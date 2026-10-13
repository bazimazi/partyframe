/**
 * Deadlines.
 *
 * Game timing is expressed as absolute server timestamps stored in game state,
 * never as timers. That keeps state serialisable, makes a match reproducible in
 * tests (`ctx.now` is the only clock), and lets phones animate a countdown
 * locally from the same two numbers the server decides with.
 */

export interface Deadline {
  /** Server epoch ms the countdown began. */
  readonly startedAt: number;
  /** Server epoch ms the countdown ends. */
  readonly endsAt: number;
}

/** Starts a countdown of `durationMs` from `now`. */
export function startDeadline(now: number, durationMs: number): Deadline {
  return { startedAt: now, endsAt: now + Math.max(0, durationMs) };
}

/** Milliseconds left, floored at zero. A missing deadline has nothing left. */
export function remainingMs(deadline: Deadline | null | undefined, now: number): number {
  if (!deadline) return 0;
  return Math.max(0, deadline.endsAt - now);
}

/** True once the deadline has passed. A missing deadline counts as expired. */
export function hasExpired(deadline: Deadline | null | undefined, now: number): boolean {
  return !deadline || now >= deadline.endsAt;
}

/** Fraction of the countdown elapsed, clamped to [0, 1]. */
export function elapsedFraction(deadline: Deadline | null | undefined, now: number): number {
  if (!deadline) return 1;
  const total = deadline.endsAt - deadline.startedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - deadline.startedAt) / total));
}
