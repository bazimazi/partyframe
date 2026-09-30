/**
 * The whole web app: register strings, bind the game catalog, render the shell.
 */

import { createRoot } from "react-dom/client";
import { addMessages, bindKit, PartyApp } from "@bazimazi/partyframe-client";
import "@bazimazi/partyframe-client/styles.css";
import "@bazimazi/partyframe-client/fonts.css";
import "./games/games.css";
import { doodleWeb } from "./games/doodle/web.js";
import { quizWeb } from "./games/quiz/web.js";
import { reflexWeb } from "./games/reflex/web.js";
import { tapWeb } from "./games/tap/web.js";
import { voteWeb } from "./games/vote/web.js";
import { en } from "./i18n/en.js";

addMessages("en", en);
bindKit({ games: [quizWeb, doodleWeb, voteWeb, reflexWeb, tapWeb] });

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<PartyApp />);
