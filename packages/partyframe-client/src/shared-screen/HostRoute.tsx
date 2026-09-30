/**
 * The shared screen.
 *
 * Creates a session on mount - or resumes the one named in `?room=` after a
 * reload - then renders whichever view matches the authoritative session
 * status. It contains no game rules and reads no game-specific fields
 * directly: everything game-shaped goes through the web game catalog, which is
 * what lets a second game reuse this file unchanged.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  RoomCodeSchema,
  type ClientPlayer,
  type SessionSettings,
  type SessionStatus,
} from "@partyframe/protocol";
import { getWebGame } from "../bind.js";
import { voiceForEvent } from "../cues.js";
import { sfx } from "../sfx.js";
import { useT } from "../i18n/I18nProvider.js";
import { LocaleSwitcher } from "../i18n/LocaleSwitcher.js";
import { useServerConfig } from "../net/useServerConfig.js";
import { useSession } from "../net/useSession.js";
import { ConnectionBadge, ErrorScreen, LoadingScreen } from "../ui/common.js";
import { DevPanel } from "./DevPanel.js";
import { EventFeed } from "./EventFeed.js";
import { LobbyView } from "./LobbyView.js";
import { PlayerGrid } from "./PlayerGrid.js";
import { ResultsView } from "./ResultsView.js";

/**
 * The Phaser stage is loaded only when a match actually starts on a game that
 * uses it. Phaser is by far the largest dependency in the app, and the lobby -
 * the first thing on screen and the thing a TV sits on while people file in -
 * does not need it. Deferring it also means the phone controller, which shares
 * this bundle, never pays for it at all.
 */
const GameStage = lazy(async () => ({
  default: (await import("./phaser/GameStage.js")).GameStage,
}));

/** URL parameter that lets a reloaded TV find its way back into its session. */
const ROOM_PARAM = "room";

export function HostRoute() {
  const t = useT();
  const { config } = useServerConfig();
  const [params, setParams] = useSearchParams();

  // Captured once: the session to resume and the game to create are decided
  // on first render. Updating the URL afterwards must not open a new session.
  const [initial] = useState(() => {
    const room = RoomCodeSchema.safeParse(params.get(ROOM_PARAM) ?? "");
    return {
      roomCode: room.success ? room.data : undefined,
      gameId: params.get("game") || undefined,
    };
  });
  const session = useSession(
    useMemo(
      () => ({ role: "host" as const, roomCode: initial.roomCode, gameId: initial.gameId }),
      [initial],
    ),
  );

  const snapshot = session?.snapshot ?? null;
  const status: SessionStatus = snapshot?.status ?? "CREATED";
  const gameId = snapshot?.gameId ?? "";
  const webGame = getWebGame(gameId);
  const gameInfo = config.games.find((game) => game.id === gameId);

  // Keep the session code in the URL so a reload (or a browser crash) resumes
  // the same game instead of stranding every phone in a dead room.
  useEffect(() => {
    const code = session?.roomCode;
    if (!code || params.get(ROOM_PARAM) === code) return;
    const next = new URLSearchParams(params);
    next.set(ROOM_PARAM, code);
    setParams(next, { replace: true });
  }, [session?.roomCode, params, setParams]);

  /** Everyone who finished joining, in seat order. Unjoined rows stay hidden. */
  const joined = useMemo<ClientPlayer[]>(
    () => (snapshot?.players ?? []).filter((player) => player.joined),
    [snapshot?.players],
  );
  /** Players in the current match: joined and not sitting it out. */
  const players = useMemo(() => joined.filter((player) => !player.spectator), [joined]);
  const spectators = useMemo(() => joined.filter((player) => player.spectator), [joined]);

  /**
   * The game's own projection, converted once per change and shared by the
   * stage and the surrounding UI.
   */
  const publicState = useMemo(
    () =>
      webGame && snapshot ? (webGame.normalizePublicState?.(snapshot.game) ?? snapshot.game) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [webGame, snapshot?.game, snapshot?.gameRevision],
  );

  const serverNow = useCallback(
    () => session?.connection.clock.now() ?? Date.now(),
    [session?.connection],
  );

  const send = session?.sendSessionAction;

  const updateSettings = useCallback(
    (patch: Partial<SessionSettings>) => {
      send?.({ type: "update-settings", settings: patch });
    },
    [send],
  );

  // The TV is the one screen allowed to make noise, and browsers require a
  // gesture before it can. Any click or key anywhere unlocks audio once.
  useEffect(() => {
    const unlock = () => {
      sfx.unlock();
      if (sfx.isReady) {
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // A shared screen is meant to stay lit for a whole party.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        // Unsupported or refused; the screen may dim, which is cosmetic.
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);

  // Sound cues are driven by the event stream rather than by state diffs, so a
  // coalesced patch cannot leave the TV silent for the rest of the match.
  const soundCursor = useRef(0);
  useEffect(() => {
    const events = session?.events ?? [];
    if (events.length < soundCursor.current) soundCursor.current = 0;
    for (const event of events.slice(soundCursor.current)) {
      const voice = voiceForEvent(event.kind, webGame?.sfx);
      if (voice) sfx.play(voice);
    }
    soundCursor.current = events.length;
  }, [session?.events, webGame?.sfx]);

  const playSound = useCallback((voice: Parameters<typeof sfx.play>[0]) => sfx.play(voice), []);

  if (!session) return <LoadingScreen message={t("host.connecting")} />;

  if (session.status === "error" && session.error) {
    return <ErrorScreen error={session.error} onRetry={() => window.location.reload()} />;
  }

  if (!snapshot || session.status === "connecting") {
    return <LoadingScreen message={t("host.starting")} />;
  }

  const inGame = status === "STARTING" || status === "PLAYING" || status === "ROUND_END";
  const round = webGame?.round?.(publicState) ?? 0;
  // Server metadata is the source of truth. `1` is only "unknown" - the room
  // still refuses a start that is below the installed game's minimum.
  const minPlayers = gameInfo?.minPlayers ?? 1;
  const Screen = webGame?.Screen;

  return (
    <div className="host" data-status={status}>
      <header className="host__bar">
        <h1 className="host__title">{t(`game.${gameId}.name`)}</h1>
        <div className="host__bar-right">
          {inGame && round > 0 && <span className="host__round">{t("host.round", { round })}</span>}
          <span className="host__code">
            {t("host.roomLabel")} <strong>{snapshot.publicCode}</strong>
          </span>
          <LocaleSwitcher />
          <ConnectionBadge status={session.status} />
        </div>
      </header>

      {session.status === "reconnecting" && (
        <p className="host__banner" role="status">
          {t("host.reconnecting")}
        </p>
      )}

      <main className="host__main">
        {status === "LOBBY" && (
          <LobbyView
            roomCode={snapshot.publicCode}
            publicBaseUrl={config.publicBaseUrl}
            players={joined}
            settings={snapshot.settings}
            game={gameInfo}
            minPlayers={minPlayers}
            onStart={() => send?.({ type: "start-game" })}
            onSettings={updateSettings}
          />
        )}

        {inGame && (
          <div className="host__game">
            {Screen ? (
              <div className="game-stage game-stage--react">
                <Screen
                  game={publicState}
                  status={status}
                  players={players}
                  events={session.events}
                  serverNow={serverNow}
                  playSound={playSound}
                  t={t}
                />
              </div>
            ) : (
              <Suspense fallback={<div className="game-stage" />}>
                <GameStage
                  gameId={gameId}
                  game={publicState}
                  players={players}
                  events={session.events}
                  running={inGame}
                  status={status}
                  serverNow={serverNow}
                />
              </Suspense>
            )}
            <aside className="host__side">
              <PlayerGrid
                players={players}
                highlightId={webGame?.activePlayerId?.(publicState)}
                dimmedIds={webGame?.eliminatedIds?.(publicState)}
                badges={webGame?.badges?.(publicState)}
              />
              {spectators.length > 0 && (
                <p className="host__waiting">
                  {t("host.waitingToPlay", {
                    names: spectators.map((player) => player.name).join(", "),
                  })}
                </p>
              )}
              <EventFeed events={session.events} hiddenKinds={webGame?.hiddenEventKinds} />
            </aside>
          </div>
        )}

        {status === "GAME_OVER" && (
          <ResultsView
            players={joined}
            winnerIds={snapshot.winnerIds}
            onRematch={() => send?.({ type: "rematch" })}
            onLobby={() => send?.({ type: "return-to-lobby" })}
          />
        )}
      </main>

      {config.devTools && (
        <DevPanel
          roomCode={snapshot.publicCode}
          latencyMs={session.latencyMs}
          clockOffsetMs={session.connection.clock.offset}
          status={`${status} / ${session.status}`}
          gameCommands={gameInfo?.devCommands ?? []}
          send={(action) => send?.(action)}
        />
      )}
    </div>
  );
}
