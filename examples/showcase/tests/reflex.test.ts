/**
 * Reflex rules, played headlessly with `createTestMatch`.
 *
 * No server, no sockets: a whole match runs in milliseconds and every random
 * wait is reproducible through the seed.
 */

import { describe, expect, it } from "vitest";
import { createTestMatch } from "@bazimazi/partyframe-server";
import { reflexGame } from "../src/games/reflex/game.js";

function startMatch(players = ["ali", "sara"], options: Record<string, unknown> = { rounds: 2 }) {
  const match = createTestMatch(reflexGame, { players, seed: 42, options });
  match.start();
  return match;
}

describe("reflex", () => {
  it("waits a random time, then turns green", () => {
    const match = startMatch();
    expect(match.status).toBe("PLAYING");
    expect(match.publicState().phase).toBe("wait");

    match.advanceUntil(() => match.publicState().phase === "go", 10_000);
    expect(match.eventsOfKind("reflex-go")).toHaveLength(1);
    expect(match.controller("ali").active).toBe(true);
  });

  it("punishes a press before green and tells only that phone", () => {
    const match = startMatch();
    expect(match.act("ali", { type: "press" })).toEqual({ status: "applied" });
    expect(match.controller("ali").game.fouled).toBe(true);
    expect(match.controller("sara").game.fouled).toBe(false);

    const early = match.eventsOfKind("reflex-early");
    expect(early).toHaveLength(1);
    expect(early[0]?.to).toBe("ali");

    // A second early press is a no-op, and a fouled player cannot score.
    expect(match.act("ali", { type: "press" })).toEqual({ status: "refused" });
    match.advanceUntil(() => match.publicState().phase === "go", 10_000);
    expect(match.act("ali", { type: "press" })).toEqual({ status: "refused" });
  });

  it("awards the round to the fastest press and ends the round when everyone has pressed", () => {
    const match = startMatch();
    match.advanceUntil(() => match.publicState().phase === "go", 10_000);

    match.advance(200);
    match.act("sara", { type: "press" });
    match.advance(100);
    match.act("ali", { type: "press" });

    expect(match.publicState().phase).toBe("result");
    expect(match.publicState().roundWinnerId).toBe("sara");
    expect(match.score("sara")).toBe(1);
    expect(match.publicState().reactions).toEqual({ sara: 200, ali: 300 });
  });

  it("plays the configured number of rounds, then finishes with a winner", () => {
    const match = startMatch(["ali", "sara"], { rounds: 3 });
    for (let round = 1; round <= 3; round += 1) {
      match.advanceUntil(() => match.publicState().phase === "go", 10_000);
      match.advance(150);
      match.act("ali", { type: "press" });
      match.act("sara", { type: "press" });
      expect(match.publicState().round).toBe(round);
      match.advanceUntil(() => match.publicState().phase !== "result", 10_000);
    }
    expect(match.status).toBe("GAME_OVER");
    expect(match.winnerIds).toEqual(["ali"]);
    expect(match.score("ali")).toBe(3);
  });

  it("moves on when nobody presses in time", () => {
    const match = startMatch(["ali"], { rounds: 1 });
    match.advanceUntil(() => match.publicState().phase === "go", 10_000);
    match.advance(3000);
    expect(match.publicState().phase).toBe("result");
    expect(match.eventsOfKind("reflex-round-nobody")).toHaveLength(1);
    match.advance(2500);
    expect(match.status).toBe("GAME_OVER");
    expect(match.winnerIds).toEqual([]);
  });

  it("lets bots play by their difficulty", () => {
    const match = createTestMatch(reflexGame, {
      players: [],
      bots: 2,
      seed: 7,
      options: { rounds: 1 },
    });
    match.start();
    match.advanceUntil(() => match.status === "GAME_OVER", 20_000);
    expect(match.winnerIds).toHaveLength(1);
    const reactions = Object.values(match.publicState().reactions);
    expect(reactions.every((ms) => ms >= 400 && ms <= 600)).toBe(true);
  });

  it("clamps host options through the declared fields", () => {
    const match = createTestMatch(reflexGame, { options: { rounds: 99, tempo: "warp" } });
    expect(match.options).toEqual({ rounds: 10, tempo: "normal" });
  });
});
