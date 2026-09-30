/**
 * What a game contributes to the web app.
 *
 * The platform's screens - lobby, QR panel, player cards, event feed, results,
 * controller shell, connection handling - are shared by every game. A game adds
 * a controller panel for phones and, for the TV, either a React `Screen` or a
 * Phaser `scene`. Everything is typed against the game's own projections so a
 * panel never has to cast `unknown`.
 */

import type Phaser from "phaser";
import type { ComponentType } from "react";
import type { Translate } from "@partyframe/i18n";
import type {
  ClientPlayer,
  ControllerEnvelope,
  GameEventMessage,
  SessionStatus,
} from "@partyframe/protocol";
import type { Voice } from "./sfx.js";

export interface PlayerBadge {
  /** Short text overlaid on the card, e.g. lives or "OUT". */
  text: string;
  tone: "neutral" | "good" | "bad";
}

/** Props every game-specific controller panel receives. */
export interface ControllerPanelProps<TController = unknown, TAction = unknown> {
  /** The envelope for this player, with `game` typed by the game. */
  envelope: ControllerEnvelope<TController>;
  /** Sends a game action. The server validates it; this is only an intention. */
  send: (action: TAction) => void;
  /** Clock-corrected server time, for local countdown interpolation. */
  serverNow: () => number;
  /** This player's own row, for name, colour and avatar. */
  me: ClientPlayer | undefined;
  /** Everyone in the session, in seat order. */
  players: ClientPlayer[];
  /**
   * Recent cues, broadcast and private alike, oldest first. Compare `at` or
   * length to react to new ones; the shell keeps only a short history.
   */
  events: GameEventMessage[];
  /** Bound translator from the platform locale. */
  t: Translate;
}

/** Props a React shared-screen component receives instead of a Phaser scene. */
export interface ScreenProps<TPublic = unknown> {
  /** The game's public projection, already normalised. */
  game: TPublic;
  /** `STARTING`, `PLAYING` or `ROUND_END` while the screen is mounted. */
  status: SessionStatus;
  /** Players in the match, in seat order. Spectators are excluded. */
  players: ClientPlayer[];
  /** Recent cues, oldest first. */
  events: GameEventMessage[];
  /** Clock-corrected server time. */
  serverNow: () => number;
  /** Plays a sound through the shared screen's audio engine. */
  playSound: (voice: Voice) => void;
  t: Translate;
}

/** A Phaser scene class the stage can boot. `KEY` names the scene. */
export type GameSceneClass = (new () => Phaser.Scene) & { KEY: string };

export interface WebGame<TPublic = unknown, TController = unknown, TAction = unknown> {
  id: string;
  /**
   * Converts the raw synchronised projection into plain data. Optional: with
   * the default JSON transport the projection already is plain data.
   */
  normalizePublicState?: (raw: unknown) => TPublic;
  Controller: ComponentType<ControllerPanelProps<TController, TAction>>;
  /** React shared screen. Used when present; otherwise `scene` boots Phaser. */
  Screen?: ComponentType<ScreenProps<TPublic>>;
  /**
   * Lazily loads a Phaser scene for the shared screen, e.g.
   * `() => import("./scene.js").then((m) => m.BombScene)`. Keeping it behind
   * `import()` keeps Phaser out of the phone bundle.
   */
  scene?: () => Promise<GameSceneClass>;
  /** Players to draw as eliminated on the shared screen. */
  eliminatedIds?: (publicState: TPublic) => Set<string>;
  /** Per-player badge text, e.g. remaining lives. */
  badges?: (publicState: TPublic) => Record<string, PlayerBadge>;
  /** The player whose turn it is, highlighted on the shared screen. */
  activePlayerId?: (publicState: TPublic) => string | undefined;
  /** Current round, shown in the top bar. Zero or undefined hides it. */
  round?: (publicState: TPublic) => number | undefined;
  /**
   * Game-owned event kinds → voices. Platform kinds (`player-joined`,
   * `game-started`, `game-ended`) are resolved first and cannot be overridden.
   */
  sfx?: Readonly<Record<string, Voice>>;
  /** Event kinds to keep out of the TV's text feed (canvas-only cues). */
  hiddenEventKinds?: readonly string[];
}

/** Fully-erased web game, used by the shells. */

export type AnyWebGame = WebGame<any, any, any>;

/**
 * Identity helper that pins a web game's type parameters, so its `Controller`
 * and `Screen` are checked against the projections it declares:
 *
 * ```ts
 * export const tapWeb = defineWebGame<TapPublic, TapController, TapAction>({ ... });
 * ```
 */
export function defineWebGame<TPublic = unknown, TController = unknown, TAction = unknown>(
  game: WebGame<TPublic, TController, TAction>,
): WebGame<TPublic, TController, TAction> {
  return game;
}
