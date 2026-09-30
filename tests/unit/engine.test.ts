/**
 * The match engine and the test harness that wraps it.
 *
 * These are the semantics every game is written against: when `start` runs,
 * what a refused action looks like, when `GAME_OVER` happens, how bots are
 * scheduled, and that a game's own bug never takes the platform down.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createTestMatch,
  defineGame,
  hasExpired,
  startDeadline,
  type GameContext,
} from "@partyframe/game-core";
import { PLATFORM_EVENT } from "@partyframe/protocol";

/** A two-phase game: a countdown, then first-to-target taps. */
const countdownTap = defineGame({
  id: "countdown-tap",
  nameKey: "game.countdown.name",
  minPlayers: 1,
  maxPlayers: 4,
  options: {
    target: { type: "number", labelKey: "o.target", default: 2, min: 1, max: 5 },
    countdownMs: { type: "number", labelKey: "o.countdown", default: 1000, min: 0, max: 5000 },
  },
  actionSchema: z.object({ type: z.literal("tap") }),
  createState: (options) => ({
    countdown: null as ReturnType<typeof startDeadline> | null,
    taps: {} as Record<string, number>,
    winnerId: "",
    target: options.target,
    countdownMs: options.countdownMs,
  }),
  start(ctx) {
    ctx.state.countdown = startDeadline(ctx.now, ctx.state.countdownMs);
    ctx.requestStatus("STARTING");
  },
  update(ctx) {
    if (ctx.state.countdown && hasExpired(ctx.state.countdown, ctx.now)) {
      ctx.state.countdown = null;
      ctx.emit({ kind: "go" });
      ctx.requestStatus("PLAYING");
    }
  },
  handleAction(ctx, playerId) {
    if (ctx.state.countdown) return false;
    ctx.state.taps[playerId] = (ctx.state.taps[playerId] ?? 0) + 1;
    ctx.emitTo(playerId, { kind: "counted" });
    if ((ctx.state.taps[playerId] ?? 0) >= ctx.state.target) {
      ctx.state.winnerId = playerId;
      ctx.players.addScore(playerId, 10);
    }
    return true;
  },
  isFinished: (ctx) => Boolean(ctx.state.winnerId),
  getControllerState: (ctx, playerId) => ({
    active: !ctx.state.countdown && !ctx.state.winnerId,
    game: { taps: ctx.state.taps[playerId] ?? 0 },
  }),
  getPublicState: (ctx) => ({ taps: ctx.state.taps, winnerId: ctx.state.winnerId }),
  createBot: (difficulty) => ({
    difficulty,
    decide: (ctx) =>
      ctx.state.countdown ? null : { action: { type: "tap" as const }, delayMs: 250 },
  }),
  devCommands: {
    "skip-countdown": (ctx) => {
      ctx.state.countdown = null;
      ctx.requestStatus("PLAYING");
    },
  },
});

describe("lifecycle", () => {
  it("holds STARTING while the game asks for it, then plays", () => {
    const match = createTestMatch(countdownTap, { players: ["a", "b"] });
    expect(match.status).toBe("LOBBY");

    match.start();
    expect(match.status).toBe("STARTING");
    expect(match.eventsOfKind(PLATFORM_EVENT.GAME_STARTED)).toHaveLength(1);
    expect(match.controller("a").active).toBe(false);

    match.advance(999);
    expect(match.status).toBe("STARTING");
    match.advance(1);
    expect(match.status).toBe("PLAYING");
    expect(match.eventsOfKind("go")).toHaveLength(1);
    expect(match.statusLog).toEqual(["STARTING", "PLAYING"]);
  });

  it("enters PLAYING on its own when the game requests nothing", () => {
    const simple = defineGame({
      id: "simple",
      nameKey: "x",
      minPlayers: 1,
      maxPlayers: 2,
      actionSchema: z.object({}),
      createState: () => ({}),
      handleAction: () => true,
      isFinished: () => false,
      getControllerState: () => ({ active: true, game: null }),
      getPublicState: () => ({}),
    });
    const match = createTestMatch(simple, { players: 1 });
    match.start();
    expect(match.status).toBe("PLAYING");
  });

  it("ends the match when isFinished turns true, with winners and wins", () => {
    const match = createTestMatch(countdownTap, {
      players: ["a", "b"],
      options: { countdownMs: 0 },
    });
    match.start();
    match.advance(100);
    expect(match.status).toBe("PLAYING");

    expect(match.act("a", { type: "tap" })).toEqual({ status: "applied" });
    expect(match.status).toBe("PLAYING");
    match.act("a", { type: "tap" });
    expect(match.status).toBe("GAME_OVER");
    expect(match.winnerIds).toEqual(["a"]);
    expect(match.score("a")).toBe(10);
    expect(match.players.find((p) => p.id === "a")?.wins).toBe(1);

    const ended = match.eventsOfKind(PLATFORM_EVENT.GAME_ENDED);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.playerId).toBe("a");
  });

  it("rematch resets scores but keeps wins; lobby resets everything", () => {
    const match = createTestMatch(countdownTap, {
      players: ["a"],
      options: { countdownMs: 0, target: 1 },
    });
    match.start();
    match.tick();
    match.act("a", { type: "tap" });
    expect(match.status).toBe("GAME_OVER");

    match.rematch();
    match.tick();
    expect(match.status).toBe("PLAYING");
    expect(match.score("a")).toBe(0);
    expect(match.players[0]?.wins).toBe(1);
    expect(match.winnerIds).toEqual([]);

    match.act("a", { type: "tap" });
    match.returnToLobby();
    expect(match.status).toBe("LOBBY");
    expect(match.score("a")).toBe(0);
    expect(match.players[0]?.wins).toBe(2);
  });

  it("refuses to start below the minimum and to act outside a match", () => {
    const match = createTestMatch(countdownTap, { players: 0 });
    expect(() => match.start()).toThrow(/needs 1 players/);
    match.addPlayer("solo");
    expect(() => match.act("solo", { type: "tap" })).toThrow(/cannot act while status is LOBBY/);
  });
});

describe("actions", () => {
  it("distinguishes invalid payloads from refused ones", () => {
    const match = createTestMatch(countdownTap, { players: ["a"] });
    match.start();
    // Countdown running: well-formed but not legal yet.
    expect(match.act("a", { type: "tap" })).toEqual({ status: "refused" });
    // Malformed: never reaches the rules.
    const invalid = match.act("a", { type: "boom" } as never);
    expect(invalid.status).toBe("invalid");
    if (invalid.status === "invalid") expect(invalid.issues.length).toBeGreaterThan(0);
  });

  it("delivers private cues only to their recipient", () => {
    const match = createTestMatch(countdownTap, {
      players: ["a", "b"],
      options: { countdownMs: 0 },
    });
    match.start();
    match.advance(100);
    match.act("a", { type: "tap" });
    const counted = match.eventsOfKind("counted");
    expect(counted).toHaveLength(1);
    expect(counted[0]?.to).toBe("a");
  });

  it("surfaces a game's own exception as a test failure", () => {
    const broken = defineGame({
      id: "broken",
      nameKey: "x",
      minPlayers: 1,
      maxPlayers: 1,
      actionSchema: z.object({}),
      createState: () => ({}),
      handleAction: () => {
        throw new Error("kaboom");
      },
      isFinished: () => false,
      getControllerState: () => ({ active: true, game: null }),
      getPublicState: () => ({}),
    });
    const match = createTestMatch(broken, { players: 1 });
    match.start();
    expect(() => match.act("p1", {})).toThrow("kaboom");
  });
});

describe("bots", () => {
  it("wait for their delay, then act through the same path as humans", () => {
    const match = createTestMatch(countdownTap, {
      players: ["human"],
      bots: 1,
      options: { countdownMs: 0, target: 3 },
    });
    match.start();
    match.advance(100);
    // 250ms think time, then a tap; three taps to win.
    match.advance(240);
    expect(match.status).toBe("PLAYING");
    match.advance(2000);
    expect(match.status).toBe("GAME_OVER");
    expect(match.winnerIds).toEqual(["bot-1"]);
  });

  it("are not consulted while a decision is pending", () => {
    let decisions = 0;
    const counting = defineGame({
      ...countdownTap,
      id: "counting",
      createBot: (difficulty) => ({
        difficulty,
        decide: () => {
          decisions += 1;
          return { action: { type: "tap" as const }, delayMs: 1000 };
        },
      }),
    });
    const match = createTestMatch(counting, { players: 0, bots: 1, options: { countdownMs: 0 } });
    match.start();
    match.advance(900);
    expect(decisions).toBe(1);
  });
});

describe("determinism", () => {
  it("replays identically for the same seed and script", () => {
    const dice = defineGame({
      id: "dice",
      nameKey: "x",
      minPlayers: 1,
      maxPlayers: 1,
      actionSchema: z.object({}),
      createState: () => ({ rolls: [] as number[] }),
      handleAction: (ctx) => {
        ctx.state.rolls.push(ctx.rng.int(1, 6));
        return true;
      },
      isFinished: (ctx) => ctx.state.rolls.length >= 5,
      getControllerState: () => ({ active: true, game: null }),
      getPublicState: (ctx) => ctx.state.rolls,
    });
    const play = (seed: number) => {
      const match = createTestMatch(dice, { players: 1, seed });
      match.start();
      for (let i = 0; i < 5; i += 1) match.act("p1", {});
      return match.publicState();
    };
    expect(play(7)).toEqual(play(7));
    expect(play(7)).not.toEqual(play(8));
  });
});

describe("dev commands and options", () => {
  it("runs a game's dev command and settles afterwards", () => {
    const match = createTestMatch(countdownTap, { players: ["a"] });
    match.start();
    expect(match.status).toBe("STARTING");
    expect(match.devCommand("skip-countdown")).toBe(true);
    expect(match.status).toBe("PLAYING");
    expect(match.devCommand("nope")).toBe(false);
  });

  it("parses options through the declared fields", () => {
    const match = createTestMatch(countdownTap, {
      players: 1,
      options: { target: 99, countdownMs: "x" },
    });
    expect(match.options).toEqual({ target: 5, countdownMs: 1000 });
  });

  it("gives the game a typed context", () => {
    const match = createTestMatch(countdownTap, { players: ["a"] });
    const ctx: GameContext<{ target: number }, { target: number }> = match.engine.context(
      0,
    ) as never;
    expect(ctx.options.target).toBe(2);
  });
});
