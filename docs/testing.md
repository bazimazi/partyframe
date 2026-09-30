# Testing

partyframe separates rules from transport precisely so that a game can be
tested without a server, a socket or a browser. There are two layers.

## Rules: `createTestMatch`

`createTestMatch(game, config)` runs the same `MatchEngine` the server does,
with an in-memory roster and a clock only you advance.

```ts
import { createTestMatch } from "@bazimazi/partyframe-server";
import { reflexGame } from "../src/games/reflex/game.js";

const match = createTestMatch(reflexGame, {
  players: ["ali", "sara"],   // or a number: seats p1..pN (default 2)
  bots: 1,                    // optional bots, named bot-1..
  botDifficulty: "hard",
  seed: 42,                   // same seed + same script = same match
  options: { rounds: 2 },     // raw host options, parsed like lobby input
});

match.start();                                   // LOBBY -> STARTING/PLAYING
match.advanceUntil(() => match.publicState().phase === "go");
match.act("ali", { type: "press" });             // -> { status: "applied" }
match.advance(3_000);                            // ticks in 100 ms steps
expect(match.status).toBe("GAME_OVER");
expect(match.winnerIds).toEqual(["ali"]);
```

### What you can inspect

| Member | Meaning |
| --- | --- |
| `status`, `statusLog` | Current session status and every transition so far |
| `state`, `options` | The engine's live state and parsed options, typed |
| `players`, `score(id)` | Roster snapshot; a player's match score and `wins` |
| `publicState()`, `controller(id)` | The projections screens would receive |
| `events`, `eventsOfKind(kind)` | Every cue delivered, with `to` set on private ones |
| `winnerIds`, `winners()` | Winners recorded at game over; the game's current answer |

### What you can do

| Member | Meaning |
| --- | --- |
| `act(id, action)` | Submit an action. Returns `applied`, `refused` (rules said no) or `invalid` (schema said no) |
| `tick(ms?)`, `advance(ms)`, `advanceUntil(pred, maxMs?)` | Move the clock and run `update` + bots |
| `addPlayer(id)`, `addBot()`, `removePlayer(id)`, `disconnect(id)`, `reconnect(id)` | Roster changes, with `onPlayerChanged` fired |
| `setOptions(raw)` | Change options before a match |
| `rematch()`, `returnToLobby()` | Session flow after `GAME_OVER` |
| `devCommand(name, value?)` | Run one of the game's dev commands |

Two differences from the server are deliberate: a game callback that throws
**fails the test** instead of being logged, and `act()` throws when the match
is not running so a mis-sequenced script is obvious.

### Determinism

Nothing in the harness reads the wall clock. `ctx.now` starts at
`config.now` (a fixed epoch) and moves only through `tick`/`advance`. All
randomness flows through `ctx.rng`, seeded by `config.seed`. Two runs of the
same script produce identical states, events and winners - which is what makes
a failing test reproducible.

## Sessions: integration tests

For the platform itself - joining, reconnection, kicks, late joiners - the
repository runs real sessions: `listen({ port: 0 })` on a free port and the
Colyseus client SDK as phones and TVs. See `tests/integration/`. The helpers
there (`createHost`, `joinPlayer`, `waitFor`) are a good template for testing
a game's full network behaviour if you need to.

`listen()` accepts `log: silentLogger` and `lookupRateLimit: false` to keep
test output quiet and avoid tripping the per-address lookup budget.

## Client logic

`SessionConnection`, `ClockSync`, endpoint resolution and the translator are
plain classes and functions that run in Node; `tests/unit/client.test.ts` and
`tests/integration/client.test.ts` cover them without a browser.
