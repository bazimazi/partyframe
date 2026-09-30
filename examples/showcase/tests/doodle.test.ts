import { describe, expect, it } from "vitest";
import { createTestMatch } from "@bazimazi/partyframe-server";
import { doodleGame, mask, normalize } from "../src/games/doodle/game.js";

function startDoodle(
  players = ["ali", "sara", "omid"],
  options: Record<string, unknown> = { rounds: 3, seconds: 60 },
) {
  const match = createTestMatch(doodleGame, { players, seed: 9, options });
  match.start();
  return match;
}

describe("doodle", () => {
  it("lets the first seat pick a word and keeps it from everyone else", () => {
    const match = startDoodle();
    expect(match.publicState().phase).toBe("pick");
    expect(match.publicState().drawerId).toBe("ali");
    expect(match.controller("ali").game.wordChoices).toHaveLength(3);
    expect(match.controller("sara").game.wordChoices).toEqual([]);

    match.act("ali", { type: "pick", index: 1 });
    expect(match.publicState().phase).toBe("draw");
    const word = match.state.word;
    expect(match.controller("ali").game.word).toBe(word);
    expect(match.controller("sara").game.word).toBeNull();
    expect(JSON.stringify(match.publicState())).not.toContain(`"${word}"`);
    expect(match.publicState().hint).toBe(mask(word));
  });

  it("only the drawer may draw, and strokes accumulate until closed", () => {
    const match = startDoodle();
    match.act("ali", { type: "pick", index: 0 });

    expect(
      match.act("sara", { type: "path", color: 0, width: 1, points: [1, 2, 3, 4], end: false }),
    ).toEqual({ status: "refused" });
    match.act("ali", { type: "path", color: 1, width: 1, points: [10, 10, 20, 20], end: false });
    match.act("ali", { type: "path", color: 1, width: 1, points: [30, 30], end: true });
    match.act("ali", { type: "path", color: 2, width: 0, points: [50, 50], end: true });
    expect(match.publicState().strokes).toEqual([
      { c: 1, w: 1, p: [10, 10, 20, 20, 30, 30] },
      { c: 2, w: 0, p: [50, 50] },
    ]);
    match.act("ali", { type: "undo" });
    expect(match.publicState().strokes).toHaveLength(1);
    match.act("ali", { type: "clear" });
    expect(match.publicState().strokes).toEqual([]);
  });

  it("rejects an oversized or malformed batch before the rules see it", () => {
    const match = startDoodle();
    match.act("ali", { type: "pick", index: 0 });
    expect(
      match.act("ali", { type: "path", color: 0, width: 1, points: [1, 2, 3], end: false } as never)
        .status,
    ).toBe("invalid");
    expect(
      match.act("ali", {
        type: "path",
        color: 0,
        width: 1,
        points: Array(66).fill(1),
        end: false,
      } as never).status,
    ).toBe("invalid");
    expect(
      match.act("ali", { type: "path", color: 9, width: 1, points: [1, 2], end: true } as never)
        .status,
    ).toBe("invalid");
  });

  it("scores a correct guess for guesser and drawer, ignores case and punctuation", () => {
    const match = startDoodle();
    match.act("ali", { type: "pick", index: 0 });
    const word = match.state.word;

    expect(match.act("sara", { type: "guess", text: "definitely not it" })).toEqual({
      status: "applied",
    });
    expect(match.publicState().recent).toEqual([{ playerId: "sara", text: "definitely not it" }]);
    expect(match.controller("sara").game.lastGuess).toEqual({
      text: "definitely not it",
      correct: false,
    });

    match.advance(30_000);
    match.act("sara", { type: "guess", text: `  ${word.toUpperCase()}! ` });
    expect(match.score("sara")).toBe(150);
    expect(match.score("ali")).toBe(40);
    expect(match.controller("sara").game.guessed).toBe(true);
    expect(match.act("sara", { type: "guess", text: word })).toEqual({ status: "refused" });
    expect(match.act("ali", { type: "guess", text: word })).toEqual({ status: "refused" });
    expect(match.eventsOfKind("doodle-correct")[0]?.to).toBe("sara");
  });

  it("ends the turn once every guesser has it, then rotates the drawer", () => {
    const match = startDoodle();
    match.act("ali", { type: "pick", index: 0 });
    const word = match.state.word;
    match.act("sara", { type: "guess", text: word });
    match.act("omid", { type: "guess", text: word });
    expect(match.publicState().phase).toBe("reveal");
    expect(match.publicState().hint).toBe(word);

    match.advance(4000);
    expect(match.publicState().phase).toBe("pick");
    expect(match.publicState().drawerId).toBe("sara");
    expect(match.publicState().turn).toBe(2);
    expect(match.state.usedWords).toEqual([word]);
  });

  it("ends the round when the drawer drops out", () => {
    const match = startDoodle();
    match.act("ali", { type: "pick", index: 0 });
    match.disconnect("ali");
    expect(match.publicState().phase).toBe("reveal");
    match.advance(4000);
    expect(match.publicState().drawerId).toBe("sara");
  });

  it("picks for a drawer who dawdles and finishes after the last turn", () => {
    const match = startDoodle(["ali", "sara"], { rounds: 2, seconds: 20 });
    match.advance(12_000);
    expect(match.publicState().phase).toBe("draw");
    match.advance(20_000);
    expect(match.publicState().phase).toBe("reveal");
    match.advance(4000);
    match.act("sara", { type: "pick", index: 0 });
    match.advance(20_000 + 4000);
    expect(match.status).toBe("GAME_OVER");
    expect(match.winnerIds).toEqual([]);
  });

  it("plays a whole match with bots", () => {
    const match = createTestMatch(doodleGame, {
      players: [],
      bots: 3,
      seed: 2,
      options: { rounds: 3, seconds: 20 },
    });
    match.start();
    match.advanceUntil(() => match.status === "GAME_OVER", 200_000);
    expect(match.publicState().turn).toBe(3);
    expect(match.state.strokes.length).toBeGreaterThan(0);
  });

  it("normalises guesses", () => {
    expect(normalize("  Ice-Cream!! ")).toBe("ice cream");
    expect(mask("ice cream")).toBe("_ _ _   _ _ _ _ _");
  });
});
