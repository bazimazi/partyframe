import { defineConfig } from "tsup";

/**
 * The private workspace packages (`@partyframe/*`) are inlined into this
 * bundle so the published tarball is self-contained. Everything else stays a
 * regular dependency resolved by the consumer's package manager.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  // `resolve` inlines the private packages' types too; without it the .d.ts
  // would still import from `@partyframe/*`, which consumers cannot install.
  dts: { resolve: [/^@partyframe\//] },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  noExternal: [/^@partyframe\//],
});
