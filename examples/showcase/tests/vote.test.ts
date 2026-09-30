import { describe, expect, it } from "vitest";
import { createTestMatch } from "@bazimazi/partyframe-server";
import { tallyVotes, topOf, voteGame } from "../src/games/vote/game.js";

function startVote(options: Record<string, unknown> = { rounds: 2, seconds: 20 }) {
  const match = createTestMatch(voteGame, { players: ["ali", "sara", "omid"], seed: 3, options });
  match.start();
  return match;
}

describe("most likely to", () => {
  it("needs three players", () => {
    const match = createTestMatch(voteGame, { players: 2 });
    expect(() => match.start()).toThrow(/needs 3 players/);
  });

  it("keeps votes secret until the reveal, then rewards the crowd's pick and those who agreed", () => {
    const match = startVote();
    expect(match.act("ali", { type: "vote", playerId: "sara" })).toEqual({ status: "applied" });
    expect(match.publicState().votedIds).toEqual(["ali"]);
    expect(match.publicState().votes).toEqual({});
    expect(match.controller("sara").game.myVote).toBeNull();

    match.act("omid", { type: "vote", playerId: "sara" });
    expect(match.publicState().phase).toBe("vote");
    match.act("sara", { type: "vote", playerId: "ali" });

    const state = match.publicState();
    expect(state.phase).toBe("reveal");
    expect(state.tally).toEqual({ sara: 2, ali: 1 });
    expect(state.topIds).toEqual(["sara"]);
    expect(match.score("sara")).toBe(200);
    expect(match.score("ali")).toBe(100);
    expect(match.score("omid")).toBe(100);
  });

  it("refuses self-votes, unknown targets and second votes", () => {
    const match = startVote();
    expect(match.act("ali", { type: "vote", playerId: "ali" })).toEqual({ status: "refused" });
    expect(match.act("ali", { type: "vote", playerId: "nobody" })).toEqual({ status: "refused" });
    match.act("ali", { type: "vote", playerId: "sara" });
    expect(match.act("ali", { type: "vote", playerId: "omid" })).toEqual({ status: "refused" });
  });

  it("splits the points on a tie", () => {
    const match = startVote();
    match.act("ali", { type: "vote", playerId: "sara" });
    match.act("sara", { type: "vote", playerId: "ali" });
    match.advance(20_000);
    expect(match.publicState().topIds).toEqual(["sara", "ali"]);
    expect(match.score("ali")).toBe(300);
    expect(match.score("sara")).toBe(300);
    expect(match.score("omid")).toBe(0);
  });

  it("advances through the rounds on the clock and ends", () => {
    // Two rounds is below the option's minimum, so the lobby input is clamped.
    const match = startVote({ rounds: 2, seconds: 10 });
    expect(match.options.rounds).toBe(3);
    match.advance(10_000);
    expect(match.publicState().phase).toBe("reveal");
    expect(match.eventsOfKind("vote-reveal")[0]?.messageKey).toBe("game.vote.event.nobody");
    match.advance(6000);
    expect(match.publicState().round).toBe(2);
    match.advance(16_000 * 2);
    expect(match.status).toBe("GAME_OVER");
  });

  it("lets bots carry a whole match", () => {
    const match = createTestMatch(voteGame, {
      players: [],
      bots: 4,
      seed: 8,
      options: { rounds: 3, seconds: 10 },
    });
    match.start();
    match.advanceUntil(() => match.status === "GAME_OVER", 100_000);
    expect(match.winnerIds.length).toBeGreaterThan(0);
  });

  it("tallies", () => {
    expect(tallyVotes({ a: "b", c: "b", b: "a" })).toEqual({ b: 2, a: 1 });
    expect(topOf({})).toEqual([]);
    expect(topOf({ a: 2, b: 2, c: 1 })).toEqual(["a", "b"]);
  });
});
