# @bazimazi/partyframe-client

The React half of a [partyframe](https://github.com/bazimazi/party-frame)
party game: the shared-screen shell (lobby, QR code, player grid, results),
the phone controller shell (setup, ready, spectating, game over), the session
client with reconnection and clock sync, sound cues and a default theme.

```tsx
import { createRoot } from "react-dom/client";
import { PartyApp, addMessages, bindKit, defineWebGame } from "@bazimazi/partyframe-client";
import "@bazimazi/partyframe-client/styles.css";

const tapWeb = defineWebGame<{ taps: Record<string, number> }, { taps: number }, { type: "tap" }>({
  id: "tap",
  Controller: ({ envelope, send }) => (
    <button className="btn btn--primary btn--big btn--block" onClick={() => send({ type: "tap" })}>
      {envelope.game.taps}
    </button>
  ),
  Screen: ({ game, players }) => (
    <ul>{players.map((p) => <li key={p.id}>{p.name}: {game.taps[p.id] ?? 0}</li>)}</ul>
  ),
});

addMessages("en", { "game.tap.name": "Tap Race" });
bindKit({ games: [tapWeb] });
createRoot(document.getElementById("root")!).render(<PartyApp />);
```

Routes: `/` (game picker), `/game` (TV), `/join` and `/join/:code` (phones).
Use `<PartyRoutes />` inside your own router, or the individual route
components, when you need more.

Peers: `react`, `react-dom`, `react-router-dom` (19 / 7). `phaser` is optional
and only loaded when a game provides a `scene`. `fonts.css` is an optional
Google Fonts import.

- [Writing a game](https://github.com/bazimazi/party-frame/blob/main/docs/writing-a-game.md)
- [Theming and i18n](https://github.com/bazimazi/party-frame/blob/main/docs/theming-and-i18n.md)
