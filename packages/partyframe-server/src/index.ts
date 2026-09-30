// ---- Writing games: the rules contract, helpers and the test harness.
export {
  defineGame,
  defaultGameOptions,
  parseGameOptions,
  Rng,
  randomSeed,
  validateSync,
  startDeadline,
  remainingMs,
  hasExpired,
  elapsedFraction,
  rankPlayers,
  topScorers,
  nextPlayer,
  createTestMatch,
  TestMatch,
  MatchEngine,
  getGame,
  listGames,
  registerGame,
  requireGame,
  resetRegistry,
  type ActionResult,
  type AnyPartyGame,
  type BooleanOptionField,
  type BotDecision,
  type BotStrategy,
  type ControllerProjection,
  type Deadline,
  type EngineHost,
  type GameAction,
  type GameContext,
  type GameControllerState,
  type GameDefinition,
  type GameOptionField,
  type GameOptionFields,
  type GameOptions,
  type GamePlayer,
  type GamePublicState,
  type GameState,
  type NumberOptionField,
  type OptionValues,
  type PartyGame,
  type PlayerChange,
  type PlayerRegistry,
  type RateLimitOptions,
  type RecordedEvent,
  type SelectOptionField,
  type TestMatchConfig,
  type ValidationResult,
} from "@partyframe/game-core";

// ---- Wire contract, re-exported so a game never needs the private package.
export {
  ABSOLUTE_MAX_PLAYERS,
  AVATARS,
  PLAYER_COLORS,
  PLAYER_NAME_MAX,
  PLATFORM_EVENT,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SERVER_TICK_MS,
  sanitizeText,
  textSchema,
  type BotDifficulty,
  type ControllerEnvelope,
  type GameEventInput,
  type GameEventMessage,
  type InstalledGameInfo,
  type LateJoinPolicy,
  type MatchStatus,
  type PartyErrorCode,
  type SessionStatus,
} from "@partyframe/protocol";

// ---- Running a server.
export {
  listen,
  publicServerConfig,
  type ListenOptions,
  type PartyServer,
  type PublicServerConfig,
} from "./listen.js";
export {
  EVENT,
  RUNTIME_DEFAULTS,
  bindRuntime,
  createConsoleLogger,
  resetRuntimeHost,
  runtimeHost,
  silentLogger,
  type BindRuntimeInput,
  type LogContext,
  type Logger,
  type RootLogger,
  type RuntimeHost,
} from "./bind.js";
export {
  describeGame,
  getAdapter,
  install,
  isNetworkAdapter,
  jsonAdapter,
  listAdapterIds,
  listInstalledGames,
  requireAdapter,
  resetAdapters,
  type GameNetworkAdapter,
} from "./adapters.js";
export { PartySessionRoom, type RoomCreateOptions, type RoomMetadata } from "./PartySessionRoom.js";

// ---- Custom network adapters. One copy of @colyseus/schema, re-exported so a
// game's schema classes and the room's always agree on the decorator registry.
export {
  JsonSessionSchema,
  PlayerSchema,
  SessionSchema,
  SettingsSchema,
  setIfChanged,
} from "./sessionSchema.js";
export { ArraySchema, MapSchema, Schema, type, defineTypes } from "@colyseus/schema";

// ---- Lower-level pieces, exported for tests and unusual hosts.
export { generateRoomCode, generateUniqueRoomCode, isRoomCodeShaped } from "./roomCode.js";
export {
  CLOCK_PING_LIMITS,
  GAME_ACTION_LIMITS,
  RateLimiter,
  SESSION_ACTION_LIMITS,
  type BucketOptions,
} from "./rateLimit.js";
export { makeBotIdentity, type BotIdentity } from "./bots.js";
