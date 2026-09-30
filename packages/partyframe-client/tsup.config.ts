import { defineConfig } from "tsup";

/**
 * The private workspace packages (`@partyframe/*`) are inlined into this
 * bundle so the published tarball is self-contained. React, Phaser and the
 * Colyseus client stay external: they are peer or regular dependencies that
 * must exist exactly once in the consumer's app.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "browser",
  target: "es2022",
  // `resolve` inlines the private packages' types too; without it the .d.ts
  // would still import from `@partyframe/*`, which consumers cannot install.
  dts: { resolve: [/^@partyframe\//] },
  sourcemap: true,
  clean: true,
  // Keeps `import("phaser")` and the Phaser stage in their own lazy chunk.
  splitting: true,
  treeshake: true,
  noExternal: [/^@partyframe\//],
  external: [
    "react",
    "react-dom",
    "react-router-dom",
    "phaser",
    "colyseus.js",
    "qrcode",
    "zod",
    /^react\//,
  ],
});
