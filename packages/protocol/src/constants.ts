/**
 * Wire-level constants shared by the server and every client.
 *
 * Anything in this file is part of the network contract. Changing a value here
 * changes behaviour on both sides of the socket, so treat it as a versioned API.
 */

/** Colyseus room definition name. One room type serves every game. */
export const PARTY_ROOM = "party";

/**
 * Alphabet used for public room codes.
 *
 * Deliberately excludes visually ambiguous glyphs (0/O, 1/I/L, 5/S, 2/Z, 8/B)
 * so a code can be read off a TV across a room and typed without mistakes.
 */
export const ROOM_CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";

/** Length of a public room code. 25^4 = 390 625 possible codes. */
export const ROOM_CODE_LENGTH = 4;

/** Maximum accepted length of a single client -> server message payload, in bytes. */
export const MAX_MESSAGE_BYTES = 2048;

/** Player display-name bounds, enforced by schema on both sides. */
export const PLAYER_NAME_MIN = 1;
export const PLAYER_NAME_MAX = 16;

/** Hard ceiling on players in one session, regardless of host settings. */
export const ABSOLUTE_MAX_PLAYERS = 8;

/** Reconnection grace period, in seconds, for a dropped controller. */
export const PLAYER_RECONNECT_SECONDS = 90;

/** Reconnection grace period, in seconds, for a dropped shared screen. */
export const HOST_RECONNECT_SECONDS = 180;

/** Server tick interval for game logic, in milliseconds. */
export const SERVER_TICK_MS = 100;

/** How often the server broadcasts a clock beacon, in milliseconds. */
export const CLOCK_BEACON_MS = 5000;

/** Avatar choices offered to players. Emoji keeps the prototype asset-free. */
export const AVATARS = [
  "🦊",
  "🐼",
  "🐙",
  "🦄",
  "🐸",
  "🐧",
  "🦖",
  "🐝",
  "👻",
  "🤖",
  "🐨",
  "🦉",
] as const;

/** Distinct, high-contrast player colours. Never the only identity signal. */
export const PLAYER_COLORS = [
  "#ff5d5d",
  "#ffb020",
  "#ffe14d",
  "#54d66a",
  "#3fc7d4",
  "#5b8cff",
  "#b579ff",
  "#ff6fc4",
] as const;

/**
 * i18n key suffix for each colour, so a colour swatch can be announced to a
 * screen reader as "Coral" rather than "#ff5d5d".
 */
export const PLAYER_COLOR_NAMES: Readonly<Record<(typeof PLAYER_COLORS)[number], string>> = {
  "#ff5d5d": "coral",
  "#ffb020": "orange",
  "#ffe14d": "yellow",
  "#54d66a": "green",
  "#3fc7d4": "teal",
  "#5b8cff": "blue",
  "#b579ff": "purple",
  "#ff6fc4": "pink",
};

/** WebSocket close codes this platform uses. Colyseus reserves everything below 4000. */
export const CLOSE_CODE = {
  /** The player was removed by the host. */
  KICKED: 4001,
  /** The session ended or expired; reconnecting is pointless. */
  SESSION_ENDED: 4002,
  /** A join was refused; the reason travels as a `PartyErrorCode`. */
  JOIN_REFUSED: 4400,
} as const;
