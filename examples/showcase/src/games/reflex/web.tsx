/**
 * Reflex on the web: a React shared screen and a one-button phone.
 *
 * No Phaser here. `Screen` receives the public projection and renders it like
 * any other React component; `FuseBar` animates the server's deadline locally.
 */

import { useEffect, useRef } from "react";
import {
  FuseBar,
  defineWebGame,
  haptic,
  sfx,
  type ControllerPanelProps,
  type ScreenProps,
} from "@bazimazi/partyframe-client";
import type { ReflexAction, ReflexControllerState, ReflexPublicState } from "./game.js";

export function ReflexScreen({ game, players, serverNow, t }: ScreenProps<ReflexPublicState>) {
  const ranked = Object.entries(game.reactions).sort((a, b) => a[1] - b[1]);
  const name = (id: string) => players.find((player) => player.id === id)?.name ?? "";

  return (
    <div className="reflex" data-phase={game.phase}>
      <p className="reflex__round">
        {t("host.round", { round: game.round })} / {game.rounds}
      </p>

      <div className="reflex__light" aria-live="polite">
        {game.phase === "wait" && t("game.reflex.wait")}
        {game.phase === "go" && t("game.reflex.go")}
        {game.phase === "result" &&
          (game.roundWinnerId
            ? t("game.reflex.roundWinner", { name: name(game.roundWinnerId) })
            : t("game.reflex.event.nobody"))}
        {game.phase === "done" && t("controller.gameOver")}
      </div>

      {game.deadline && game.phase !== "wait" && (
        <FuseBar
          startedAt={game.deadline.startedAt}
          endsAt={game.deadline.endsAt}
          serverNow={serverNow}
          label={t("game.reflex.timeLeft")}
        />
      )}

      <ol className="reflex__times">
        {ranked.map(([id, ms]) => (
          <li key={id}>
            <span>{name(id)}</span>
            <strong>{ms} ms</strong>
          </li>
        ))}
        {game.fouls.map((id) => (
          <li key={id} className="reflex__foul">
            <span>{name(id)}</span>
            <strong>{t("game.reflex.tooEarly")}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ReflexController({
  envelope,
  send,
  events,
  t,
}: ControllerPanelProps<ReflexControllerState, ReflexAction>) {
  const { phase, reactionMs, fouled, round, rounds } = envelope.game;

  // Buzz the phone on its own private cues.
  const seen = useRef(0);
  useEffect(() => {
    for (const event of events.slice(seen.current)) {
      if (event.kind === "reflex-early") haptic([40, 60, 40]);
      if (event.kind === "reflex-pressed") haptic(20);
    }
    seen.current = events.length;
  }, [events]);

  const headline = fouled
    ? t("game.reflex.tooEarly")
    : reactionMs !== null
      ? `${reactionMs} ms`
      : phase === "go"
        ? t("game.reflex.go")
        : phase === "wait"
          ? t("game.reflex.wait")
          : t("controller.waitingForNextRound");

  return (
    <div className="ctl-panel reflex-ctl" data-phase={phase}>
      <p className="ctl-panel__sub">
        {t("host.round", { round })} / {rounds}
      </p>
      <p className="ctl-panel__headline">{headline}</p>
      <button
        type="button"
        className="btn btn--primary btn--big btn--block reflex-ctl__button"
        disabled={!envelope.active || fouled || reactionMs !== null}
        onPointerDown={() => {
          sfx.play("tick");
          send({ type: "press" });
        }}
      >
        {t("game.reflex.press")}
      </button>
    </div>
  );
}

export const reflexWeb = defineWebGame<ReflexPublicState, ReflexControllerState, ReflexAction>({
  id: "reflex",
  Controller: ReflexController,
  Screen: ReflexScreen,
  activePlayerId: (game) => (game.phase === "result" ? game.roundWinnerId || undefined : undefined),
  round: (game) => game.round,
  sfx: { "reflex-go": "start", "reflex-round-won": "score" },
});
