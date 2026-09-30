/**
 * Catalog bindings for the TV and phone shells.
 *
 * The shells must not import a host's game catalog - that code already depends
 * on this package for `WebGame`. The app wires the two together once at
 * startup, before any route mounts:
 *
 * ```ts
 * bindKit({ games: [tapWeb, quizWeb] });
 * ```
 */

import type { AnyWebGame, GameSceneClass } from "./types.js";

export type { GameSceneClass };

export interface KitCatalog {
  /** Every game this web app can present. */
  games: readonly AnyWebGame[];
}

/** The 0.1 shape, still accepted so existing hosts keep working. */
export interface LegacyKitCatalog {
  getWebGame: (gameId: string) => AnyWebGame | undefined;
  loadSceneForGame: (gameId: string) => Promise<GameSceneClass | null>;
}

let lookup: ((gameId: string) => AnyWebGame | undefined) | null = null;
let legacyScene: LegacyKitCatalog["loadSceneForGame"] | null = null;

export function bindKit(catalog: KitCatalog | LegacyKitCatalog): void {
  if ("games" in catalog) {
    const byId = new Map(catalog.games.map((game) => [game.id, game]));
    lookup = (gameId) => byId.get(gameId);
    legacyScene = null;
  } else {
    lookup = catalog.getWebGame;
    legacyScene = catalog.loadSceneForGame;
  }
}

function requireCatalog(): (gameId: string) => AnyWebGame | undefined {
  if (!lookup) {
    throw new Error("@bazimazi/partyframe-client: bindKit() must run before routes mount");
  }
  return lookup;
}

export function getWebGame(gameId: string): AnyWebGame | undefined {
  return requireCatalog()(gameId);
}

/** The Phaser scene for a game, or null when it renders with a React `Screen`. */
export async function loadSceneForGame(gameId: string): Promise<GameSceneClass | null> {
  const game = requireCatalog()(gameId);
  if (game?.scene) return game.scene();
  if (legacyScene) return legacyScene(gameId);
  return null;
}

/** Test helper. */
export function resetKit(): void {
  lookup = null;
  legacyScene = null;
}
