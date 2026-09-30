import { describe, expect, it } from "vitest";
import { createTestMatch } from "@bazimazi/partyframe-server";
import { quizGame } from "../src/games/quiz/game.js";

function startQuiz(options: Record<string, unknown> = { rounds: 3, seconds: 10 }) {
  const match = createTestMatch(quizGame, { players: ["ali", "sara"], seed: 5, options });
  match.start();
  return match;
}

describe("quiz", () => {
  it("never leaks the answer before the reveal", () => {
    const match = startQuiz();
    expect(match.publicState().correct).toBeNull();
    expect(match.controller("ali").game.correct).toBeNull();
    expect(match.publicState().choices).toHaveLength(4);
  });

  it("scores a correct answer with a speed bonus and reveals when everyone answered", () => {
    const match = startQuiz();
    const correct = match.state.questions[0]!.answer;
    const wrong = (correct + 1) % 4;

    match.advance(2000); // 20% of the 10 s window gone
    expect(match.act("ali", { type: "answer", choice: correct })).toEqual({ status: "applied" });
    expect(match.publicState().answeredIds).toEqual(["ali"]);
    expect(match.publicState().phase).toBe("ask");

    match.act("sara", { type: "answer", choice: wrong });
    expect(match.publicState().phase).toBe("reveal");
    expect(match.publicState().correct).toBe(correct);
    expect(match.score("ali")).toBe(180);
    expect(match.score("sara")).toBe(0);
    expect(match.publicState().roundPoints).toEqual({ ali: 180 });
    expect(match.eventsOfKind("quiz-correct")[0]?.to).toBe("ali");
  });

  it("refuses a second answer and answers after the reveal", () => {
    const match = startQuiz();
    match.act("ali", { type: "answer", choice: 0 });
    expect(match.act("ali", { type: "answer", choice: 1 })).toEqual({ status: "refused" });
    match.advance(10_000);
    expect(match.publicState().phase).toBe("reveal");
    expect(match.act("sara", { type: "answer", choice: 1 })).toEqual({ status: "refused" });
  });

  it("times out an unanswered question and moves on", () => {
    const match = startQuiz();
    match.advance(10_000);
    expect(match.publicState().phase).toBe("reveal");
    expect(match.eventsOfKind("quiz-reveal")[0]?.messageKey).toBe("game.quiz.event.nobody");
    match.advance(4000);
    expect(match.publicState().round).toBe(2);
    expect(match.publicState().phase).toBe("ask");
  });

  it("finishes after the configured rounds with the top scorer winning", () => {
    const match = startQuiz({ rounds: 3, seconds: 5 });
    for (let round = 1; round <= 3; round += 1) {
      const correct = match.state.questions[round - 1]!.answer;
      match.act("ali", { type: "answer", choice: correct });
      match.act("sara", { type: "answer", choice: (correct + 1) % 4 });
      match.advance(4000);
    }
    expect(match.status).toBe("GAME_OVER");
    expect(match.winnerIds).toEqual(["ali"]);
    expect(match.score("ali")).toBe(600);
  });

  it("uses the rng for question order so a seed pins the match", () => {
    const a = startQuiz().publicState().question;
    const b = startQuiz().publicState().question;
    expect(a).toBe(b);
  });

  it("gives hard bots a better accuracy than easy ones", () => {
    const play = (difficulty: "easy" | "hard") => {
      const match = createTestMatch(quizGame, {
        players: [],
        bots: 1,
        botDifficulty: difficulty,
        seed: 11,
        options: { rounds: 20, seconds: 5 },
      });
      match.start();
      match.advanceUntil(() => match.status === "GAME_OVER", 400_000);
      return match.score("bot-1");
    };
    expect(play("hard")).toBeGreaterThan(play("easy"));
  });
});
