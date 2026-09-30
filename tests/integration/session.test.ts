/**
 * The session room, exercised through real sockets.
 *
 * Every test here is a scenario a living room produces: a TV creates a game,
 * phones scan in, someone starts too early, someone's Wi-Fi drops, a latecomer
 * arrives mid-round. The server is the real `listen()`; the clients are the
 * real Colyseus SDK the web app uses.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CLOSE_CODE, PLATFORM_EVENT, ROOM_CODE_LENGTH } from "@partyframe/protocol";
import {
  createHost,
  joinController,
  joinPlayer,
  lookup,
  rebind,
  sleep,
  startServer,
  waitFor,
  type Screen,
  type TestServer,
} from "./helpers.js";

let server: TestServer;
const open: Screen[] = [];

/** Tracks screens so a failing test cannot leak sockets into the next one. */
async function track<T extends Screen>(screen: Promise<T>): Promise<T> {
  const value = await screen;
  open.push(value);
  return value;
}

beforeAll(async () => {
  server = await startServer();
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((screen) => screen.leave(true).catch(() => undefined)));
});

afterAll(async () => {
  await server.close();
});

describe("creating and finding a session", () => {
  it("gives the shared screen a code that phones can resolve", async () => {
    const host = await track(createHost(server));
    expect(host.welcome.role).toBe("host");
    expect(host.welcome.roomCode).toHaveLength(ROOM_CODE_LENGTH);
    expect(host.state().status).toBe("LOBBY");
    expect(host.state().hostConnected).toBe(true);

    const found = await lookup(server, host.welcome.roomCode.toLowerCase());
    expect(found).toMatchObject({
      roomCode: host.welcome.roomCode,
      gameId: "tap",
      status: "LOBBY",
      playerCount: 0,
      joinable: true,
      lateJoin: "spectate",
    });
  });

  it("answers 404 for a code nobody is using", async () => {
    expect(await lookup(server, "QQQQ")).toBeNull();
  });

  it("creates a session for the requested game and publishes its options", async () => {
    const host = await track(createHost(server, "duo"));
    expect(host.state().gameId).toBe("duo");
    expect(host.state().settings.maxPlayers).toBe(4);

    const tap = await track(createHost(server, "tap"));
    expect(JSON.parse(tap.state().settings.gameOptions)).toEqual({ target: 3 });
  });

  it("refuses a second shared screen while the first is attached", async () => {
    const host = await track(createHost(server));
    const found = await lookup(server, host.welcome.roomCode);
    await expect(host.client.joinById(found!.roomId, { role: "host" })).rejects.toThrow(
      /NOT_ALLOWED/,
    );
  });

  it("reports health with a session count", async () => {
    const response = await fetch(`${server.url}/api/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; sessions: number };
    expect(body.ok).toBe(true);
    expect(body.sessions).toBeGreaterThanOrEqual(0);
  });
});

describe("joining", () => {
  it("seats a player once their profile arrives and makes the first one host", async () => {
    const host = await track(createHost(server));
    const ali = await track(joinPlayer(server, host.welcome.roomCode, "Ali"));

    const row = host.player(ali.welcome.playerId);
    expect(row).toMatchObject({ name: "Ali", joined: true, isHost: true, spectator: false });
    expect(host.state().hostPlayerId).toBe(ali.welcome.playerId);
    expect(ali.controller?.mode).toBe("lobby");
    expect(host.events.some((event) => event.kind === PLATFORM_EVENT.PLAYER_JOINED)).toBe(true);
  });

  it("keeps names and colours distinct on the shared screen", async () => {
    const host = await track(createHost(server));
    const first = await track(
      joinPlayer(server, host.welcome.roomCode, "Ali", { color: "#5b8cff" }),
    );
    const second = await track(
      joinPlayer(server, host.welcome.roomCode, "ali", { color: "#5b8cff" }),
    );

    expect(host.player(first.welcome.playerId)?.name).toBe("Ali");
    expect(host.player(second.welcome.playerId)?.name).toBe("ali 2");
    expect(host.player(second.welcome.playerId)?.color).not.toBe("#5b8cff");
  });

  it("hides an unjoined seat from the count but still reserves it", async () => {
    const host = await track(createHost(server));
    await track(joinController(server, host.welcome.roomCode));
    await waitFor(() => host.players().length === 1, "seat reserved");
    expect(host.players()[0]?.joined).toBe(false);
    expect((await lookup(server, host.welcome.roomCode))?.playerCount).toBe(0);
  });

  it("rejects a full room", async () => {
    const host = await track(createHost(server));
    host.send({ type: "update-settings", settings: { maxPlayers: 1 } });
    await waitFor(() => host.state().settings.maxPlayers === 1, "cap");

    await track(joinPlayer(server, host.welcome.roomCode, "Ali"));
    await expect(joinController(server, host.welcome.roomCode)).rejects.toThrow(/ROOM_FULL/);
  });
});

describe("a match", () => {
  it("refuses to start below the game's minimum and tells the requester why", async () => {
    const host = await track(createHost(server, "duo"));
    await track(joinPlayer(server, host.welcome.roomCode, "Solo"));

    host.send({ type: "start-game" });
    await waitFor(() => host.errors.length > 0, "error");
    expect(host.errors[0]?.code).toBe("NOT_ENOUGH_PLAYERS");
    expect(host.state().status).toBe("LOBBY");
    expect(host.events.some((event) => event.kind === PLATFORM_EVENT.START_REFUSED)).toBe(true);
  });

  it("runs from lobby to game over with scores, winners and events", async () => {
    const host = await track(createHost(server));
    const ali = await track(joinPlayer(server, host.welcome.roomCode, "Ali"));
    const sara = await track(joinPlayer(server, host.welcome.roomCode, "Sara"));

    host.send({ type: "start-game" });
    await waitFor(() => host.state().status === "PLAYING", "PLAYING");
    await waitFor(() => ali.controller?.mode === "game", "controller in game");
    expect(host.events.some((event) => event.kind === PLATFORM_EVENT.GAME_STARTED)).toBe(true);
    expect(ali.controller?.game).toEqual({ taps: 0, target: 3 });

    ali.act({ type: "tap" });
    await waitFor(
      () => ali.controller?.game && (ali.controller.game as { taps: number }).taps === 1,
      "tap",
    );
    // The private cue reached only the tapper.
    await waitFor(() => ali.events.some((event) => event.kind === "tap-counted"), "private cue");
    expect(sara.events.some((event) => event.kind === "tap-counted")).toBe(false);
    await waitFor(
      () =>
        (host.state().game as { taps: Record<string, number> }).taps[ali.welcome.playerId] === 1,
      "projection",
    );

    ali.act({ type: "tap" });
    ali.act({ type: "tap" });
    await waitFor(() => host.state().status === "GAME_OVER", "GAME_OVER");

    expect(host.state().winnerIds).toEqual([ali.welcome.playerId]);
    expect(host.player(ali.welcome.playerId)).toMatchObject({ score: 1, wins: 1 });
    expect(host.player(sara.welcome.playerId)).toMatchObject({ score: 0, wins: 0 });
    await waitFor(() => ali.controller?.mode === "game-over", "game-over mode");
    expect(host.events.some((event) => event.kind === PLATFORM_EVENT.GAME_ENDED)).toBe(true);
    expect(host.events.some((event) => event.kind === "tap-won")).toBe(true);

    // A rematch resets match scores but keeps the session's win tally.
    host.send({ type: "rematch" });
    await waitFor(() => host.state().status === "PLAYING", "rematch");
    expect(host.player(ali.welcome.playerId)).toMatchObject({ score: 0, wins: 1 });
    expect(host.state().winnerIds).toEqual([]);
  });

  it("rejects malformed, out-of-turn and unauthorised actions distinctly", async () => {
    const host = await track(createHost(server));
    const ali = await track(joinPlayer(server, host.welcome.roomCode, "Ali"));

    ali.act({ type: "tap" });
    await waitFor(() => ali.errors.length === 1, "lobby action refused");
    expect(ali.errors[0]?.code).toBe("WRONG_STATE");

    host.send({ type: "start-game" });
    await waitFor(() => host.state().status === "PLAYING", "PLAYING");

    ali.act({ type: "explode" });
    await waitFor(() => ali.errors.length === 2, "invalid payload");
    expect(ali.errors[1]?.code).toBe("INVALID_PAYLOAD");

    host.act({ type: "tap" });
    await waitFor(() => host.errors.length === 1, "host screen refused");
    expect(host.errors[0]?.code).toBe("NOT_ALLOWED");
  });

  it("only republishes the projection when it changed", async () => {
    const host = await track(createHost(server));
    await track(joinPlayer(server, host.welcome.roomCode, "Ali"));
    host.send({ type: "start-game" });
    await waitFor(() => host.state().status === "PLAYING", "PLAYING");
    const revision = host.state().gameRevision;
    await sleep(400);
    expect(host.state().gameRevision).toBe(revision);
  });

  it("applies and clamps game options from the lobby", async () => {
    const host = await track(createHost(server));
    host.send({ type: "update-settings", settings: { gameOptions: { target: 999, junk: true } } });
    await waitFor(() => host.state().settings.gameOptions.includes("50"), "clamped");
    expect(JSON.parse(host.state().settings.gameOptions)).toEqual({ target: 50 });
  });

  it("returns to the lobby with a clean slate", async () => {
    const host = await track(createHost(server));
    const ali = await track(joinPlayer(server, host.welcome.roomCode, "Ali"));
    host.send({ type: "start-game" });
    await waitFor(() => host.state().status === "PLAYING", "PLAYING");
    host.send({ type: "dev-command", command: "finish-now" });
    await waitFor(() => host.state().status === "GAME_OVER", "GAME_OVER");

    host.send({ type: "return-to-lobby" });
    await waitFor(() => host.state().status === "LOBBY", "LOBBY");
    expect(host.player(ali.welcome.playerId)?.score).toBe(0);
    expect(host.state().winnerIds).toEqual([]);
    await waitFor(() => ali.controller?.mode === "lobby", "lobby mode");
  });
});

describe("late joiners", () => {
  it("seat a spectator who plays the next match", async () => {
    const host = await track(createHost(server));
    await track(joinPlayer(server, host.welcome.roomCode, "Ali"));
    host.send({ type: "start-game" });
    await waitFor(() => host.state().status === "PLAYING", "PLAYING");

    expect((await lookup(server, host.welcome.roomCode))?.joinable).toBe(true);
    const late = await track(joinPlayer(server, host.welcome.roomCode, "Late"));
    expect(host.player(late.welcome.playerId)?.spectator).toBe(true);
    await waitFor(() => late.controller?.mode === "spectating", "spectating");
    expect(late.controller?.active).toBe(false);

    host.send({ type: "dev-command", command: "finish-now" });
    await waitFor(() => host.state().status === "GAME_OVER", "GAME_OVER");
    host.send({ type: "rematch" });
    await waitFor(() => host.state().status === "PLAYING", "rematch");
    expect(host.player(late.welcome.playerId)?.spectator).toBe(false);
    await waitFor(() => late.controller?.mode === "game", "late joiner playing");
  });

  it("are refused by a game that denies late joins", async () => {
    const host = await track(createHost(server, "duo"));
    await track(joinPlayer(server, host.welcome.roomCode, "A"));
    await track(joinPlayer(server, host.welcome.roomCode, "B"));
    host.send({ type: "start-game" });
    await waitFor(() => host.state().status === "PLAYING", "PLAYING");

    expect((await lookup(server, host.welcome.roomCode))?.joinable).toBe(false);
    await expect(joinController(server, host.welcome.roomCode)).rejects.toThrow(/GAME_IN_PROGRESS/);
  });
});

describe("host powers", () => {
  it("let the host phone kick another phone but never the shared screen", async () => {
    const host = await track(createHost(server));
    const boss = await track(joinPlayer(server, host.welcome.roomCode, "Boss"));
    const victim = await track(joinPlayer(server, host.welcome.roomCode, "Victim"));

    boss.send({ type: "kick-player", playerId: host.welcome.playerId });
    await waitFor(() => boss.errors.length === 1, "refusal");
    expect(boss.errors[0]?.code).toBe("NOT_ALLOWED");
    expect(host.leaveCode).toBeNull();
    expect(host.state().hostConnected).toBe(true);

    boss.send({ type: "kick-player", playerId: victim.welcome.playerId });
    await waitFor(() => victim.leaveCode === CLOSE_CODE.KICKED, "kick");
    await waitFor(() => host.player(victim.welcome.playerId) === undefined, "row removed");
  });

  it("are refused to ordinary players", async () => {
    const host = await track(createHost(server));
    await track(joinPlayer(server, host.welcome.roomCode, "Boss"));
    const peon = await track(joinPlayer(server, host.welcome.roomCode, "Peon"));

    peon.send({ type: "start-game" });
    await waitFor(() => peon.errors.length === 1, "refusal");
    expect(peon.errors[0]?.code).toBe("NOT_ALLOWED");
  });

  it("pass to the next player when the host phone leaves", async () => {
    const host = await track(createHost(server));
    const first = await track(joinPlayer(server, host.welcome.roomCode, "First"));
    const second = await track(joinPlayer(server, host.welcome.roomCode, "Second"));

    await first.leave(true);
    await waitFor(() => host.state().hostPlayerId === second.welcome.playerId, "election");
    expect(host.player(second.welcome.playerId)?.isHost).toBe(true);
  });
});

describe("bots", () => {
  it("fill seats, play through the human path and can win", async () => {
    const host = await track(createHost(server));
    host.send({ type: "update-settings", settings: { botCount: 2 } });
    await waitFor(() => host.players().filter((p) => p.isBot).length === 2, "bots seated");
    expect(host.state().settings.botCount).toBe(2);

    host.send({ type: "start-game" });
    await waitFor(() => host.state().status === "GAME_OVER", "bots finish", 8000);
    const winner = host.state().winnerIds[0];
    expect(host.player(winner ?? "")?.isBot).toBe(true);
  });

  it("make way for humans and are capped by the game", async () => {
    const host = await track(createHost(server, "duo"));
    host.send({ type: "update-settings", settings: { botCount: 3 } });
    await sleep(100);
    // `duo` has no createBot, so bots are impossible.
    expect(host.players()).toHaveLength(0);
    expect(host.state().settings.botCount).toBe(0);
  });
});

describe("dropping and returning", () => {
  it("keeps a phone's seat through a drop and restores it on reconnect", async () => {
    const host = await track(createHost(server));
    const ali = await track(joinPlayer(server, host.welcome.roomCode, "Ali"));
    host.send({ type: "start-game" });
    await waitFor(() => host.state().status === "PLAYING", "PLAYING");

    await ali.room.leave(false);
    await waitFor(() => host.player(ali.welcome.playerId)?.connected === false, "disconnected");
    expect(host.events.some((event) => event.kind === PLATFORM_EVENT.PLAYER_DISCONNECTED)).toBe(
      true,
    );

    const room = await ali.client.reconnect(ali.room.reconnectionToken);
    open.push(rebind(ali, room));
    await waitFor(() => host.player(ali.welcome.playerId)?.connected === true, "reconnected");
    expect(host.player(ali.welcome.playerId)?.name).toBe("Ali");
    expect(host.events.some((event) => event.kind === PLATFORM_EVENT.PLAYER_RECONNECTED)).toBe(
      true,
    );
  });

  it("keeps the session alive while the shared screen is away and lets it return", async () => {
    const host = await track(createHost(server));
    const ali = await track(joinPlayer(server, host.welcome.roomCode, "Ali"));

    await host.room.leave(false);
    await waitFor(() => ali.state().hostConnected === false, "host away");
    expect(await lookup(server, host.welcome.roomCode)).not.toBeNull();

    const room = await host.client.reconnect(host.room.reconnectionToken);
    open.push(rebind(host, room));
    await waitFor(() => ali.state().hostConnected === true, "host back");
  });

  it("lets a fresh shared screen take over a session whose TV vanished", async () => {
    const host = await track(createHost(server));
    const ali = await track(joinPlayer(server, host.welcome.roomCode, "Ali"));
    await host.room.leave(false);
    await waitFor(() => ali.state().hostConnected === false, "host away");

    const found = await lookup(server, host.welcome.roomCode);
    const replacement = await track(
      host.client.joinById(found!.roomId, { role: "host" }).then((room) => rebind(host, room)),
    );
    expect(replacement.room.sessionId).not.toBe(host.room.sessionId);
    await waitFor(() => ali.state().hostConnected === true, "replacement attached");
  });

  it("disposes an empty lobby the shared screen closed on purpose", async () => {
    const host = await track(createHost(server));
    const code = host.welcome.roomCode;
    await host.leave(true);
    await sleep(150);
    expect(await lookup(server, code)).toBeNull();
  });
});

describe("rate limits", () => {
  it("apply the default budget to button games and a game's own budget to streaming games", async () => {
    const tap = await track(createHost(server, "tap"));
    const tapper = await track(joinPlayer(server, tap.welcome.roomCode, "Tapper"));
    tap.send({ type: "start-game" });
    await waitFor(() => tap.state().status === "PLAYING", "tap playing");
    for (let i = 0; i < 12; i += 1) tapper.act({ type: "tap" });
    await waitFor(
      () => tapper.errors.some((error) => error.code === "RATE_LIMITED"),
      "tap limited",
    );

    const stream = await track(createHost(server, "stream"));
    const pen = await track(joinPlayer(server, stream.welcome.roomCode, "Pen"));
    stream.send({ type: "start-game" });
    await waitFor(() => stream.state().status === "PLAYING", "stream playing");
    for (let i = 0; i < 30; i += 1) pen.act({ type: "point", n: i });
    await waitFor(
      () => (stream.state().game as { received: number }).received === 30,
      "all points",
    );
    expect(pen.errors.some((error) => error.code === "RATE_LIMITED")).toBe(false);
  });
});

describe("developer tools", () => {
  it("delay inbound messages by the configured latency", async () => {
    const response = await fetch(`${server.url}/api/dev/latency`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ milliseconds: 150 }),
    });
    expect(response.status).toBe(200);
    try {
      const host = await track(createHost(server));
      const started = Date.now();
      host.send({ type: "update-settings", settings: { botCount: 1 } });
      await waitFor(() => host.state().settings.botCount === 1, "delayed settings");
      expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    } finally {
      await fetch(`${server.url}/api/dev/latency`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ milliseconds: 0 }),
      });
    }
  });

  it("reject nonsense", async () => {
    const response = await fetch(`${server.url}/api/dev/latency`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ milliseconds: -5 }),
    });
    expect(response.status).toBe(400);
  });
});
