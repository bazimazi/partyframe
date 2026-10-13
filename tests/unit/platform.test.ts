/**
 * Platform pieces that are not game rules: room codes, rate limiting, the game
 * registry and localisation.
 *
 * These are the parts every future game inherits, so a regression here would
 * break games that have not been written yet.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@partyframe/protocol";
import {
  getGame,
  listGames,
  registerGame,
  requireGame,
  resetRegistry,
  type PartyGame,
  GAME_ACTION_LIMITS,
  RateLimiter,
  SESSION_ACTION_LIMITS,
  generateRoomCode,
  generateUniqueRoomCode,
  isRoomCodeShaped,
} from "@bazimazi/partyframe-server";
import { createTranslator, resolveLocale } from "@bazimazi/partyframe-client";
import { en } from "../../packages/partyframe-client/src/i18n/en.js";

const stubGame: PartyGame = {
  id: "stub",
  nameKey: "game.stub.name",
  minPlayers: 1,
  maxPlayers: 8,
  actionSchema: z.object({ type: z.literal("noop") }),
  parseOptions: () => ({}),
  createState: () => ({}),
  start() {},
  handleAction() {
    return false;
  },
  update() {},
  isFinished() {
    return false;
  },
  getControllerState() {
    return { active: false, game: null };
  },
  getPublicState() {
    return {};
  },
  createBot() {
    return { difficulty: "easy", decide: () => null };
  },
};

describe("room codes", () => {
  it("has the configured length", () => {
    expect(generateRoomCode()).toHaveLength(ROOM_CODE_LENGTH);
  });

  it("only uses unambiguous characters", () => {
    for (let i = 0; i < 500; i += 1) {
      for (const char of generateRoomCode()) {
        expect(ROOM_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("excludes the characters people misread on a TV", () => {
    for (const char of ["O", "0", "I", "1", "L", "S", "5", "B", "8", "Z", "2"]) {
      expect(ROOM_CODE_ALPHABET).not.toContain(char);
    }
  });

  it("spreads across the alphabet rather than favouring a few characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) {
      for (const char of generateRoomCode()) seen.add(char);
    }
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it("retries until it finds a free code", () => {
    let calls = 0;
    const isTaken = async () => {
      calls += 1;
      return calls < 4;
    };
    return expect(generateUniqueRoomCode(isTaken)).resolves.toHaveLength(ROOM_CODE_LENGTH);
  });

  it("throws rather than handing out a duplicate", async () => {
    await expect(generateUniqueRoomCode(async () => true, 3)).rejects.toThrow(
      /Could not find a free room code/,
    );
  });

  it("recognises well-shaped codes without a lookup", () => {
    expect(isRoomCodeShaped(generateRoomCode())).toBe(true);
    expect(isRoomCodeShaped("ABC")).toBe(false);
    expect(isRoomCodeShaped("AB0C")).toBe(false);
  });
});

describe("rate limiting", () => {
  it("allows a burst up to the bucket capacity", () => {
    const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 1 });
    const now = 1000;
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.tryConsume("a", now)).toBe(true);
    }
    expect(limiter.tryConsume("a", now)).toBe(false);
  });

  it("refills over time", () => {
    const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 2 });
    limiter.tryConsume("a", 0);
    limiter.tryConsume("a", 0);
    expect(limiter.tryConsume("a", 0)).toBe(false);

    // Half a second at two tokens per second restores exactly one.
    expect(limiter.tryConsume("a", 500)).toBe(true);
    expect(limiter.tryConsume("a", 500)).toBe(false);
  });

  it("never accumulates more than the capacity", () => {
    const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 10 });
    limiter.tryConsume("a", 0);
    // A long idle period must not buy an unlimited burst afterwards.
    let allowed = 0;
    for (let i = 0; i < 20; i += 1) {
      if (limiter.tryConsume("a", 60_000)) allowed += 1;
    }
    expect(allowed).toBe(3);
  });

  it("tracks each client separately", () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 0 });
    expect(limiter.tryConsume("a", 0)).toBe(true);
    expect(limiter.tryConsume("b", 0)).toBe(true);
    expect(limiter.tryConsume("a", 0)).toBe(false);
  });

  it("forgets a client that has gone", () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 0 });
    limiter.tryConsume("a", 0);
    limiter.forget("a");
    expect(limiter.tryConsume("a", 0)).toBe(true);
  });

  it("permits normal play without tripping", () => {
    // A fast player submitting and retrying peaks near three per second.
    const limiter = new RateLimiter(GAME_ACTION_LIMITS);
    let blocked = 0;
    for (let i = 0; i < 30; i += 1) {
      if (!limiter.tryConsume("player", i * 333)) blocked += 1;
    }
    expect(blocked).toBe(0);
  });

  it("stops a sustained flood", () => {
    const limiter = new RateLimiter(SESSION_ACTION_LIMITS);
    let blocked = 0;
    for (let i = 0; i < 100; i += 1) {
      if (!limiter.tryConsume("player", 0)) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(90);
  });
});

describe("game registry", () => {
  beforeEach(() => {
    resetRegistry();
    registerGame(stubGame);
  });

  afterEach(() => {
    resetRegistry();
  });

  it("resolves a registered game", () => {
    expect(getGame("stub")?.id).toBe("stub");
    expect(listGames()).toHaveLength(1);
  });

  it("returns undefined for an unknown id rather than throwing", () => {
    expect(getGame("does-not-exist")).toBeUndefined();
  });

  it("names what is installed when a required game is missing", () => {
    expect(() => requireGame("does-not-exist")).toThrow(/Registered: stub/);
  });

  it("refuses to register the same id twice", () => {
    expect(() => registerGame(stubGame)).toThrow(/already registered/);
  });

  it("exposes the player bounds the lobby needs", () => {
    const game = requireGame("stub");
    expect(game.minPlayers).toBeGreaterThanOrEqual(1);
    expect(game.maxPlayers).toBeGreaterThanOrEqual(game.minPlayers);
    expect(game.nameKey).toMatch(/^game\./);
  });
});

describe("localisation", () => {
  it("returns the English string for a known key", () => {
    const { t } = createTranslator("en");
    expect(t("host.scanToJoin")).toBe(en["host.scanToJoin"]);
  });

  it("interpolates named parameters", () => {
    const { t } = createTranslator("en");
    expect(t("host.winner", { name: "Ali" })).toBe("Ali wins!");
  });

  it("leaves an unmatched placeholder alone rather than printing undefined", () => {
    const { t } = createTranslator("en");
    expect(t("host.winner", {})).toContain("{name}");
  });

  it("falls back to the key itself for an unknown string", () => {
    const { t } = createTranslator("en");
    expect(t("nope.not.a.key")).toBe("nope.not.a.key");
  });

  it("falls back to English for an unknown locale", () => {
    const { t, code } = createTranslator("xx");
    expect(code).toBe("en");
    expect(t("host.players")).toBe(en["host.players"]);
  });

  it("resolves a browser language list to a supported locale", () => {
    expect(resolveLocale(["en-GB", "fr"])).toBe("en");
    expect(resolveLocale(["fa-IR"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
  });

  it("covers every error code with a message", () => {
    const codes = [
      "ROOM_NOT_FOUND",
      "ROOM_FULL",
      "ROOM_CLOSED",
      "GAME_IN_PROGRESS",
      "INVALID_PAYLOAD",
      "NOT_ALLOWED",
      "RATE_LIMITED",
      "UNKNOWN_ACTION",
      "WRONG_STATE",
      "INTERNAL",
    ] as const;
    const { t } = createTranslator("en");
    for (const code of codes) {
      expect(t(`error.${code}`)).not.toBe(`error.${code}`);
    }
  });
});
