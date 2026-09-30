# Architecture

## Packages

```
packages/
  protocol           wire contract: constants, message schemas, session types, option fields
  game-core          PartyGame contract, MatchEngine, test harness, rng, timing/roster helpers
  i18n               translator, English dictionary, locale registry
  partyframe-server  Colyseus room, adapters, listen(), rate limits, room codes   (published)
  partyframe-client  React shells, session client, clock sync, sounds, styles     (published)
```

The three private packages are inlined into the two published ones at build
time (tsup), so consumers install exactly two packages and never see
`@partyframe/*`. `scripts/verify-pack.mjs` installs the packed tarballs into
an empty project and boots them, and CI runs it on every push.

## Authority model

The server is the only place state changes. Clients send **intentions** on
two channels:

- `session-action` - platform-level: profile, ready, start, rematch, settings,
  kick, leave, dev commands. Identical for every game. Each variant is
  authorised against the sender's role and the session status.
- `game-action` - opaque to the platform, validated by the game's
  `actionSchema`, applied by `handleAction`.

What comes back is derived state:

- The **session schema** (Colyseus state sync): status, players, settings,
  winners and the game's public projection, which travels as JSON in
  `gameJson` by default. Only changed projections produce a patch.
- `controller-state` - one envelope per phone: `{ mode, gameId, active, score,
  game, revision }`. Sent whenever it changes for that phone.
- `game-event` - presentation cues, broadcast or targeted.
- `welcome`, `error`, `clock-pong`.

## The room and the engine

`PartySessionRoom` owns everything social: the room code, seats, profiles,
name and colour uniqueness, host election, bots, reconnection windows, rate
limits, late-join policy, expiry. It delegates everything about the match to a
`MatchEngine`:

```
Room ── owns ──► MatchEngine ── calls ──► PartyGame
 seats, status,     state, options, rng,     rules
 settings, clients  event queue, bots,
                    status requests,
                    finished check
```

The engine needs only an `EngineHost` (roster, status get/set, event
delivery, error reporting). The room implements it over Colyseus; the test
harness implements it in memory. This is what guarantees a game behaves the
same under test and in a living room.

After every engine step the room re-projects: `getPublicState` is serialised
and compared to the last projection; if it changed, the adapter writes it to
the schema and bumps `gameRevision`. Then each connected phone's envelope is
rebuilt and sent if it changed. Ticks run every 100 ms.

## Session lifecycle

```
create (TV)            ──► LOBBY      players scan in, host tweaks settings
start / rematch        ──► STARTING   fresh state, start(ctx)
                       ──► PLAYING    actions accepted, update() ticks
requestStatus          ◄─► ROUND_END  optional, game-driven
isFinished true        ──► GAME_OVER  winners recorded, wins += 1
return-to-lobby        ──► LOBBY      scores cleared
idle timeout / max age ──► CLOSED     clients disconnected with 4002
```

A session is created when a shared screen connects with `role: "host"`. The
first phone to submit a profile becomes the **host player** and may start,
rematch, change settings and kick from their phone; if they leave, the
longest-seated human inherits it. The TV always has these powers.

## Joining and identity

Room codes are four characters from an alphabet without look-alikes
(`ACDEFGHJKMNPQRTUVWXY34679`), drawn from a CSPRNG and checked for uniqueness.
A phone resolves a code with `GET /api/rooms/:code`, which reports whether the
room is joinable, then joins the Colyseus room by id.

A seat is reserved when the socket opens and hidden until the phone submits a
profile. Names are made unique ("Ali", "Ali 2") and a colour someone else
already holds is swapped for a free one, so two players never look alike on
the TV.

## Reconnection

- **Phones** keep their seat for 90 s after a drop. The client stores its
  reconnection token in `localStorage` (keyed by role and room code) and
  resumes on reload or when the network returns, with front-loaded backoff.
  If the seat is gone it rejoins as a new player.
- **The shared screen** keeps its session for 180 s. The TV page writes
  `?room=CODE` into its URL, so a reload resumes with its token; if the token
  is stale it re-attaches to the session by code as a replacement host; only
  if the session is gone does it create a new one. A second TV cannot attach
  while the first is online.
- **Late joiners** during a match become spectators (unless the game says
  otherwise) and play the next match.

## Time

The server publishes deadlines as epoch milliseconds. Phones and TVs measure
their offset with NTP-style probes over `clock-ping`/`clock-pong` (five quick
probes on connect, then every 10 s) and keep the median, so a countdown on a
phone with a skewed clock still ends when the server says it does. Everything
timed on screen is interpolated from that; the server remains the judge.

## Defences

- Payloads are validated with Zod on the platform channel and with the game's
  Standard Schema on the game channel. Oversized payloads are dropped.
- Per-client token buckets on game actions, session actions and clock pings;
  a per-address bucket on room lookups (the request a code guesser would
  hammer); a cap on live sessions.
- Display names are stripped of control, zero-width and bidi-override
  characters so a name cannot spoof another on the TV.
- Kicking targets seated phones only; a phone host can never disconnect the
  TV. Host powers are re-checked server-side on every message.
- Developer commands and the latency endpoint are refused unless dev tools are
  enabled, which the runtime never does when `NODE_ENV=production`.
- A game that throws is isolated: logged with context, the sender told, the
  session kept alive.

## Scaling notes

Sessions are in memory and one process serves them; that is the right shape
for parties (a session is eight phones and one TV) and for a modest public
host (hundreds of sessions on a small VM). Horizontal scaling would need the
Colyseus presence/driver backends and a shared session directory for the code
lookup - both possible, neither wired up here.
