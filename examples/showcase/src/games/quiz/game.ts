/**
 * Quiz: multiple choice on the TV, answers on the phones, faster is better.
 *
 * Shows two things every quiz-like game needs. First, secrets: the correct
 * answer is never in the public or controller projection until the reveal, so
 * a curious player reading the network cannot cheat. Second, speed scoring
 * from server timestamps, so a phone with a slow clock is judged by when the
 * server received the answer, not by what its screen showed.
 */

import {
  defineGame,
  elapsedFraction,
  hasExpired,
  startDeadline,
  type Deadline,
  type GameContext,
} from "@bazimazi/partyframe-server";
import { z } from "zod";
import { QUESTIONS, type QuizQuestion } from "./questions.js";

export type QuizPhase = "ask" | "reveal" | "done";

export interface QuizOptions {
  rounds: number;
  seconds: number;
}

type Ctx = GameContext<QuizState, QuizOptions>;

export interface QuizState {
  questions: QuizQuestion[];
  round: number;
  rounds: number;
  phase: QuizPhase;
  deadline: Deadline | null;
  /** Choice index and server time per player for the current question. */
  answers: Record<string, { choice: number; at: number }>;
  /** Points earned on the current question, filled at reveal. */
  roundPoints: Record<string, number>;
  secondsPerQuestion: number;
}

export interface QuizControllerState {
  phase: QuizPhase;
  round: number;
  rounds: number;
  choices: string[];
  myChoice: number | null;
  /** Only during reveal. */
  correct: number | null;
  points: number;
}

export interface QuizPublicState {
  phase: QuizPhase;
  round: number;
  rounds: number;
  question: string;
  choices: string[];
  deadline: Deadline | null;
  answeredIds: string[];
  /** Only during reveal: the right answer, who chose what and what they earned. */
  correct: number | null;
  picks: Record<string, number>;
  roundPoints: Record<string, number>;
}

export const QuizActionSchema = z.object({
  type: z.literal("answer"),
  choice: z.number().int().min(0).max(3),
});
export type QuizAction = z.infer<typeof QuizActionSchema>;

const REVEAL_MS = 4000;
const BASE_POINTS = 100;
const SPEED_BONUS = 100;

export const quizGame = defineGame({
  id: "quiz",
  nameKey: "game.quiz.name",
  minPlayers: 1,
  maxPlayers: 8,
  options: {
    rounds: { type: "number", labelKey: "game.quiz.option.rounds", default: 8, min: 3, max: 20 },
    seconds: { type: "number", labelKey: "game.quiz.option.seconds", default: 12, min: 5, max: 30 },
  },
  actionSchema: QuizActionSchema,

  createState: (options): QuizState => ({
    questions: [],
    round: 0,
    rounds: options.rounds,
    phase: "done",
    deadline: null,
    answers: {},
    roundPoints: {},
    secondsPerQuestion: options.seconds,
  }),

  start(ctx) {
    const { state } = ctx;
    state.questions = ctx.rng.shuffle(QUESTIONS).slice(0, state.rounds);
    state.rounds = state.questions.length;
    askNext(ctx.state, ctx.now);
    ctx.requestStatus("PLAYING");
  },

  update(ctx) {
    const { state } = ctx;
    if (!hasExpired(state.deadline, ctx.now)) return;
    if (state.phase === "ask") reveal(ctx);
    else if (state.phase === "reveal") {
      if (state.round >= state.rounds) {
        state.phase = "done";
        state.deadline = null;
      } else {
        askNext(state, ctx.now);
      }
    }
  },

  handleAction(ctx, playerId, action) {
    const { state } = ctx;
    if (state.phase !== "ask" || state.answers[playerId]) return false;
    state.answers[playerId] = { choice: action.choice, at: ctx.now };
    ctx.emitTo(playerId, { kind: "quiz-locked" });

    const waiting = ctx.players.connected().filter((player) => !state.answers[player.id]);
    if (waiting.length === 0) reveal(ctx);
    return true;
  },

  isFinished: (ctx) => ctx.state.phase === "done",

  getControllerState: (ctx, playerId) => {
    const { state } = ctx;
    const question = state.questions[state.round - 1];
    return {
      active: state.phase === "ask" && !state.answers[playerId],
      game: {
        phase: state.phase,
        round: state.round,
        rounds: state.rounds,
        choices: question ? [...question.choices] : [],
        myChoice: state.answers[playerId]?.choice ?? null,
        correct: state.phase === "reveal" && question ? question.answer : null,
        points: state.roundPoints[playerId] ?? 0,
      } satisfies QuizControllerState,
    };
  },

  getPublicState: (ctx): QuizPublicState => {
    const { state } = ctx;
    const question = state.questions[state.round - 1];
    const revealed = state.phase === "reveal";
    return {
      phase: state.phase,
      round: state.round,
      rounds: state.rounds,
      question: question?.text ?? "",
      choices: question ? [...question.choices] : [],
      deadline: state.deadline,
      answeredIds: Object.keys(state.answers),
      correct: revealed && question ? question.answer : null,
      picks: revealed
        ? Object.fromEntries(
            Object.entries(state.answers).map(([id, answer]) => [id, answer.choice]),
          )
        : {},
      roundPoints: revealed ? { ...state.roundPoints } : {},
    };
  },

  createBot(difficulty) {
    const accuracy = difficulty === "easy" ? 0.4 : difficulty === "hard" ? 0.9 : 0.65;
    const think =
      difficulty === "easy" ? [2500, 6000] : difficulty === "hard" ? [800, 2500] : [1500, 4000];
    return {
      difficulty,
      decide: (ctx, botId) => {
        const { state } = ctx;
        if (state.phase !== "ask" || state.answers[botId]) return null;
        const question = state.questions[state.round - 1];
        if (!question) return null;
        const correct = ctx.rng.chance(accuracy);
        const wrong = [0, 1, 2, 3].filter((index) => index !== question.answer);
        const choice = correct ? question.answer : ctx.rng.pick(wrong);
        return {
          action: { type: "answer" as const, choice },
          delayMs: ctx.rng.int(think[0]!, think[1]!),
        };
      },
    };
  },

  devCommands: {
    "reveal-now": (ctx) => {
      if (ctx.state.phase === "ask") ctx.state.deadline = startDeadline(ctx.now, 0);
    },
    "end-game": (ctx) => {
      ctx.state.phase = "done";
      ctx.state.deadline = null;
    },
  },
});

function askNext(state: QuizState, now: number): void {
  state.round += 1;
  state.phase = "ask";
  state.deadline = startDeadline(now, state.secondsPerQuestion * 1000);
  state.answers = {};
  state.roundPoints = {};
}

/** Scores the question: a flat award for being right plus a bonus for speed. */
function reveal(ctx: Ctx): void {
  const { state } = ctx;
  const question = state.questions[state.round - 1];
  if (!question) return;

  for (const [playerId, answer] of Object.entries(state.answers)) {
    if (answer.choice !== question.answer) continue;
    const speed = 1 - elapsedFraction(state.deadline, answer.at);
    const points = BASE_POINTS + Math.round(SPEED_BONUS * speed);
    state.roundPoints[playerId] = points;
    ctx.players.addScore(playerId, points);
    ctx.emitTo(playerId, { kind: "quiz-correct", params: { points } });
  }

  const best = Object.entries(state.roundPoints).sort((a, b) => b[1] - a[1])[0];
  ctx.emit({
    kind: "quiz-reveal",
    messageKey: best ? "game.quiz.event.fastest" : "game.quiz.event.nobody",
    params: best ? { name: ctx.players.get(best[0])?.name ?? "", points: best[1] } : {},
    ...(best ? { playerId: best[0] } : {}),
  });

  state.phase = "reveal";
  state.deadline = startDeadline(ctx.now, REVEAL_MS);
}
