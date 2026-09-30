/**
 * One-call server bootstrap.
 *
 * Hosts should not have to wire Colyseus, CORS, `/api/config`, room lookup and
 * static files themselves. `listen()` installs games, binds runtime defaults,
 * and serves the HTTP + WebSocket surface the client package already talks to.
 *
 * HTTP surface:
 *
 * - `GET /api/config`        what this server has installed, for the web app
 * - `GET /api/rooms/:code`   resolves a room code before a phone joins
 * - `GET /api/health`        liveness plus a session count, for orchestrators
 * - `POST /api/dev/latency`  developer tool; refused unless dev tools are on
 * - anything else            `onRequest`, then `staticDir`, then 404
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, normalize, resolve, sep } from "node:path";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { AnyPartyGame } from "@partyframe/game-core";
import { PARTY_ROOM, isRunningStatus, type PublicServerConfig } from "@partyframe/protocol";
import { install, listInstalledGames, type GameNetworkAdapter } from "./adapters.js";
import { EVENT, bindRuntime, runtimeHost, type BindRuntimeInput } from "./bind.js";
import { PartySessionRoom, type RoomMetadata } from "./PartySessionRoom.js";
import { RateLimiter, type BucketOptions } from "./rateLimit.js";

export interface ListenOptions extends BindRuntimeInput {
  /** Games to install. Plain `PartyGame`s sync their projection as JSON. */
  games: Array<AnyPartyGame | GameNetworkAdapter>;
  /** Defaults to `$PORT`, then 2567. `0` picks a free port. */
  port?: number;
  hostname?: string;
  /** Public origin encoded in QR codes when the page sits behind a proxy. Defaults to `$PUBLIC_URL`. */
  publicBaseUrl?: string;
  /**
   * Directory of a built web app to serve from the same origin, with an SPA
   * fallback to its `index.html`. One process then serves TV, phones and game.
   */
  staticDir?: string;
  /**
   * Custom HTTP handling, consulted before the static directory. Return true
   * once the response has been handled.
   */
  onRequest?: (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>;
  /** `Access-Control-Allow-Origin` for the JSON API. Defaults to `*`. */
  corsOrigin?: string;
  /**
   * Per-address budget for `GET /api/rooms/:code`, the request a code guesser
   * would hammer. `false` disables it, e.g. behind a gateway that already
   * limits, or in tests.
   */
  lookupRateLimit?: BucketOptions | false;
}

export type { PublicServerConfig };

export interface PartyServer {
  gameServer: Server;
  httpServer: ReturnType<typeof createServer>;
  /** The port actually bound, which matters when `port: 0` was requested. */
  port: number;
  /** Disconnects every session and stops listening. */
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Room lookups are how a code gets guessed; budget them per address. A whole
 * household behind one NAT shares an address, so the burst covers a room full
 * of phones scanning at once and the refill only bites a scanner.
 */
export const LOOKUP_LIMITS: BucketOptions = { capacity: 30, refillPerSecond: 2 };

export function publicServerConfig(publicBaseUrl = ""): PublicServerConfig {
  const host = runtimeHost();
  return {
    publicBaseUrl,
    defaultGameId: host.defaultGameId,
    games: listInstalledGames(),
    devTools: host.devToolsEnabled,
  };
}

function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (first ?? req.socket.remoteAddress ?? "unknown").trim();
}

async function readJsonBody(req: IncomingMessage, limit = 4096): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(buffer);
  }
  return chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

class HttpApi {
  private readonly lookups: RateLimiter | null;
  private readonly cors: Record<string, string>;
  private readonly staticRoot: string | null;

  constructor(
    private readonly options: {
      publicBaseUrl: string;
      staticDir?: string;
      corsOrigin: string;
      onRequest?: ListenOptions["onRequest"];
      lookupRateLimit: BucketOptions | false;
    },
  ) {
    this.lookups = options.lookupRateLimit ? new RateLimiter(options.lookupRateLimit) : null;
    this.cors = {
      "access-control-allow-origin": options.corsOrigin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    this.staticRoot = options.staticDir ? resolve(options.staticDir) : null;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204, this.cors);
      res.end();
      return;
    }

    if (url.pathname === "/api/config" && req.method === "GET") {
      return this.json(res, 200, publicServerConfig(this.options.publicBaseUrl));
    }

    if (url.pathname === "/api/health" && req.method === "GET") {
      const rooms = await matchMaker.query({ name: PARTY_ROOM });
      return this.json(res, 200, {
        ok: true,
        sessions: rooms.length,
        uptimeSeconds: Math.round(process.uptime()),
      });
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
    if (roomMatch && req.method === "GET") {
      if (this.lookups && !this.lookups.tryConsume(clientAddress(req), Date.now())) {
        return this.json(res, 429, { error: "RATE_LIMITED" });
      }
      const code = decodeURIComponent(roomMatch[1] ?? "").toUpperCase();
      const rooms = await matchMaker.query({ name: PARTY_ROOM });
      const room = rooms.find(
        (candidate) => (candidate.metadata as RoomMetadata | undefined)?.publicCode === code,
      );
      if (!room) return this.json(res, 404, { error: "ROOM_NOT_FOUND" });

      const meta = room.metadata as RoomMetadata;
      const hasRoom = meta.playerCount < meta.maxPlayers;
      const lateJoin = meta.lateJoin ?? "spectate";
      const joinable =
        hasRoom &&
        (meta.status === "LOBBY" ||
          meta.status === "GAME_OVER" ||
          (isRunningStatus(meta.status) && lateJoin !== "deny"));
      return this.json(res, 200, {
        roomId: room.roomId,
        roomCode: meta.publicCode,
        gameId: meta.gameId,
        status: meta.status,
        playerCount: meta.playerCount,
        maxPlayers: meta.maxPlayers,
        lateJoin,
        joinable,
      });
    }

    if (url.pathname === "/api/dev/latency" && req.method === "POST") {
      const host = runtimeHost();
      if (!host.devToolsEnabled) return this.json(res, 403, { error: "NOT_ALLOWED" });
      try {
        const body = (await readJsonBody(req)) as { milliseconds?: unknown } | null;
        const ms = Number(body?.milliseconds ?? 0);
        if (!Number.isFinite(ms) || ms < 0 || ms > 5000) {
          return this.json(res, 400, { error: "INVALID_PAYLOAD" });
        }
        host.simulatedLatencyMs = Math.round(ms);
        return this.json(res, 200, { milliseconds: host.simulatedLatencyMs });
      } catch {
        return this.json(res, 400, { error: "INVALID_PAYLOAD" });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return this.json(res, 404, { error: "NOT_FOUND" });
    }

    if (this.options.onRequest && (await this.options.onRequest(req, res))) return;

    if (this.staticRoot && (req.method === "GET" || req.method === "HEAD")) {
      if (this.serveStatic(url.pathname, res)) return;
    }

    this.json(res, 404, { error: "NOT_FOUND" });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...this.cors,
    });
    res.end(JSON.stringify(body));
  }

  /**
   * Serves a built single-page app.
   *
   * Paths are resolved inside the static root only - a request for
   * `/../server.js` cannot escape it. Unknown paths without an extension fall
   * back to `index.html` so `/game` and `/join/ABCD` work on a fresh load.
   * Hashed assets are immutable; the entry page is not cached at all.
   */
  private serveStatic(pathname: string, res: ServerResponse): boolean {
    const root = this.staticRoot;
    if (!root) return false;

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
    let file = resolve(root, `.${sep}${relative}`);
    if (!file.startsWith(root + sep) && file !== root) return false;

    let stats = statSafe(file);
    if (stats?.isDirectory()) {
      file = resolve(file, "index.html");
      stats = statSafe(file);
    }
    if (!stats && !extname(relative)) {
      file = resolve(root, "index.html");
      stats = statSafe(file);
    }
    if (!stats?.isFile()) return false;

    const extension = extname(file).toLowerCase();
    const immutable = /[/\\]assets[/\\]/.test(file) && extension !== ".html";
    res.writeHead(200, {
      "content-type": MIME[extension] ?? "application/octet-stream",
      "content-length": Number(stats.size),
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    createReadStream(file).pipe(res);
    return true;
  }
}

function statSafe(file: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

export async function listen(options: ListenOptions): Promise<PartyServer> {
  const {
    games,
    port = Number(process.env.PORT) || 2567,
    hostname = "0.0.0.0",
    publicBaseUrl = process.env.PUBLIC_URL ?? "",
    staticDir,
    onRequest,
    corsOrigin = "*",
    lookupRateLimit = LOOKUP_LIMITS,
    ...runtime
  } = options;

  bindRuntime(runtime);
  for (const game of games) install(game);

  const api = new HttpApi({ publicBaseUrl, staticDir, corsOrigin, onRequest, lookupRateLimit });
  const httpServer = createServer((req, res) => {
    api.handle(req, res).catch((error: unknown) => {
      runtimeHost().log.error("HTTP_ERROR", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      res.end(JSON.stringify({ error: "INTERNAL" }));
    });
  });

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    greet: false,
  });
  gameServer.define(PARTY_ROOM, PartySessionRoom);
  await gameServer.listen(port, hostname);

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  const log = runtimeHost().log;
  log.info(EVENT.SERVER_STARTED, { port: boundPort, hostname, games: games.length });

  return {
    gameServer,
    httpServer,
    port: boundPort,
    async close() {
      await gameServer.gracefullyShutdown(false);
      log.info(EVENT.SERVER_STOPPED);
    },
  };
}
