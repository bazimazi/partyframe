/** Session, player and controller types shared across the whole platform. */

/**
 * Lifecycle of a game session.
 *
 * `CREATED` exists only between room construction and the host attaching; a
 * client that observes it should render the connecting state, not the lobby.
 */
export type SessionStatus =
  "CREATED" | "LOBBY" | "STARTING" | "PLAYING" | "ROUND_END" | "GAME_OVER" | "CLOSED";

/** The subset of statuses a game may move the session between. */
export type MatchStatus = "STARTING" | "PLAYING" | "ROUND_END" | "GAME_OVER";

/** Statuses in which a match is in progress and the game's rules are ticking. */
export const RUNNING_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "STARTING",
  "PLAYING",
  "ROUND_END",
]);

export function isRunningStatus(status: SessionStatus): boolean {
  return RUNNING_STATUSES.has(status);
}

/** Which experience a connected client is presenting. */
export type ClientRole = "host" | "controller";

/**
 * What the phone should be rendering right now.
 *
 * The server derives this from session status so that a controller never has to
 * infer its own mode from game-specific state. `spectating` is a player who
 * joined while a match was running and is waiting for the next one.
 */
export type ControllerMode =
  "setup" | "lobby" | "starting" | "game" | "round-end" | "game-over" | "spectating";

export type BotDifficulty = "easy" | "medium" | "hard";

/** What happens to a player who joins while a match is already running. */
export type LateJoinPolicy = "spectate" | "play" | "deny";

/** Player as seen by clients. Contains no tokens and no server internals. */
export interface ClientPlayer {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
  /** Score in the current match. Reset when a new match starts. */
  score: number;
  /** Matches won in this session. Survives rematches. */
  wins: number;
  /** Join order, used for stable seat ordering on the shared screen. */
  seat: number;
  /**
   * False between the socket opening and the player submitting their profile.
   *
   * An unjoined row already holds a seat, which is what makes the capacity check
   * and reconnection work, but it is hidden from the lobby.
   */
  joined: boolean;
  /** True for a late joiner who sits out the current match. */
  spectator: boolean;
}

/** Host-configurable session settings. */
export interface SessionSettings {
  maxPlayers: number;
  botCount: number;
  botDifficulty: BotDifficulty;
  /** Game-specific settings, validated and defaulted by the active game. */
  gameOptions: Record<string, unknown>;
}

/** Credentials a client persists so it can resume its seat after a drop. */
export interface StoredCredentials {
  roomId: string;
  roomCode: string;
  reconnectionToken: string;
  playerId: string;
  role: ClientRole;
  /** Epoch ms after which the credentials are assumed dead. */
  expiresAt: number;
}

/** Response of `GET /api/rooms/:code`. */
export interface RoomLookupResponse {
  roomId: string;
  roomCode: string;
  gameId: string;
  status: SessionStatus;
  playerCount: number;
  maxPlayers: number;
  lateJoin: LateJoinPolicy;
  /** True when a new controller can take a seat right now. */
  joinable: boolean;
}

/** Machine-readable failure reasons surfaced to the UI. */
export type PartyErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_CLOSED"
  | "GAME_IN_PROGRESS"
  | "NOT_ENOUGH_PLAYERS"
  | "SERVER_FULL"
  | "INVALID_PAYLOAD"
  | "NOT_ALLOWED"
  | "RATE_LIMITED"
  | "UNKNOWN_ACTION"
  | "WRONG_STATE"
  | "INTERNAL";

export const PARTY_ERROR_CODES: readonly PartyErrorCode[] = [
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "ROOM_CLOSED",
  "GAME_IN_PROGRESS",
  "NOT_ENOUGH_PLAYERS",
  "SERVER_FULL",
  "INVALID_PAYLOAD",
  "NOT_ALLOWED",
  "RATE_LIMITED",
  "UNKNOWN_ACTION",
  "WRONG_STATE",
  "INTERNAL",
];

/** Error envelope pushed to a single client over the `error` message channel. */
export interface PartyError {
  code: PartyErrorCode;
  /** i18n key; clients localise this rather than showing raw server text. */
  messageKey: string;
}

/**
 * Plain, immutable snapshot of the synchronised session state.
 *
 * Clients convert the live Colyseus schema into one of these before handing it
 * to React, so components receive ordinary data they can memoise on rather than
 * a mutable object that changes identity twenty times a second.
 */
export interface SessionSnapshot {
  publicCode: string;
  status: SessionStatus;
  gameId: string;
  serverTime: number;
  /** Every seat, ordered, including rows that have not finished joining. */
  players: ClientPlayer[];
  settings: SessionSettings;
  hostPlayerId: string;
  hostConnected: boolean;
  /** Bumped whenever the game projection below changes, for cheap change checks. */
  gameRevision: number;
  /** Winner(s) of the last finished match. Empty until `GAME_OVER`. */
  winnerIds: string[];
  /** The active game's public projection. Shape is defined by that game. */
  game: unknown;
}
