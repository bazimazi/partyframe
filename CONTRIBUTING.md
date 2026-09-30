# Contributing

This is an npm workspaces monorepo. Only `@bazimazi/partyframe-server` and
`@bazimazi/partyframe-client` are published. `protocol`, `game-core` and `i18n`
are private, source-only packages (their `exports` point at `src/`) that get
bundled into the two published ones at build time.

```
packages/protocol            wire contract
packages/game-core           rules contract, engine, harness
packages/i18n                translator and English strings
packages/partyframe-server   published
packages/partyframe-client   published
examples/showcase            five games that exercise the framework
tests/unit                   pure logic, plus the example's game tests
tests/integration            real server + real Colyseus clients
scripts/verify-pack.mjs      installs the packed tarballs into an empty project
docs/                        guides
```

## Develop

```bash
npm install
npm run check          # typecheck, build, test, then typecheck + build the example
npm run example        # build, then run the sample server (2567) and Vite (5173)
npm run dev            # watch-rebuild both packages and run the example
```

Individual steps:

| Command | What |
| --- | --- |
| `npm run lint` / `format` | ESLint and Prettier (CI checks both) |
| `npm run typecheck` | `tsc` per package (source-only, no emit) |
| `npm run build` | tsup bundles for the two published packages |
| `npm test` | unit + integration projects (vitest) |
| `npm run test:integration` | only the socket tests |
| `npm run verify-pack` | pack, install into a temp project, boot a server from it |
| `npm run typecheck:example` / `build:example` | the sample as a real consumer (needs `build` first) |

Tests import the published packages by name and resolve them to source, so
they never depend on a stale `dist/`. The example, by contrast, deliberately
consumes the built packages.

Line endings are LF everywhere (`.gitattributes`). Open the TV page on your
LAN address, not `localhost`, or phones cannot scan the QR code.

## Adding a game to the example

1. Rules in `examples/showcase/src/games/<id>/game.ts` with `defineGame`.
2. Web in `.../web.tsx` with `defineWebGame` (React `Screen` or a lazy Phaser
   `scene`).
3. Strings in `examples/showcase/src/i18n/en.ts`.
4. Register in `server.ts` and `web.tsx`.
5. A harness test in `examples/showcase/tests/<id>.test.ts`.

## Publishing

`prepack` rebuilds, and `npm run verify-pack` proves the tarballs work
outside the workspace - run it before every publish. Both public packages are
published together with the same version.

The first publish of a new package name needs account 2FA and an OTP; a
granular token can update existing packages. Tokens in `.env.local` are
ignored by git.

```bash
npm run check
npm run verify-pack
npm login && npm whoami          # must print bazimazi
npm publish -w @bazimazi/partyframe-server --access public --otp=123456
npm publish -w @bazimazi/partyframe-client --access public --otp=123456
```

Do not publish `protocol`, `game-core`, `i18n`, the root workspace or the
example.
