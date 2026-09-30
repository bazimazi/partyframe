/**
 * Client configuration.
 *
 * Two values must be right for a party to work: where the game server is, and
 * what address the QR code should send phones to. They can be set explicitly
 * with `configureClient()`, through Vite environment variables, or left to the
 * heuristics in `net/endpoint.ts`. Explicit wins.
 */

export interface ClientConfig {
  /** Origin of the game server, e.g. `https://party.example.com`. */
  serverUrl?: string;
  /** Public origin of the web app, used in QR codes behind a proxy. */
  publicUrl?: string;
}

let config: ClientConfig = {};

export function configureClient(next: ClientConfig): void {
  config = { ...config, ...next };
}

export function clientConfig(): ClientConfig {
  return config;
}

/**
 * Reads a `VITE_*` variable without assuming a Vite build. Bundlers that do
 * not define `import.meta.env` would otherwise throw at import time.
 */
export function readEnv(name: string): string | undefined {
  try {
    const env = (import.meta as { env?: Record<string, unknown> }).env;
    const value = env?.[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
