/**
 * Bootstrap configuration fetched from the game server.
 *
 * Kept to one small request per page load, shared by every component that
 * asks. It carries only things the client cannot know on its own: the public
 * base URL for QR codes when the app sits behind a proxy, which games this
 * build has installed (with their options), and whether developer tooling is
 * enabled on this server.
 */

import { useEffect, useState } from "react";
import { SERVER_CONFIG_FALLBACK, type PublicServerConfig } from "@partyframe/protocol";
import { resolveServerHttpUrl } from "./endpoint.js";

export type ServerConfigResponse = PublicServerConfig;

let inflight: Promise<PublicServerConfig> | null = null;
let cached: PublicServerConfig | null = null;

/** Fetches `/api/config` once; later callers share the result. */
export function fetchServerConfig(): Promise<PublicServerConfig> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetch(`${resolveServerHttpUrl()}/api/config`)
    .then((response) =>
      response.ok ? (response.json() as Promise<PublicServerConfig>) : SERVER_CONFIG_FALLBACK,
    )
    .then((config) => {
      cached = config;
      return config;
    })
    .catch(() => {
      // The fallback is enough to render and to connect; a failed config
      // fetch must not block the shared screen from creating a session.
      inflight = null;
      return SERVER_CONFIG_FALLBACK;
    });
  return inflight;
}

/** Test helper. */
export function resetServerConfigCache(): void {
  inflight = null;
  cached = null;
}

export function useServerConfig(): { config: PublicServerConfig; loaded: boolean } {
  const [config, setConfig] = useState<PublicServerConfig>(cached ?? SERVER_CONFIG_FALLBACK);
  const [loaded, setLoaded] = useState(cached !== null);

  useEffect(() => {
    let active = true;
    void fetchServerConfig().then((value) => {
      if (!active) return;
      setConfig(value);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return { config, loaded };
}
