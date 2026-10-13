/**
 * Deterministic pseudo-random source.
 *
 * Game rules must never call `Math.random` directly: a seeded generator makes
 * rounds reproducible in tests and keeps every random decision (prompt choice,
 * bomb fuse, bot mistakes) on the server, where it belongs.
 *
 * Implementation is mulberry32 - small, fast, and good enough for gameplay.
 * It is emphatically not cryptographically secure and must not be used for
 * tokens or room codes.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force to uint32 so behaviour is identical regardless of the seed's sign.
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`Rng.int: max ${max} < min ${min}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Uniformly picks one element. Throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("Rng.pick: empty list");
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Returns a shuffled copy, leaving the input untouched (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}

/** Creates a seed from a non-deterministic source, for production sessions. */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
