/**
 * Roster helpers: ranking and turn order.
 *
 * Pure functions over plain player data, so a game can use them on the
 * `PlayerRegistry` and a shared screen can use them on `ClientPlayer[]`.
 */

interface Seated {
  id: string;
  seat: number;
}

interface Scored extends Seated {
  score: number;
}

/** Highest score first; ties keep seat order so the list is stable. */
export function rankPlayers<T extends Scored>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => b.score - a.score || a.seat - b.seat);
}

/**
 * Everyone sharing the top score. Empty when nobody scored at all, because a
 * "tie" between players who never did anything is not a result.
 */
export function topScorers<T extends Scored>(players: readonly T[]): T[] {
  if (players.length === 0) return [];
  const best = Math.max(...players.map((player) => player.score));
  if (best <= 0) return [];
  return players.filter((player) => player.score === best);
}

/**
 * The player after `currentId` in seat order, wrapping around, skipping anyone
 * `eligible` rejects. With no current player, the first eligible seat is next.
 * Returns undefined when nobody is eligible.
 */
export function nextPlayer<T extends Seated>(
  players: readonly T[],
  currentId: string | null | undefined,
  eligible: (player: T) => boolean = () => true,
): T | undefined {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  if (ordered.length === 0) return undefined;

  const start = currentId ? ordered.findIndex((player) => player.id === currentId) : -1;
  for (let step = 1; step <= ordered.length; step += 1) {
    const candidate = ordered[(start + step) % ordered.length];
    if (candidate && eligible(candidate)) return candidate;
  }
  return undefined;
}
