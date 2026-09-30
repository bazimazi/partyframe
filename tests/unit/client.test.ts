/**
 * Client-side logic that needs no browser: clock synchronisation, endpoint
 * resolution, plural-aware translation and the web-game catalog.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClockSync,
  addMessages,
  bindKit,
  configureClient,
  createTranslator,
  getWebGame,
  loadSceneForGame,
  registerLocale,
  resetKit,
  resolveJoinBaseUrl,
  resolveServerHttpUrl,
  type WebGame,
} from "@bazimazi/partyframe-client";

describe("ClockSync", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("estimates the server offset from a round trip", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const clock = new ClockSync(() => undefined);
    // Sent at 10 000, server stamped 15 100, received at 10 200: RTT 200,
    // one-way 100, so the server is 5 000 ahead.
    vi.setSystemTime(10_200);
    clock.handlePong(10_000, 15_100);
    expect(clock.offset).toBe(5000);
    expect(clock.rtt).toBe(200);
    expect(clock.now()).toBe(15_200);
    expect(clock.remaining(15_700)).toBe(500);
  });

  it("uses the median so one slow probe cannot skew countdowns", () => {
    vi.useFakeTimers();
    const clock = new ClockSync(() => undefined);
    const sample = (t0: number, t1: number, t2: number) => {
      vi.setSystemTime(t2);
      clock.handlePong(t0, t1);
    };
    sample(0, 1000, 100); // offset 950
    sample(0, 1000, 100); // offset 950
    sample(0, 3000, 100); // offset 2950, an outlier
    expect(clock.offset).toBe(950);
  });

  it("discards absurd round trips", () => {
    vi.useFakeTimers();
    const clock = new ClockSync(() => undefined);
    vi.setSystemTime(9000);
    clock.handlePong(0, 100);
    expect(clock.synced).toBe(false);
  });

  it("probes quickly at first and then slowly", () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const clock = new ClockSync((t0) => sent.push(t0));
    clock.start();
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(250 * 4);
    expect(sent).toHaveLength(5);
    vi.advanceTimersByTime(9_000);
    expect(sent).toHaveLength(5);
    vi.advanceTimersByTime(1_000);
    expect(sent).toHaveLength(6);
    clock.stop();
  });
});

describe("endpoints", () => {
  afterEach(() => {
    configureClient({ serverUrl: undefined, publicUrl: undefined });
  });

  it("prefers explicit configuration and strips trailing slashes", () => {
    configureClient({
      serverUrl: "https://party.example.com/",
      publicUrl: "https://tv.example.com/",
    });
    expect(resolveServerHttpUrl()).toBe("https://party.example.com");
    expect(resolveJoinBaseUrl()).toBe("https://tv.example.com");
    expect(resolveJoinBaseUrl("https://proxy.example.com/")).toBe("https://proxy.example.com");
  });

  it("has a sane default outside a browser", () => {
    expect(resolveServerHttpUrl()).toBe("http://localhost:2567");
  });
});

describe("translation", () => {
  it("picks plural variants from a numeric count", () => {
    const { t } = createTranslator("en");
    expect(t("host.needMorePlayers", { count: 1 })).toBe("Need at least 1 player");
    expect(t("host.needMorePlayers", { count: 3 })).toBe("Need at least 3 players");
    expect(t("host.wins", { count: 1 })).toBe("1 win");
  });

  it("falls back to the base key when a locale has no variants", () => {
    registerLocale({
      code: "xx",
      label: "Test",
      dir: "ltr",
      messages: { "host.wins": "{count} W" },
    });
    const { t } = createTranslator("xx");
    expect(t("host.wins", { count: 2 })).toBe("2 W");
  });

  it("keeps messages added before a locale is registered", () => {
    addMessages("yy", { "game.tap.name": "Tap!" });
    registerLocale({ code: "yy", label: "Later", dir: "rtl", messages: {} });
    const { t, dir } = createTranslator("yy");
    expect(t("game.tap.name")).toBe("Tap!");
    expect(dir).toBe("rtl");
  });
});

describe("bindKit", () => {
  afterEach(() => {
    resetKit();
  });

  const Panel = () => null;

  it("resolves games and lazy scenes from a list", async () => {
    const scene = { KEY: "x" } as unknown as Awaited<ReturnType<NonNullable<WebGame["scene"]>>>;
    bindKit({
      games: [
        { id: "a", Controller: Panel, scene: async () => scene },
        { id: "b", Controller: Panel },
      ],
    });
    expect(getWebGame("a")?.id).toBe("a");
    expect(getWebGame("zzz")).toBeUndefined();
    expect(await loadSceneForGame("a")).toBe(scene);
    expect(await loadSceneForGame("b")).toBeNull();
  });

  it("still accepts the 0.1 catalog shape", async () => {
    bindKit({
      getWebGame: (id) => (id === "a" ? { id: "a", Controller: Panel } : undefined),
      loadSceneForGame: async () => null,
    });
    expect(getWebGame("a")?.id).toBe("a");
    expect(await loadSceneForGame("a")).toBeNull();
  });

  it("explains itself when routes mount before binding", () => {
    expect(() => getWebGame("a")).toThrow(/bindKit/);
  });
});
