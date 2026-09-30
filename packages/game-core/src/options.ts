/**
 * Declarative game options.
 *
 * A game describes the knobs a host may turn (rounds, time limit, mode) as
 * data. The platform then does three things from that one declaration: renders
 * controls in the lobby, validates and clamps what the host sends, and derives
 * the TypeScript type of `ctx.options`. A game never parses option input by
 * hand unless it wants to.
 */

import type { GameOptionFields, OptionValues, SelectOptionField } from "@partyframe/protocol";

export type {
  BooleanOptionField,
  GameOptionField,
  GameOptionFields,
  NumberOptionField,
  OptionValues,
  SelectOptionField,
} from "@partyframe/protocol";

function choiceValues(field: SelectOptionField): readonly string[] {
  return field.choices.map((choice) => (typeof choice === "string" ? choice : choice.value));
}

/** The options a game runs with when the host has touched nothing. */
export function defaultGameOptions<F extends GameOptionFields>(fields: F): OptionValues<F> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) out[key] = field.default;
  return out as OptionValues<F>;
}

/**
 * Validates and defaults raw option input.
 *
 * Lenient on purpose: an out-of-range number is clamped and a bad value falls
 * back to the default, because option input comes from the host's own lobby
 * controls, not from an adversary, and a stuck lobby is worse than a clamp.
 * Unknown keys are dropped so a game never sees fields it did not declare.
 */
export function parseGameOptions<F extends GameOptionFields>(
  fields: F,
  raw: unknown,
): OptionValues<F> {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(fields)) {
    const value = input[key];
    switch (field.type) {
      case "number": {
        let next = typeof value === "number" && Number.isFinite(value) ? value : field.default;
        if (field.step !== undefined && field.step > 0) {
          const origin = field.min ?? 0;
          next = origin + Math.round((next - origin) / field.step) * field.step;
        }
        if (field.min !== undefined) next = Math.max(field.min, next);
        if (field.max !== undefined) next = Math.min(field.max, next);
        out[key] = next;
        break;
      }
      case "boolean":
        out[key] = typeof value === "boolean" ? value : field.default;
        break;
      case "select":
        out[key] =
          typeof value === "string" && choiceValues(field).includes(value) ? value : field.default;
        break;
    }
  }
  return out as OptionValues<F>;
}
