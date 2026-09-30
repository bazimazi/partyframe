/**
 * React bindings for `SessionConnection`.
 *
 * `useSyncExternalStore` is used rather than local state so every consumer sees
 * exactly one consistent view per commit. The connection itself is created in
 * an effect and torn down in its cleanup, which keeps React StrictMode's
 * mount-unmount-mount honest: the first connection is disposed before its join
 * resolves and never attaches a room, so the server sees one screen, not two.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SessionAction } from "@partyframe/protocol";
import { SessionConnection, type ConnectOptions, type SessionView } from "./SessionConnection.js";

export interface UseSessionResult extends SessionView {
  connection: SessionConnection;
  sendSessionAction: (action: SessionAction) => void;
  sendGameAction: (action: unknown) => void;
  dismissError: () => void;
  leave: () => void;
}

const EMPTY_VIEW: SessionView = {
  status: "idle",
  error: null,
  snapshot: null,
  controller: null,
  events: [],
  playerId: "",
  roomCode: "",
  latencyMs: 0,
};

/**
 * Opens (and owns) one session connection for as long as `options` describe
 * the same session. A different room code or role is a different session and
 * gets a fresh connection; a new object with the same values does not.
 */
export function useSession(options: ConnectOptions | null): UseSessionResult | null {
  const key = options ? `${options.role}|${options.roomCode ?? ""}|${options.gameId ?? ""}` : "";
  const [connection, setConnection] = useState<SessionConnection | null>(null);

  // The connection is an external system created here and disposed in the
  // cleanup; storing its handle in state is what this effect is for.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!key) {
      setConnection(null);
      return;
    }
    const [role, roomCode, gameId] = key.split("|") as [ConnectOptions["role"], string, string];
    const next = new SessionConnection();
    setConnection(next);
    void next.connect({ role, roomCode: roomCode || undefined, gameId: gameId || undefined });
    return () => {
      next.dispose();
    };
  }, [key]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!connection) return () => undefined;
      return connection.subscribe(() => listener());
    },
    [connection],
  );

  const getSnapshot = useCallback(() => connection?.current ?? EMPTY_VIEW, [connection]);

  const view = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const api = useMemo(() => {
    if (!connection) return null;
    return {
      connection,
      sendSessionAction: (action: SessionAction) => connection.sendSessionAction(action),
      sendGameAction: (action: unknown) => connection.sendGameAction(action),
      dismissError: () => connection.dismissError(),
      leave: () => void connection.leave(true),
    };
  }, [connection]);

  if (!connection || !api) return null;
  return { ...view, ...api };
}
