/**
 * Declarative game option fields.
 *
 * A game describes the knobs a host may turn (rounds, time limit, mode) as
 * data. The server validates against the declaration and publishes it through
 * `/api/config`, and the lobby renders a control per field - so the shape is
 * part of the wire contract and lives here.
 */

export interface NumberOptionField {
  type: "number";
  /** i18n key for the lobby label. */
  labelKey: string;
  default: number;
  min?: number;
  max?: number;
  /** Stepper increment. Defaults to 1. */
  step?: number;
}

export interface BooleanOptionField {
  type: "boolean";
  labelKey: string;
  default: boolean;
}

export interface SelectOptionField<T extends string = string> {
  type: "select";
  labelKey: string;
  default: T;
  /**
   * Allowed values. Declare the array `as const` so the option's type is the
   * union of its values rather than `string`. A choice may carry its own label
   * key; otherwise the lobby shows `${labelKey}.${value}`.
   */
  choices: readonly T[] | readonly { value: T; labelKey: string }[];
}

export type GameOptionField = NumberOptionField | BooleanOptionField | SelectOptionField;

export type GameOptionFields = Record<string, GameOptionField>;

/**
 * The value of a select field, read from `choices` rather than `default` so an
 * `as const` array yields the union of its members instead of `string`.
 */
type SelectValue<F> = F extends { choices: readonly (infer C)[] }
  ? C extends string
    ? C
    : C extends { value: infer V extends string }
      ? V
      : never
  : never;

/** The value type a set of fields produces. */
export type OptionValues<F extends GameOptionFields> = {
  [K in keyof F]: F[K] extends NumberOptionField
    ? number
    : F[K] extends BooleanOptionField
      ? boolean
      : F[K] extends SelectOptionField
        ? SelectValue<F[K]>
        : never;
};
