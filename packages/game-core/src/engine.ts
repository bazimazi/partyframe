/**
 * Drives a game's rules through a match.
 *
 * The engine owns everything about a match that is not transport: the game
 * state and options, the seeded RNG, the event queue, status requests, the
 * finished check and bot scheduling. It knows nothing about sockets or
 * Colyseus. The session room wraps it for real play; `createTestMatch()`
 * wraps it for tests, so the two can never drift apart.
 *
 * Every call into the game is guarded. A game that throws must not take the
 * session down with it: the error is reported to the host and the match goes
 * on with whatever state the game left behind.
 */

import {
  PLATFORM_EVENT,
  isRunningStatus,
  type BotDifficulty,
  type GameEventMessage,
  type MatchStatus,
  type SessionStatus,
} from "@partyframe/protocol";
import { parseGameOptions } from "./options.js";
import { Rng } from "./rng.js";
import { topScorers } from "./roster.js";
import type {
  BotStrategy,
  ControllerProjection,
  GameContext,
  PartyGame,
  PlayerChange,
  PlayerRegistry,
} from "./types.js";
import { validateSync } from "./validation.js";

/** What the engine needs from whatever is hosting the match. */
export interface EngineHost {
  /** The match roster. Only players taking part in the current match. */
  players: PlayerRegistry;
  getStatus(): SessionStatus;
  setStatus(status: SessionStatus): void;
  /** Delivers a cue to every screen, or to one player's phone when `to` is set. */
  deliver(event: GameEventMessage, to?: string): void;
  /** A game callback threw. The room logs it; the test harness rethrows. */
  onGameError(error: unknown, phase: string): void;
  /** The match just ended with these winners (several ids mean a tie). */
  onMatchEnded?(winnerIds: string[]): void;
}

export type ActionResult =
  /** The rules accepted and applied the action. */
  | { status: "applied" }
  /** The payload failed the game's `actionSchema`. */
  | { status: "invalid"; issues: readonly string[] }
  /** Well formed, but `handleAction` said it is not legal right now. */
  | { status: "refused" }
  /** `handleAction` threw. The error has already been reported to the host. */
  | { status: "error"; error: unknown };

export type OptionsResult = { ok: true } | { ok: false; issues: string[] };

interface QueuedEvent {
  event: GameEventMessage;
  to?: string;
}

interface PendingBotAction<TAction> {
  action: TAction;
  dueAt: number;
}

export class MatchEngine<TState = unknown, TOptions = unknown, TAction = unknown> {
  readonly rng: Rng;
  state: TState;
  options: TOptions;
  botDifficulty: BotDifficulty = "medium";

  private queue: QueuedEvent[] = [];
  private requested: MatchStatus | null = null;
  private strategies = new Map<BotDifficulty, BotStrategy<TState, TOptions, TAction>>();
  private pendingBots = new Map<string, PendingBotAction<TAction>>();

  constructor(
    readonly game: PartyGame<TState, TOptions, TAction, any, any>,
    private readonly host: EngineHost,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.options = this.parse({});
    this.state = game.createState(this.options);
  }

  /** True while a match is in progress and the rules should be ticking. */
  get running(): boolean {
    return isRunningStatus(this.host.getStatus());
  }

  /** Whether the game can field bots at all. */
  get supportsBots(): boolean {
    return typeof this.game.createBot === "function";
  }

  // ------------------------------------------------------------- options

  /**
   * Replaces the options for the next match. Invalid input is reported rather
   * than thrown, because it arrives from a lobby control, not from code.
   */
  setOptions(raw: unknown): OptionsResult {
    try {
      this.options = this.parse(raw);
      return { ok: true };
    } catch (error) {
      return { ok: false, issues: [error instanceof Error ? error.message : String(error)] };
    }
  }

  private parse(raw: unknown): TOptions {
    if (this.game.parseOptions) return this.game.parseOptions(raw);
    return parseGameOptions(this.game.options ?? {}, raw) as TOptions;
  }

  // ------------------------------------------------------------ lifecycle

  /** Throws away the current match state. Used when returning to the lobby. */
  resetState(): void {
    this.state = this.game.createState(this.options);
    this.pendingBots.clear();
    this.requested = null;
    this.queue = [];
  }

  /**
   * Begins a match: fresh state, `STARTING`, the game's `start` hook, then
   * `PLAYING` unless the game asked to hold the countdown.
   */
  start(now: number): void {
    this.resetState();
    this.host.setStatus("STARTING");
    this.queue.push({
      event: { kind: PLATFORM_EVENT.GAME_STARTED, messageKey: "event.gameStarted", at: now },
    });

    const ctx = this.context(now);
    this.guard("start", () => this.game.start?.(ctx));
    const holdStarting = this.requested === "STARTING";
    this.settle(ctx);
    if (this.host.getStatus() === "STARTING" && !holdStarting) {
      this.host.setStatus("PLAYING");
    }
  }

  /** Validates and applies one action from a player or a bot. */
  act(playerId: string, raw: unknown, now: number): ActionResult {
    const validated = validateSync(this.game.actionSchema, raw);
    if (!validated.ok) return { status: "invalid", issues: validated.issues };

    const ctx = this.context(now);
    let handled = false;
    let failure: { error: unknown } | null = null;
    try {
      handled = this.game.handleAction(ctx, playerId, validated.value);
    } catch (error) {
      failure = { error };
      this.host.onGameError(error, "handleAction");
    }
    this.settle(ctx);

    if (failure) return { status: "error", error: failure.error };
    return handled ? { status: "applied" } : { status: "refused" };
  }

  /** One server tick: the game's `update`, then any bot decisions that came due. */
  tick(deltaMs: number, now: number): void {
    if (!this.running) return;
    const ctx = this.context(now);
    this.guard("update", () => this.game.update?.(ctx, deltaMs));
    this.settle(ctx);
    this.tickBots(now);
  }

  /** Tells the game a player joined, left, dropped or came back. */
  playerChanged(playerId: string, change: PlayerChange, now: number): void {
    const hook = this.game.onPlayerChanged;
    if (!hook) return;
    const ctx = this.context(now);
    this.guard("onPlayerChanged", () => hook.call(this.game, ctx, playerId, change));
    this.settle(ctx);
  }

  /** Runs a developer shortcut declared by the game. False when it has none by that name. */
  runDevCommand(name: string, value: number | undefined, now: number): boolean {
    const handler = this.game.devCommands?.[name];
    if (!handler) return false;
    const ctx = this.context(now);
    this.guard(`devCommand:${name}`, () => handler(ctx, value));
    this.settle(ctx);
    return true;
  }

  // ---------------------------------------------------------- projections

  controllerState(playerId: string, now: number): ControllerProjection {
    try {
      return this.game.getControllerState(this.context(now), playerId);
    } catch (error) {
      this.host.onGameError(error, "getControllerState");
      return { active: false, game: null };
    }
  }

  /** The shared-screen projection, or `undefined` when the game threw. */
  publicState(now: number): unknown {
    try {
      return this.game.getPublicState(this.context(now));
    } catch (error) {
      this.host.onGameError(error, "getPublicState");
      return undefined;
    }
  }

  /** Winner ids. The game decides; otherwise the top scorers, or nobody. */
  winners(now: number): string[] {
    try {
      if (this.game.getWinners) return this.game.getWinners(this.context(now));
      return topScorers(this.host.players.all()).map((player) => player.id);
    } catch (error) {
      this.host.onGameError(error, "getWinners");
      return [];
    }
  }

  // ---------------------------------------------------------------- bots

  private strategy(): BotStrategy<TState, TOptions, TAction> | null {
    if (!this.game.createBot) return null;
    let strategy = this.strategies.get(this.botDifficulty);
    if (!strategy) {
      strategy = this.game.createBot(this.botDifficulty);
      this.strategies.set(this.botDifficulty, strategy);
    }
    return strategy;
  }

  /**
   * Drives every bot through the human action path.
   *
   * A bot never mutates game state directly: it produces the same payload a
   * phone would send, and that payload goes through the same validation and the
   * same `handleAction` call.
   */
  private tickBots(now: number): void {
    const bots = this.host.players.all().filter((player) => player.isBot);
    if (bots.length === 0) return;
    const strategy = this.strategy();
    if (!strategy) return;

    for (const bot of bots) {
      if (!this.running) return;

      const pending = this.pendingBots.get(bot.id);
      if (pending) {
        if (now < pending.dueAt) continue;
        this.pendingBots.delete(bot.id);
        this.act(bot.id, pending.action, now);
        continue;
      }

      let decision: ReturnType<typeof strategy.decide>;
      try {
        decision = strategy.decide(this.context(now), bot.id);
      } catch (error) {
        this.host.onGameError(error, "bot");
        continue;
      }
      if (decision) {
        this.pendingBots.set(bot.id, {
          action: decision.action,
          dueAt: now + Math.max(0, decision.delayMs),
        });
      }
    }
  }

  // ------------------------------------------------------------ internals

  /** Everything a rule function may touch, for one call at one instant. */
  context(now: number): GameContext<TState, TOptions> {
    return {
      state: this.state,
      options: this.options,
      players: this.host.players,
      rng: this.rng,
      now,
      emit: (event) => {
        this.queue.push({ event: { ...event, at: now } });
      },
      emitTo: (playerId, event) => {
        this.queue.push({ event: { ...event, at: now }, to: playerId });
      },
      requestStatus: (status) => {
        this.requested = status;
      },
    };
  }

  private guard(phase: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.host.onGameError(error, phase);
    }
  }

  /** Ends the call: finished check, status request, then queued cues go out. */
  private settle(ctx: GameContext<TState, TOptions>): void {
    if (this.running && this.requested !== "GAME_OVER") {
      let finished = false;
      this.guard("isFinished", () => {
        finished = this.game.isFinished(ctx);
      });
      if (finished) this.requested = "GAME_OVER";
    }
    this.applyRequested(ctx.now);
    this.flush();
  }

  /**
   * Applies a status the game asked for, filtered by what the platform allows.
   *
   * The game may move between playing states, but it may not put the session
   * back into the lobby or close it - those are platform decisions.
   */
  private applyRequested(now: number): void {
    const requested = this.requested;
    this.requested = null;
    if (!requested || !this.running) return;

    if (requested === "PLAYING" || requested === "ROUND_END") {
      this.host.setStatus(requested);
      return;
    }
    if (requested === "GAME_OVER") {
      const winners = this.winners(now);
      this.pendingBots.clear();
      this.host.setStatus("GAME_OVER");
      this.queue.push({
        event: {
          kind: PLATFORM_EVENT.GAME_ENDED,
          messageKey: "event.gameEnded",
          params: { winners: winners.join(",") },
          ...(winners.length === 1 ? { playerId: winners[0] } : {}),
          at: now,
        },
      });
      this.host.onMatchEnded?.(winners);
    }
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    const queued = this.queue;
    this.queue = [];
    for (const { event, to } of queued) this.host.deliver(event, to);
  }
}
