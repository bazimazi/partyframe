/**
 * Reflex: wait for green, then press first.
 *
 * Shows the pieces a timed party game needs: phases driven by deadlines in
 * state (never timers), a random wait drawn from the seeded RNG, private cues
 * to one phone, declared options with lobby controls, and bots with a reaction
 * time that depends on difficulty.
 */

import { defineGame, hasExpired, startDeadline, type Deadline } from "@bazimazi/partyframe-server";
import { z } from "zod";

export type ReflexPhase = "wait" | "go" | "result" | "done";

export interface ReflexState {
  round: number;
  rounds: number;
  phase: ReflexPhase;
  /** When the current phase ends. */
  deadline: Deadline | null;
  /** Server time the light turned green, for reaction maths. */
  goAt: number;
  /** Reaction time in ms per player for the current round. */
  reactions: Record<string, number>;
  /** Players who pressed before green this round. */
  fouls: Record<string, true>;
  roundWinnerId: string;
}

export interface ReflexControllerState {
  phase: ReflexPhase;
  round: number;
  rounds: number;
  reactionMs: number | null;
  fouled: boolean;
}

export interface ReflexPublicState {
  phase: ReflexPhase;
  round: number;
  rounds: number;
  goAt: number;
  deadline: Deadline | null;
  reactions: Record<string, number>;
  fouls: string[];
  roundWinnerId: string;
}

export const ReflexActionSchema = z.object({ type: z.literal("press") });
export type ReflexAction = z.infer<typeof ReflexActionSchema>;

const GO_WINDOW_MS = 3000;
const RESULT_MS = 2500;

export const reflexGame = defineGame({
  id: "reflex",
  nameKey: "game.reflex.name",
  minPlayers: 1,
  maxPlayers: 8,
  lateJoin: "spectate",
  options: {
    rounds: { type: "number", labelKey: "game.reflex.option.rounds", default: 3, min: 1, max: 10 },
    tempo: {
      type: "select",
      labelKey: "game.reflex.option.tempo",
      default: "normal",
      choices: ["relaxed", "normal", "frantic"] as const,
    },
  },
  actionSchema: ReflexActionSchema,
  createState: (options): ReflexState => ({
    round: 0,
    rounds: options.rounds,
    phase: "done",
    deadline: null,
    goAt: 0,
    reactions: {},
    fouls: {},
    roundWinnerId: "",
  }),

  start(ctx) {
    beginRound(ctx.state, ctx.now, ctx.rng, ctx.options.tempo);
    ctx.requestStatus("PLAYING");
  },

  update(ctx) {
    const { state } = ctx;
    if (!hasExpired(state.deadline, ctx.now)) return;

    switch (state.phase) {
      case "wait":
        state.phase = "go";
        state.goAt = ctx.now;
        state.deadline = startDeadline(ctx.now, GO_WINDOW_MS);
        ctx.emit({ kind: "reflex-go" });
        return;
      case "go":
        finishRound(ctx);
        return;
      case "result":
        if (state.round >= state.rounds) {
          state.phase = "done";
          state.deadline = null;
        } else {
          beginRound(state, ctx.now, ctx.rng, ctx.options.tempo);
        }
        return;
      case "done":
        return;
    }
  },

  handleAction(ctx, playerId, action) {
    if (action.type !== "press") return false;
    const { state } = ctx;

    if (state.phase === "wait") {
      if (state.fouls[playerId]) return false;
      state.fouls[playerId] = true;
      ctx.emitTo(playerId, { kind: "reflex-early" });
      return true;
    }

    if (state.phase === "go") {
      if (state.reactions[playerId] !== undefined || state.fouls[playerId]) return false;
      state.reactions[playerId] = Math.max(1, ctx.now - state.goAt);
      ctx.emitTo(playerId, { kind: "reflex-pressed" });
      // Once everyone still in the round has pressed there is nothing to wait for.
      const pending = ctx.players
        .connected()
        .filter((player) => !state.fouls[player.id] && state.reactions[player.id] === undefined);
      if (pending.length === 0) finishRound(ctx);
      return true;
    }

    return false;
  },

  isFinished: (ctx) => ctx.state.phase === "done",

  getControllerState: (ctx, playerId) => ({
    active: ctx.state.phase === "wait" || ctx.state.phase === "go",
    game: {
      phase: ctx.state.phase,
      round: ctx.state.round,
      rounds: ctx.state.rounds,
      reactionMs: ctx.state.reactions[playerId] ?? null,
      fouled: Boolean(ctx.state.fouls[playerId]),
    } satisfies ReflexControllerState,
  }),

  getPublicState: (ctx): ReflexPublicState => ({
    phase: ctx.state.phase,
    round: ctx.state.round,
    rounds: ctx.state.rounds,
    goAt: ctx.state.goAt,
    deadline: ctx.state.deadline,
    reactions: { ...ctx.state.reactions },
    fouls: Object.keys(ctx.state.fouls),
    roundWinnerId: ctx.state.roundWinnerId,
  }),

  createBot(difficulty) {
    const base = difficulty === "easy" ? 650 : difficulty === "hard" ? 230 : 400;
    return {
      difficulty,
      decide: (ctx, botId) => {
        if (ctx.state.phase !== "go" || ctx.state.reactions[botId] !== undefined) return null;
        return { action: { type: "press" as const }, delayMs: base + ctx.rng.int(0, 150) };
      },
    };
  },

  devCommands: {
    "skip-wait": (ctx) => {
      if (ctx.state.phase === "wait") ctx.state.deadline = startDeadline(ctx.now, 0);
    },
    "end-game": (ctx) => {
      ctx.state.phase = "done";
      ctx.state.deadline = null;
    },
  },
});

type Ctx = Parameters<NonNullable<typeof reflexGame.update>>[0];

function beginRound(
  state: ReflexState,
  now: number,
  rng: { int(min: number, max: number): number },
  tempo: "relaxed" | "normal" | "frantic",
): void {
  const [min, max] =
    tempo === "relaxed" ? [2500, 6000] : tempo === "frantic" ? [800, 2500] : [1500, 4000];
  state.round += 1;
  state.phase = "wait";
  state.deadline = startDeadline(now, rng.int(min, max));
  state.goAt = 0;
  state.reactions = {};
  state.fouls = {};
  state.roundWinnerId = "";
}

function finishRound(ctx: Ctx): void {
  const { state } = ctx;
  const fastest = Object.entries(state.reactions).sort((a, b) => a[1] - b[1])[0];
  state.roundWinnerId = fastest?.[0] ?? "";
  if (fastest) {
    ctx.players.addScore(fastest[0], 1);
    ctx.emit({
      kind: "reflex-round-won",
      messageKey: "game.reflex.event.roundWon",
      params: { name: ctx.players.get(fastest[0])?.name ?? "", ms: fastest[1] },
      playerId: fastest[0],
    });
  } else {
    ctx.emit({ kind: "reflex-round-nobody", messageKey: "game.reflex.event.nobody" });
  }
  state.phase = "result";
  state.deadline = startDeadline(ctx.now, RESULT_MS);
}
