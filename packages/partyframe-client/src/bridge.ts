/**
 * The seam between React and Phaser.
 *
 * React must not drive the canvas: re-rendering a component tree to move a
 * sprite would cap the game at React's commit rate and allocate on every frame.
 * Instead React owns a single `StageBridge` object, mutates the handful of
 * references on it, and the scene pulls whatever it needs inside its own 60 fps
 * loop. Nothing crosses this boundary except plain reads.
 */

import type { ClientPlayer, GameEventMessage, SessionStatus } from "@partyframe/protocol";
import type { Voice } from "./sfx.js";

export interface StageBridge {
  /** The live game projection from the server, or null before the first patch. */
  game: unknown;
  /** Players in seat order, refreshed whenever the roster changes. */
  players: ClientPlayer[];
  /** Server time in epoch ms, corrected for this client's clock offset. */
  serverNow: () => number;
  /** Cues the scene has not yet consumed. The scene drains this every frame. */
  pendingEvents: GameEventMessage[];
  /** True while the session is in a state where the game should be drawn. */
  running: boolean;
  /** The session status, for scenes that show a countdown while `STARTING`. */
  status: SessionStatus;
  /** Plays a sound effect, routed through the shared screen's audio engine. */
  playSound: (voice: Voice) => void;
}

export function createStageBridge(
  serverNow: () => number,
  playSound: (voice: Voice) => void = () => undefined,
): StageBridge {
  return {
    game: null,
    players: [],
    serverNow,
    pendingEvents: [],
    running: false,
    status: "CREATED",
    playSound,
  };
}

/** Drains queued cues, returning them in arrival order. */
export function drainEvents(bridge: StageBridge): GameEventMessage[] {
  if (bridge.pendingEvents.length === 0) return [];
  const events = bridge.pendingEvents;
  bridge.pendingEvents = [];
  return events;
}
