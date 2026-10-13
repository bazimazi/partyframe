/**
 * The seeded random source.
 *
 * These properties are what make an entire match reproducible: if `Rng` drifts,
 * every other deterministic test in this suite silently stops testing what it
 * claims to.
 */

import { describe, expect, it } from "vitest";
import { Rng } from "@bazimazi/partyframe-server";

describe("Rng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const left = Array.from({ length: 32 }, () => a.next());
    const right = Array.from({ length: 32 }, () => b.next());
    expect(left).toEqual(right);
  });

  it("produces different sequences for different seeds", () => {
    const a = Array.from({ length: 16 }, (_, i) => new Rng(1).next() + i * 0);
    const b = Array.from({ length: 16 }, (_, i) => new Rng(2).next() + i * 0);
    expect(a[0]).not.toEqual(b[0]);
  });

  it("stays within [0, 1)", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("returns integers inclusive of both bounds", () => {
    const rng = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i += 1) seen.add(rng.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("treats a single-value range as a constant", () => {
    const rng = new Rng(5);
    expect(rng.int(3, 3)).toBe(3);
  });

  it("rejects an inverted range rather than silently swapping it", () => {
    expect(() => new Rng(1).int(5, 2)).toThrow(RangeError);
  });

  it("refuses to pick from an empty list", () => {
    expect(() => new Rng(1).pick([])).toThrow(RangeError);
  });

  it("shuffles without mutating the input or losing elements", () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const frozen = [...source];
    const shuffled = new Rng(3).shuffle(source);

    expect(source).toEqual(frozen);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(frozen);
  });

  it("normalises the seed so equivalent seeds behave identically", () => {
    // -1 and 0xffffffff are the same uint32; a naive implementation would not
    // agree, and seeds arrive from `Math.random() * 0xffffffff`.
    expect(new Rng(-1).next()).toBe(new Rng(0xffffffff).next());
  });
});
