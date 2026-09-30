/**
 * The showcase games over real sockets.
 *
 * The harness tests prove the rules; this proves the games survive the wire:
 * JSON projections of the right shape reach the TV, private cues reach one
 * phone, the drawing game's stroke bursts clear the rate limiter, and secrets
 * stay out of the public state.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { doodleGame } from "../../examples/showcase/src/games/doodle/game.js";
import { quizGame } from "../../examples/showcase/src/games/quiz/game.js";
import { voteGame } from "../../examples/showcase/src/games/vote/game.js";
import {
  createHost,
  joinPlayer,
  startServer,
  waitFor,
  type Screen,
  type TestServer,
} from "./helpers.js";

let server: TestServer;
const open: Screen[] = [];

async function track<T extends Screen>(screen: Promise<T>): Promise<T> {
  const value = await screen;
  open.push(value);
  return value;
}

beforeAll(async () => {
  server = await startServer({ defaultGameId: "quiz", games: [quizGame, doodleGame, voteGame] });
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((screen) => screen.leave(true).catch(() => undefined)));
});

afterAll(async () => {
  await server.close();
});

describe("quiz", () => {
  it("asks, scores the fast correct answer and reveals", async () => {
    const host = await track(createHost(server, "quiz"));
    host.send({ type: "update-settings", settings: { gameOptions: { rounds: 3, seconds: 10 } } });
    const ali = await track(joinPlayer(server, host.welcome.roomCode, "Ali"));
    const sara = await track(joinPlayer(server, host.welcome.roomCode, "Sara"));

    host.send({ type: "start-game" });
    await waitFor(() => host.state().status === "PLAYING", "playing");
    await waitFor(
      () => (host.state().game as { question: string }).question.length > 0,
      "question",
    );

    const pub = host.state().game as {
      choices: string[];
      correct: number | null;
      deadline: unknown;
    };
    expect(pub.choices).toHaveLength(4);
    expect(pub.correct).toBeNull();
    await waitFor(
      () => (ali.controller?.game as { choices: string[] })?.choices?.length === 4,
      "phone choices",
    );

    // Neither phone knows the answer; the reveal is what tells them.
    ali.act({ type: "answer", choice: 0 });
    sara.act({ type: "answer", choice: 3 });
    await waitFor(() => (host.state().game as { phase: string }).phase === "reveal", "reveal");
    const revealed = host.state().game as { correct: number; picks: Record<string, number> };
    expect(revealed.correct).toBeGreaterThanOrEqual(0);
    expect(revealed.picks[ali.welcome.playerId]).toBe(0);
    expect(revealed.picks[sara.welcome.playerId]).toBe(3);
    await waitFor(
      () => (ali.controller?.game as { correct: number | null })?.correct !== null,
      "phone reveal",
    );

    host.send({ type: "dev-command", command: "end-game" });
    await waitFor(() => host.state().status === "GAME_OVER", "game over");
  });
});

describe("doodle", () => {
  it("streams a drawing from one phone, hides the word, and scores a guess", async () => {
    const host = await track(createHost(server, "doodle"));
    host.send({ type: "update-settings", settings: { gameOptions: { rounds: 2, seconds: 60 } } });
    const drawer = await track(joinPlayer(server, host.welcome.roomCode, "Drawer"));
    const guesser = await track(joinPlayer(server, host.welcome.roomCode, "Guesser"));

    host.send({ type: "start-game" });
    await waitFor(() => (host.state().game as { phase: string }).phase === "pick", "pick");
    expect((host.state().game as { drawerId: string }).drawerId).toBe(drawer.welcome.playerId);
    await waitFor(
      () => (drawer.controller?.game as { wordChoices: string[] })?.wordChoices?.length === 3,
      "choices on phone",
    );
    expect((guesser.controller?.game as { wordChoices: string[] }).wordChoices).toEqual([]);

    drawer.act({ type: "pick", index: 0 });
    await waitFor(() => (host.state().game as { phase: string }).phase === "draw", "draw");
    await waitFor(
      () => typeof (drawer.controller?.game as { word: string | null })?.word === "string",
      "word",
    );
    const word = (drawer.controller!.game as { word: string }).word;
    expect(JSON.stringify(host.state().game)).not.toContain(`"${word}"`);
    expect((guesser.controller?.game as { word: string | null }).word).toBeNull();

    // A burst well above the default 8-message budget.
    for (let i = 0; i < 30; i += 1) {
      drawer.act({
        type: "path",
        color: 1,
        width: 1,
        points: [i * 10, i * 10, i * 10 + 5, i * 10 + 5],
        end: i % 10 === 9,
      });
    }
    await waitFor(
      () => (host.state().game as { strokes: unknown[] }).strokes.length === 3,
      "strokes projected",
    );
    expect(drawer.errors.some((error) => error.code === "RATE_LIMITED")).toBe(false);
    expect((host.state().game as { strokes: { p: number[] }[] }).strokes[0]!.p).toHaveLength(40);

    guesser.act({ type: "guess", text: "definitely wrong" });
    await waitFor(
      () => (host.state().game as { recent: unknown[] }).recent.length === 1,
      "wrong guess shown",
    );
    guesser.act({ type: "guess", text: word.toUpperCase() });
    await waitFor(() => (host.state().game as { phase: string }).phase === "reveal", "reveal");
    expect(host.player(guesser.welcome.playerId)!.score).toBeGreaterThanOrEqual(100);
    expect(host.player(drawer.welcome.playerId)!.score).toBe(40);
    await waitFor(
      () => guesser.events.some((event) => event.kind === "doodle-correct"),
      "private cue",
    );
    expect(drawer.events.some((event) => event.kind === "doodle-correct")).toBe(false);
  });
});

describe("most likely to", () => {
  it("collects secret votes and reveals a tally", async () => {
    const host = await track(createHost(server, "vote"));
    const a = await track(joinPlayer(server, host.welcome.roomCode, "A"));
    const b = await track(joinPlayer(server, host.welcome.roomCode, "B"));
    const c = await track(joinPlayer(server, host.welcome.roomCode, "C"));

    host.send({ type: "start-game" });
    await waitFor(() => (host.state().game as { prompt: string }).prompt.length > 0, "prompt");
    a.act({ type: "vote", playerId: b.welcome.playerId });
    await waitFor(
      () => (host.state().game as { votedIds: string[] }).votedIds.length === 1,
      "one vote",
    );
    expect((host.state().game as { votes: Record<string, string> }).votes).toEqual({});

    c.act({ type: "vote", playerId: b.welcome.playerId });
    b.act({ type: "vote", playerId: a.welcome.playerId });
    await waitFor(() => (host.state().game as { phase: string }).phase === "reveal", "reveal");
    const tally = (host.state().game as { tally: Record<string, number> }).tally;
    expect(tally[b.welcome.playerId]).toBe(2);
    expect(host.player(b.welcome.playerId)!.score).toBe(200);
    expect(host.player(a.welcome.playerId)!.score).toBe(100);
  });
});
