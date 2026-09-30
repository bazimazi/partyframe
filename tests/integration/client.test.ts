/**
 * The client package's connection layer against a real server.
 *
 * `SessionConnection` is what both React shells build on. Running it here, in
 * Node, checks the parts a browser test would otherwise be the only witness
 * to: snapshot conversion (including the JSON game projection), the welcome
 * handshake, host resume-by-code after a "reload", and controller recovery.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionConnection, type SessionView } from "@bazimazi/partyframe-client";
import { startServer, waitFor, type TestServer } from "./helpers.js";

let server: TestServer;
const connections: SessionConnection[] = [];

function open(): SessionConnection {
  const connection = new SessionConnection(server.url);
  connections.push(connection);
  return connection;
}

async function until(
  connection: SessionConnection,
  predicate: (view: SessionView) => boolean,
  label: string,
): Promise<SessionView> {
  await waitFor(() => predicate(connection.current), label);
  return connection.current;
}

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await Promise.all(connections.map((connection) => connection.leave(true).catch(() => undefined)));
  await server.close();
});

describe("SessionConnection", () => {
  it("creates a session as host and converts state into a plain snapshot", async () => {
    const host = open();
    void host.connect({ role: "host", gameId: "tap" });
    const view = await until(
      host,
      (v) => v.status === "connected" && v.snapshot !== null,
      "host up",
    );

    expect(view.roomCode).toHaveLength(4);
    expect(view.snapshot).toMatchObject({
      status: "LOBBY",
      gameId: "tap",
      hostConnected: true,
      players: [],
      winnerIds: [],
      settings: { maxPlayers: 8, botCount: 0, botDifficulty: "medium", gameOptions: { target: 3 } },
    });
    // The JSON projection is parsed into ordinary data.
    expect(view.snapshot?.game).toEqual({ taps: {}, winnerId: "" });
  });

  it("joins as a controller, plays and sees the projection update", async () => {
    const host = open();
    void host.connect({ role: "host" });
    const { roomCode } = await until(
      host,
      (v) => v.status === "connected" && Boolean(v.roomCode),
      "host",
    );

    const phone = open();
    void phone.connect({ role: "controller", roomCode });
    await until(phone, (v) => v.status === "connected" && v.controller?.mode === "setup", "phone");

    phone.sendSessionAction({ type: "set-profile", name: "Ali", avatar: "🦊", color: "#ff5d5d" });
    await until(phone, (v) => v.controller?.mode === "lobby", "joined");
    await until(phone, (v) => v.snapshot?.players[0]?.joined === true, "row synced");
    expect(phone.current.snapshot?.players[0]).toMatchObject({
      name: "Ali",
      joined: true,
      isHost: true,
    });

    host.sendSessionAction({ type: "start-game" });
    await until(phone, (v) => v.controller?.mode === "game", "playing");
    phone.sendGameAction({ type: "tap" });
    await until(
      phone,
      (v) => (v.snapshot?.game as { taps: Record<string, number> })?.taps[v.playerId] === 1,
      "tap projected",
    );
    expect(phone.current.controller?.game).toEqual({ taps: 1, target: 3 });
  });

  it("reports precise join failures", async () => {
    const phone = open();
    void phone.connect({ role: "controller", roomCode: "QQQQ" });
    const view = await until(phone, (v) => v.status === "error", "error");
    expect(view.error?.code).toBe("ROOM_NOT_FOUND");
  });

  it("lets a reloaded shared screen resume its session by code", async () => {
    const host = open();
    void host.connect({ role: "host" });
    const { roomCode } = await until(
      host,
      (v) => v.status === "connected" && Boolean(v.roomCode),
      "host",
    );

    const phone = open();
    void phone.connect({ role: "controller", roomCode });
    await until(phone, (v) => v.status === "connected", "phone");
    phone.sendSessionAction({ type: "set-profile", name: "Sara", avatar: "🐼", color: "#5b8cff" });
    await until(phone, (v) => v.controller?.mode === "lobby", "joined");

    // A reload: the old page is gone without saying goodbye.
    host.dispose();
    await until(phone, (v) => v.snapshot?.hostConnected === false, "host away");

    const reloaded = open();
    void reloaded.connect({ role: "host", roomCode });
    const view = await until(
      reloaded,
      (v) => v.status === "connected" && v.snapshot?.hostConnected === true,
      "host resumed",
    );
    expect(view.roomCode).toBe(roomCode);
    expect(view.snapshot?.players.map((p) => p.name)).toEqual(["Sara"]);
  });

  it("falls back to a fresh session when the code is dead", async () => {
    const host = open();
    void host.connect({ role: "host", roomCode: "QQQQ" });
    const view = await until(host, (v) => v.status === "connected" && Boolean(v.roomCode), "fresh");
    expect(view.roomCode).not.toBe("QQQQ");
  });
});
