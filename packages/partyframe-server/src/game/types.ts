/**
 * The game plugin contract.
 *
 * A game supplies rules only. It never touches sockets, Colyseus schema, Phaser
 * or the DOM, which is what makes it unit-testable in Node with
 * `createTestMatch()` and what lets the same rules drive bots, replays and a
 * future headless simulator.
 *
 * The platform supplies everything else: sessions, room codes, QR joining,
 * players, bots, reconnection, lobby, scoring storage and the session lifecycle.
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  BotDifficulty,
  GameEventInput,
  LateJoinPolicy,
  MatchStatus,
} from "@partyframe/protocol";
import type { GameOptionFields } from "./options.js";
import type { Rng } from "./rng.js";

/** A player as the game rules see them. Deliberately minimal. */
export interface GamePlayer {
  id: string;
  name: string;
  isBot: boolean;
  /** False while the player is inside their reconnection grace period. */
  connected: boolean;
  /** Score in the current match. */
  score: number;
  /** Matches won earlier in this session. */
  wins: number;
  seat: number;
}

/**
 * Read/write access to the match roster, owned by the platform.
 *
 * Scores live here rather than in game state so that the lobby, scoreboard and
 * rematch flow work identically for every game. The roster contains only the
 * players taking part in the current match: late joiners who are spectating
 * are not in it until the next match starts.
 */
export interface PlayerRegistry {
  /** Everyone in the match, ordered by seat. */
  all(): readonly GamePlayer[];
  get(playerId: string): GamePlayer | undefined;
  has(playerId: string): boolean;
  /** Players who are currently connected (bots always are). */
  connected(): readonly GamePlayer[];
  /** Everyone, highest score first; ties keep seat order. */
  ranked(): readonly GamePlayer[];
  addScore(playerId: string, delta: number): void;
  setScore(playerId: string, score: number): void;
}

/** Everything a game rule function is allowed to touch. */
export interface GameContext<TState, TOptions> {
  state: TState;
  options: TOptions;
  players: PlayerRegistry;
  /** Seeded, server-owned randomness. Never use `Math.random` in a game. */
  rng: Rng;
  /** Authoritative server time in epoch ms, fixed for the duration of the call. */
  now: number;
  /** Queues a presentation cue for every screen. Never authoritative. */
  emit(event: GameEventInput): void;
  /** Queues a presentation cue for one player's phone only, e.g. "wrong answer". */
  emitTo(playerId: string, event: GameEventInput): void;
  /**
   * Asks the platform to move the match to another status. The platform may
   * refuse (for example, it will not leave `GAME_OVER` on its own).
   */
  requestStatus(status: MatchStatus): void;
}

/** The per-player projection a game hands to one phone. */
export interface ControllerProjection<TController = unknown> {
  /** True while this player may act at all (not eliminated, not spectating). */
  active: boolean;
  /** Game-specific view for this one player. Opaque to the platform. */
  game: TController;
}

/** A decision a bot wants to make, and how long to pretend to think first. */
export interface BotDecision<TAction> {
  action: TAction;
  /** Delay in ms before the action is submitted, applied by the platform. */
  delayMs: number;
}

/**
 * Bot behaviour for one game.
 *
 * A strategy returns the same action shape a phone would send, so bot input
 * flows through the identical validate-authorise-execute path as human input.
 * There is no bot-only branch inside the rules.
 */
export interface BotStrategy<TState, TOptions, TAction> {
  difficulty: BotDifficulty;
  /**
   * Returns the bot's next intent, or `null` when it has nothing to do.
   *
   * Called on every server tick for every bot, so it must be cheap and must not
   * mutate state. The platform de-duplicates: while a decision is pending, the
   * strategy is not consulted again.
   */
  decide(ctx: GameContext<TState, TOptions>, botId: string): BotDecision<TAction> | null;
}

export type PlayerChange = "joined" | "left" | "disconnected" | "reconnected";

/** A token bucket: `capacity` is the burst, `refillPerSecond` the sustained rate. */
export interface RateLimitOptions {
  capacity: number;
  refillPerSecond: number;
}

/**
 * A playable game.
 *
 * `TState` is the game's own plain-object state. It is the source of truth on
 * the server; what reaches the wire is the projection returned by
 * `getPublicState`, serialised by the platform.
 */
export interface PartyGame<
  TState = unknown,
  TOptions = unknown,
  TAction = unknown,
  TController = unknown,
  TPublic = unknown,
> {
  readonly id: string;
  /** i18n key for the display name, not a pre-translated string. */
  readonly nameKey: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;

  /**
   * Host-configurable options, declared as data.
   *
   * The lobby renders a control per field and the platform validates input
   * against it. `ctx.options` is typed from this declaration when
   * `parseOptions` is not supplied.
   */
  readonly options?: GameOptionFields;

  /** Custom validation of the host's option input. Defaults to `options`. */
  parseOptions?(raw: unknown): TOptions;

  /**
   * What happens to a player who joins while a match is running.
   *
   * - `spectate` (default): they wait on their phone and play the next match.
   * - `play`: they enter the running match; `onPlayerChanged` is called.
   * - `deny`: the join is refused with `GAME_IN_PROGRESS`.
   */
  readonly lateJoin?: LateJoinPolicy;

  /**
   * Runtime validator for `game-action` payloads.
   *
   * Typed as a Standard Schema so a game may use Zod, Valibot or anything else
   * without the platform depending on that choice.
   */
  readonly actionSchema: StandardSchemaV1<unknown, TAction>;

  /**
   * How many actions one phone may send. The default (8 burst, 4 per second)
   * suits button presses; a game that streams input - drawing strokes, a
   * tilt sensor - raises it, e.g. `{ capacity: 40, refillPerSecond: 20 }`.
   */
  readonly actionRateLimit?: RateLimitOptions;

  /** Fresh state for a new match. Must not read any ambient clock or randomness. */
  createState(options: TOptions): TState;

  /**
   * Called once after the host starts a match, while the session is `STARTING`.
   *
   * Call `ctx.requestStatus("PLAYING")` to begin immediately, or
   * `ctx.requestStatus("STARTING")` to keep a countdown and move to `PLAYING`
   * later from `update()`. If you request nothing, the platform enters
   * `PLAYING` for you so phones do not sit on "Starting...".
   */
  start?(ctx: GameContext<TState, TOptions>): void;

  /**
   * Applies one validated action.
   *
   * Returning `false` means the action was well formed but not legal right now
   * (wrong turn, wrong phase, duplicate submission). The platform turns that
   * into a `WRONG_STATE` error for the sender.
   */
  handleAction(ctx: GameContext<TState, TOptions>, playerId: string, action: TAction): boolean;

  /** Server tick. Owns all timing: fuses, deadlines, round transitions. */
  update?(ctx: GameContext<TState, TOptions>, deltaMs: number): void;

  /** True once the match is over. Checked after every action and tick. */
  isFinished(ctx: GameContext<TState, TOptions>): boolean;

  /** Called when a player disconnects, joins mid-game, or is removed. */
  onPlayerChanged?(
    ctx: GameContext<TState, TOptions>,
    playerId: string,
    change: PlayerChange,
  ): void;

  /** The per-player projection sent to one phone. */
  getControllerState(
    ctx: GameContext<TState, TOptions>,
    playerId: string,
  ): ControllerProjection<TController>;

  /** The projection broadcast to the shared screen. */
  getPublicState(ctx: GameContext<TState, TOptions>): TPublic;

  /**
   * Who won, once `isFinished` is true. Defaults to everyone sharing the top
   * score, or nobody when no one scored. Several ids mean a tie.
   */
  getWinners?(ctx: GameContext<TState, TOptions>): string[];

  /** Builds a bot for the requested difficulty. Omit it and the lobby offers no bots. */
  createBot?(difficulty: BotDifficulty): BotStrategy<TState, TOptions, TAction>;

  /** Developer-mode shortcuts, e.g. skipping a round. Never reachable in production. */
  devCommands?: Record<string, (ctx: GameContext<TState, TOptions>, value?: number) => void>;
}

/** Convenience alias for a fully-erased game, used by the platform registry. */

export type AnyPartyGame = PartyGame<any, any, any, any, any>;

/** Type-level accessors for a defined game, handy when typing web components. */
export type GameState<G> = G extends PartyGame<infer S, any, any, any, any> ? S : never;
export type GameOptions<G> = G extends PartyGame<any, infer O, any, any, any> ? O : never;
export type GameAction<G> = G extends PartyGame<any, any, infer A, any, any> ? A : never;
export type GameControllerState<G> = G extends PartyGame<any, any, any, infer C, any> ? C : never;
export type GamePublicState<G> = G extends PartyGame<any, any, any, any, infer P> ? P : never;
