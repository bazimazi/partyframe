/**
 * The phone while waiting: in the lobby, between rounds, spectating a match
 * that started without it, and after the match.
 *
 * These states share one component because they share one job: tell the
 * player what is happening and offer at most one action. Anything more
 * elaborate competes with the TV, which is where everyone is actually looking.
 */

import type { ClientPlayer, ControllerMode } from "@partyframe/protocol";
import { haptic, sfx } from "../sfx.js";
import { useT } from "../i18n/I18nProvider.js";

export function LobbyPanel({
  mode,
  me,
  players,
  winnerIds,
  isHost,
  score,
  onReady,
  onStart,
  onRematch,
  onLobby,
}: {
  mode: ControllerMode;
  me: ClientPlayer | undefined;
  /** Everyone who played the last match, for the final ranking. */
  players: ClientPlayer[];
  winnerIds: string[];
  isHost: boolean;
  score: number;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onRematch: () => void;
  onLobby: () => void;
}) {
  const t = useT();

  if (mode === "game-over") {
    const ranked = [...players]
      .filter((player) => !player.spectator)
      .sort((a, b) => b.score - a.score || a.seat - b.seat);
    const rank = me ? ranked.findIndex((player) => player.id === me.id) + 1 : 0;
    const won = Boolean(me && winnerIds.includes(me.id));

    return (
      <div className="ctl-panel ctl-panel--calm" data-won={won || undefined}>
        <p className="ctl-panel__headline">
          {won
            ? winnerIds.length > 1
              ? t("controller.youTied")
              : t("controller.youWon")
            : t("controller.gameOver")}
        </p>
        {rank > 0 && !won && (
          <p className="ctl-panel__sub">
            {t("controller.yourRank", { rank, total: ranked.length })}
          </p>
        )}
        <p className="ctl-panel__sub">{t("controller.finalScore", { score })}</p>
        {isHost ? (
          <div className="ctl-panel__actions">
            <button
              type="button"
              className="btn btn--primary btn--big btn--block"
              onClick={() => {
                haptic(15);
                onRematch();
              }}
            >
              {t("controller.hostRematch")}
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={onLobby}>
              {t("controller.hostLobby")}
            </button>
          </div>
        ) : (
          <p className="ctl-panel__sub">{t("controller.waitingForHost")}</p>
        )}
      </div>
    );
  }

  if (mode === "spectating") {
    return (
      <div className="ctl-panel ctl-panel--calm">
        <p className="ctl-panel__headline">{t("controller.spectating")}</p>
        <p className="ctl-panel__sub">{t("controller.spectatingHint")}</p>
      </div>
    );
  }

  if (mode === "starting" || mode === "round-end") {
    return (
      <div className="ctl-panel ctl-panel--calm">
        <p className="ctl-panel__headline">
          {mode === "starting" ? t("controller.starting") : t("controller.roundOver")}
        </p>
        <p className="ctl-panel__sub">{t("controller.waitingForNextRound")}</p>
      </div>
    );
  }

  const ready = me?.ready ?? false;

  return (
    <div className="ctl-panel ctl-panel--calm">
      <p className="ctl-panel__headline">{t("controller.getReady")}</p>

      <button
        type="button"
        className={`btn btn--big btn--block ${ready ? "btn--ghost" : "btn--primary"}`}
        aria-pressed={ready}
        onClick={() => {
          sfx.play("ready");
          haptic(12);
          onReady(!ready);
        }}
      >
        {ready ? `${t("controller.ready")} ✓` : t("controller.ready")}
      </button>

      {isHost ? (
        <>
          <p className="ctl-panel__sub">{t("controller.youAreHost")}</p>
          <button
            type="button"
            className="btn btn--big btn--block"
            onClick={() => {
              haptic(15);
              onStart();
            }}
          >
            {t("controller.hostStart")}
          </button>
        </>
      ) : (
        <p className="ctl-panel__sub">{t("controller.waitingForHost")}</p>
      )}
    </div>
  );
}
