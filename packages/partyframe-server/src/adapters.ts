/**
 * Binds a game's rules to a concrete Colyseus representation.
 *
 * `install()` accepts a plain `PartyGame`, in which case the public projection
 * is synchronised as JSON and the game needs no schema code at all. A game with
 * a large projection can hand in a `GameNetworkAdapter` with its own schema
 * subclass and diffing `project()` instead. The room looks adapters up by
 * `gameId` and never imports a game package itself.
 */

import { getGame, registerGame, requireGame, type AnyPartyGame } from "@partyframe/game-core";
import type { InstalledGameInfo } from "@partyframe/protocol";
import { JsonSessionSchema, setIfChanged, type SessionSchema } from "./sessionSchema.js";

export interface GameNetworkAdapter {
  game: AnyPartyGame;
  /** Builds the room's root state, a subclass of `SessionSchema`. */
  createState(): SessionSchema;
  /**
   * Copies the game's public projection onto that state.
   *
   * Only called when the projection changed since the last call, so it may
   * assign freely; `setIfChanged` keeps patches small when it does not.
   */
  project(state: SessionSchema, publicState: unknown): void;
}

/** The default binding: the projection travels as one JSON string. */
export function jsonAdapter(game: AnyPartyGame): GameNetworkAdapter {
  return {
    game,
    createState: () => new JsonSessionSchema(),
    project(state, publicState) {
      setIfChanged(state as JsonSessionSchema, "gameJson", JSON.stringify(publicState ?? null));
    },
  };
}

export function isNetworkAdapter(
  value: AnyPartyGame | GameNetworkAdapter,
): value is GameNetworkAdapter {
  return typeof (value as GameNetworkAdapter).project === "function" && "game" in value;
}

const adapters = new Map<string, GameNetworkAdapter>();

/** Makes a game available to sessions. Idempotent for the same game object. */
export function install(gameOrAdapter: AnyPartyGame | GameNetworkAdapter): GameNetworkAdapter {
  const adapter = isNetworkAdapter(gameOrAdapter) ? gameOrAdapter : jsonAdapter(gameOrAdapter);
  const existing = getGame(adapter.game.id);
  if (existing && existing !== adapter.game) {
    throw new Error(`Game "${adapter.game.id}" is already installed with a different definition`);
  }
  if (!existing) registerGame(adapter.game);
  adapters.set(adapter.game.id, adapter);
  return adapter;
}

export function getAdapter(gameId: string): GameNetworkAdapter | undefined {
  return adapters.get(gameId);
}

export function requireAdapter(gameId: string): GameNetworkAdapter {
  const adapter = adapters.get(gameId);
  if (!adapter) {
    requireGame(gameId);
    throw new Error(`Game "${gameId}" has no network adapter`);
  }
  return adapter;
}

export function describeGame(game: AnyPartyGame): InstalledGameInfo {
  return {
    id: game.id,
    nameKey: game.nameKey,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    lateJoin: game.lateJoin ?? "spectate",
    bots: typeof game.createBot === "function",
    options: game.options ?? {},
    devCommands: Object.keys(game.devCommands ?? {}),
  };
}

export function listInstalledGames(): InstalledGameInfo[] {
  return [...adapters.values()].map(({ game }) => describeGame(game));
}

export function listAdapterIds(): string[] {
  return [...adapters.keys()];
}

/** Test helper. Not used by the running server. */
export function resetAdapters(): void {
  adapters.clear();
}
