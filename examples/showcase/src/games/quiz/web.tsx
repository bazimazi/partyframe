/**
 * Quiz on the web: the question on the TV, four big tiles on each phone.
 *
 * Uses the kit's `ChoiceGrid`, `FuseBar`, `Countdown` and `Scoreboard` so the
 * game itself is mostly layout. Tile colours are shared between the TV and
 * the phones so "the blue one" means the same thing everywhere.
 */

import { useEffect, useRef } from "react";
import {
  ChoiceGrid,
  Countdown,
  FuseBar,
  Scoreboard,
  defineWebGame,
  haptic,
  type ControllerPanelProps,
  type ScreenProps,
} from "@bazimazi/partyframe-client";
import type { QuizAction, QuizControllerState, QuizPublicState } from "./game.js";

const TILE_COLORS = ["#5b8cff", "#ff5d5d", "#ffb020", "#54d66a"];

export function QuizScreen({ game, players, serverNow, t }: ScreenProps<QuizPublicState>) {
  const reveal = game.phase === "reveal";
  const name = (id: string) => players.find((player) => player.id === id)?.name ?? "";

  return (
    <div className="quiz" data-phase={game.phase}>
      <header className="quiz__header">
        <span className="quiz__round">
          {t("host.round", { round: game.round })} / {game.rounds}
        </span>
        {game.deadline && game.phase === "ask" && (
          <Countdown endsAt={game.deadline.endsAt} serverNow={serverNow} size="small" />
        )}
      </header>

      <p className="quiz__question">{game.question}</p>

      {game.deadline && game.phase === "ask" && (
        <FuseBar
          startedAt={game.deadline.startedAt}
          endsAt={game.deadline.endsAt}
          serverNow={serverNow}
          label={t("game.quiz.timeLeft")}
        />
      )}

      <ol className="quiz__tiles">
        {game.choices.map((choice, index) => {
          const pickers = Object.entries(game.picks)
            .filter(([, pick]) => pick === index)
            .map(([id]) => name(id));
          return (
            <li
              key={index}
              className="quiz__tile"
              data-correct={reveal && game.correct === index ? true : undefined}
              data-wrong={reveal && game.correct !== index ? true : undefined}
              style={{ "--tile-color": TILE_COLORS[index] } as React.CSSProperties}
            >
              <span className="quiz__tile-letter">{String.fromCharCode(65 + index)}</span>
              <span className="quiz__tile-text">{choice}</span>
              {reveal && pickers.length > 0 && (
                <span className="quiz__tile-pickers">{pickers.join(", ")}</span>
              )}
            </li>
          );
        })}
      </ol>

      {game.phase === "ask" && (
        <p className="quiz__answered">
          {t("game.quiz.answered", { count: game.answeredIds.length, total: players.length })}
        </p>
      )}

      {reveal && (
        <div className="quiz__board">
          <Scoreboard players={players} deltas={game.roundPoints} limit={5} />
        </div>
      )}
    </div>
  );
}

export function QuizController({
  envelope,
  send,
  events,
  t,
}: ControllerPanelProps<QuizControllerState, QuizAction>) {
  const { phase, choices, myChoice, correct, points, round, rounds } = envelope.game;

  const seen = useRef(0);
  useEffect(() => {
    for (const event of events.slice(seen.current)) {
      if (event.kind === "quiz-correct") haptic([30, 40, 30]);
    }
    seen.current = events.length;
  }, [events]);

  const headline =
    phase === "reveal"
      ? myChoice === null
        ? t("game.quiz.noAnswer")
        : myChoice === correct
          ? t("game.quiz.correct", { points })
          : t("game.quiz.wrong")
      : myChoice !== null
        ? t("game.quiz.lockedIn")
        : t("game.quiz.pick");

  return (
    <div className="ctl-panel quiz-ctl" data-phase={phase}>
      <p className="ctl-panel__sub">
        {t("host.round", { round })} / {rounds}
      </p>
      <p className="ctl-panel__headline">{headline}</p>
      <ChoiceGrid
        choices={choices.map((label, index) => ({
          id: String(index),
          label,
          color: TILE_COLORS[index],
          hint: phase === "reveal" && correct === index ? t("game.quiz.rightAnswer") : undefined,
        }))}
        selectedId={myChoice === null ? null : String(myChoice)}
        disabled={!envelope.active}
        onSelect={(id) => send({ type: "answer", choice: Number(id) })}
      />
    </div>
  );
}

export const quizWeb = defineWebGame<QuizPublicState, QuizControllerState, QuizAction>({
  id: "quiz",
  Controller: QuizController,
  Screen: QuizScreen,
  round: (game) => game.round,
  sfx: { "quiz-reveal": "score" },
});
