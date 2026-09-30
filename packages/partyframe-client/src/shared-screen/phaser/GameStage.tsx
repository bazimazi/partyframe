/**
 * Mounts the active game's Phaser scene and keeps the bridge fed.
 *
 * React owns the DOM node and the bridge object; Phaser owns everything inside
 * the canvas. The only per-frame work React does here is assigning a few fields
 * on a plain object, which is why the canvas can run at 60 fps while the
 * surrounding UI re-renders at whatever rate the network dictates.
 *
 * Both Phaser and the scene are imported dynamically. This module is only ever
 * reached from the shared screen, and keeping the renderer behind an `import()`
 * is what stops it reaching a phone's bundle.
 */

import { useEffect, useRef } from "react";
import type Phaser from "phaser";
import type { ClientPlayer, GameEventMessage, SessionStatus } from "@partyframe/protocol";
import { loadSceneForGame } from "../../bind.js";
import { createStageBridge, type StageBridge } from "../../bridge.js";
import { sfx } from "../../sfx.js";

export function GameStage({
  gameId,
  game,
  players,
  events,
  running,
  status,
  serverNow,
}: {
  gameId: string;
  /** Live public projection from the server, already normalised by the game. */
  game: unknown;
  players: ClientPlayer[];
  /** Full event history; only the newly arrived tail is forwarded to the scene. */
  events: GameEventMessage[];
  running: boolean;
  status: SessionStatus;
  serverNow: () => number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<StageBridge | null>(null);
  const forwardedRef = useRef(0);

  if (bridgeRef.current === null) {
    bridgeRef.current = createStageBridge(serverNow, (voice) => sfx.play(voice));
  }

  // Boot Phaser once per game type. Recreating it on every state change would
  // tear down and rebuild a WebGL context several times a second.
  useEffect(() => {
    const host = hostRef.current;
    const bridge = bridgeRef.current;
    if (!host || !bridge) return;

    let instance: Phaser.Game | null = null;
    let cancelled = false;

    void (async () => {
      const [{ default: Phaser }, SceneClass] = await Promise.all([
        import("phaser"),
        loadSceneForGame(gameId),
      ]);
      // The component may have unmounted while the renderer was downloading.
      if (cancelled || !SceneClass) return;

      instance = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host,
        backgroundColor: "#020617",
        scale: {
          // RESIZE rather than FIT: the shared screen has no fixed aspect ratio,
          // and letterboxing a 4K TV wastes the screen the game is meant to fill.
          mode: Phaser.Scale.RESIZE,
          width: "100%",
          height: "100%",
        },
        fps: { target: 60, forceSetTimeOut: false },
        render: { antialias: true, powerPreference: "high-performance" },
        // Sound is owned by the shared screen's own engine, which respects the
        // browser's autoplay policy; Phaser's would be a second, unmanaged one.
        audio: { noAudio: true },
        scene: [SceneClass],
      });

      instance.scene.start(SceneClass.KEY, { bridge });
    })();

    return () => {
      cancelled = true;
      instance?.destroy(true);
    };
  }, [gameId]);

  // Keep the bridge current. Assignments only - no allocation, no re-render.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.game = game;
    bridge.players = players;
    bridge.running = running;
    bridge.status = status;
    bridge.serverNow = serverNow;
  }, [game, players, running, status, serverNow]);

  // Forward only cues the scene has not seen. `events` is append-only and
  // capped, so comparing lengths is enough and avoids diffing arrays.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    if (events.length < forwardedRef.current) forwardedRef.current = 0;
    if (events.length > forwardedRef.current) {
      bridge.pendingEvents.push(...events.slice(forwardedRef.current));
      forwardedRef.current = events.length;
    }
  }, [events]);

  return <div className="game-stage" ref={hostRef} aria-hidden="true" />;
}
