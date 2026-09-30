/**
 * A one-line text answer for a phone: guesses, captions, words.
 *
 * Submits on Enter or the button, clears itself, keeps focus so the next guess
 * needs no extra tap, and disables autocorrect - a guess is not prose.
 */

import { useRef, useState, type FormEvent } from "react";
import { sanitizeText } from "@partyframe/protocol";
import { haptic } from "../../sfx.js";

export function TextEntry({
  placeholder,
  submitLabel,
  maxLength = 40,
  disabled,
  autoFocus = true,
  onSubmit,
}: {
  placeholder?: string;
  submitLabel: string;
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const clean = sanitizeText(value);
  const canSubmit = clean.length > 0 && !disabled;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    haptic(10);
    onSubmit(clean.slice(0, maxLength));
    setValue("");
    inputRef.current?.focus();
  };

  return (
    <form className="text-entry" onSubmit={submit}>
      <input
        ref={inputRef}
        className="input text-entry__input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="send"
      />
      <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
        {submitLabel}
      </button>
    </form>
  );
}
