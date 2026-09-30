/**
 * Tap Race: first to the target number of taps wins.
 *
 * The smallest complete game. Rules only - no sockets, no rendering - which is
 * what lets `tests/tap.test.ts` play a whole match in a few milliseconds.
 */

import { defineGame } from "@bazimazi/partyframe-server";
import { z } from "zod";

export interface TapState {
  taps: Record<string, number>;
  winnerId: string;
  target: number;
}

/** Sent to every phone; the shell delivers it typed to `TapController`. */
export interface TapControllerState {
  taps: number;
  target: number;
}

/** Broadcast to the shared screen. */
export interface TapPublicState {
  taps: Record<string, number>;
  winnerId: string;
  target: number;
}

export const TapActionSchema = z.object({ type: z.literal("tap") });
export type TapAction = z.infer<typeof TapActionSchema>;

export const tapGame = defineGame({
  id: "tap",
  nameKey: "game.tap.name",
  minPlayers: 1,
  maxPlayers: 8,
  options: {
    target: {
      type: "number",
      labelKey: "game.tap.option.target",
      default: 10,
      min: 5,
      max: 50,
      step: 5,
    },
  },
  actionSchema: TapActionSchema,
  createState: (options): TapState => ({ taps: {}, winnerId: "", target: options.target }),
  handleAction(ctx, playerId, action) {
    if (action.type !== "tap" || ctx.state.winnerId) return false;
    const taps = (ctx.state.taps[playerId] ?? 0) + 1;
    ctx.state.taps[playerId] = taps;
    if (taps >= ctx.state.target) {
      ctx.state.winnerId = playerId;
      ctx.players.addScore(playerId, 1);
      ctx.emit({
        kind: "tap-finished",
        messageKey: "game.tap.event.finished",
        params: { name: ctx.players.get(playerId)?.name ?? "" },
      });
    }
    return true;
  },
  isFinished: (ctx) => Boolean(ctx.state.winnerId),
  getControllerState: (ctx, playerId) => ({
    active: !ctx.state.winnerId,
    game: {
      taps: ctx.state.taps[playerId] ?? 0,
      target: ctx.state.target,
    } satisfies TapControllerState,
  }),
  getPublicState: (ctx): TapPublicState => ({
    taps: { ...ctx.state.taps },
    winnerId: ctx.state.winnerId,
    target: ctx.state.target,
  }),
  createBot(difficulty) {
    const delayMs = difficulty === "easy" ? 420 : difficulty === "hard" ? 140 : 240;
    return {
      difficulty,
      decide: (ctx) => ({
        action: { type: "tap" as const },
        delayMs: delayMs + ctx.rng.int(0, 80),
      }),
    };
  },
  devCommands: {
    "finish-now": (ctx) => {
      ctx.state.winnerId = ctx.players.all()[0]?.id ?? "";
    },
  },
});
