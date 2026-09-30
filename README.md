# partyframe

**The TV is the game. Phones are the controllers.**

partyframe is a framework for Jackbox-style party games: one shared screen
(a TV, a laptop, a projector) runs the game, and everyone in the room joins by
scanning a QR code with their phone. You write the rules of your game and the
two views it needs; partyframe supplies everything else.

- **Sessions** with short, unambiguous room codes and QR joining
- **Lobby, players, avatars, colours, ready states, host powers, kicking**
- **Bots** that play through the same rules as humans
- **Reconnection** for phones that lock, drop Wi-Fi or reload - and for the TV
- **Late joiners** who spectate and play the next match
- **Authoritative server**: phones send intentions, the server decides
- **Clock sync**, rate limiting, input validation, name sanitising
- **Declared options** that become lobby controls automatically
- **A test harness** that plays a whole match in milliseconds, no server needed
- **React** shells for both screens, an optional **Phaser** stage for the TV
- **Game UI kit**: countdowns, scoreboards, choice grids, text entry, confetti
- **Streaming input** (drawing, sensors) with per-game rate limits
- **i18n** with plural rules and RTL, sound cues, haptics, wake lock

```
npm install @bazimazi/partyframe-server   # rules contract, session server
npm install @bazimazi/partyframe-client   # TV + phone React shells
```

Peers for the web app: `react`, `react-dom`, `react-router-dom`. Add `phaser`
only if a game draws its TV view with it. Node 20.11 or newer.

## Quick start

A game is three small files: rules, the phone panel, and the TV view. Here is
"first to ten taps".

**Rules** (`tap.ts`) - plain TypeScript, no networking:

```ts
import { defineGame } from "@bazimazi/partyframe-server";
import { z } from "zod";

export const tapGame = defineGame({
  id: "tap",
  nameKey: "game.tap.name",
  minPlayers: 1,
  maxPlayers: 8,
  options: {
    target: { type: "number", labelKey: "game.tap.target", default: 10, min: 5, max: 50 },
  },
  actionSchema: z.object({ type: z.literal("tap") }),
  createState: (options) => ({ taps: {} as Record<string, number>, winnerId: "", target: options.target }),
  handleAction(ctx, playerId) {
    if (ctx.state.winnerId) return false;
    ctx.state.taps[playerId] = (ctx.state.taps[playerId] ?? 0) + 1;
    if (ctx.state.taps[playerId]! >= ctx.state.target) {
      ctx.state.winnerId = playerId;
      ctx.players.addScore(playerId, 1);
    }
    return true;
  },
  isFinished: (ctx) => Boolean(ctx.state.winnerId),
  getControllerState: (ctx, playerId) => ({
    active: !ctx.state.winnerId,
    game: { taps: ctx.state.taps[playerId] ?? 0, target: ctx.state.target },
  }),
  getPublicState: (ctx) => ({ taps: ctx.state.taps, winnerId: ctx.state.winnerId }),
  createBot: (difficulty) => ({
    difficulty,
    decide: () => ({ action: { type: "tap" as const }, delayMs: difficulty === "hard" ? 150 : 300 }),
  }),
});
```

**Server** (`server.ts`):

```ts
import { listen } from "@bazimazi/partyframe-server";
import { tapGame } from "./tap.js";

await listen({ defaultGameId: "tap", games: [tapGame] });
```

**Web app** (`web.tsx`) - the phone panel and the TV view are React components:

```tsx
import { createRoot } from "react-dom/client";
import { PartyApp, addMessages, bindKit, defineWebGame } from "@bazimazi/partyframe-client";
import "@bazimazi/partyframe-client/styles.css";

const tapWeb = defineWebGame<
  { taps: Record<string, number>; winnerId: string },
  { taps: number; target: number },
  { type: "tap" }
>({
  id: "tap",
  Controller: ({ envelope, send }) => (
    <button className="btn btn--primary btn--big btn--block" disabled={!envelope.active} onClick={() => send({ type: "tap" })}>
      {envelope.game.taps} / {envelope.game.target}
    </button>
  ),
  Screen: ({ game, players }) => (
    <ol>{players.map((p) => <li key={p.id}>{p.avatar} {p.name}: {game.taps[p.id] ?? 0}</li>)}</ol>
  ),
});

addMessages("en", { "game.tap.name": "Tap Race", "game.tap.target": "Taps to win" });
bindKit({ games: [tapWeb] });
createRoot(document.getElementById("root")!).render(<PartyApp />);
```

That gives you `/game` (the TV), `/join` (type a code) and `/join/:code` (what
the QR code encodes). Open the TV page on your machine's **LAN address**, not
`localhost`, so phones can reach it.

**Test it** without a server:

```ts
import { createTestMatch } from "@bazimazi/partyframe-server";

const match = createTestMatch(tapGame, { players: ["ali", "sara"], options: { target: 5 } });
match.start();
for (let i = 0; i < 5; i += 1) match.act("ali", { type: "tap" });
expect(match.status).toBe("GAME_OVER");
expect(match.winnerIds).toEqual(["ali"]);
```

## Try the showcase

```bash
git clone https://github.com/bazimazi/party-frame && cd party-frame
npm install
npm run example
```

Open `http://<your-lan-ip>:5173/` on the shared screen and pick a game. Five
are installed, each written to show a different part of the framework:

| Game | Players | What it demonstrates |
| --- | --- | --- |
| **Quiz** | 1–8 | Speed scoring from server timestamps, answers kept secret until the reveal, bots with accuracy by difficulty, `ChoiceGrid` + `Countdown` |
| **Doodle** | 2–8 | The phone as a drawing tablet: streamed strokes under a raised rate limit, the word secret to the drawer, turn rotation with `nextPlayer`, `textSchema` guesses, a drawer who drops ends the round |
| **Most Likely To** | 3–8 | Social voting with a dramatic reveal; how little code a round-based party game needs |
| **Reflex** | 1–8 | Deadlines in state, a held `STARTING` countdown, private cues + haptics, declared options with a select |
| **Tap Race** | 1–8 | The smallest game, with a Phaser scene on the TV |

Their sources under `examples/showcase/src/games` are the best place to start
reading; each has a harness test in `examples/showcase/tests`.

## How it fits together

```
      phones (controllers)                    shared screen (host)
   ┌──────────────────────┐              ┌────────────────────────┐
   │ <JoinRoute/>         │              │ <HostRoute/>           │
   │  your Controller     │              │  lobby · QR · results  │
   │  panel               │              │  your Screen or scene  │
   └──────────┬───────────┘              └───────────┬────────────┘
              │ game-action / session-action          │ create / settings
              ▼                                       ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  PartySessionRoom (Colyseus)                                   │
   │   room code · seats · bots · reconnection · rate limits        │
   │      └── MatchEngine ── your PartyGame rules                   │
   │            state · options · rng · events · status requests    │
   └────────────────────────────────────────────────────────────────┘
```

The server is the only authority. A phone never changes state; it sends an
intention, the rules decide, and the resulting projections are what every
screen renders: `getPublicState()` for the TV, `getControllerState(playerId)`
for each phone. The same `MatchEngine` drives real sessions and the test
harness, so a game that passes its tests behaves identically in a room.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Writing a game](docs/writing-a-game.md) | The full `PartyGame` and `WebGame` contracts, lifecycle, options, events, bots, timing helpers |
| [Testing](docs/testing.md) | `createTestMatch`, integration tests against a real server |
| [Architecture](docs/architecture.md) | Packages, wire protocol, session lifecycle, reconnection, security |
| [Deployment](docs/deployment.md) | Single-origin vs split hosting, environment, proxies, health checks |
| [Theming and i18n](docs/theming-and-i18n.md) | CSS variables, fonts, locales, plurals, RTL, sounds |
| [CONTRIBUTING](CONTRIBUTING.md) | Working on this repo and publishing |

## Packages

| Package | Contents |
| --- | --- |
| `@bazimazi/partyframe-server` | `defineGame`, `listen`, `createTestMatch`, `MatchEngine`, timing/roster helpers, Colyseus room |
| `@bazimazi/partyframe-client` | `PartyApp`, `defineWebGame`, `bindKit`, session client, clock sync, sounds, `styles.css` |

The protocol, engine and i18n live in private workspace packages and are
bundled into the two above, so a consumer installs exactly two packages.

## Status

0.2.0. The API is small and documented but not yet frozen; breaking changes are
listed in [CHANGELOG.md](CHANGELOG.md). MIT licensed.
