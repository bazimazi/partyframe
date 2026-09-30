/**
 * The client half of the session protocol.
 *
 * Deliberately framework-free: this class owns the socket, the reconnection
 * policy and the clock, and exposes a plain subscription. React binds to it in
 * `useSession`, and a Phaser scene can read from it directly - neither of them
 * has to know how a Colyseus room works.
 *
 * Nothing here decides anything about the game. Every method either sends an
 * intention to the server or reports what the server has said.
 */

import { Client, type Room } from "colyseus.js";
import {
  CLOSE_CODE,
  MSG,
  PARTY_ERROR_CODES,
  PARTY_ROOM,
  type BotDifficulty,
  type ClientPlayer,
  type ClientRole,
  type ControllerEnvelope,
  type GameEventMessage,
  type PartyError,
  type PartyErrorCode,
  type RoomLookupResponse,
  type SessionAction,
  type SessionSnapshot,
  type SessionStatus,
  type WelcomePayload,
} from "@partyframe/protocol";
import { ClockSync } from "./clock.js";
import { resolveServerHttpUrl } from "./endpoint.js";
import { clearCredentials, loadCredentials, saveCredentials } from "./storage.js";

export type ConnectionStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

export interface SessionView {
  status: ConnectionStatus;
  error: PartyError | null;
  snapshot: SessionSnapshot | null;
  controller: ControllerEnvelope | null;
  events: GameEventMessage[];
  playerId: string;
  roomCode: string;
  latencyMs: number;
}

/** How many event cues to keep for the shared screen's feed. */
const EVENT_HISTORY = 24;

/**
 * Reconnection backoff.
 *
 * Front-loaded because most real drops are momentary (a lift, a dead spot) and
 * recover within a second or two; the later, longer waits exist so a phone that
 * genuinely lost the network does not burn its battery retrying.
 */
const RECONNECT_DELAYS_MS = [300, 700, 1500, 3000, 5000, 8000, 12000];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads a MapSchema, a plain Map or a plain object uniformly. */
function readMap(source: unknown): Array<[string, Record<string, unknown>]> {
  if (!source) return [];
  const entries: Array<[string, Record<string, unknown>]> = [];
  const candidate = source as { forEach?: (cb: (v: unknown, k: string) => void) => void };
  if (typeof candidate.forEach === "function") {
    candidate.forEach((value, key) => {
      if (isRecord(value)) entries.push([key, value]);
    });
    return entries;
  }
  if (isRecord(source)) {
    for (const [key, value] of Object.entries(source)) {
      if (isRecord(value)) entries.push([key, value]);
    }
  }
  return entries;
}

/** Reads an ArraySchema or a plain array of strings. */
function readStringList(source: unknown): string[] {
  if (Array.isArray(source)) return source.filter((v): v is string => typeof v === "string");
  const candidate = source as {
    toArray?: () => unknown[];
    forEach?: (cb: (v: unknown) => void) => void;
  };
  if (typeof candidate?.toArray === "function") return readStringList(candidate.toArray());
  if (typeof candidate?.forEach === "function") {
    const out: string[] = [];
    candidate.forEach((value) => {
      if (typeof value === "string") out.push(value);
    });
    return out;
  }
  return [];
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Parses JSON at most once per distinct string. */
function jsonCache(): (text: string) => unknown {
  let lastText: string | null = null;
  let lastValue: unknown = null;
  return (text) => {
    if (text === lastText) return lastValue;
    lastText = text;
    try {
      lastValue = JSON.parse(text);
    } catch {
      lastValue = null;
    }
    return lastValue;
  };
}

export interface ConnectOptions {
  role: ClientRole;
  /**
   * Controllers: the code to join. Hosts: a session to resume after a reload;
   * when it cannot be resumed a fresh session is created instead.
   */
  roomCode?: string;
  /** Hosts only: which installed game the new session runs. */
  gameId?: string;
}

export class SessionConnection {
  private readonly client: Client;
  private room: Room | null = null;
  private view: SessionView = {
    status: "idle",
    error: null,
    snapshot: null,
    controller: null,
    events: [],
    playerId: "",
    roomCode: "",
    latencyMs: 0,
  };

  private listeners = new Set<(view: SessionView) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private options: ConnectOptions | null = null;
  /** Bumped on every connect/dispose so a stale in-flight join is discarded. */
  private generation = 0;
  private readonly parseGame = jsonCache();
  private readonly parseOptions = jsonCache();

  readonly clock: ClockSync;

  constructor(readonly serverUrl = resolveServerHttpUrl()) {
    this.client = new Client(this.serverUrl);
    this.clock = new ClockSync((t0) => this.room?.send(MSG.CLOCK_PING, { t0 }));
  }

  /** The live Colyseus state. Used by Phaser, which cannot afford a snapshot copy. */
  get liveState(): unknown {
    return this.room?.state ?? null;
  }

  get roomId(): string {
    return this.room?.roomId ?? "";
  }

  get current(): SessionView {
    return this.view;
  }

  subscribe(listener: (view: SessionView) => void): () => void {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }

  private patch(changes: Partial<SessionView>): void {
    this.view = { ...this.view, ...changes };
    for (const listener of this.listeners) listener(this.view);
  }

  // ------------------------------------------------------------------ connect

  async connect(options: ConnectOptions): Promise<void> {
    this.options = options;
    this.disposed = false;
    const generation = ++this.generation;
    this.patch({ status: "connecting", error: null });

    // A stored token is tried first: it is the only way back into the same seat,
    // and it is also the only path that survives a page reload mid-game.
    if (options.roomCode) {
      const stored = loadCredentials(options.role, options.roomCode);
      if (stored) {
        const room = await this.tryReconnect(stored.reconnectionToken);
        if (this.stale(generation, room)) return;
        if (room) {
          this.attach(room);
          return;
        }
      }
    }

    try {
      const room =
        options.role === "host"
          ? await this.openAsHost(options)
          : await this.joinByCode(options.roomCode ?? "");
      if (this.stale(generation, room)) return;
      this.attach(room);
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.fail(error);
    }
  }

  /**
   * True when the connection was disposed or reconnected while a join was in
   * flight. The room, if one was obtained, is released so the server does not
   * keep a ghost seat.
   */
  private stale(generation: number, room: Room | null | undefined): boolean {
    if (generation === this.generation && !this.disposed) return false;
    if (room) void room.leave(true).catch(() => undefined);
    return true;
  }

  /**
   * A shared screen resumes its session when it can and creates one otherwise.
   * Resuming by code covers a TV whose token expired but whose session is still
   * alive without a host.
   */
  private async openAsHost(options: ConnectOptions): Promise<Room> {
    if (options.roomCode) {
      const found = await this.lookup(options.roomCode);
      if (found && found.status !== "CLOSED") {
        try {
          return await this.client.joinById(found.roomId, { role: "host" });
        } catch {
          // Another screen holds the session. Start a fresh one.
        }
      }
    }
    return this.client.create(PARTY_ROOM, { role: "host", gameId: options.gameId });
  }

  private async lookup(roomCode: string): Promise<RoomLookupResponse | null> {
    const response = await fetch(`${this.serverUrl}/api/rooms/${encodeURIComponent(roomCode)}`);
    if (response.status === 429) throw new Error("RATE_LIMITED");
    if (!response.ok) return null;
    return (await response.json()) as RoomLookupResponse;
  }

  private async joinByCode(roomCode: string): Promise<Room> {
    const found = await this.lookup(roomCode);
    if (!found) throw new Error("ROOM_NOT_FOUND");
    if (found.status === "CLOSED") throw new Error("ROOM_CLOSED");
    if (!found.joinable) {
      throw new Error(found.playerCount >= found.maxPlayers ? "ROOM_FULL" : "GAME_IN_PROGRESS");
    }
    return this.client.joinById(found.roomId, { role: "controller" });
  }

  private async tryReconnect(token: string): Promise<Room | null> {
    try {
      return await this.client.reconnect(token);
    } catch {
      // A stale token is expected after a session ends; fall through to a fresh
      // join rather than surfacing it as an error.
      if (this.options?.roomCode) {
        clearCredentials(this.options.role, this.options.roomCode);
      }
      return null;
    }
  }

  private attach(room: Room): void {
    this.room = room;
    this.reconnectAttempt = 0;
    this.clock.reset();
    this.clock.start();

    room.onStateChange((state) => {
      this.patch({ snapshot: this.toSnapshot(state) });
    });

    room.onMessage(MSG.WELCOME, (payload: WelcomePayload) => {
      saveCredentials({
        roomId: room.roomId,
        roomCode: payload.roomCode,
        // The room object holds the canonical token; the payload is a fallback
        // for a client that reconnected and never saw its own `onJoin`.
        reconnectionToken: room.reconnectionToken || payload.reconnectionToken,
        playerId: payload.playerId,
        role: payload.role,
      });
      this.patch({
        playerId: payload.playerId,
        roomCode: payload.roomCode,
        status: "connected",
        error: null,
      });
    });

    room.onMessage(MSG.CONTROLLER_STATE, (envelope: ControllerEnvelope) => {
      // Out-of-order delivery is not possible over one socket, but a reconnection
      // can interleave an old push with a fresh one.
      const currentRevision = this.view.controller?.revision ?? -1;
      if (envelope.revision < currentRevision) return;
      this.patch({ controller: envelope });
    });

    room.onMessage(MSG.GAME_EVENT, (event: GameEventMessage) => {
      const events = [...this.view.events, event].slice(-EVENT_HISTORY);
      this.patch({ events });
    });

    room.onMessage(MSG.CLOCK_PONG, ({ t0, t1 }: { t0: number; t1: number }) => {
      this.clock.handlePong(t0, t1);
      this.patch({ latencyMs: Math.round(this.clock.rtt) });
    });

    room.onMessage(MSG.ERROR, (error: PartyError) => {
      this.patch({ error });
    });

    room.onError((_code, message) => {
      const code = this.mapErrorCode(message);
      this.patch({ status: "error", error: { code, messageKey: `error.${code}` } });
    });

    room.onLeave((code) => this.handleLeave(code));

    this.patch({ status: "connected" });
  }

  /**
   * Converts the live schema into plain, immutable data.
   *
   * React components render from this rather than from the schema itself: the
   * schema mutates in place, so a component memoised on it would never update,
   * and a component not memoised on it would re-render on every patch.
   */
  private toSnapshot(state: unknown): SessionSnapshot | null {
    if (!isRecord(state)) return null;

    const players: ClientPlayer[] = readMap(state.players)
      .map(([id, row]) => ({
        id: str(row.id, id),
        name: str(row.name),
        avatar: str(row.avatar),
        color: str(row.color),
        isBot: bool(row.isBot),
        isHost: bool(row.isHost),
        connected: bool(row.connected, true),
        ready: bool(row.ready),
        score: num(row.score),
        wins: num(row.wins),
        seat: num(row.seat),
        joined: bool(row.joined),
        spectator: bool(row.spectator),
      }))
      .sort((a, b) => a.seat - b.seat);

    const settings = isRecord(state.settings) ? state.settings : {};
    const gameOptions = this.parseOptions(str(settings.gameOptions, "{}"));

    // With the default transport the projection arrives as JSON; a custom
    // adapter exposes it under `game`, and only that game's own client code
    // knows how to read it - the platform treats it as opaque either way.
    const game =
      typeof state.gameJson === "string" ? this.parseGame(state.gameJson) : (state.game ?? null);

    return {
      publicCode: str(state.publicCode),
      status: str(state.status, "CREATED") as SessionStatus,
      gameId: str(state.gameId),
      serverTime: num(state.serverTime),
      players,
      settings: {
        maxPlayers: num(settings.maxPlayers, 8),
        botCount: num(settings.botCount),
        botDifficulty: str(settings.botDifficulty, "medium") as BotDifficulty,
        gameOptions: isRecord(gameOptions) ? gameOptions : {},
      },
      hostPlayerId: str(state.hostPlayerId),
      hostConnected: bool(state.hostConnected),
      gameRevision: num(state.gameRevision),
      winnerIds: readStringList(state.winnerIds),
      game,
    };
  }

  // -------------------------------------------------------------- disconnects

  private handleLeave(code: number): void {
    this.clock.stop();
    this.room = null;

    if (this.disposed || code === 1000) {
      this.patch({ status: "closed" });
      return;
    }

    if (code === CLOSE_CODE.SESSION_ENDED) {
      this.patch({
        status: "closed",
        error: { code: "ROOM_CLOSED", messageKey: "error.sessionExpired" },
      });
      this.forgetCredentials();
      return;
    }
    if (code === CLOSE_CODE.KICKED) {
      this.patch({
        status: "closed",
        error: { code: "NOT_ALLOWED", messageKey: "error.kicked" },
      });
      this.forgetCredentials();
      return;
    }

    this.patch({
      status: "reconnecting",
      error: { code: "INTERNAL", messageKey: "error.connectionLost" },
    });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ?? 12000;
    this.reconnectAttempt += 1;

    if (this.reconnectAttempt > RECONNECT_DELAYS_MS.length + 4) {
      this.patch({
        status: "error",
        error: { code: "ROOM_CLOSED", messageKey: "error.sessionExpired" },
      });
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      void this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.disposed || !this.options) return;
    const generation = this.generation;

    const roomCode = this.view.roomCode || this.options.roomCode;
    if (roomCode) {
      const stored = loadCredentials(this.options.role, roomCode);
      if (stored) {
        const room = await this.tryReconnect(stored.reconnectionToken);
        if (this.stale(generation, room)) return;
        if (room) {
          this.attach(room);
          return;
        }
      }
    }

    // The seat is gone, but the session may still be running: a controller can
    // rejoin as a new player and a shared screen can take its session back by
    // code. Either way the server hands out a fresh identity.
    if (roomCode) {
      try {
        const room =
          this.options.role === "controller"
            ? await this.joinByCode(roomCode)
            : await this.openAsHost({ ...this.options, roomCode });
        if (this.stale(generation, room)) return;
        this.attach(room);
        return;
      } catch {
        /* fall through to another backoff step */
      }
    }

    this.scheduleReconnect();
  }

  private forgetCredentials(): void {
    const roomCode = this.view.roomCode || this.options?.roomCode;
    if (this.options && roomCode) clearCredentials(this.options.role, roomCode);
  }

  private fail(error: unknown): void {
    const code = this.mapErrorCode(error instanceof Error ? error.message : String(error));
    this.patch({ status: "error", error: { code, messageKey: `error.${code}` } });
  }

  /** Server rejections carry a `PartyErrorCode` as their message. */
  private mapErrorCode(message: unknown): PartyErrorCode {
    const text = typeof message === "string" ? message : "";
    return PARTY_ERROR_CODES.find((code) => text.includes(code)) ?? "INTERNAL";
  }

  // ------------------------------------------------------------------- output

  sendSessionAction(action: SessionAction): void {
    this.room?.send(MSG.SESSION_ACTION, action);
  }

  sendGameAction(action: unknown): void {
    this.room?.send(MSG.GAME_ACTION, action);
  }

  /** Clears a transient error banner without touching the connection. */
  dismissError(): void {
    this.patch({ error: null });
  }

  async leave(consented = true): Promise<void> {
    this.disposed = true;
    this.generation += 1;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.clock.stop();
    this.forgetCredentials();
    try {
      await this.room?.leave(consented);
    } catch {
      /* already gone */
    }
    this.room = null;
    this.patch({ status: "closed" });
  }

  /**
   * Tears down without telling the server, for React unmount during navigation.
   * The seat stays reserved so a remount within the grace period resumes it.
   */
  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.clock.stop();
    this.listeners.clear();
    try {
      void this.room?.leave(false);
    } catch {
      /* ignore */
    }
    this.room = null;
  }
}
