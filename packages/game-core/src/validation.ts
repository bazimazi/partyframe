/**
 * Standard Schema helpers.
 *
 * Games declare validators as Standard Schemas so the platform can run them
 * without importing any particular validation library.
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: readonly string[] };

/**
 * Runs a Standard Schema synchronously.
 *
 * Async validators are rejected outright: the room's message handler is
 * synchronous, and allowing a promise here would let an action be applied after
 * the game state it was validated against has already moved on.
 */
export function validateSync<TIn, TOut>(
  schema: StandardSchemaV1<TIn, TOut>,
  input: unknown,
): ValidationResult<TOut> {
  const result = schema["~standard"].validate(input);
  if (result instanceof Promise) {
    return { ok: false, issues: ["asynchronous validators are not supported"] };
  }
  if (result.issues) {
    return { ok: false, issues: result.issues.map((issue) => issue.message) };
  }
  return { ok: true, value: result.value };
}
