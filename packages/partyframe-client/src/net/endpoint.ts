/**
 * Where the game server lives, from the browser's point of view.
 *
 * This is the one piece of configuration that must be right for a phone to
 * connect, so the resolution order is explicit rather than clever:
 *
 * 1. `configureClient({ serverUrl })`, for apps that know at runtime.
 * 2. `VITE_SERVER_URL`, when the app is deployed with the frontend on a CDN and
 *    the WebSocket server on its own host. This is the production path.
 * 3. Otherwise, in development, the same hostname the page was served from with
 *    the game server's port. This is what makes `http://192.168.1.5:5173` on a
 *    laptop reach `http://192.168.1.5:2567`, so a phone scanning the QR code
 *    connects to the laptop rather than to its own `localhost`.
 * 4. Otherwise the page's own origin, for single-origin deployments where the
 *    Node server also serves the built frontend (`listen({ staticDir })`).
 */

import { clientConfig, readEnv } from "../config.js";

/** Vite dev/preview ports. A page on one of these is not same-origin with the server. */
const DEV_PORTS = new Set(["5173", "4173"]);

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveServerHttpUrl(): string {
  const explicit = clientConfig().serverUrl ?? readEnv("VITE_SERVER_URL");
  if (explicit) return trimSlash(explicit);

  if (typeof window === "undefined") return "http://localhost:2567";

  const { protocol, hostname, port } = window.location;
  if (DEV_PORTS.has(port)) {
    return `${protocol}//${hostname}:${readEnv("VITE_SERVER_PORT") ?? "2567"}`;
  }
  return window.location.origin;
}

/**
 * The base URL a phone should open to join.
 *
 * Built from the *page's* origin, not the server's: the QR code has to point at
 * whatever address the shared screen itself is reachable on. The server's
 * `publicBaseUrl`, `configureClient({ publicUrl })` or `VITE_PUBLIC_URL`
 * override it for deployments behind a proxy with a different public name.
 */
export function resolveJoinBaseUrl(publicBaseUrl?: string): string {
  const explicit = publicBaseUrl || clientConfig().publicUrl || readEnv("VITE_PUBLIC_URL");
  if (explicit) return trimSlash(explicit);
  return typeof window === "undefined" ? "" : window.location.origin;
}

export function buildJoinUrl(roomCode: string, publicBaseUrl?: string): string {
  return `${resolveJoinBaseUrl(publicBaseUrl)}/join/${roomCode}`;
}

/**
 * True when the page is on `localhost` while also being the QR target.
 *
 * A `localhost` QR code is the single most common way this kind of app fails in
 * a living room, so the shared screen warns about it explicitly rather than
 * showing a code nobody can use.
 */
export function isLoopbackHost(): boolean {
  if (typeof window === "undefined") return false;
  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
