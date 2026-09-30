/**
 * Small pure helpers games build on: option parsing, deadlines and rosters.
 */

import { describe, expect, it } from "vitest";
import {
  defaultGameOptions,
  elapsedFraction,
  hasExpired,
  nextPlayer,
  parseGameOptions,
  rankPlayers,
  remainingMs,
  startDeadline,
  topScorers,
} from "@partyframe/game-core";

const fields = {
  rounds: { type: "number", labelKey: "o.rounds", default: 3, min: 1, max: 10 },
  seconds: { type: "number", labelKey: "o.seconds", default: 30, min: 10, max: 60, step: 5 },
  chaos: { type: "boolean", labelKey: "o.chaos", default: false },
  mode: { type: "select", labelKey: "o.mode", default: "short", choices: ["short", "long"] },
} as const;

describe("game options", () => {
  it("starts from the declared defaults", () => {
    expect(defaultGameOptions(fields)).toEqual({
      rounds: 3,
      seconds: 30,
      chaos: false,
      mode: "short",
    });
  });

  it("accepts valid input and drops keys the game did not declare", () => {
    expect(parseGameOptions(fields, { rounds: 5, chaos: true, mode: "long", extra: 1 })).toEqual({
      rounds: 5,
      seconds: 30,
      chaos: true,
      mode: "long",
    });
  });

  it("clamps numbers and snaps them to the step", () => {
    expect(parseGameOptions(fields, { rounds: 99 }).rounds).toBe(10);
    expect(parseGameOptions(fields, { rounds: -4 }).rounds).toBe(1);
    expect(parseGameOptions(fields, { seconds: 33 }).seconds).toBe(35);
    expect(parseGameOptions(fields, { seconds: 1000 }).seconds).toBe(60);
  });

  it("falls back to the default for the wrong type or an unknown choice", () => {
    expect(parseGameOptions(fields, { rounds: "many", chaos: "yes", mode: "epic" })).toEqual(
      defaultGameOptions(fields),
    );
    expect(parseGameOptions(fields, null)).toEqual(defaultGameOptions(fields));
    expect(parseGameOptions(fields, { rounds: Number.NaN }).rounds).toBe(3);
  });

  it("accepts labelled choices", () => {
    const labelled = {
      size: {
        type: "select",
        labelKey: "o.size",
        default: "s",
        choices: [
          { value: "s", labelKey: "o.size.small" },
          { value: "l", labelKey: "o.size.large" },
        ],
      },
    } as const;
    expect(parseGameOptions(labelled, { size: "l" }).size).toBe("l");
    expect(parseGameOptions(labelled, { size: "xl" }).size).toBe("s");
  });
});

describe("deadlines", () => {
  it("counts down from now", () => {
    const deadline = startDeadline(1000, 500);
    expect(deadline).toEqual({ startedAt: 1000, endsAt: 1500 });
    expect(remainingMs(deadline, 1200)).toBe(300);
    expect(remainingMs(deadline, 1600)).toBe(0);
    expect(hasExpired(deadline, 1499)).toBe(false);
    expect(hasExpired(deadline, 1500)).toBe(true);
  });

  it("reports progress as a clamped fraction", () => {
    const deadline = startDeadline(0, 1000);
    expect(elapsedFraction(deadline, -5)).toBe(0);
    expect(elapsedFraction(deadline, 250)).toBe(0.25);
    expect(elapsedFraction(deadline, 5000)).toBe(1);
    expect(elapsedFraction(startDeadline(0, 0), 0)).toBe(1);
  });

  it("treats a missing deadline as already over", () => {
    expect(hasExpired(null, 0)).toBe(true);
    expect(remainingMs(undefined, 0)).toBe(0);
    expect(elapsedFraction(null, 0)).toBe(1);
  });
});

describe("rosters", () => {
  const players = [
    { id: "a", seat: 0, score: 3 },
    { id: "b", seat: 1, score: 7 },
    { id: "c", seat: 2, score: 7 },
    { id: "d", seat: 3, score: 0 },
  ];

  it("ranks by score, then seat, without mutating the input", () => {
    const ranked = rankPlayers(players);
    expect(ranked.map((p) => p.id)).toEqual(["b", "c", "a", "d"]);
    expect(players[0]?.id).toBe("a");
  });

  it("returns every top scorer, and nobody when nobody scored", () => {
    expect(topScorers(players).map((p) => p.id)).toEqual(["b", "c"]);
    expect(topScorers([{ id: "x", seat: 0, score: 0 }])).toEqual([]);
    expect(topScorers([])).toEqual([]);
  });

  it("walks seats in order, wrapping and skipping ineligible players", () => {
    expect(nextPlayer(players, "a")?.id).toBe("b");
    expect(nextPlayer(players, "d")?.id).toBe("a");
    expect(nextPlayer(players, null)?.id).toBe("a");
    expect(nextPlayer(players, "a", (p) => p.score === 0)?.id).toBe("d");
    expect(nextPlayer(players, "a", () => false)).toBeUndefined();
    expect(nextPlayer([], "a")).toBeUndefined();
  });
});
