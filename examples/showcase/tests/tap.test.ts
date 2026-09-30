import { describe, expect, it } from "vitest";
import { createTestMatch } from "@bazimazi/partyframe-server";
import { tapGame } from "../src/games/tap/game.js";

describe("tap race", () => {
  it("is won by the first player to reach the target", () => {
    const match = createTestMatch(tapGame, { players: ["ali", "sara"], options: { target: 5 } });
    match.start();
    for (let i = 0; i < 4; i += 1) match.act("ali", { type: "tap" });
    expect(match.status).toBe("PLAYING");
    match.act("sara", { type: "tap" });
    match.act("ali", { type: "tap" });
    expect(match.status).toBe("GAME_OVER");
    expect(match.winnerIds).toEqual(["ali"]);
    expect(match.controller("sara")).toEqual({ active: false, game: { taps: 1, target: 5 } });
  });

  it("ignores taps after the race is over", () => {
    const match = createTestMatch(tapGame, { players: ["ali"], options: { target: 5 } });
    match.start();
    for (let i = 0; i < 5; i += 1) match.act("ali", { type: "tap" });
    expect(match.status).toBe("GAME_OVER");
    expect(() => match.act("ali", { type: "tap" })).toThrow(/GAME_OVER/);
  });

  it("snaps the target option to steps of five", () => {
    expect(createTestMatch(tapGame, { options: { target: 12 } }).options.target).toBe(10);
  });

  it("gives bots a chance to win", () => {
    const match = createTestMatch(tapGame, {
      players: [],
      bots: 2,
      options: { target: 5 },
      seed: 3,
    });
    match.start();
    match.advanceUntil(() => match.status === "GAME_OVER", 10_000);
    expect(match.winnerIds).toHaveLength(1);
  });
});
