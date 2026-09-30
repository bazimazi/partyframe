#!/usr/bin/env node
/**
 * Proves the published tarballs work outside this repo.
 *
 * The 0.1.0 release shipped a stale `dist/` and depended on private workspace
 * packages that do not exist on npm; nothing caught it because every check ran
 * against the workspace, where those packages resolve. This script packs both
 * public packages, installs them into an empty project, and starts a server
 * from the installed copy.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packages = ["@bazimazi/partyframe-server", "@bazimazi/partyframe-client"];

/**
 * Runs npm without a shell. Under `npm run` the CLI's entry point is in
 * `npm_execpath`, so it can be executed with this very Node binary; outside
 * of it, fall back to the `npm` on PATH.
 */
function npm(args, cwd) {
  const cli = process.env.npm_execpath;
  if (cli && cli.endsWith(".js")) {
    execFileSync(process.execPath, [cli, ...args], { cwd, stdio: "inherit" });
  } else {
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
}

const work = mkdtempSync(join(tmpdir(), "partyframe-pack-"));
const fail = (message) => {
  console.error(`\n✖ ${message}`);
  process.exitCode = 1;
};

try {
  console.log(`packing into ${work}`);
  for (const name of packages) npm(["pack", "-w", name, "--pack-destination", work], root);

  const tarballs = readdirSync(work).filter((file) => file.endsWith(".tgz"));
  if (tarballs.length !== packages.length) {
    fail(`expected ${packages.length} tarballs, found ${tarballs.length}`);
  }

  // A consumer project with nothing but the tarballs and the client's peers.
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name: "pack-check", private: true, type: "module" }, null, 2),
  );
  npm(
    [
      "install",
      "--no-audit",
      "--no-fund",
      ...tarballs.map((file) => `./${file}`),
      "react@19",
      "react-dom@19",
      "react-router-dom@7",
    ],
    work,
  );

  // The bundles must not reference the private workspace packages anywhere.
  for (const name of packages) {
    const dir = join(work, "node_modules", ...name.split("/"));
    for (const file of readdirSync(join(dir, "dist"))) {
      if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
      const text = readFileSync(join(dir, "dist", file), "utf8");
      if (/from\s+["']@partyframe\//.test(text) || /import\(["']@partyframe\//.test(text)) {
        fail(`${name}/dist/${file} still imports a private @partyframe package`);
      }
    }
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (dep.startsWith("@partyframe/")) fail(`${name} lists private dependency ${dep}`);
    }
  }

  // Boot a real server from the installed package and hit its config endpoint.
  writeFileSync(
    join(work, "smoke.mjs"),
    `
import { defineGame, listen, createTestMatch, silentLogger } from "@bazimazi/partyframe-server";
import * as client from "@bazimazi/partyframe-client";

const game = defineGame({
  id: "smoke",
  nameKey: "game.smoke.name",
  minPlayers: 1,
  maxPlayers: 4,
  actionSchema: { "~standard": { version: 1, vendor: "smoke", validate: (v) => ({ value: v }) } },
  createState: () => ({ done: false }),
  handleAction(ctx) { ctx.state.done = true; return true; },
  isFinished: (ctx) => ctx.state.done,
  getControllerState: () => ({ active: true, game: null }),
  getPublicState: (ctx) => ctx.state,
});

const match = createTestMatch(game, { players: ["a"] });
match.start();
match.act("a", { go: true });
if (match.status !== "GAME_OVER") throw new Error("harness did not finish the match");

const server = await listen({ defaultGameId: "smoke", games: [game], port: 0, log: silentLogger });
const response = await fetch(\`http://127.0.0.1:\${server.port}/api/config\`);
const config = await response.json();
if (config.defaultGameId !== "smoke") throw new Error("unexpected /api/config: " + JSON.stringify(config));
await server.close();

if (typeof client.PartyApp !== "function" || typeof client.defineWebGame !== "function") {
  throw new Error("client package did not export its public API");
}
console.log("✔ installed packages boot and answer /api/config");
`,
  );
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: work, stdio: "inherit" });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (process.exitCode) {
  console.error("pack verification failed");
} else {
  console.log("✔ pack verification passed");
}
