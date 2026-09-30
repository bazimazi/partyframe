/** Shape of `GET /api/config`: what a server has installed, for the web app. */

import type { GameOptionFields } from "./options.js";
import type { LateJoinPolicy } from "./session.js";

export interface InstalledGameInfo {
  id: string;
  nameKey: string;
  minPlayers: number;
  maxPlayers: number;
  lateJoin: LateJoinPolicy;
  /** Whether the lobby should offer bots. */
  bots: boolean;
  /** Declared options, so the lobby can render controls without game code. */
  options: GameOptionFields;
  /** Developer shortcuts the game exposes, listed in the dev panel. */
  devCommands: string[];
}

export interface PublicServerConfig {
  /** Public origin for QR codes when the app sits behind a proxy, or "". */
  publicBaseUrl: string;
  defaultGameId: string;
  games: InstalledGameInfo[];
  /** True when the server accepts developer commands. Never true in production. */
  devTools: boolean;
}

/** Used by clients when the request fails or has not returned. Names no game. */
export const SERVER_CONFIG_FALLBACK: PublicServerConfig = {
  publicBaseUrl: "",
  defaultGameId: "",
  games: [],
  devTools: false,
};
