/**
 * Doodle: one phone draws, the others type guesses, the TV shows the picture.
 *
 * This is the game that stretches the framework the most:
 *
 * - The phone is an input device: strokes stream in as batched `path`
 *   actions, so the game raises `actionRateLimit` above the default.
 * - The word is a secret. It appears in the drawer's controller state only,
 *   never in the public projection, until the reveal.
 * - Turns rotate with `nextPlayer`; a drawer who disconnects ends the round
 *   through `onPlayerChanged`.
 * - Free text from phones goes through `textSchema`, so a stray control
 *   character or a novel-length guess never reaches the rules.
 */

import {
  defineGame,
  elapsedFraction,
  hasExpired,
  nextPlayer,
  startDeadline,
  textSchema,
  type Deadline,
  type GameContext,
  type GamePlayer,
  type Rng,
} from "@bazimazi/partyframe-server";
import { z } from "zod";
import { WORDS } from "./words.js";

export type DoodlePhase = "pick" | "draw" | "reveal" | "done";

export interface DoodleOptions {
  rounds: number;
  seconds: number;
}

type Ctx = GameContext<DoodleState, DoodleOptions>;

/** A polyline in a 1000×1000 space: colour index, width, then x,y pairs. */
export interface Stroke {
  c: number;
  w: number;
  p: number[];
}

export interface DoodleState {
  turn: number;
  turns: number;
  phase: DoodlePhase;
  deadline: Deadline | null;
  drawerId: string;
  word: string;
  wordChoices: string[];
  usedWords: string[];
  strokes: Stroke[];
  /** True while the last stroke is still being drawn. */
  open: boolean;
  /** Guessers who got it, with the points they earned. */
  correct: Record<string, number>;
  /** Last few wrong guesses, for the TV's feed. */
  recent: Array<{ playerId: string; text: string }>;
  drawSeconds: number;
}

export interface DoodleControllerState {
  phase: DoodlePhase;
  turn: number;
  turns: number;
  role: "drawer" | "guesser";
  drawerName: string;
  /** The drawer's word. Absent for everyone else until the reveal. */
  word: string | null;
  wordChoices: string[];
  /** Masked word for guessers, e.g. "_ _ _   _ _ _". */
  hint: string;
  guessed: boolean;
  points: number;
  deadline: Deadline | null;
  lastGuess: { text: string; correct: boolean } | null;
  strokeCount: number;
}

export interface DoodlePublicState {
  phase: DoodlePhase;
  turn: number;
  turns: number;
  drawerId: string;
  strokes: Stroke[];
  deadline: Deadline | null;
  hint: string;
  guessedIds: string[];
  recent: Array<{ playerId: string; text: string }>;
  roundPoints: Record<string, number>;
}

export const PALETTE = ["#0b0913", "#ff5d5d", "#ffb020", "#54d66a", "#5b8cff", "#b579ff"] as const;
export const WIDTHS = [6, 14, 26] as const;
export const CANVAS_SIZE = 1000;

export const DoodleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pick"), index: z.number().int().min(0).max(2) }),
  z.object({
    type: z.literal("path"),
    color: z
      .number()
      .int()
      .min(0)
      .max(PALETTE.length - 1),
    width: z
      .number()
      .int()
      .min(0)
      .max(WIDTHS.length - 1),
    /** x,y pairs; a batch is at most 32 points. Empty with `end` just closes the stroke. */
    points: z
      .array(z.number().int().min(0).max(CANVAS_SIZE))
      .max(64)
      .refine((p) => p.length % 2 === 0),
    end: z.boolean(),
  }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("clear") }),
  z.object({ type: z.literal("guess"), text: textSchema(30) }),
]);
export type DoodleAction = z.infer<typeof DoodleActionSchema>;

const PICK_MS = 12_000;
const REVEAL_MS = 4000;
const MAX_STROKES = 400;
const GUESS_POINTS = 100;
const GUESS_SPEED_BONUS = 100;
const DRAWER_POINTS_PER_GUESS = 40;

export const doodleGame = defineGame({
  id: "doodle",
  nameKey: "game.doodle.name",
  minPlayers: 2,
  maxPlayers: 8,
  actionRateLimit: { capacity: 40, refillPerSecond: 20 },
  options: {
    rounds: { type: "number", labelKey: "game.doodle.option.rounds", default: 6, min: 2, max: 16 },
    seconds: {
      type: "number",
      labelKey: "game.doodle.option.seconds",
      default: 60,
      min: 20,
      max: 120,
      step: 10,
    },
  },
  actionSchema: DoodleActionSchema,

  createState: (options): DoodleState => ({
    turn: 0,
    turns: options.rounds,
    phase: "done",
    deadline: null,
    drawerId: "",
    word: "",
    wordChoices: [],
    usedWords: [],
    strokes: [],
    open: false,
    correct: {},
    recent: [],
    drawSeconds: options.seconds,
  }),

  start(ctx) {
    beginTurn(ctx, null);
    ctx.requestStatus("PLAYING");
  },

  update(ctx) {
    const { state } = ctx;
    if (!hasExpired(state.deadline, ctx.now)) return;
    switch (state.phase) {
      case "pick":
        chooseWord(ctx, 0);
        return;
      case "draw":
        endTurn(ctx);
        return;
      case "reveal":
        if (state.turn >= state.turns) {
          state.phase = "done";
          state.deadline = null;
        } else {
          beginTurn(ctx, state.drawerId);
        }
        return;
      case "done":
        return;
    }
  },

  handleAction(ctx, playerId, action) {
    const { state } = ctx;
    const isDrawer = playerId === state.drawerId;

    switch (action.type) {
      case "pick": {
        if (state.phase !== "pick" || !isDrawer) return false;
        chooseWord(ctx, action.index);
        return true;
      }
      case "path": {
        if (state.phase !== "draw" || !isDrawer) return false;
        if (action.points.length === 0) {
          state.open = state.open && !action.end;
          return true;
        }
        const last = state.strokes[state.strokes.length - 1];
        if (state.open && last && last.c === action.color && last.w === action.width) {
          last.p.push(...action.points);
        } else {
          if (state.strokes.length >= MAX_STROKES) return false;
          state.strokes.push({ c: action.color, w: action.width, p: [...action.points] });
        }
        state.open = !action.end;
        return true;
      }
      case "undo": {
        if (state.phase !== "draw" || !isDrawer) return false;
        state.strokes.pop();
        state.open = false;
        return true;
      }
      case "clear": {
        if (state.phase !== "draw" || !isDrawer) return false;
        state.strokes = [];
        state.open = false;
        return true;
      }
      case "guess": {
        if (state.phase !== "draw" || isDrawer || state.correct[playerId] !== undefined)
          return false;
        if (normalize(action.text) === normalize(state.word)) {
          const speed = 1 - elapsedFraction(state.deadline, ctx.now);
          const points = GUESS_POINTS + Math.round(GUESS_SPEED_BONUS * speed);
          state.correct[playerId] = points;
          ctx.players.addScore(playerId, points);
          ctx.players.addScore(state.drawerId, DRAWER_POINTS_PER_GUESS);
          ctx.emitTo(playerId, { kind: "doodle-correct", params: { points } });
          ctx.emit({
            kind: "doodle-guessed",
            messageKey: "game.doodle.event.guessed",
            params: { name: ctx.players.get(playerId)?.name ?? "" },
            playerId,
          });
          const waiting = ctx.players
            .connected()
            .filter(
              (player) => player.id !== state.drawerId && state.correct[player.id] === undefined,
            );
          if (waiting.length === 0) endTurn(ctx);
        } else {
          state.recent = [...state.recent, { playerId, text: action.text }].slice(-6);
          ctx.emitTo(playerId, { kind: "doodle-wrong" });
        }
        return true;
      }
    }
  },

  onPlayerChanged(ctx, playerId, change) {
    // A drawer who vanishes mid-picture ends the round; nobody wants to
    // stare at a half-drawn cat for a minute.
    if (playerId !== ctx.state.drawerId) return;
    if (
      (change === "left" || change === "disconnected") &&
      (ctx.state.phase === "draw" || ctx.state.phase === "pick")
    ) {
      if (ctx.state.phase === "pick") chooseWord(ctx, 0);
      endTurn(ctx);
    }
  },

  isFinished: (ctx) => ctx.state.phase === "done",

  getControllerState: (ctx, playerId) => {
    const { state } = ctx;
    const isDrawer = playerId === state.drawerId;
    const revealed = state.phase === "reveal";
    return {
      active:
        (state.phase === "draw" && (isDrawer || state.correct[playerId] === undefined)) ||
        (state.phase === "pick" && isDrawer),
      game: {
        phase: state.phase,
        turn: state.turn,
        turns: state.turns,
        role: isDrawer ? "drawer" : "guesser",
        drawerName: ctx.players.get(state.drawerId)?.name ?? "",
        word: isDrawer || revealed ? state.word || null : null,
        wordChoices: isDrawer && state.phase === "pick" ? state.wordChoices : [],
        hint: revealed ? state.word : mask(state.word),
        guessed: state.correct[playerId] !== undefined,
        points: state.correct[playerId] ?? 0,
        deadline: state.deadline,
        lastGuess: lastGuessOf(state, playerId),
        strokeCount: state.strokes.length,
      } satisfies DoodleControllerState,
    };
  },

  getPublicState: (ctx): DoodlePublicState => {
    const { state } = ctx;
    return {
      phase: state.phase,
      turn: state.turn,
      turns: state.turns,
      drawerId: state.drawerId,
      strokes: state.strokes,
      deadline: state.deadline,
      hint: state.phase === "reveal" ? state.word : mask(state.word),
      guessedIds: Object.keys(state.correct),
      recent: state.recent,
      roundPoints: { ...state.correct },
    };
  },

  createBot(difficulty) {
    const accuracy = difficulty === "easy" ? 0.3 : difficulty === "hard" ? 0.8 : 0.55;
    const think =
      difficulty === "easy" ? [6000, 12000] : difficulty === "hard" ? [2500, 6000] : [4000, 9000];
    return {
      difficulty,
      decide: (ctx, botId) => {
        const { state } = ctx;
        if (botId === state.drawerId) {
          if (state.phase === "pick")
            return { action: { type: "pick" as const, index: 0 }, delayMs: 800 };
          if (state.phase === "draw" && state.strokes.length < 8) {
            return { action: scribble(ctx.rng, state.strokes.length), delayMs: 700 };
          }
          return null;
        }
        if (state.phase !== "draw" || state.correct[botId] !== undefined) return null;
        const text = ctx.rng.chance(accuracy) ? state.word : ctx.rng.pick(WORDS);
        return {
          action: { type: "guess" as const, text },
          delayMs: ctx.rng.int(think[0]!, think[1]!),
        };
      },
    };
  },

  devCommands: {
    "end-turn": (ctx) => {
      if (ctx.state.phase === "pick") chooseWord(ctx, 0);
      if (ctx.state.phase === "draw") endTurn(ctx);
    },
    "end-game": (ctx) => {
      ctx.state.phase = "done";
      ctx.state.deadline = null;
    },
  },
});

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function mask(word: string): string {
  return word
    .split("")
    .map((char) => (char === " " ? " " : "_"))
    .join(" ");
}

function lastGuessOf(state: DoodleState, playerId: string): DoodleControllerState["lastGuess"] {
  if (state.correct[playerId] !== undefined) return { text: state.word, correct: true };
  const wrong = [...state.recent].reverse().find((guess) => guess.playerId === playerId);
  return wrong ? { text: wrong.text, correct: false } : null;
}

function beginTurn(ctx: Ctx, previousDrawerId: string | null): void {
  const { state } = ctx;
  const drawer = nextPlayer(
    ctx.players.all(),
    previousDrawerId,
    (player: GamePlayer) => player.connected,
  );
  state.turn += 1;
  state.phase = "pick";
  state.deadline = startDeadline(ctx.now, PICK_MS);
  state.drawerId = drawer?.id ?? "";
  state.word = "";
  state.strokes = [];
  state.open = false;
  state.correct = {};
  state.recent = [];

  const fresh = WORDS.filter((word) => !state.usedWords.includes(word));
  const pool = fresh.length >= 3 ? fresh : WORDS;
  state.wordChoices = ctx.rng.shuffle(pool).slice(0, 3);

  ctx.emit({
    kind: "doodle-turn",
    messageKey: "game.doodle.event.turn",
    params: { name: drawer?.name ?? "" },
    ...(drawer ? { playerId: drawer.id } : {}),
  });
}

function chooseWord(ctx: Ctx, index: number): void {
  const { state } = ctx;
  state.word = state.wordChoices[index] ?? state.wordChoices[0] ?? "cat";
  state.usedWords.push(state.word);
  state.phase = "draw";
  state.deadline = startDeadline(ctx.now, state.drawSeconds * 1000);
  ctx.emit({ kind: "doodle-draw" });
}

function endTurn(ctx: Ctx): void {
  const { state } = ctx;
  state.phase = "reveal";
  state.open = false;
  state.deadline = startDeadline(ctx.now, REVEAL_MS);
  ctx.emit({
    kind: "doodle-reveal",
    messageKey: "game.doodle.event.reveal",
    params: { word: state.word, count: Object.keys(state.correct).length },
  });
}

/** A bot's "drawing": a rough circle, then a few sticks. Art is not the point. */
function scribble(rng: Rng, index: number): DoodleAction {
  const cx = rng.int(300, 700);
  const cy = rng.int(300, 700);
  const points: number[] = [];
  if (index === 0) {
    const r = rng.int(120, 260);
    for (let i = 0; i <= 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      points.push(Math.round(cx + Math.cos(angle) * r), Math.round(cy + Math.sin(angle) * r));
    }
  } else {
    points.push(cx, cy, rng.int(100, 900), rng.int(100, 900));
  }
  return { type: "path", color: rng.int(0, PALETTE.length - 1), width: 1, points, end: true };
}
