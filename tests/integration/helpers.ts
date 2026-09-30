/**
 * Shared plumbing for integration tests: a real server on a free port and a
 * real Colyseus client per screen, with message capture and a polling wait.
 */

import { Client, type Room } from "colyseus.js";
import { z } from "zod";
import {
  defineGame,
  listen,
  resetAdapters,
  resetRegistry,
  resetRuntimeHost,
  silentLogger,
  type ListenOptions,
  type PartyServer,
} from "@bazimazi/partyframe-server";
import {
  MSG,
  PARTY_ROOM,
  type ControllerEnvelope,
  type GameEventMessage,
  type PartyError,
  type RoomLookupResponse,
  type SessionAction,
  type WelcomePayload,
} from "@partyframe/protocol";

/** First to `target` taps wins. Bots tap on a timer. */
export const tapGame = defineGame({
  id: "tap",
  nameKey: "game.tap.name",
  minPlayers: 1,
  maxPlayers: 8,
  options: {
    target: { type: "number", labelKey: "game.tap.target", default: 3, min: 1, max: 50 },
  },
  actionSchema: z.object({ type: z.literal("tap") }),
  createState: (options) => ({
    taps: {} as Record<string, number>,
    winnerId: "",
    target: options.target,
  }),
  handleAction(ctx, playerId, action) {
    if (action.type !== "tap" || ctx.state.winnerId) return false;
    ctx.state.taps[playerId] = (ctx.state.taps[playerId] ?? 0) + 1;
    if ((ctx.state.taps[playerId] ?? 0) >= ctx.state.target) {
      ctx.state.winnerId = playerId;
      ctx.players.addScore(playerId, 1);
      ctx.emit({ kind: "tap-won", playerId });
    } else {
      ctx.emitTo(playerId, { kind: "tap-counted" });
    }
    return true;
  },
  isFinished: (ctx) => Boolean(ctx.state.winnerId),
  getControllerState: (ctx, playerId) => ({
    active: !ctx.state.winnerId,
    game: { taps: ctx.state.taps[playerId] ?? 0, target: ctx.state.target },
  }),
  getPublicState: (ctx) => ({ taps: { ...ctx.state.taps }, winnerId: ctx.state.winnerId }),
  createBot: (difficulty) => ({
    difficulty,
    decide: () => ({ action: { type: "tap" as const }, delayMs: 30 }),
  }),
  devCommands: {
    "finish-now": (ctx) => {
      ctx.state.winnerId = ctx.players.all()[0]?.id ?? "";
    },
  },
});

/** Needs two players and refuses late joiners. */
export const duoGame = defineGame({
  id: "duo",
  nameKey: "game.duo.name",
  minPlayers: 2,
  maxPlayers: 4,
  lateJoin: "deny",
  actionSchema: z.object({ type: z.literal("noop") }),
  createState: () => ({ done: false }),
  handleAction: () => true,
  isFinished: (ctx) => ctx.state.done,
  getControllerState: () => ({ active: true, game: null }),
  getPublicState: (ctx) => ctx.state,
});

/** Streams input, like a drawing game, so it raises the action budget. */
export const streamGame = defineGame({
  id: "stream",
  nameKey: "game.stream.name",
  minPlayers: 1,
  maxPlayers: 8,
  actionRateLimit: { capacity: 40, refillPerSecond: 20 },
  actionSchema: z.object({ type: z.literal("point"), n: z.number().int() }),
  createState: () => ({ received: 0 }),
  handleAction(ctx) {
    ctx.state.received += 1;
    return true;
  },
  isFinished: () => false,
  getControllerState: (ctx) => ({ active: true, game: { received: ctx.state.received } }),
  getPublicState: (ctx) => ({ received: ctx.state.received }),
});

export interface TestServer extends PartyServer {
  url: string;
}

export async function startServer(overrides: Partial<ListenOptions> = {}): Promise<TestServer> {
  resetRuntimeHost();
  resetRegistry();
  resetAdapters();
  const server = await listen({
    defaultGameId: "tap",
    games: [tapGame, duoGame, streamGame],
    port: 0,
    hostname: "127.0.0.1",
    log: silentLogger,
    devToolsEnabled: true,
    sessionTimeoutMs: 60_000,
    lookupRateLimit: false,
    ...overrides,
  });
  return { ...server, url: `http://127.0.0.1:${server.port}` };
}

export interface Screen {
  client: Client;
  room: Room;
  welcome: WelcomePayload;
  controller: ControllerEnvelope | null;
  events: GameEventMessage[];
  errors: PartyError[];
  leaveCode: number | null;
  send(action: SessionAction): void;
  act(action: unknown): void;
  /** Plain object view of the synchronised session state. */
  state(): SessionState;
  players(): PlayerRow[];
  player(id: string): PlayerRow | undefined;
  leave(consented?: boolean): Promise<void>;
}

export interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
  score: number;
  wins: number;
  seat: number;
  joined: boolean;
  spectator: boolean;
}

export interface SessionState {
  publicCode: string;
  status: string;
  gameId: string;
  hostPlayerId: string;
  hostConnected: boolean;
  gameRevision: number;
  winnerIds: string[];
  settings: { maxPlayers: number; botCount: number; botDifficulty: string; gameOptions: string };
  game: unknown;
}

function attach(client: Client, room: Room): Promise<Screen> {
  const screen: Screen = {
    client,
    room,
    welcome: undefined as unknown as WelcomePayload,
    controller: null,
    events: [],
    errors: [],
    leaveCode: null,
    send: (action) => room.send(MSG.SESSION_ACTION, action),
    act: (action) => room.send(MSG.GAME_ACTION, action),
    state: () => readState(room.state),
    players: () => readState(room.state).players,
    player: (id) => readState(room.state).players.find((p) => p.id === id),
    leave: (consented = true) => leaveRoom(room, consented),
  };
  room.onMessage(MSG.CONTROLLER_STATE, (envelope: ControllerEnvelope) => {
    screen.controller = envelope;
  });
  room.onMessage(MSG.GAME_EVENT, (event: GameEventMessage) => {
    screen.events.push(event);
  });
  room.onMessage(MSG.ERROR, (error: PartyError) => {
    screen.errors.push(error);
  });
  room.onMessage(MSG.CLOCK_PONG, () => undefined);
  room.onLeave((code) => {
    screen.leaveCode = code;
  });
  return new Promise((resolve) => {
    room.onMessage(MSG.WELCOME, (welcome: WelcomePayload) => {
      screen.welcome = welcome;
      resolve(screen);
    });
  });
}

function readState(raw: unknown): SessionState & { players: PlayerRow[] } {
  const state = raw as Record<string, unknown>;
  const players: PlayerRow[] = [];
  const map = state.players as
    { forEach?: (cb: (value: unknown, key: string) => void) => void } | undefined;
  map?.forEach?.((value) => {
    const row = value as Record<string, unknown>;
    players.push({
      id: String(row.id),
      name: String(row.name),
      color: String(row.color),
      avatar: String(row.avatar),
      isBot: Boolean(row.isBot),
      isHost: Boolean(row.isHost),
      connected: Boolean(row.connected),
      ready: Boolean(row.ready),
      score: Number(row.score),
      wins: Number(row.wins),
      seat: Number(row.seat),
      joined: Boolean(row.joined),
      spectator: Boolean(row.spectator),
    });
  });
  players.sort((a, b) => a.seat - b.seat);
  const settings = (state.settings ?? {}) as Record<string, unknown>;
  const winners = state.winnerIds as { toArray?: () => string[] } | string[] | undefined;
  const gameJson = state.gameJson;
  return {
    publicCode: String(state.publicCode ?? ""),
    status: String(state.status ?? ""),
    gameId: String(state.gameId ?? ""),
    hostPlayerId: String(state.hostPlayerId ?? ""),
    hostConnected: Boolean(state.hostConnected),
    gameRevision: Number(state.gameRevision ?? 0),
    winnerIds: Array.isArray(winners) ? winners : (winners?.toArray?.() ?? []),
    settings: {
      maxPlayers: Number(settings.maxPlayers),
      botCount: Number(settings.botCount),
      botDifficulty: String(settings.botDifficulty),
      gameOptions: String(settings.gameOptions ?? ""),
    },
    game: typeof gameJson === "string" ? JSON.parse(gameJson) : (state.game ?? null),
    players,
  };
}

export async function createHost(server: TestServer, gameId?: string): Promise<Screen> {
  const client = new Client(server.url);
  const room = await client.create(PARTY_ROOM, { role: "host", gameId });
  return attach(client, room);
}

export async function lookup(server: TestServer, code: string): Promise<RoomLookupResponse | null> {
  const response = await fetch(`${server.url}/api/rooms/${code}`);
  return response.ok ? ((await response.json()) as RoomLookupResponse) : null;
}

export async function joinController(server: TestServer, code: string): Promise<Screen> {
  const found = await lookup(server, code);
  if (!found) throw new Error(`no room ${code}`);
  const client = new Client(server.url);
  const room = await client.joinById(found.roomId, { role: "controller" });
  return attach(client, room);
}

/** Joins and submits a profile, returning once the server shows the player as joined. */
export async function joinPlayer(
  server: TestServer,
  code: string,
  name: string,
  profile: { avatar?: string; color?: string } = {},
): Promise<Screen> {
  const screen = await joinController(server, code);
  screen.send({
    type: "set-profile",
    name,
    avatar: (profile.avatar ?? "🦊") as "🦊",
    color: (profile.color ?? "#ff5d5d") as "#ff5d5d",
  });
  await waitFor(() => screen.player(screen.welcome.playerId)?.joined === true, `${name} to join`);
  return screen;
}

export async function waitFor(
  condition: () => boolean,
  label = "condition",
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `Room.leave()` resolves from `onLeave`, which never fires for a room whose
 * socket is already closed, so a bare `leave()` would hang a test forever.
 */
export function leaveRoom(room: Room, consented = true): Promise<void> {
  if (!room.connection?.isOpen) return Promise.resolve();
  return Promise.race([room.leave(consented).then(() => undefined), sleep(2000)]);
}

/** Rebinds a screen to a new room object after a reconnection. */
export function rebind(screen: Screen, room: Room): Screen {
  return { ...screen, room, leave: (consented = true) => leaveRoom(room, consented) };
}
