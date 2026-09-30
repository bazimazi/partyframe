/**
 * Big multiple-choice buttons for a phone.
 *
 * Every choice is a full-width target you can hit with a thumb without
 * looking. Selection is shown three ways - fill, a check mark and
 * `aria-pressed` - and a locked grid keeps the chosen one visible.
 */

import type { ReactNode } from "react";
import { haptic } from "../../sfx.js";

export interface Choice {
  id: string;
  label: ReactNode;
  /** Accent for the tile; defaults to the kit's card colour. */
  color?: string;
  /** Small text shown under the label. */
  hint?: ReactNode;
}

export function ChoiceGrid({
  choices,
  selectedId,
  disabled,
  columns = 2,
  showLetters = true,
  onSelect,
}: {
  choices: Choice[];
  selectedId?: string | null;
  disabled?: boolean;
  columns?: 1 | 2;
  /** Prefix tiles with A, B, C... so the TV can refer to them. */
  showLetters?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="choice-grid" data-columns={columns} role="group">
      {choices.map((choice, index) => {
        const selected = choice.id === selectedId;
        return (
          <button
            key={choice.id}
            type="button"
            className="choice"
            aria-pressed={selected}
            disabled={disabled}
            style={{ "--choice-color": choice.color } as React.CSSProperties}
            onClick={() => {
              if (disabled) return;
              haptic(10);
              onSelect(choice.id);
            }}
          >
            {showLetters && (
              <span className="choice__letter">{String.fromCharCode(65 + index)}</span>
            )}
            <span className="choice__label">{choice.label}</span>
            {choice.hint && <span className="choice__hint">{choice.hint}</span>}
            {selected && (
              <span className="choice__check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
