/**
 * The one room type the platform needs.
 *
 * A `PartySessionRoom` owns a session: its public code, its lobby, its players
 * (human and bot), its lifecycle and its authoritative clock. The game being
 * played is a plugin resolved at creation time and driven through a
 * `MatchEngine`, so this file contains no game logic whatsoever - swapping in a
 * different game changes only which adapter is looked up.
 *
 * Authority model, in one sentence: clients send *intentions*, this room decides
 * what actually happened, and the resulting state is what everyone renders.
 */

import { Room, ServerError, matchMaker, type Client, type Deferred } from "@colyseus/core";
import { ArraySchema } from "@colyseus/schema";
import {
  MatchEngine,
  randomSeed,
  rankPlayers,
  type GamePlayer,
  type PlayerChange,
  type PlayerRegistry,
} from "@partyframe/game-core";
import {
  ABSOLUTE_MAX_PLAYERS,
  AVATARS,
  CLOCK_BEACON_MS,
  CLOSE_CODE,
  ClockPingSchema,
  HOST_RECONNECT_SECONDS,
  JoinOptionsSchema,
  MAX_MESSAGE_BYTES,
  MSG,
  PARTY_ROOM,
  PLATFORM_EVENT,
  PLAYER_COLORS,
  PLAYER_NAME_MAX,
  PLAYER_RECONNECT_SECONDS,
  SERVER_TICK_MS,
  SessionActionSchema,
  isRunningStatus,
  type ClientRole,
  type ControllerEnvelope,
  type ControllerMode,
  type GameEventInput,
  type GameEventMessage,
  type LateJoinPolicy,
  type PartyErrorCode,
  type SessionAction,
  type SessionStatus,
  type WelcomePayload,
} from "@partyframe/protocol";
import { requireAdapter, type GameNetworkAdapter } from "./adapters.js";
import { EVENT, runtimeHost, type Logger } from "./bind.js";
import { makeBotIdentity } from "./bots.js";
import { generateUniqueRoomCode } from "./roomCode.js";
import {
  CLOCK_PING_LIMITS,
  GAME_ACTION_LIMITS,
  RateLimiter,
  SESSION_ACTION_LIMITS,
} from "./rateLimit.js";
import { PlayerSchema, type SessionSchema } from "./sessionSchema.js";

/** Options the matchmaker passes when a shared screen creates a session. */
export interface RoomCreateOptions {
  gameId?: string;
  /** Fixed seed, used only by tests to make a whole match reproducible. */
  seed?: number;
}

/** Metadata published to the matchmaker, used by the `/api/rooms/:code` lookup. */
export interface RoomMetadata {
  publicCode: string;
  gameId: string;
  status: SessionStatus;
  playerCount: number;
  maxPlayers: number;
  lateJoin: LateJoinPolicy;
}

interface ClientData {
  role: ClientRole;
  joinedAt: number;
}

function rejectJoin(code: PartyErrorCode): never {
  // The message carries the machine-readable code; the client localises it and
  // never shows this string to a player.
  throw new ServerError(CLOSE_CODE.JOIN_REFUSED, code);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PartySessionRoom extends Room<SessionSchema, RoomMetadata> {
  override maxClients = ABSOLUTE_MAX_PLAYERS + 2;

  private adapter!: GameNetworkAdapter;
  private engine!: MatchEngine;
  private registry!: PlayerRegistry;
  private logger!: Logger;

  private gameLimiter = new RateLimiter(GAME_ACTION_LIMITS);
  private readonly sessionLimiter = new RateLimiter(SESSION_ACTION_LIMITS);
  private readonly clockLimiter = new RateLimiter(CLOCK_PING_LIMITS);

  private createdAt = 0;
  private lastConnectedAt = 0;
  private lastBeaconAt = 0;
  private nextSeat = 0;
  private controllerRevision = 0;
  /** Last envelope sent to each controller, so unchanged state is not resent. */
  private lastControllerJson = new Map<string, string>();
  /** Last projection published, so unchanged game state produces no patch. */
  private lastPublicJson = "";
  /** The shared screen's pending reconnection, so a replacement TV can cancel it. */
  private hostReconnection: Deferred<Client> | null = null;

  // ---------------------------------------------------------------- lifecycle

  override async onCreate(options: RoomCreateOptions): Promise<void> {
    const host = runtimeHost();
    const gameId = options.gameId ?? host.defaultGameId;
    this.adapter = requireAdapter(gameId);
    this.gameLimiter = new RateLimiter(this.adapter.game.actionRateLimit ?? GAME_ACTION_LIMITS);

    const live = await matchMaker.query({ name: PARTY_ROOM });
    if (live.length >= host.maxSessions) {
      host.log.warn(EVENT.SESSION_REFUSED, { sessions: live.length });
      throw new ServerError(CLOSE_CODE.JOIN_REFUSED, "SERVER_FULL");
    }

    // Generated here rather than by the caller so a client can never choose,
    // guess or reuse a code. Colyseus awaits `onCreate` before admitting anyone,
    // so the code is in place before the first join.
    const publicCode = await generateUniqueRoomCode(async (candidate) => {
      const rooms = await matchMaker.query({ name: PARTY_ROOM });
      return rooms.some(
        (room) => (room.metadata as RoomMetadata | undefined)?.publicCode === candidate,
      );
    });

    this.logger = host.log.child({
      sessionId: this.roomId,
      roomCode: publicCode,
      gameId: this.adapter.game.id,
    });

    const state = this.adapter.createState();
    state.publicCode = publicCode;
    state.gameId = this.adapter.game.id;
    state.status = "LOBBY";
    state.serverTime = Date.now();
    state.settings.maxPlayers = Math.min(host.maxPlayers, this.adapter.game.maxPlayers);
    state.settings.botCount = 0;
    state.settings.botDifficulty = "medium";
    this.setState(state);

    this.registry = this.createRegistry();
    this.engine = new MatchEngine(
      this.adapter.game,
      {
        players: this.registry,
        getStatus: () => this.state.status as SessionStatus,
        setStatus: (status) => this.setStatus(status),
        deliver: (event, to) => this.deliver(event, to),
        onGameError: (error, phase) => {
          this.logger.error(EVENT.GAME_ERROR, { phase, message: describeError(error) });
        },
        onMatchEnded: (winnerIds) => this.recordWinners(winnerIds),
      },
      options.seed ?? randomSeed(),
    );
    state.settings.gameOptions = JSON.stringify(this.engine.options ?? {});

    // The session outlives an empty room on purpose: a TV that drops off Wi-Fi
    // must be able to come back to the same game. `checkExpiry` reclaims it.
    this.autoDispose = false;

    this.createdAt = Date.now();
    this.lastConnectedAt = this.createdAt;

    this.registerMessageHandlers();
    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), SERVER_TICK_MS);
    this.projectGameState(Date.now());
    void this.publishMetadata();

    this.logger.info(EVENT.SESSION_CREATED, { maxPlayers: state.settings.maxPlayers });
  }

  override onAuth(_client: Client, rawOptions: unknown): ClientData {
    const parsed = JoinOptionsSchema.safeParse(rawOptions ?? {});
    if (!parsed.success) rejectJoin("INVALID_PAYLOAD");

    const { role } = parsed.data;
    const status = this.state.status as SessionStatus;
    if (status === "CLOSED") rejectJoin("ROOM_CLOSED");

    if (role === "host") {
      // A second shared screen is refused while the first is online, so a stray
      // tab cannot hijack the TV mid-game. A TV whose predecessor is gone (or
      // stuck in its reconnection window) may take over.
      const hostOnline = this.clients.some(
        (client) => (client.userData as ClientData | undefined)?.role === "host",
      );
      if (hostOnline) rejectJoin("NOT_ALLOWED");
    } else {
      if (isRunningStatus(status) && this.lateJoinPolicy() === "deny") {
        rejectJoin("GAME_IN_PROGRESS");
      }
      const seated = [...this.state.players.values()].filter((p) => !p.isBot).length;
      if (seated >= this.state.settings.maxPlayers) rejectJoin("ROOM_FULL");
    }

    return { role, joinedAt: Date.now() };
  }

  override onJoin(client: Client, _options: unknown, auth: ClientData): void {
    client.userData = auth;
    this.lastConnectedAt = Date.now();

    if (auth.role === "host") {
      // A replacement TV supersedes the one that dropped.
      this.hostReconnection?.reject?.(new Error("replaced"));
      this.hostReconnection = null;
      this.state.hostConnected = true;
      this.logger.info(EVENT.HOST_ATTACHED, { playerId: client.sessionId });
    } else {
      this.ensurePlayerRow(client.sessionId);
    }

    this.sendWelcome(client);
    void this.publishMetadata();
    this.pushControllerState(client, true);
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const data = client.userData as ClientData | undefined;
    const role = data?.role ?? "controller";

    if (role === "host") {
      this.state.hostConnected = false;
      this.logger.warn(EVENT.HOST_DISCONNECTED, { consented });
      if (consented) {
        // A TV closing an empty lobby on purpose has nothing worth keeping.
        // Not awaited: disposal cannot complete while this onLeave is in flight.
        if (this.state.status === "LOBBY" && this.joinedHumans().length === 0) {
          this.state.status = "CLOSED";
          void this.disconnect(CLOSE_CODE.SESSION_ENDED);
        }
        return;
      }
      const reconnection = this.allowReconnection(client, HOST_RECONNECT_SECONDS);
      this.hostReconnection = reconnection;
      try {
        // A TV losing Wi-Fi must not end everyone's game.
        const reconnected = await reconnection;
        this.hostReconnection = null;
        reconnected.userData = data;
        this.state.hostConnected = true;
        this.lastConnectedAt = Date.now();
        this.sendWelcome(reconnected);
        this.logger.info(EVENT.HOST_RECONNECTED);
      } catch {
        if (this.hostReconnection === reconnection) this.hostReconnection = null;
        this.logger.info(EVENT.HOST_DISCONNECTED, { recovered: false });
      }
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (consented) {
      this.removePlayer(client.sessionId, "left");
      return;
    }

    player.connected = false;
    this.notifyGameOfPlayer(client.sessionId, "disconnected");
    this.emitPlatformEvent({
      kind: PLATFORM_EVENT.PLAYER_DISCONNECTED,
      messageKey: "event.playerDisconnected",
      params: { name: player.name },
      playerId: player.id,
    });
    this.logger.info(EVENT.PLAYER_DISCONNECTED, { playerId: client.sessionId });

    try {
      const reconnected = await this.allowReconnection(client, PLAYER_RECONNECT_SECONDS);
      const row = this.state.players.get(client.sessionId);
      if (row) row.connected = true;
      reconnected.userData = data ?? { role: "controller", joinedAt: Date.now() };
      this.lastConnectedAt = Date.now();
      this.notifyGameOfPlayer(client.sessionId, "reconnected");
      this.emitPlatformEvent({
        kind: PLATFORM_EVENT.PLAYER_RECONNECTED,
        messageKey: "event.playerReconnected",
        params: { name: row?.name ?? "" },
        playerId: client.sessionId,
      });
      // onJoin does not run again after a reconnection, so identity and the
      // controller projection have to be re-sent explicitly.
      this.sendWelcome(reconnected);
      this.pushControllerState(reconnected, true);
      this.logger.info(EVENT.PLAYER_RECONNECTED, { playerId: client.sessionId });
    } catch {
      this.removePlayer(client.sessionId, "left");
    }
  }

  override onDispose(): void {
    this.gameLimiter.clear();
    this.sessionLimiter.clear();
    this.clockLimiter.clear();
    this.lastControllerJson.clear();
    this.logger?.info(EVENT.SESSION_DISPOSED);
  }

  /** A bug in a handler is logged with context rather than crashing the process. */
  override onUncaughtException(error: Error, methodName: string): void {
    (this.logger ?? runtimeHost().log).error(EVENT.GAME_ERROR, {
      phase: methodName,
      message: describeError((error as { cause?: unknown }).cause ?? error),
    });
  }

  // ------------------------------------------------------------------ players

  private lateJoinPolicy(): LateJoinPolicy {
    return this.adapter.game.lateJoin ?? "spectate";
  }

  /** Creates or revives the row for a controller's seat. */
  private ensurePlayerRow(playerId: string): PlayerSchema {
    const existing = this.state.players.get(playerId);
    if (existing) {
      existing.connected = true;
      return existing;
    }

    const player = new PlayerSchema();
    player.id = playerId;
    player.seat = this.nextSeat++;
    player.color = this.pickFreeColor();
    player.avatar = this.pickFreeAvatar();
    player.connected = true;
    player.joined = false;
    this.state.players.set(playerId, player);
    return player;
  }

  private pickFreeColor(except?: string): string {
    const taken = new Set(
      [...this.state.players.values()].filter((p) => p.id !== except).map((p) => p.color),
    );
    return PLAYER_COLORS.find((c) => !taken.has(c)) ?? PLAYER_COLORS[0];
  }

  private pickFreeAvatar(): string {
    const taken = new Set([...this.state.players.values()].map((p) => p.avatar));
    return AVATARS.find((a) => !taken.has(a)) ?? AVATARS[0];
  }

  /**
   * Keeps display names distinct on the shared screen.
   *
   * Two "Ali"s would be indistinguishable from four metres away, so the second
   * becomes "Ali 2". The suffix eats into the length limit rather than
   * overflowing it.
   */
  private uniqueName(desired: string, selfId: string): string {
    const taken = new Set(
      [...this.state.players.values()]
        .filter((p) => p.joined && p.id !== selfId)
        .map((p) => p.name.toLowerCase()),
    );
    if (!taken.has(desired.toLowerCase())) return desired;
    for (let n = 2; n < 100; n += 1) {
      const suffix = ` ${n}`;
      const candidate = `${desired.slice(0, PLAYER_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return desired;
  }

  private removePlayer(playerId: string, reason: "left" | "kicked"): void {
    const player = this.state.players.get(playerId);
    if (!player) return;

    const wasParticipant = player.joined && !player.spectator;
    this.state.players.delete(playerId);
    this.gameLimiter.forget(playerId);
    this.sessionLimiter.forget(playerId);
    this.clockLimiter.forget(playerId);
    this.lastControllerJson.delete(playerId);

    if (this.state.hostPlayerId === playerId) {
      this.state.hostPlayerId = this.electHostPlayer();
    }

    if (wasParticipant) this.notifyGameOfPlayer(playerId, "left");
    if (player.joined) {
      this.emitPlatformEvent({
        kind: PLATFORM_EVENT.PLAYER_LEFT,
        messageKey: "event.playerLeft",
        params: { name: player.name },
        playerId,
      });
    }
    this.logger.info(EVENT.PLAYER_LEFT, { playerId, reason });
    void this.publishMetadata();
  }

  /** The longest-seated joined human becomes host when the previous one leaves. */
  private electHostPlayer(): string {
    const candidate = this.joinedHumans().sort((a, b) => a.seat - b.seat)[0];
    for (const player of this.state.players.values()) {
      player.isHost = candidate ? player.id === candidate.id : false;
    }
    return candidate?.id ?? "";
  }

  private joinedHumans(): PlayerSchema[] {
    return [...this.state.players.values()].filter((p) => !p.isBot && p.joined);
  }

  /** Players the game rules operate on: joined and not sitting this match out. */
  private participants(): PlayerSchema[] {
    return [...this.state.players.values()]
      .filter((p) => p.joined && !p.spectator)
      .sort((a, b) => a.seat - b.seat);
  }

  private createRegistry(): PlayerRegistry {
    const toGamePlayer = (p: PlayerSchema): GamePlayer => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      score: p.score,
      wins: p.wins,
      seat: p.seat,
    });
    const participant = (playerId: string): PlayerSchema | undefined => {
      const row = this.state.players.get(playerId);
      return row && row.joined && !row.spectator ? row : undefined;
    };

    return {
      all: () => this.participants().map(toGamePlayer),
      get: (playerId) => {
        const row = participant(playerId);
        return row ? toGamePlayer(row) : undefined;
      },
      has: (playerId) => participant(playerId) !== undefined,
      connected: () =>
        this.participants()
          .filter((p) => p.connected)
          .map(toGamePlayer),
      ranked: () => rankPlayers(this.participants()).map(toGamePlayer),
      addScore: (playerId, delta) => {
        const row = this.state.players.get(playerId);
        if (row) row.score = Math.max(0, row.score + delta);
      },
      setScore: (playerId, score) => {
        const row = this.state.players.get(playerId);
        if (row) row.score = Math.max(0, score);
      },
    };
  }

  // --------------------------------------------------------------------- bots

  /** Adds or removes bots so the roster matches `settings.botCount`. */
  private reconcileBots(): void {
    if (!this.engine.supportsBots) this.state.settings.botCount = 0;

    const bots = [...this.state.players.values()].filter((p) => p.isBot);
    const humans = this.joinedHumans();
    const capacity = Math.max(0, this.state.settings.maxPlayers - humans.length);
    const target = Math.min(this.state.settings.botCount, capacity);

    for (let i = bots.length; i > target; i -= 1) {
      const victim = bots[i - 1];
      if (!victim) break;
      this.state.players.delete(victim.id);
      this.lastControllerJson.delete(victim.id);
      if (isRunningStatus(this.state.status as SessionStatus) && !victim.spectator) {
        this.notifyGameOfPlayer(victim.id, "left");
      }
      this.logger.info(EVENT.BOT_REMOVED, { playerId: victim.id });
    }

    for (let i = bots.length; i < target; i += 1) {
      const takenNames = new Set([...this.state.players.values()].map((p) => p.name.toLowerCase()));
      const takenColors = new Set([...this.state.players.values()].map((p) => p.color));
      const identity = makeBotIdentity(i, takenNames, takenColors);

      const bot = new PlayerSchema();
      bot.id = `bot-${this.roomId}-${this.nextSeat}`;
      bot.seat = this.nextSeat++;
      bot.name = identity.name;
      bot.avatar = identity.avatar;
      bot.color = identity.color;
      bot.isBot = true;
      bot.connected = true;
      bot.joined = true;
      bot.ready = true;
      // A bot added mid-match waits for the next one, like a late human would.
      bot.spectator = isRunningStatus(this.state.status as SessionStatus);
      this.state.players.set(bot.id, bot);
      this.logger.info(EVENT.BOT_ADDED, { playerId: bot.id });
    }

    // Settings may have asked for more bots than there was room for.
    this.state.settings.botCount = Math.min(this.state.settings.botCount, capacity);
    void this.publishMetadata();
  }

  // ----------------------------------------------------------------- messages

  private registerMessageHandlers(): void {
    this.onMessage(
      MSG.SESSION_ACTION,
      this.withSimulatedLatency((client, payload: unknown) => {
        if (!this.checkPayload(client, payload)) return;
        if (!this.sessionLimiter.tryConsume(client.sessionId, Date.now())) {
          this.sendError(client, "RATE_LIMITED");
          this.logger.warn(EVENT.RATE_LIMITED, { playerId: client.sessionId, channel: "session" });
          return;
        }

        const parsed = SessionActionSchema.safeParse(payload);
        if (!parsed.success) {
          this.sendError(client, "INVALID_PAYLOAD");
          return;
        }
        this.handleSessionAction(client, parsed.data);
      }),
    );

    this.onMessage(
      MSG.GAME_ACTION,
      this.withSimulatedLatency((client, payload: unknown) => {
        if (!this.checkPayload(client, payload)) return;
        const now = Date.now();

        if (!this.gameLimiter.tryConsume(client.sessionId, now)) {
          this.sendError(client, "RATE_LIMITED");
          this.logger.warn(EVENT.RATE_LIMITED, { playerId: client.sessionId, channel: "game" });
          return;
        }

        const data = client.userData as ClientData | undefined;
        if (data?.role !== "controller") {
          this.sendError(client, "NOT_ALLOWED");
          return;
        }
        if (!this.engine.running) {
          this.sendError(client, "WRONG_STATE");
          return;
        }
        if (!this.registry.has(client.sessionId)) {
          this.sendError(client, "NOT_ALLOWED");
          return;
        }

        const result = this.engine.act(client.sessionId, payload, now);
        switch (result.status) {
          case "applied":
            this.logger.debug(EVENT.PLAYER_ACTION, { playerId: client.sessionId });
            break;
          case "invalid":
            this.sendError(client, "INVALID_PAYLOAD");
            this.logger.debug(EVENT.ACTION_REJECTED, {
              playerId: client.sessionId,
              issues: result.issues,
            });
            break;
          case "refused":
            this.sendError(client, "WRONG_STATE");
            break;
          case "error":
            this.sendError(client, "INTERNAL");
            break;
        }
        this.afterGameStep(now);
      }),
    );

    this.onMessage(MSG.CLOCK_PING, (client, payload: unknown) => {
      if (!this.clockLimiter.tryConsume(client.sessionId, Date.now())) return;
      const parsed = ClockPingSchema.safeParse(payload);
      if (!parsed.success) return;
      client.send(MSG.CLOCK_PONG, { t0: parsed.data.t0, t1: Date.now() });
    });
  }

  /**
   * Developer tool: holds inbound messages for `simulatedLatencyMs` so timing
   * bugs that only appear on real networks reproduce on a LAN. Order is
   * preserved because every message waits the same amount. Never active in
   * production, where the runtime refuses to enable dev tools.
   */
  private withSimulatedLatency<T>(
    handler: (client: Client, payload: T) => void,
  ): (client: Client, payload: T) => void {
    return (client, payload) => {
      const host = runtimeHost();
      const delay = host.devToolsEnabled ? host.simulatedLatencyMs : 0;
      if (delay <= 0) {
        handler(client, payload);
        return;
      }
      this.clock.setTimeout(() => {
        if (this.clients.includes(client)) handler(client, payload);
      }, delay);
    };
  }

  /**
   * Rejects payloads that are too large before any parsing work happens.
   *
   * Colyseus has already decoded the message by this point, so this is a guard
   * against a client wasting the rules engine's time, not a transport-level
   * defence - the transport's own frame limit handles that.
   */
  private checkPayload(client: Client, payload: unknown): boolean {
    let size: number;
    try {
      size = JSON.stringify(payload ?? null).length;
    } catch {
      this.sendError(client, "INVALID_PAYLOAD");
      return false;
    }
    if (size > MAX_MESSAGE_BYTES) {
      this.sendError(client, "INVALID_PAYLOAD");
      this.logger.warn(EVENT.ACTION_REJECTED, { playerId: client.sessionId, size });
      return false;
    }
    return true;
  }

  private handleSessionAction(client: Client, action: SessionAction): void {
    const data = client.userData as ClientData | undefined;
    const isHostScreen = data?.role === "host";
    const player = this.state.players.get(client.sessionId);
    const isHostPlayer = Boolean(player && player.isHost);
    const canControlSession = isHostScreen || isHostPlayer;
    const status = this.state.status as SessionStatus;

    switch (action.type) {
      case "set-profile": {
        if (!player) return this.sendError(client, "NOT_ALLOWED");
        if (status === "CLOSED") return this.sendError(client, "ROOM_CLOSED");

        const firstJoin = !player.joined;
        player.name = this.uniqueName(action.name, player.id);
        player.avatar = action.avatar;
        // Colours identify players on the TV, so a second pick of a taken colour
        // is quietly replaced with a free one.
        const colorTaken = [...this.state.players.values()].some(
          (p) => p.id !== player.id && p.joined && p.color === action.color,
        );
        player.color = colorTaken ? this.pickFreeColor(player.id) : action.color;
        player.joined = true;

        if (firstJoin) {
          player.spectator = isRunningStatus(status) && this.lateJoinPolicy() !== "play";
          if (this.state.hostPlayerId === "") {
            this.state.hostPlayerId = player.id;
            player.isHost = true;
          }
          if (!player.spectator) this.notifyGameOfPlayer(player.id, "joined");
          this.emitPlatformEvent({
            kind: PLATFORM_EVENT.PLAYER_JOINED,
            messageKey: "event.playerJoined",
            params: { name: player.name },
            playerId: player.id,
          });
          this.logger.info(EVENT.PLAYER_JOINED, {
            playerId: player.id,
            spectator: player.spectator,
          });
          this.reconcileBots();
        }
        void this.publishMetadata();
        this.pushControllerState(client, true);
        return;
      }

      case "set-ready": {
        if (!player?.joined) return this.sendError(client, "NOT_ALLOWED");
        player.ready = action.ready;
        return;
      }

      case "leave": {
        this.removePlayer(client.sessionId, "left");
        client.leave(1000);
        return;
      }

      case "start-game": {
        if (!canControlSession) return this.sendError(client, "NOT_ALLOWED");
        if (status !== "LOBBY") return this.sendError(client, "WRONG_STATE");
        if (!this.startMatch()) this.sendError(client, "NOT_ENOUGH_PLAYERS");
        return;
      }

      case "rematch": {
        if (!canControlSession) return this.sendError(client, "NOT_ALLOWED");
        if (status !== "GAME_OVER") return this.sendError(client, "WRONG_STATE");
        if (!this.startMatch()) this.sendError(client, "NOT_ENOUGH_PLAYERS");
        return;
      }

      case "return-to-lobby": {
        if (!canControlSession) return this.sendError(client, "NOT_ALLOWED");
        if (status !== "GAME_OVER") return this.sendError(client, "WRONG_STATE");
        this.returnToLobby();
        return;
      }

      case "update-settings": {
        if (!canControlSession) return this.sendError(client, "NOT_ALLOWED");
        if (status !== "LOBBY") return this.sendError(client, "WRONG_STATE");
        if (!this.applySettings(action.settings)) this.sendError(client, "INVALID_PAYLOAD");
        return;
      }

      case "kick-player": {
        if (!canControlSession) return this.sendError(client, "NOT_ALLOWED");
        if (action.playerId === client.sessionId) return this.sendError(client, "NOT_ALLOWED");
        // Only seated controllers can be kicked. The shared screen has no player
        // row, so a phone host can never disconnect the TV.
        const target = this.state.players.get(action.playerId);
        if (!target || target.isBot) return this.sendError(client, "NOT_ALLOWED");
        const targetClient = this.clients.find((c) => c.sessionId === action.playerId);
        this.removePlayer(action.playerId, "kicked");
        targetClient?.leave(CLOSE_CODE.KICKED);
        return;
      }

      case "dev-command": {
        if (!runtimeHost().devToolsEnabled) return this.sendError(client, "NOT_ALLOWED");
        if (!canControlSession) return this.sendError(client, "NOT_ALLOWED");
        this.runDevCommand(action.command, action.value);
        return;
      }
    }
  }

  private applySettings(patch: {
    maxPlayers?: number;
    botCount?: number;
    botDifficulty?: "easy" | "medium" | "hard";
    gameOptions?: Record<string, unknown>;
  }): boolean {
    const { settings } = this.state;
    let ok = true;

    if (patch.maxPlayers !== undefined) {
      const humans = this.joinedHumans().length;
      // Never set a cap below the number of people already in the room.
      settings.maxPlayers = Math.max(
        humans,
        Math.min(patch.maxPlayers, this.adapter.game.maxPlayers, runtimeHost().maxPlayers),
      );
    }
    if (patch.botDifficulty !== undefined) {
      settings.botDifficulty = patch.botDifficulty;
      this.engine.botDifficulty = patch.botDifficulty;
    }
    if (patch.botCount !== undefined) {
      settings.botCount = Math.max(0, Math.min(patch.botCount, ABSOLUTE_MAX_PLAYERS));
    }
    if (patch.gameOptions !== undefined) {
      const result = this.engine.setOptions(patch.gameOptions);
      if (result.ok) {
        settings.gameOptions = JSON.stringify(this.engine.options ?? {});
      } else {
        ok = false;
        this.logger.warn(EVENT.SETTINGS_REJECTED, { issues: result.issues });
      }
    }

    this.reconcileBots();
    this.projectGameState(Date.now());
    return ok;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Starts a match. Returns false, with a cue on the TV, when too few are seated. */
  private startMatch(): boolean {
    this.reconcileBots();

    // Everyone who has joined by now plays, including last match's spectators.
    for (const player of this.state.players.values()) {
      if (player.joined) player.spectator = false;
    }

    const roster = this.participants();
    if (roster.length < this.adapter.game.minPlayers) {
      this.emitPlatformEvent({
        kind: PLATFORM_EVENT.START_REFUSED,
        messageKey: "host.needMorePlayers",
        params: { count: this.adapter.game.minPlayers },
      });
      return false;
    }

    for (const player of this.state.players.values()) {
      player.ready = false;
      player.score = 0;
    }
    this.state.winnerIds = new ArraySchema<string>();

    const now = Date.now();
    this.engine.start(now);
    this.afterGameStep(now);
    this.logger.info(EVENT.GAME_STARTED, { players: roster.length });
    return true;
  }

  private returnToLobby(): void {
    this.engine.resetState();
    for (const player of this.state.players.values()) {
      player.ready = false;
      player.score = 0;
      if (player.joined) player.spectator = false;
    }
    this.state.winnerIds = new ArraySchema<string>();
    this.setStatus("LOBBY");
    this.afterGameStep(Date.now());
  }

  private setStatus(status: SessionStatus): void {
    if (this.state.status === status) return;
    this.state.status = status;
    this.logger.info(EVENT.STATUS_CHANGED, { status });
    void this.publishMetadata();
  }

  private recordWinners(winnerIds: string[]): void {
    this.state.winnerIds = new ArraySchema<string>(...winnerIds);
    for (const id of winnerIds) {
      const row = this.state.players.get(id);
      if (row) row.wins += 1;
    }
    this.logger.info(EVENT.GAME_ENDED, { winners: winnerIds });
  }

  // -------------------------------------------------------------- game bridge

  private notifyGameOfPlayer(playerId: string, change: PlayerChange): void {
    const now = Date.now();
    this.engine.playerChanged(playerId, change, now);
    this.afterGameStep(now);
  }

  /** Publishes whatever a game step changed: projection first, then each phone. */
  private afterGameStep(now: number): void {
    this.projectGameState(now);
    this.pushAllControllerStates();
  }

  /**
   * Mirrors the game's public projection into network state.
   *
   * The projection is serialised and compared to the last one, so a tick that
   * changed nothing produces no patch and no re-render on the shared screen.
   */
  private projectGameState(now: number): void {
    const publicState = this.engine.publicState(now);
    if (publicState === undefined) return;

    let json: string;
    try {
      json = JSON.stringify(publicState ?? null);
    } catch (error) {
      this.logger.error(EVENT.GAME_ERROR, { phase: "serialize", message: describeError(error) });
      return;
    }
    if (json === this.lastPublicJson) return;
    this.lastPublicJson = json;

    try {
      this.adapter.project(this.state, publicState);
      this.state.gameRevision += 1;
    } catch (error) {
      this.logger.error(EVENT.GAME_ERROR, { phase: "project", message: describeError(error) });
    }
  }

  /** Delivers a cue from the engine: to one phone, or to every screen. */
  private deliver(event: GameEventMessage, to?: string): void {
    if (to === undefined) {
      this.broadcast(MSG.GAME_EVENT, event);
      return;
    }
    const client = this.clients.find((c) => c.sessionId === to);
    client?.send(MSG.GAME_EVENT, event);
  }

  private emitPlatformEvent(event: GameEventInput): void {
    this.broadcast(MSG.GAME_EVENT, { ...event, at: Date.now() });
  }

  // ------------------------------------------------------------ controller io

  private controllerMode(player: PlayerSchema | undefined): ControllerMode {
    if (!player?.joined) return "setup";
    const status = this.state.status as SessionStatus;
    if (player.spectator && isRunningStatus(status)) return "spectating";
    switch (status) {
      case "LOBBY":
        return "lobby";
      case "STARTING":
        return "starting";
      case "PLAYING":
        return "game";
      case "ROUND_END":
        return "round-end";
      case "GAME_OVER":
        return "game-over";
      default:
        return "setup";
    }
  }

  private buildEnvelope(playerId: string): ControllerEnvelope {
    const player = this.state.players.get(playerId);
    const mode = this.controllerMode(player);
    const projection =
      player && this.registry.has(playerId)
        ? this.engine.controllerState(playerId, Date.now())
        : { active: false, game: null };

    return {
      mode,
      gameId: this.state.gameId,
      active: projection.active,
      score: player?.score ?? 0,
      game: projection.game,
      revision: this.controllerRevision,
    };
  }

  /** Sends a controller its projection, skipping sends that would change nothing. */
  private pushControllerState(client: Client, force = false): void {
    const data = client.userData as ClientData | undefined;
    if (data?.role !== "controller") return;

    const envelope = this.buildEnvelope(client.sessionId);
    // `revision` is excluded from the comparison so it does not defeat the check.
    const { revision: _revision, ...comparable } = envelope;
    const json = JSON.stringify(comparable);
    if (!force && this.lastControllerJson.get(client.sessionId) === json) return;

    this.lastControllerJson.set(client.sessionId, json);
    this.controllerRevision += 1;
    client.send(MSG.CONTROLLER_STATE, { ...envelope, revision: this.controllerRevision });
  }

  private pushAllControllerStates(): void {
    for (const client of this.clients) {
      this.pushControllerState(client);
    }
  }

  private sendWelcome(client: Client): void {
    const data = client.userData as ClientData | undefined;
    const payload: WelcomePayload = {
      playerId: client.sessionId,
      role: data?.role ?? "controller",
      roomId: this.roomId,
      roomCode: this.state.publicCode,
      // The client rebuilds the full token from its own room object; this is
      // sent so a client that lost its copy can still recover it.
      reconnectionToken: `${this.roomId}:${client.reconnectionToken}`,
      gameId: this.state.gameId,
      serverTime: Date.now(),
    };
    client.send(MSG.WELCOME, payload);
  }

  private sendError(client: Client, code: PartyErrorCode): void {
    client.send(MSG.ERROR, { code, messageKey: `error.${code}` });
  }

  // --------------------------------------------------------------------- tick

  private tick(deltaMs: number): void {
    const now = Date.now();

    if (this.engine.running) {
      this.engine.tick(deltaMs, now);
      this.projectGameState(now);
    }
    this.pushAllControllerStates();

    if (now - this.lastBeaconAt >= CLOCK_BEACON_MS) {
      this.lastBeaconAt = now;
      this.state.serverTime = now;
    }

    this.checkExpiry(now);
  }

  /**
   * Reclaims sessions nobody is using.
   *
   * Two independent limits: an idle timeout that starts when the last client
   * leaves, and an absolute age cap so a forgotten room on a TV in an empty
   * office cannot live forever.
   */
  private checkExpiry(now: number): void {
    if (this.clients.length > 0) {
      this.lastConnectedAt = now;
      return;
    }
    const idleFor = now - this.lastConnectedAt;
    const age = now - this.createdAt;
    const limits = runtimeHost();
    if (idleFor < limits.sessionTimeoutMs && age < limits.sessionMaxAgeMs) return;

    this.logger.info(EVENT.SESSION_EXPIRED, { idleFor, age });
    this.state.status = "CLOSED";
    void this.disconnect(CLOSE_CODE.SESSION_ENDED);
  }

  // ----------------------------------------------------------------- metadata

  private async publishMetadata(): Promise<void> {
    try {
      await this.setMetadata({
        publicCode: this.state.publicCode,
        gameId: this.state.gameId,
        status: this.state.status as SessionStatus,
        playerCount: this.joinedHumans().length,
        maxPlayers: this.state.settings.maxPlayers,
        lateJoin: this.lateJoinPolicy(),
      });
    } catch (error) {
      this.logger.warn(EVENT.METADATA_FAILED, { message: describeError(error) });
    }
  }

  // --------------------------------------------------------------- dev tools

  /**
   * Developer-mode shortcuts.
   *
   * Reachable only when dev tools are enabled, which the runtime refuses in
   * production. Platform commands are handled here; anything else is delegated
   * to the game plugin's `devCommands`.
   */
  private runDevCommand(command: string, value?: number): void {
    switch (command) {
      case "add-bot": {
        this.state.settings.botCount = Math.min(
          this.state.settings.botCount + 1,
          ABSOLUTE_MAX_PLAYERS,
        );
        this.reconcileBots();
        return;
      }
      case "remove-bot": {
        this.state.settings.botCount = Math.max(0, this.state.settings.botCount - 1);
        this.reconcileBots();
        return;
      }
      case "end-session": {
        this.state.status = "CLOSED";
        void this.disconnect(CLOSE_CODE.SESSION_ENDED);
        return;
      }
      default: {
        const now = Date.now();
        if (this.engine.runDevCommand(command, value, now)) this.afterGameStep(now);
      }
    }
  }
}
