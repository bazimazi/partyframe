import type { GameOptionFields, OptionValues } from "./options.js";
import type { AnyPartyGame, PartyGame } from "./types.js";

/**
 * A game as written by its author: like `PartyGame`, except `options` is
 * generic so its field declarations flow into the type of `ctx.options`.
 */
export type GameDefinition<
  TState,
  TFields extends GameOptionFields,
  TAction,
  TController,
  TPublic,
> = Omit<
  PartyGame<TState, OptionValues<TFields>, TAction, TController, TPublic>,
  "options" | "parseOptions"
> & {
  options?: TFields;
};

/**
 * Identity helper that preserves the game's type parameters.
 *
 * Pass a `PartyGame` object through this instead of annotating the variable,
 * so `handleAction`, `getPublicState` and `createBot` stay typed against each
 * other. When the game declares `options`, `ctx.options` is typed from them;
 * when it supplies its own `parseOptions`, that function's return type wins.
 */
export function defineGame<TState, TOptions, TAction, TController, TPublic>(
  game: PartyGame<TState, TOptions, TAction, TController, TPublic> & {
    parseOptions(raw: unknown): TOptions;
  },
): PartyGame<TState, TOptions, TAction, TController, TPublic>;
export function defineGame<
  TState,
  TFields extends GameOptionFields = Record<never, never>,
  TAction = unknown,
  TController = unknown,
  TPublic = unknown,
>(
  game: GameDefinition<TState, TFields, TAction, TController, TPublic>,
): PartyGame<TState, OptionValues<TFields>, TAction, TController, TPublic>;
export function defineGame(game: AnyPartyGame): AnyPartyGame {
  return game;
}
