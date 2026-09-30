/**
 * A big number counting down to a server deadline.
 *
 * Re-renders only when the displayed second changes, so a phone or TV showing
 * it is not re-rendered sixty times a second. Reads the synchronised clock, so
 * every screen in the room shows the same digit at the same moment.
 */

import { useEffect, useState } from "react";

function secondsLeft(endsAt: number, serverNow: () => number): number {
  return Math.max(0, Math.ceil((endsAt - serverNow()) / 1000));
}

export function Countdown({
  endsAt,
  serverNow,
  label,
  onZero,
  size = "large",
}: {
  /** Server epoch ms the countdown ends. */
  endsAt: number;
  serverNow: () => number;
  /** Optional caption under the number, e.g. "Get ready". */
  label?: string;
  /** Called once when the number reaches zero. */
  onZero?: () => void;
  size?: "large" | "small";
}) {
  const [seconds, setSeconds] = useState(() => secondsLeft(endsAt, serverNow));
  // A new deadline resets the digit in the same render rather than a frame late.
  const [trackedEndsAt, setTrackedEndsAt] = useState(endsAt);
  if (trackedEndsAt !== endsAt) {
    setTrackedEndsAt(endsAt);
    setSeconds(secondsLeft(endsAt, serverNow));
  }

  useEffect(() => {
    let current = secondsLeft(endsAt, serverNow);
    if (current === 0) return;
    const timer = setInterval(() => {
      const next = secondsLeft(endsAt, serverNow);
      if (next === current) return;
      current = next;
      setSeconds(next);
      if (next === 0) {
        clearInterval(timer);
        onZero?.();
      }
    }, 50);
    return () => clearInterval(timer);
    // `onZero` is intentionally not a dependency: a new callback identity
    // must not restart the countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, serverNow]);

  return (
    <div
      className={`countdown countdown--${size}`}
      role="timer"
      aria-live="off"
      data-urgent={seconds <= 3 || undefined}
    >
      {/* The key makes each digit a fresh node so the pop animation replays. */}
      <span key={seconds} className="countdown__digit">
        {seconds}
      </span>
      {label && <span className="countdown__label">{label}</span>}
    </div>
  );
}
