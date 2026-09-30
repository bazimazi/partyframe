/**
 * The phone controller.
 *
 * Route: `/join/:code` - exactly what the QR code encodes, so a scan lands here
 * with the room already identified and no second step. The shell owns identity,
 * connection state and the mode switch; the game-specific panel is looked up
 * from the catalog and knows nothing about any of that.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RoomCodeSchema, type ControllerMode } from "@partyframe/protocol";
import { getWebGame } from "../bind.js";
import { useT } from "../i18n/I18nProvider.js";
import { useSession } from "../net/useSession.js";
import { ConnectionBadge, ErrorScreen, LoadingScreen, PlayerAvatar } from "../ui/common.js";
import { LobbyPanel } from "./LobbyPanel.js";
import { SetupPanel, type Profile } from "./SetupPanel.js";

export function JoinRoute() {
  const t = useT();
  const navigate = useNavigate();
  const params = useParams<{ code: string }>();

  const parsedCode = RoomCodeSchema.safeParse(params.code ?? "");
  const roomCode = parsedCode.success ? parsedCode.data : "";

  const connectOptions = useMemo(
    () => (roomCode ? { role: "controller" as const, roomCode } : null),
    [roomCode],
  );
  const session = useSession(connectOptions);

  const [joining, setJoining] = useState(false);

  const snapshot = session?.snapshot ?? null;
  const players = useMemo(
    () => (snapshot?.players ?? []).filter((player) => player.joined),
    [snapshot?.players],
  );
  const me = snapshot?.players.find((player) => player.id === session?.playerId);
  const envelope = session?.controller ?? null;
  const mode: ControllerMode = envelope?.mode ?? "setup";

  const takenColors = useMemo(
    () =>
      new Set(
        players.filter((player) => player.id !== session?.playerId).map((player) => player.color),
      ),
    [players, session?.playerId],
  );

  const serverNow = useCallback(
    () => session?.connection.clock.now() ?? Date.now(),
    [session?.connection],
  );

  // Busy from the moment a profile is sent until the server seats the player
  // or refuses it, so a rejected name re-enables the join button.
  const transientError = session?.status === "connected" ? session.error : null;
  if (joining && transientError) setJoining(false);
  const busy = joining && !me?.joined;

  // A rejected action ("too late") is worth a glance, not a dismissal.
  const dismissError = session?.dismissError;
  useEffect(() => {
    if (!transientError || !dismissError) return;
    const timer = setTimeout(dismissError, 2500);
    return () => clearTimeout(timer);
  }, [transientError, dismissError]);

  /**
   * Locks the page against the browser gestures that ruin a touch controller:
   * pull-to-refresh mid-round, text selection from a long press, and the
   * double-tap zoom that fires when a player taps submit twice quickly.
   */
  useEffect(() => {
    document.body.classList.add("is-controller");
    return () => document.body.classList.remove("is-controller");
  }, []);

  if (!parsedCode.success) {
    return (
      <ErrorScreen
        error={{ code: "ROOM_NOT_FOUND", messageKey: "error.ROOM_NOT_FOUND" }}
        onRetry={() => navigate("/join")}
      />
    );
  }

  if (!session) return <LoadingScreen message={t("join.joining")} />;

  if (session.status === "error" && session.error) {
    return <ErrorScreen error={session.error} onRetry={() => window.location.reload()} />;
  }

  if (session.status === "closed" && session.error) {
    return <ErrorScreen error={session.error} onRetry={() => navigate("/join")} />;
  }

  if (!snapshot) {
    return <LoadingScreen message={t("join.joining")} />;
  }

  const webGame = getWebGame(snapshot.gameId);
  const GamePanel = webGame?.Controller;
  const waiting =
    mode === "lobby" ||
    mode === "starting" ||
    mode === "round-end" ||
    mode === "game-over" ||
    mode === "spectating";

  return (
    <div className="ctl" data-mode={mode}>
      <header className="ctl__bar">
        {me?.joined ? (
          <>
            <PlayerAvatar player={me} size={36} />
            <span className="ctl__name">{me.name}</span>
            <span className="ctl__score" aria-label={t("controller.score")}>
              {envelope?.score ?? me.score}
            </span>
          </>
        ) : (
          <span className="ctl__name">{t("join.title")}</span>
        )}
        <ConnectionBadge status={session.status} />
      </header>

      {session.status === "reconnecting" && (
        <p className="ctl__banner" role="status">
          {t("error.connectionLost")}
        </p>
      )}

      {session.error && session.status === "connected" && (
        <p className="ctl__banner ctl__banner--error" role="alert" onClick={session.dismissError}>
          {t(session.error.messageKey)}
        </p>
      )}

      <main className="ctl__main">
        {mode === "setup" && (
          <SetupPanel
            roomCode={snapshot.publicCode}
            // Empty until the server has assigned this seat a free avatar and
            // colour. The setup form adopts them as soon as they arrive rather
            // than defaulting everyone to the same first swatch.
            suggested={{ avatar: me?.avatar ?? "", color: me?.color ?? "" }}
            takenColors={takenColors}
            busy={busy}
            onJoin={(profile: Profile) => {
              setJoining(true);
              session.sendSessionAction({ type: "set-profile", ...profile });
            }}
          />
        )}

        {waiting && (
          <LobbyPanel
            mode={mode}
            me={me}
            players={players}
            winnerIds={snapshot.winnerIds}
            isHost={me?.isHost ?? false}
            score={envelope?.score ?? 0}
            onReady={(ready) => session.sendSessionAction({ type: "set-ready", ready })}
            onStart={() => session.sendSessionAction({ type: "start-game" })}
            onRematch={() => session.sendSessionAction({ type: "rematch" })}
            onLobby={() => session.sendSessionAction({ type: "return-to-lobby" })}
          />
        )}

        {mode === "game" && envelope && GamePanel && (
          <GamePanel
            envelope={envelope}
            send={session.sendGameAction}
            serverNow={serverNow}
            me={me}
            players={players}
            events={session.events}
            t={t}
          />
        )}
      </main>

      <footer className="ctl__foot">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            session.leave();
            navigate("/join");
          }}
        >
          {t("controller.leave")}
        </button>
      </footer>
    </div>
  );
}
