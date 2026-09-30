/**
 * The whole server. `listen()` installs the games, binds the runtime and
 * serves the HTTP + WebSocket surface the web app talks to.
 *
 * In production, build the web app and pass `staticDir` so one process serves
 * the TV, the phones and the game from a single origin:
 *
 *     await listen({ games, defaultGameId: "quiz", staticDir: "dist" });
 */

import { listen } from "@bazimazi/partyframe-server";
import { doodleGame } from "./games/doodle/game.js";
import { quizGame } from "./games/quiz/game.js";
import { reflexGame } from "./games/reflex/game.js";
import { tapGame } from "./games/tap/game.js";
import { voteGame } from "./games/vote/game.js";

// `npm start` (--serve) serves the Vite build from this same port. During
// `npm run dev` Vite serves the app on 5173 and this process only runs the game.
const staticDir = process.env.STATIC_DIR ?? (process.argv.includes("--serve") ? "dist" : undefined);

const server = await listen({
  defaultGameId: "quiz",
  games: [quizGame, doodleGame, voteGame, reflexGame, tapGame],
  staticDir,
});

console.info(
  `partyframe showcase: server on :${server.port} — open http://<this-machine>:${staticDir ? server.port : 5173}/ on the TV`,
);
