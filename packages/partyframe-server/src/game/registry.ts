/**
 * Registry of installed games.
 *
 * The server resolves a session's `gameId` through this map, so adding a game to
 * the platform is a single `register()` call plus a controller component on the
 * web side. Nothing in the session, lobby or networking layer changes.
 */

import type { AnyPartyGame } from "./types.js";

const games = new Map<string, AnyPartyGame>();

export function registerGame(game: AnyPartyGame): void {
  if (games.has(game.id)) {
    throw new Error(`Game "${game.id}" is already registered`);
  }
  games.set(game.id, game);
}

export function getGame(gameId: string): AnyPartyGame | undefined {
  return games.get(gameId);
}

/** Throws with a clear message rather than returning undefined into the room. */
export function requireGame(gameId: string): AnyPartyGame {
  const game = games.get(gameId);
  if (!game) {
    throw new Error(
      `Unknown game "${gameId}". Registered: ${[...games.keys()].join(", ") || "(none)"}`,
    );
  }
  return game;
}

export function listGames(): AnyPartyGame[] {
  return [...games.values()];
}

/** Test helper. Not used by the running server. */
export function resetRegistry(): void {
  games.clear();
}
