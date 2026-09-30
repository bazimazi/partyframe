import { defineConfig } from "vitest/config";

/**
 * Tests import the published packages by name but resolve them to source, so
 * the suite never depends on a stale `dist/`. The private `@partyframe/*`
 * packages already point at their sources through `exports`.
 */
const alias = {
  "@bazimazi/partyframe-server": new URL(
    "./packages/partyframe-server/src/index.ts",
    import.meta.url,
  ).pathname,
  "@bazimazi/partyframe-client": new URL(
    "./packages/partyframe-client/src/index.ts",
    import.meta.url,
  ).pathname,
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "examples/*/tests/**/*.test.ts"],
          testTimeout: 20_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
