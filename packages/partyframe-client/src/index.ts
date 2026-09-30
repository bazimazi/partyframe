// ---- Wiring a host app.
export { PartyApp, PartyRoutes } from "./PartyApp.js";
export {
  bindKit,
  getWebGame,
  loadSceneForGame,
  resetKit,
  type GameSceneClass,
  type KitCatalog,
  type LegacyKitCatalog,
} from "./bind.js";
export { configureClient, clientConfig, type ClientConfig } from "./config.js";

// ---- Writing a web game.
export {
  defineWebGame,
  type AnyWebGame,
  type ControllerPanelProps,
  type PlayerBadge,
  type ScreenProps,
  type WebGame,
} from "./types.js";
export { FuseBar } from "./FuseBar.js";
export { createStageBridge, drainEvents, type StageBridge } from "./bridge.js";
export { PLATFORM_SFX, voiceForEvent } from "./cues.js";
export { haptic, sfx, type BuiltinVoice, type Voice, type VoicePlayer } from "./sfx.js";
export { PlayerAvatar, ConnectionBadge, ErrorScreen, LoadingScreen } from "./ui/common.js";
export { PlayerGrid } from "./shared-screen/PlayerGrid.js";
export { Countdown } from "./ui/game/Countdown.js";
export { Scoreboard, type ScoreboardProps } from "./ui/game/Scoreboard.js";
export { Confetti } from "./ui/game/Confetti.js";
export { ChoiceGrid, type Choice } from "./ui/game/ChoiceGrid.js";
export { TextEntry } from "./ui/game/TextEntry.js";

// ---- Routes, for apps that compose their own router.
export { HostRoute } from "./shared-screen/HostRoute.js";
export { LandingRoute } from "./shared-screen/LandingRoute.js";
export { JoinLanding } from "./controller/JoinLanding.js";
export { JoinRoute } from "./controller/JoinRoute.js";

// ---- Localisation.
export { I18nProvider, useI18n, useT } from "./i18n/I18nProvider.js";
export { LocaleSwitcher } from "./i18n/LocaleSwitcher.js";
export {
  addMessages,
  createTranslator,
  getLocale,
  listLocales,
  registerLocale,
  resolveLocale,
  type LocaleDefinition,
  type PartialDictionary,
  type Translate,
  type TranslateParams,
  type TranslationKey,
} from "@partyframe/i18n";

// ---- Networking, for custom shells.
export {
  useServerConfig,
  fetchServerConfig,
  type ServerConfigResponse,
} from "./net/useServerConfig.js";
export {
  SessionConnection,
  type ConnectOptions,
  type ConnectionStatus,
  type SessionView,
} from "./net/SessionConnection.js";
export { useSession, type UseSessionResult } from "./net/useSession.js";
export { ClockSync } from "./net/clock.js";
export {
  resolveServerHttpUrl,
  resolveJoinBaseUrl,
  buildJoinUrl,
  isLoopbackHost,
} from "./net/endpoint.js";

// ---- Wire contract, re-exported so a game never needs the private package.
export {
  AVATARS,
  PLAYER_COLORS,
  PLAYER_COLOR_NAMES,
  PLATFORM_EVENT,
  SERVER_CONFIG_FALLBACK,
  sanitizeText,
  type ClientPlayer,
  type ControllerEnvelope,
  type ControllerMode,
  type GameEventMessage,
  type GameOptionFields,
  type InstalledGameInfo,
  type PartyError,
  type PartyErrorCode,
  type PublicServerConfig,
  type SessionAction,
  type SessionSettings,
  type SessionSnapshot,
  type SessionStatus,
} from "@partyframe/protocol";
