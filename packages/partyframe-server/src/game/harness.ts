/**
 * A headless match for unit-testing game rules.
 *
 * Runs the same `MatchEngine` the server does, with an in-memory roster and a
 * clock you control, so a whole match can be scripted in a few lines:
 *
 * ```ts
 * const match = createTestMatch(tapGame, { players: ["ali", "sara"], seed: 1 });
 * match.start();
 * match.act("ali", { type: "tap" });
 * match.advance(5_000);
 * expect(match.status).toBe("GAME_OVER");
 * ```
 *
 * Time never passes on its own: `tick()` and `advance()` are the only clocks,
 * which is what makes a test reproducible. A game callback that throws fails
 * the test rather than being logged, unlike on the server.
 */

import {
  SERVER_TICK_MS,
  type BotDifficulty,
  type GameEventMessage,
  type SessionStatus,
} from "@partyframe/protocol";
import { MatchEngine, type ActionResult } from "./engine.js";
import { rankPlayers } from "./roster.js";
import type { ControllerProjection, GamePlayer, PartyGame, PlayerRegistry } from "./types.js";

export interface TestMatchConfig {
  /** Player ids to seat, or how many to seat as `p1`..`pN`. Defaults to 2. */
  players?: readonly string[] | number;
  /** Bots to seat in addition to the players. */
  bots?: number;
  botDifficulty?: BotDifficulty;
  /** RNG seed. The same seed and script produce the same match. */
  seed?: number;
  /** Raw host options, parsed exactly as lobby input would be. */
  options?: unknown;
  /** Starting clock in epoch ms. */
  now?: number;
  /** Tick length used by `advance()`. Defaults to the server's tick. */
  tickMs?: number;
}

/** A cue as the engine delivered it, with the recipient when it was private. */
export interface RecordedEvent extends GameEventMessage {
  to?: string;
}

interface MutablePlayer extends GamePlayer {
  score: number;
}

export class TestMatch<
  TState = unknown,
  TOptions = unknown,
  TAction = unknown,
  TController = unknown,
  TPublic = unknown,
> {
  readonly engine: MatchEngine<TState, TOptions, TAction>;
  /** Current clock in epoch ms. Advanced only by `tick()` and `advance()`. */
  now: number;
  status: SessionStatus = "LOBBY";
  /** Every status the match has been in, oldest first. */
  readonly statusLog: SessionStatus[] = [];
  /** Every cue delivered so far, broadcast and private alike. */
  readonly events: RecordedEvent[] = [];
  /** Winners reported when the last match ended. */
  winnerIds: string[] = [];

  private readonly tickMs: number;
  private roster: MutablePlayer[] = [];
  private seats = 0;
  private botSerial = 0;

  constructor(
    readonly game: PartyGame<TState, TOptions, TAction, TController, TPublic>,
    config: TestMatchConfig = {},
  ) {
    this.now = config.now ?? 1_700_000_000_000;
    this.tickMs = config.tickMs ?? SERVER_TICK_MS;

    const registry = this.createRegistry();
    this.engine = new MatchEngine<TState, TOptions, TAction>(
      game,
      {
        players: registry,
        getStatus: () => this.status,
        setStatus: (status) => {
          this.status = status;
          this.statusLog.push(status);
        },
        deliver: (event, to) => {
          this.events.push(to === undefined ? event : { ...event, to });
        },
        onGameError: (error) => {
          throw error;
        },
        onMatchEnded: (winnerIds) => {
          this.winnerIds = winnerIds;
          for (const winner of winnerIds) {
            const row = this.roster.find((player) => player.id === winner);
            if (row) row.wins += 1;
          }
        },
      },
      config.seed ?? 1,
    );

    if (config.botDifficulty) this.engine.botDifficulty = config.botDifficulty;
    if (config.options !== undefined) this.setOptions(config.options);

    const ids =
      typeof config.players === "number"
        ? Array.from({ length: config.players }, (_, i) => `p${i + 1}`)
        : (config.players ?? ["p1", "p2"]);
    for (const id of ids) this.addPlayer(id);
    for (let i = 0; i < (config.bots ?? 0); i += 1) this.addBot();
  }

  // -------------------------------------------------------------- roster

  get players(): readonly GamePlayer[] {
    return this.roster.map((player) => ({ ...player }));
  }

  get state(): TState {
    return this.engine.state;
  }

  get options(): TOptions {
    return this.engine.options;
  }

  /** Seats a player. During a match this is a late join with the `play` policy. */
  addPlayer(id: string, init: { name?: string; bot?: boolean } = {}): void {
    if (this.roster.some((player) => player.id === id)) {
      throw new Error(`TestMatch: player "${id}" is already seated`);
    }
    this.roster.push({
      id,
      name: init.name ?? id,
      isBot: init.bot ?? false,
      connected: true,
      score: 0,
      wins: 0,
      seat: this.seats++,
    });
    this.engine.playerChanged(id, "joined", this.now);
  }

  addBot(id = `bot-${++this.botSerial}`): string {
    this.addPlayer(id, { bot: true, name: id });
    return id;
  }

  removePlayer(id: string): void {
    this.requirePlayer(id);
    this.roster = this.roster.filter((player) => player.id !== id);
    this.engine.playerChanged(id, "left", this.now);
  }

  disconnect(id: string): void {
    this.requirePlayer(id).connected = false;
    this.engine.playerChanged(id, "disconnected", this.now);
  }

  reconnect(id: string): void {
    this.requirePlayer(id).connected = true;
    this.engine.playerChanged(id, "reconnected", this.now);
  }

  score(id: string): number {
    return this.requirePlayer(id).score;
  }

  // ----------------------------------------------------------- lifecycle

  /** Applies host options. Throws when the game rejects them. */
  setOptions(raw: unknown): void {
    const result = this.engine.setOptions(raw);
    if (!result.ok) throw new Error(`TestMatch: invalid options: ${result.issues.join("; ")}`);
  }

  /** Starts a match, as the host pressing "Start" would. */
  start(): void {
    if (this.roster.length < this.game.minPlayers) {
      throw new Error(
        `TestMatch: ${this.game.id} needs ${this.game.minPlayers} players, has ${this.roster.length}`,
      );
    }
    for (const player of this.roster) player.score = 0;
    this.winnerIds = [];
    this.engine.start(this.now);
  }

  /** Starts another match with the same seats. Scores reset, wins persist. */
  rematch(): void {
    if (this.status !== "GAME_OVER") throw new Error("TestMatch: rematch requires GAME_OVER");
    this.start();
  }

  returnToLobby(): void {
    for (const player of this.roster) player.score = 0;
    this.engine.resetState();
    this.status = "LOBBY";
    this.statusLog.push("LOBBY");
  }

  /** Submits an action for a seated player. Throws if the match is not running. */
  act(playerId: string, action: TAction): ActionResult {
    this.requirePlayer(playerId);
    if (!this.engine.running) {
      throw new Error(`TestMatch: cannot act while status is ${this.status}`);
    }
    return this.engine.act(playerId, action, this.now);
  }

  /** Runs one server tick. */
  tick(deltaMs = this.tickMs): void {
    this.now += deltaMs;
    this.engine.tick(deltaMs, this.now);
  }

  /** Runs ticks until `ms` have elapsed. */
  advance(ms: number): void {
    let remaining = ms;
    while (remaining > 0) {
      const step = Math.min(this.tickMs, remaining);
      this.tick(step);
      remaining -= step;
    }
  }

  /** Advances until the predicate holds, failing after `maxMs` of game time. */
  advanceUntil(predicate: () => boolean, maxMs = 60_000): void {
    let elapsed = 0;
    while (!predicate()) {
      if (elapsed >= maxMs) throw new Error(`TestMatch: condition not met within ${maxMs}ms`);
      this.tick();
      elapsed += this.tickMs;
    }
  }

  devCommand(name: string, value?: number): boolean {
    return this.engine.runDevCommand(name, value, this.now);
  }

  // --------------------------------------------------------- projections

  publicState(): TPublic {
    return this.engine.publicState(this.now) as TPublic;
  }

  controller(playerId: string): ControllerProjection<TController> {
    return this.engine.controllerState(playerId, this.now) as ControllerProjection<TController>;
  }

  winners(): string[] {
    return this.engine.winners(this.now);
  }

  /** Cues of one kind, in delivery order. */
  eventsOfKind(kind: string): RecordedEvent[] {
    return this.events.filter((event) => event.kind === kind);
  }

  clearEvents(): void {
    this.events.length = 0;
  }

  // ----------------------------------------------------------- internals

  private requirePlayer(id: string): MutablePlayer {
    const player = this.roster.find((candidate) => candidate.id === id);
    if (!player) throw new Error(`TestMatch: no player "${id}"`);
    return player;
  }

  private createRegistry(): PlayerRegistry {
    const snapshot = (player: MutablePlayer): GamePlayer => ({ ...player });
    return {
      all: () => this.roster.map(snapshot),
      get: (id) => {
        const row = this.roster.find((player) => player.id === id);
        return row ? snapshot(row) : undefined;
      },
      has: (id) => this.roster.some((player) => player.id === id),
      connected: () => this.roster.filter((player) => player.connected).map(snapshot),
      ranked: () => rankPlayers(this.roster).map(snapshot),
      addScore: (id, delta) => {
        const row = this.roster.find((player) => player.id === id);
        if (row) row.score = Math.max(0, row.score + delta);
      },
      setScore: (id, score) => {
        const row = this.roster.find((player) => player.id === id);
        if (row) row.score = Math.max(0, score);
      },
    };
  }
}

/** Creates a headless match for a game. See `TestMatch`. */
export function createTestMatch<TState, TOptions, TAction, TController, TPublic>(
  game: PartyGame<TState, TOptions, TAction, TController, TPublic>,
  config: TestMatchConfig = {},
): TestMatch<TState, TOptions, TAction, TController, TPublic> {
  return new TestMatch(game, config);
}
