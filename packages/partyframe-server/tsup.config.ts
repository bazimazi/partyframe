import { defineConfig } from "tsup";

/**
 * The shared protocol (`@partyframe/protocol`) is inlined into this
 * bundle so the published tarball is self-contained. Everything else stays a
 * regular dependency resolved by the consumer's package manager.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  // Inline protocol types too; consumers cannot install the private package.
  dts: { resolve: ["@partyframe/protocol"] },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  noExternal: ["@partyframe/protocol"],
});
