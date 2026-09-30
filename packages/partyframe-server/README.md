# @bazimazi/partyframe-server

The authoritative half of a [partyframe](https://github.com/bazimazi/party-frame)
party game: the rules contract, the session server, and a test harness.

```ts
import { defineGame, listen, createTestMatch } from "@bazimazi/partyframe-server";
import { z } from "zod";

export const tapGame = defineGame({
  id: "tap",
  nameKey: "game.tap.name",
  minPlayers: 1,
  maxPlayers: 8,
  actionSchema: z.object({ type: z.literal("tap") }),
  createState: () => ({ taps: {} as Record<string, number>, winnerId: "" }),
  handleAction(ctx, playerId) {
    ctx.state.taps[playerId] = (ctx.state.taps[playerId] ?? 0) + 1;
    if (ctx.state.taps[playerId]! >= 10) ctx.state.winnerId = playerId;
    return true;
  },
  isFinished: (ctx) => Boolean(ctx.state.winnerId),
  getControllerState: (ctx, id) => ({ active: !ctx.state.winnerId, game: { taps: ctx.state.taps[id] ?? 0 } }),
  getPublicState: (ctx) => ctx.state,
});

await listen({ defaultGameId: "tap", games: [tapGame], staticDir: "dist" });
```

```ts
const match = createTestMatch(tapGame, { players: ["ali"] });
match.start();
for (let i = 0; i < 10; i += 1) match.act("ali", { type: "tap" });
match.status; // "GAME_OVER"
```

Sessions, room codes, QR joining, lobby, bots, reconnection, late joiners,
rate limiting and validation are provided. Pair it with
`@bazimazi/partyframe-client` for the React shells.

- [Writing a game](https://github.com/bazimazi/party-frame/blob/main/docs/writing-a-game.md)
- [Testing](https://github.com/bazimazi/party-frame/blob/main/docs/testing.md)
- [Deployment](https://github.com/bazimazi/party-frame/blob/main/docs/deployment.md)

Node 20.11+. ESM only.
