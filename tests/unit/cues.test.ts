import { describe, expect, it } from "vitest";
import { PLATFORM_SFX, voiceForEvent } from "../../packages/partyframe-client/src/cues.js";

describe("voiceForEvent", () => {
  it("maps platform kinds without asking the game", () => {
    expect(voiceForEvent("player-joined")).toBe("join");
    expect(voiceForEvent("game-started")).toBe("start");
    expect(voiceForEvent("game-ended")).toBe("win");
  });

  it("uses the game map for kinds the platform does not own", () => {
    expect(
      voiceForEvent("answer-accepted", {
        "answer-accepted": "accept",
        "answer-rejected": "reject",
      }),
    ).toBe("accept");
    expect(voiceForEvent("answer-rejected", { "answer-rejected": "reject" })).toBe("reject");
  });

  it("does not let a game override a platform kind", () => {
    expect(voiceForEvent("player-joined", { "player-joined": "explode" })).toBe("join");
  });

  it("returns undefined for an unknown kind", () => {
    expect(voiceForEvent("bomb-exploded")).toBeUndefined();
    expect(voiceForEvent("not-a-real-event", { "answer-accepted": "accept" })).toBeUndefined();
  });

  it("does not name a game in the platform map", () => {
    expect(Object.keys(PLATFORM_SFX).some((kind) => kind.startsWith("answer-"))).toBe(false);
  });
});
