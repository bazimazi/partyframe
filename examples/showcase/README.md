# Showcase

Five games, one server, one web bundle. Each game is written to show a
different part of partyframe; together they cover most of what a party game
needs.

| Game | Folder | Shows |
| --- | --- | --- |
| Quiz | `src/games/quiz` | Timed multiple choice, secrets until the reveal, speed scoring, bots with accuracy |
| Doodle | `src/games/doodle` | Phone as a drawing tablet, streamed input with a raised rate limit, turn rotation, text guesses |
| Most Likely To | `src/games/vote` | Social voting and a reveal; the least code a round-based game needs |
| Reflex | `src/games/reflex` | Deadlines in state, a held `STARTING` countdown, private cues and haptics |
| Tap Race | `src/games/tap` | The smallest game, with a Phaser scene on the TV |

```bash
# from the repo root, after npm install
npm run example
```

Open `http://<this-machine>:5173/` on the shared screen and pick a game. Use
the LAN address, not `localhost`, so phones can scan the QR code. If port 2567
is taken, set `PORT` for the server and `VITE_SERVER_PORT` for the web app.

Add bots from the lobby to try a game alone; the developer panel on the TV can
skip phases.

Production shape: `npm run build` here, then `npm start` serves the built app
and the game from one port (`--serve` tells the server to serve `dist/`).

Every game's rules are tested without a server in `tests/`.
