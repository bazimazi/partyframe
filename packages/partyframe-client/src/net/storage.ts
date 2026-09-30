/**
 * Reconnection credentials.
 *
 * The whole point of a QR-code party game is that nobody signs in, so a player's
 * only identity is a short-lived Colyseus reconnection token. Persisting it means
 * a phone that locks its screen, drops Wi-Fi or has its browser evicted from
 * memory can walk straight back into the same seat.
 *
 * `localStorage` rather than `sessionStorage`: iOS Safari discards a background
 * tab's session storage aggressively, which is exactly the case this exists to
 * survive. Nothing personal is stored - a room-scoped token and a room code.
 */

import type { ClientRole, StoredCredentials } from "@partyframe/protocol";

/** Credentials past this age are assumed dead and cleaned up on read. */
const TTL_MS = 6 * 60 * 60 * 1000;

const KEY_PREFIX = "party:creds:";

function key(role: ClientRole, roomCode: string): string {
  return `${KEY_PREFIX}${role}:${roomCode.toUpperCase()}`;
}

/** Storage may throw in private mode or when disabled; never break the game for it. */
function safeStorage(): Storage | null {
  try {
    const probe = "party:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: Omit<StoredCredentials, "expiresAt">): void {
  const store = safeStorage();
  if (!store) return;
  const record: StoredCredentials = { ...credentials, expiresAt: Date.now() + TTL_MS };
  try {
    store.setItem(key(credentials.role, credentials.roomCode), JSON.stringify(record));
  } catch {
    // A full quota is not worth interrupting play for.
  }
}

export function loadCredentials(role: ClientRole, roomCode: string): StoredCredentials | null {
  const store = safeStorage();
  if (!store) return null;

  const raw = store.getItem(key(role, roomCode));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredCredentials;
    if (typeof parsed?.reconnectionToken !== "string" || parsed.expiresAt < Date.now()) {
      store.removeItem(key(role, roomCode));
      return null;
    }
    return parsed;
  } catch {
    store.removeItem(key(role, roomCode));
    return null;
  }
}

export function clearCredentials(role: ClientRole, roomCode: string): void {
  safeStorage()?.removeItem(key(role, roomCode));
}

/** Remembers a player's last profile so returning players skip the setup form. */
export interface StoredProfile {
  name: string;
  avatar: string;
  color: string;
}

const PROFILE_KEY = "party:profile";

export function saveProfile(profile: StoredProfile): void {
  try {
    safeStorage()?.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

export function loadProfile(): StoredProfile | null {
  const raw = safeStorage()?.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredProfile;
    return typeof parsed?.name === "string" ? parsed : null;
  } catch {
    return null;
  }
}
