/**
 * Most Likely To: a prompt on the TV, everyone points at someone.
 *
 * The simplest social game, and the one that shows how little code a round-
 * based party game needs when the platform owns players, timing and reveal
 * choreography. Votes are secret until the reveal, then the tally animates on
 * the TV. Points go to the crowd's pick and to everyone who read the room.
 */

import {
  defineGame,
  hasExpired,
  startDeadline,
  type Deadline,
  type GameContext,
} from "@bazimazi/partyframe-server";
import { z } from "zod";
import { PROMPTS } from "./prompts.js";

export type VotePhase = "vote" | "reveal" | "done";

export interface VoteOptions {
  rounds: number;
  seconds: number;
}

type Ctx = GameContext<VoteState, VoteOptions>;

export interface VoteState {
  prompts: string[];
  round: number;
  rounds: number;
  phase: VotePhase;
  deadline: Deadline | null;
  votes: Record<string, string>;
  roundPoints: Record<string, number>;
  voteSeconds: number;
}

export interface VoteControllerState {
  phase: VotePhase;
  round: number;
  rounds: number;
  prompt: string;
  myVote: string | null;
  points: number;
}

export interface VotePublicState {
  phase: VotePhase;
  round: number;
  rounds: number;
  prompt: string;
  deadline: Deadline | null;
  votedIds: string[];
  /** Only during reveal. */
  tally: Record<string, number>;
  votes: Record<string, string>;
  topIds: string[];
  roundPoints: Record<string, number>;
}

export const VoteActionSchema = z.object({
  type: z.literal("vote"),
  playerId: z.string().min(1).max(64),
});
export type VoteAction = z.infer<typeof VoteActionSchema>;

const REVEAL_MS = 6000;
const CHOSEN_POINTS = 200;
const AGREED_POINTS = 100;

export const voteGame = defineGame({
  id: "vote",
  nameKey: "game.vote.name",
  minPlayers: 3,
  maxPlayers: 8,
  options: {
    rounds: { type: "number", labelKey: "game.vote.option.rounds", default: 6, min: 3, max: 15 },
    seconds: {
      type: "number",
      labelKey: "game.vote.option.seconds",
      default: 20,
      min: 10,
      max: 60,
      step: 5,
    },
  },
  actionSchema: VoteActionSchema,

  createState: (options): VoteState => ({
    prompts: [],
    round: 0,
    rounds: options.rounds,
    phase: "done",
    deadline: null,
    votes: {},
    roundPoints: {},
    voteSeconds: options.seconds,
  }),

  start(ctx) {
    ctx.state.prompts = ctx.rng.shuffle(PROMPTS).slice(0, ctx.state.rounds);
    ctx.state.rounds = ctx.state.prompts.length;
    nextPrompt(ctx.state, ctx.now);
    ctx.requestStatus("PLAYING");
  },

  update(ctx) {
    const { state } = ctx;
    if (!hasExpired(state.deadline, ctx.now)) return;
    if (state.phase === "vote") reveal(ctx);
    else if (state.phase === "reveal") {
      if (state.round >= state.rounds) {
        state.phase = "done";
        state.deadline = null;
      } else {
        nextPrompt(state, ctx.now);
      }
    }
  },

  handleAction(ctx, playerId, action) {
    const { state } = ctx;
    if (state.phase !== "vote" || state.votes[playerId]) return false;
    if (action.playerId === playerId || !ctx.players.has(action.playerId)) return false;
    state.votes[playerId] = action.playerId;
    ctx.emitTo(playerId, { kind: "vote-locked" });

    const waiting = ctx.players.connected().filter((player) => !state.votes[player.id]);
    if (waiting.length === 0) reveal(ctx);
    return true;
  },

  isFinished: (ctx) => ctx.state.phase === "done",

  getControllerState: (ctx, playerId) => ({
    active: ctx.state.phase === "vote" && !ctx.state.votes[playerId],
    game: {
      phase: ctx.state.phase,
      round: ctx.state.round,
      rounds: ctx.state.rounds,
      prompt: ctx.state.prompts[ctx.state.round - 1] ?? "",
      myVote: ctx.state.votes[playerId] ?? null,
      points: ctx.state.roundPoints[playerId] ?? 0,
    } satisfies VoteControllerState,
  }),

  getPublicState: (ctx): VotePublicState => {
    const { state } = ctx;
    const revealed = state.phase === "reveal";
    const tally = revealed ? tallyVotes(state.votes) : {};
    return {
      phase: state.phase,
      round: state.round,
      rounds: state.rounds,
      prompt: state.prompts[state.round - 1] ?? "",
      deadline: state.deadline,
      votedIds: Object.keys(state.votes),
      tally,
      votes: revealed ? { ...state.votes } : {},
      topIds: revealed ? topOf(tally) : [],
      roundPoints: revealed ? { ...state.roundPoints } : {},
    };
  },

  createBot(difficulty) {
    const think = difficulty === "hard" ? [1000, 3000] : [2000, 7000];
    return {
      difficulty,
      decide: (ctx, botId) => {
        if (ctx.state.phase !== "vote" || ctx.state.votes[botId]) return null;
        const others = ctx.players.all().filter((player) => player.id !== botId);
        if (others.length === 0) return null;
        return {
          action: { type: "vote" as const, playerId: ctx.rng.pick(others).id },
          delayMs: ctx.rng.int(think[0]!, think[1]!),
        };
      },
    };
  },

  devCommands: {
    "reveal-now": (ctx) => {
      if (ctx.state.phase === "vote") ctx.state.deadline = startDeadline(ctx.now, 0);
    },
    "end-game": (ctx) => {
      ctx.state.phase = "done";
      ctx.state.deadline = null;
    },
  },
});

function nextPrompt(state: VoteState, now: number): void {
  state.round += 1;
  state.phase = "vote";
  state.deadline = startDeadline(now, state.voteSeconds * 1000);
  state.votes = {};
  state.roundPoints = {};
}

export function tallyVotes(votes: Record<string, string>): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const target of Object.values(votes)) tally[target] = (tally[target] ?? 0) + 1;
  return tally;
}

export function topOf(tally: Record<string, number>): string[] {
  const best = Math.max(0, ...Object.values(tally));
  return best === 0 ? [] : Object.keys(tally).filter((id) => tally[id] === best);
}

function reveal(ctx: Ctx): void {
  const { state } = ctx;
  const top = topOf(tallyVotes(state.votes));
  for (const id of top) {
    state.roundPoints[id] = (state.roundPoints[id] ?? 0) + CHOSEN_POINTS;
    ctx.players.addScore(id, CHOSEN_POINTS);
  }
  for (const [voter, target] of Object.entries(state.votes)) {
    if (!top.includes(target)) continue;
    state.roundPoints[voter] = (state.roundPoints[voter] ?? 0) + AGREED_POINTS;
    ctx.players.addScore(voter, AGREED_POINTS);
  }
  ctx.emit({
    kind: "vote-reveal",
    messageKey: top.length > 0 ? "game.vote.event.chosen" : "game.vote.event.nobody",
    params: { names: top.map((id) => ctx.players.get(id)?.name ?? "").join(" & ") },
    ...(top.length === 1 ? { playerId: top[0] } : {}),
  });
  state.phase = "reveal";
  state.deadline = startDeadline(ctx.now, REVEAL_MS);
}
