# Writing a game

A partyframe game has two halves that never import each other:

- **Rules** - a `PartyGame` object, defined with `defineGame()` from
  `@bazimazi/partyframe-server`. Plain TypeScript: no sockets, no DOM, no
  Colyseus. Runs on the server and in the test harness.
- **Web** - a `WebGame` object, defined with `defineWebGame()` from
  `@bazimazi/partyframe-client`. A React panel for phones and a React `Screen`
  or a Phaser `scene` for the shared screen.

They meet through three projections you control: the action a phone sends,
the controller state a phone receives, and the public state the TV receives.

## The rules contract

```ts
const game = defineGame({
  id: "reflex",                  // stable id, used in URLs and message routing
  nameKey: "game.reflex.name",   // i18n key; register the string with addMessages()
  minPlayers: 1,
  maxPlayers: 8,
  lateJoin: "spectate",          // "spectate" (default) | "play" | "deny"
  options: { ... },              // host-configurable, see below
  actionSchema: z.object(...),   // validates every game-action payload
  createState: (options) => ({ ... }),
  start(ctx) { ... },            // optional
  update(ctx, deltaMs) { ... },  // optional, every 100 ms while running
  handleAction(ctx, playerId, action) { ...; return true; },
  isFinished: (ctx) => ...,
  onPlayerChanged(ctx, playerId, change) { ... }, // optional
  getControllerState: (ctx, playerId) => ({ active, game }),
  getPublicState: (ctx) => ({ ... }),
  getWinners: (ctx) => [...],    // optional; default = top scorers
  createBot: (difficulty) => ({ difficulty, decide }), // optional
  devCommands: { "skip-round": (ctx) => { ... } },     // optional
});
```

### State

`createState(options)` returns a plain object: the single source of truth for
a match. Keep it JSON-serialisable and mutate it freely inside rule functions;
the platform never copies it. Store **timestamps, not timers** (see
[Timing](#timing)) so a match is reproducible.

### The context

Every rule function receives a `GameContext`:

| Field | Meaning |
| --- | --- |
| `ctx.state` | Your state object |
| `ctx.options` | Parsed host options, typed from `options` |
| `ctx.players` | The match roster: `all()`, `get(id)`, `has(id)`, `connected()`, `ranked()`, `addScore()`, `setScore()` |
| `ctx.rng` | Seeded randomness: `next()`, `int(min, max)`, `float()`, `chance(p)`, `pick(list)`, `shuffle(list)`. Never use `Math.random` |
| `ctx.now` | Server time in epoch ms, fixed for the duration of the call |
| `ctx.emit(event)` | Queues a presentation cue for every screen |
| `ctx.emitTo(playerId, event)` | Queues a cue for one phone only |
| `ctx.requestStatus(status)` | Asks to move to `STARTING`, `PLAYING`, `ROUND_END` or `GAME_OVER` |

Scores live on the roster, not in your state, so the lobby, the results screen
and rematches work the same for every game. A player's `score` resets each
match; `wins` accumulates across the session.

### Lifecycle

```
LOBBY ──start──► STARTING ──► PLAYING ◄──► ROUND_END ──► GAME_OVER ──rematch──► STARTING
                                                              │
                                                              └──return-to-lobby──► LOBBY
```

1. The host presses **Start**. The platform checks `minPlayers`, resets scores,
   creates fresh state and calls `start(ctx)` while the status is `STARTING`.
2. If `start` requests nothing, the match moves to `PLAYING` immediately. Call
   `ctx.requestStatus("STARTING")` to hold a countdown and request `PLAYING`
   later from `update()`.
3. While `STARTING`, `PLAYING` or `ROUND_END`, `update(ctx, deltaMs)` runs
   every server tick (100 ms) and actions are accepted.
4. After **every** action and tick the platform calls `isFinished(ctx)`. When it
   returns true the match ends: winners are computed, `wins` are recorded, a
   `game-ended` cue is emitted and phones switch to the results mode.
5. **Rematch** starts again with the same seats. **Back to lobby** also clears
   scores and lets the host change settings.

A game may move between the running statuses; it cannot return to the lobby or
close the session - those are host actions.

### Actions

`actionSchema` is any [Standard Schema](https://standardschema.dev) validator
(Zod, Valibot, ArkType, or a hand-written one). The platform runs it on every
payload before `handleAction` sees it, so your rules only ever receive the
type it declares.

For free text a phone types - guesses, captions - use `textSchema(maxLength)`
as the field's schema. It strips control and zero-width characters and
collapses whitespace, the same way player names are cleaned, so what reaches
the rules is safe to show on the TV.

Each phone may send 8 actions in a burst and 4 per second sustained, which is
plenty for buttons. A game that streams input - drawing strokes, a tilt
sensor - raises its budget with `actionRateLimit: { capacity: 40,
refillPerSecond: 20 }` and batches on the phone (the Doodle example sends a
stroke every 70 ms or 24 points, whichever comes first).

`handleAction` returns:

- `true` - applied. The phone gets its new controller state right away.
- `false` - well formed but not legal now (wrong turn, wrong phase, duplicate).
  The sender receives a `WRONG_STATE` error it can show or ignore.

Throwing is treated as a bug: it is logged with context, the sender gets
`INTERNAL`, and the match continues with whatever state you left behind. In
the test harness a throw fails the test instead.

### Options

Declare the knobs a host may turn and the platform renders lobby controls,
validates input and types `ctx.options`:

```ts
options: {
  rounds: { type: "number", labelKey: "game.quiz.rounds", default: 5, min: 1, max: 20, step: 1 },
  chaos:  { type: "boolean", labelKey: "game.quiz.chaos", default: false },
  mode:   { type: "select", labelKey: "game.quiz.mode", default: "classic",
            choices: ["classic", "speed"] as const },
}
```

Declare select choices `as const` so `ctx.options.mode` is `"classic" | "speed"`
rather than `string`. Choice labels are looked up as `${labelKey}.${value}`
unless a choice supplies its own `labelKey`.

Input is clamped and defaulted rather than rejected: a value outside `min`/`max`
is clamped, a wrong type falls back to the default, unknown keys are dropped.
Supply `parseOptions(raw)` instead when you need custom validation; its return
type then becomes `ctx.options`.

### Projections

- `getPublicState(ctx)` is broadcast to the shared screen whenever it changes.
  Return only what the TV needs to draw; it is serialised as JSON, and its
  size is what every state change costs on the wire.
- `getControllerState(ctx, playerId)` is sent to one phone whenever it changes
  for that phone. `active: false` disables the phone's panel (eliminated,
  waiting). Put secrets here (a player's hand, their role), never in the public
  state.

Both are recomputed after every action and tick and diffed, so an unchanged
projection sends nothing.

### Events

Events are presentation cues - sounds, feed lines, animations - and never a
substitute for state. A dropped event must not break anything.

```ts
ctx.emit({ kind: "bomb-exploded", messageKey: "game.bomb.exploded", params: { name }, playerId });
ctx.emitTo(playerId, { kind: "answer-rejected" });
```

`messageKey` makes the cue appear in the TV's text feed. Map `kind` to a sound
with `WebGame.sfx`. The platform emits `player-joined`, `player-left`,
`player-disconnected`, `player-reconnected`, `game-started` and `game-ended`
itself; games may listen for them but not emit them.

### Players joining and leaving

`onPlayerChanged(ctx, playerId, change)` is called with `"joined"`, `"left"`,
`"disconnected"` or `"reconnected"` - only for players in the current match.
Use it to skip a disconnected player's turn or drop them from a round. A
disconnected player keeps their seat for 90 seconds; `ctx.players.connected()`
excludes them meanwhile.

`lateJoin` decides what happens to someone who scans in mid-match:

- `"spectate"` (default) - they see "a match is in progress" and join the next one.
- `"play"` - they enter immediately and `onPlayerChanged` fires with `"joined"`.
- `"deny"` - the join is refused with `GAME_IN_PROGRESS`.

### Winners

By default everyone sharing the top score wins, and nobody wins when no one
scored. Override `getWinners(ctx)` for games where score is not the measure
(last one standing, most votes). Return several ids for a tie, `[]` for no
winner.

### Bots

`createBot(difficulty)` returns a strategy whose `decide(ctx, botId)` is called
every tick while the bot has no pending action. Return `{ action, delayMs }` or
`null`. The action goes through the same validation and `handleAction` as a
phone's, so bots cannot cheat and need no special rules. Omit `createBot` and
the lobby offers no bots.

### Dev commands

`devCommands` are shortcuts for testing - skip a round, force a phase. They
appear as buttons in the TV's developer panel and are refused by the server in
production.

## Timing

Never use timers in rules. Store deadlines as server timestamps and check them
in `update()`:

```ts
import { startDeadline, hasExpired, remainingMs } from "@bazimazi/partyframe-server";

start(ctx) {
  ctx.state.roundEnds = startDeadline(ctx.now, 30_000);
},
update(ctx) {
  if (hasExpired(ctx.state.roundEnds, ctx.now)) endRound(ctx);
},
```

Put the deadline in the public and controller state and phones can animate it
locally with `<FuseBar startedAt endsAt serverNow />`, using the synchronised
clock. `elapsedFraction()` and `remainingMs()` do the arithmetic.

Roster helpers: `rankPlayers()`, `topScorers()` and `nextPlayer(players,
currentId, eligible)` for turn order that wraps and skips.

## The web contract

```tsx
const web = defineWebGame<Public, Controller, Action>({
  id: "reflex",
  Controller: ReflexController,      // React, on phones
  Screen: ReflexScreen,              // React, on the TV - or:
  scene: () => import("./scene.js").then((m) => m.ReflexScene), // Phaser
  normalizePublicState: (raw) => raw as Public, // optional
  activePlayerId: (game) => game.turnPlayerId,  // highlights a player card
  eliminatedIds: (game) => new Set(game.out),   // dims player cards
  badges: (game) => ({ [id]: { text: "3 ❤", tone: "good" } }),
  round: (game) => game.round,                  // shown in the top bar
  sfx: { "reflex-go": "start", "reflex-round-won": "score" },
  hiddenEventKinds: ["reflex-tick"],            // keep canvas cues out of the feed
});
```

### Controller

```tsx
function ReflexController({ envelope, send, serverNow, me, players, events, t }: ControllerPanelProps<Controller, Action>) {
  return <button disabled={!envelope.active} onClick={() => send({ type: "press" })}>...</button>;
}
```

`envelope.game` is your controller projection, typed. `events` are recent cues
including private ones; react to new entries by index or `at`. `haptic()` and
`sfx` are available for feedback. Keep panels big-thumbed: the phone is a
controller, not a second screen.

### Screen (React)

```tsx
function ReflexScreen({ game, players, events, serverNow, playSound, t }: ScreenProps<Public>) { ... }
```

Renders inside the stage area with the player grid and event feed beside it.
`players` are the match participants in seat order.

### Scene (Phaser)

Provide `scene` instead of `Screen` for canvas games. It is loaded with
`import()` so Phaser never reaches the phone bundle. The scene receives a
`StageBridge` in `init`: read `bridge.game`, `bridge.players`, drain
`bridge.pendingEvents` with `drainEvents(bridge)` every frame, and call
`bridge.playSound(voice)`. React never drives the canvas.

### UI kit

The client package ships components that most party games need, styled to
match the shells and the theme variables:

| Component | Use |
| --- | --- |
| `<Countdown endsAt serverNow />` | Big digits to a server deadline; re-renders once per second |
| `<FuseBar startedAt endsAt serverNow />` | A shrinking bar, animated off the React render path |
| `<Scoreboard players deltas highlightIds />` | Ranked list with "+n" round deltas and win tallies |
| `<ChoiceGrid choices selectedId onSelect />` | Big thumb-sized multiple-choice tiles for phones |
| `<TextEntry onSubmit submitLabel />` | One-line answer box that sanitises and refocuses |
| `<Confetti active />` | A burst on the TV; the results screen uses it for winners |
| `<PlayerAvatar player />`, `<PlayerGrid players />` | The same cards the lobby draws |

### Registering

```ts
addMessages("en", { "game.reflex.name": "Reflex", ... });
bindKit({ games: [reflexWeb, tapWeb] });
```

`bindKit` must run before any route mounts. Games that ship their own
translations can call `addMessages` for locales the host app has not
registered yet; the strings are kept and merged when the locale appears.

## Checklist for a good party game

- Every random decision uses `ctx.rng`, so tests can replay it.
- Every deadline is a timestamp in state, so a late phone catches up.
- Secrets go in `getControllerState`, never `getPublicState`.
- `handleAction` returns `false` for out-of-turn input instead of ignoring it.
- The phone panel works with one thumb and never requires reading the phone.
- `lateJoin` is chosen deliberately.
- A `createTestMatch` test plays a full match.
