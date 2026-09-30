# Changelog

## 0.2.0

### Showcase and game kit (second pass)

- Three more games in `examples/showcase`: **Quiz**, **Doodle** (draw and
  guess) and **Most Likely To**, each with bots and harness tests. The example
  workspace is now `@partyframe/example-showcase`.
- `PartyGame.actionRateLimit` for games that stream input.
- `textSchema(max)` / `sanitizeText()` for free text from phones.
- Client UI kit: `Countdown`, `Scoreboard`, `ChoiceGrid`, `TextEntry`,
  `Confetti`. Results screen with a podium and confetti; player cards and
  digits animate in; QR frame pulses.
- `ScreenProps.status` and `StageBridge.status`.
- ESLint (typescript-eslint, react-hooks) and Prettier, enforced in CI.

The first release that installs. 0.1.0 was published from a stale build and
depended on private workspace packages that were never on npm, so it could not
be used outside this repository.

### Packaging

- The private `@partyframe/*` packages are bundled into the two published
  packages with tsup; tarballs are self-contained (JS and `.d.ts`).
- `scripts/verify-pack.mjs` (CI: "Tarballs install and run") packs, installs
  into an empty project and boots a server from the installed copy.
- `clean` works on Windows; `prepack` always rebuilds.
- Dependencies use caret ranges; `@colyseus/core` requires `^0.16.26`
  (0.16.25 has a broken manifest).

### Writing games

- **`MatchEngine`**: the game-driving logic is transport-free and shared by
  the room and the new **test harness** `createTestMatch()`.
- **No adapter needed**: `listen({ games: [game] })` accepts a plain
  `PartyGame`; the public projection travels as JSON. Custom Colyseus schemas
  are still possible through `GameNetworkAdapter`.
- **Declared options** (`options: { rounds: { type: "number", ... } }`) render
  lobby controls, validate input and type `ctx.options`.
- `start`, `update`, `parseOptions`, `createBot` are optional.
- `ctx.emitTo(playerId, event)` sends a cue to one phone.
- `ctx.players.connected()` and `ranked()`; `wins` on every player.
- `getWinners()` with a top-scorers default; `lateJoin` policy.
- Timing helpers (`startDeadline`, `hasExpired`, `remainingMs`,
  `elapsedFraction`) and roster helpers (`rankPlayers`, `topScorers`,
  `nextPlayer`).
- `requestStatus` is typed to the statuses a game may request.
- `defineGame` infers `ctx.options` from `options`, or from `parseOptions`.

### Server

- Scores reset on rematch; `wins` persist; `winnerIds` are synchronised.
- `game-started` / `game-ended` platform events are emitted.
- Projections are diffed: an unchanged tick sends no patch.
- Late joiners become spectators (or are refused, or play - per game).
- Unique display names and colours per session.
- A phone host can no longer disconnect the shared screen with `kick-player`.
- A replacement shared screen may attach when the previous one dropped.
- `NOT_ENOUGH_PLAYERS` is reported to whoever pressed Start.
- `listen()` serves a static web app (`staticDir`), answers `/api/health`,
  supports `port: 0`, `onRequest`, `corsOrigin`, `lookupRateLimit`,
  `maxSessions`, and returns `close()`.
- The developer latency endpoint exists and works (inbound delay).
- Room lookups are rate limited per address; session count is capped.
- Game exceptions are isolated per phase and logged with context.

### Client

- `defineWebGame<Public, Controller, Action>()` types panels end to end.
- A React `Screen` can replace a Phaser scene on the TV; `scene` is loaded
  lazily per game. `bindKit({ games })` (the 0.1 shape still works).
- The TV resumes its session after a reload (`?room=CODE`), or re-attaches by
  code, before creating a new one.
- `useSession` is StrictMode-safe; a stale in-flight join never attaches.
- Spectator mode, rank and "you won" on phones; multiple winners and win
  tallies on the results screen; taken colours marked during setup.
- Lobby controls for max players and declared game options; bots hidden for
  games without `createBot`; ready count.
- Landing page listing installed games; `LocaleSwitcher`.
- `configureClient()`; `import.meta.env` is read defensively.
- `registerLocale`, `listLocales`, plural variants, pending messages for
  locales registered later; every hard-coded string localised.
- `sfx.define()` for custom cues; `qrcode` and Phaser load lazily.
- `styles.css` no longer imports Google Fonts; `fonts.css` is opt-in. Logical
  properties for RTL.

### Breaking changes from 0.1.0

- `ControllerEnvelope`, `ClientPlayer` and `SessionSnapshot` gained fields
  (`spectator`, `wins`, `winnerIds`); `ControllerMode` gained `spectating`.
- `GameContext.requestStatus` accepts `MatchStatus` only.
- `PartyGame.getControllerState` returns `ControllerProjection`.
- `WebGame.normalizePublicState` is optional; `Controller` props are generic
  and include `players` and `events`.
- `SERVER_CONFIG_FALLBACK` / `ServerConfigResponse` come from the protocol
  (`PublicServerConfig`); `games[]` entries carry `options`, `bots`,
  `lateJoin`, `devCommands`.
- The example's `tapAdapter.ts` is gone: install the game directly.

## 0.1.0

Initial release (unusable when installed from npm; see above).
