/**
 * Client/server clock synchronisation.
 *
 * The server owns every deadline and publishes them as absolute epoch
 * milliseconds. A client that naively compares those to its own `Date.now()`
 * will show a countdown that is wrong by the device's clock skew, which on
 * phones is routinely seconds and occasionally minutes.
 *
 * So the client measures the offset the same way NTP does: send `t0`, receive
 * the server's `t1`, note the arrival time `t2`, and assume the one-way delay is
 * half the round trip.
 *
 *     offset = t1 - (t0 + rtt / 2)
 *     serverNow = Date.now() + offset
 *
 * Samples are kept and the *median* is used, because a single sample stuck
 * behind a slow radio wake-up would otherwise skew every countdown on screen.
 * This affects presentation only: the server decides what actually happened.
 */

/** How many samples to keep. Odd, so the median is a real observation. */
const SAMPLE_COUNT = 7;

/** Rapid probes on connect, then a slow drift correction. */
const WARMUP_INTERVAL_MS = 250;
const WARMUP_PROBES = 5;
const STEADY_INTERVAL_MS = 10_000;

export class ClockSync {
  private samples: number[] = [];
  private offsetMs = 0;
  private roundTripMs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private probesSent = 0;

  constructor(private readonly sendPing: (t0: number) => void) {}

  /** Server time in epoch ms, as best this client can tell. */
  now(): number {
    return Date.now() + this.offsetMs;
  }

  /** Milliseconds until an absolute server deadline, floored at zero. */
  remaining(serverDeadlineMs: number): number {
    return Math.max(0, serverDeadlineMs - this.now());
  }

  get offset(): number {
    return this.offsetMs;
  }

  /** Last measured round trip, surfaced in the developer panel. */
  get rtt(): number {
    return this.roundTripMs;
  }

  get synced(): boolean {
    return this.samples.length > 0;
  }

  start(): void {
    this.stop();
    this.probesSent = 0;
    this.probe();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Clears samples so a reconnection re-measures rather than trusting old data. */
  reset(): void {
    this.samples = [];
    this.probesSent = 0;
  }

  handlePong(t0: number, t1: number): void {
    const t2 = Date.now();
    const rtt = t2 - t0;
    // A wildly long round trip carries almost no information about the offset.
    if (rtt > 4000) return;

    this.roundTripMs = rtt;
    this.samples.push(t1 - (t0 + rtt / 2));
    if (this.samples.length > SAMPLE_COUNT) this.samples.shift();

    const sorted = [...this.samples].sort((a, b) => a - b);
    this.offsetMs = sorted[Math.floor(sorted.length / 2)] ?? 0;
  }

  private probe(): void {
    this.sendPing(Date.now());
    this.probesSent += 1;
    const interval = this.probesSent < WARMUP_PROBES ? WARMUP_INTERVAL_MS : STEADY_INTERVAL_MS;
    this.timer = setTimeout(() => this.probe(), interval);
  }
}
