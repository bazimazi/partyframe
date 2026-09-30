/**
 * Lobby controls for a game's declared options.
 *
 * Rendered from the field descriptors the server publishes, so a game gets a
 * settings UI by declaring `options` and never writes lobby code. Values are
 * only intentions: the server clamps and validates, and the control re-renders
 * from the synchronised settings.
 */

import type { GameOptionField, GameOptionFields } from "@partyframe/protocol";
import { useT } from "../i18n/I18nProvider.js";

export function GameOptionsPanel({
  fields,
  values,
  onChange,
}: {
  fields: GameOptionFields;
  values: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const t = useT();
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;

  return (
    <fieldset className="lobby__options">
      <legend className="lobby__heading">{t("host.gameSettings")}</legend>
      {entries.map(([key, field]) => (
        <OptionControl
          key={key}
          field={field}
          value={values[key] ?? field.default}
          onChange={(value) => onChange({ [key]: value })}
        />
      ))}
    </fieldset>
  );
}

function OptionControl({
  field,
  value,
  onChange,
}: {
  field: GameOptionField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useT();
  const label = t(field.labelKey);

  switch (field.type) {
    case "number": {
      const current = typeof value === "number" ? value : field.default;
      const step = field.step ?? 1;
      const atMin = field.min !== undefined && current <= field.min;
      const atMax = field.max !== undefined && current >= field.max;
      return (
        <label className="lobby__setting">
          <span>{label}</span>
          <div className="stepper">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onChange(current - step)}
              disabled={atMin}
              aria-label={`${label} −`}
            >
              −
            </button>
            <output className="stepper__value">{current}</output>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onChange(current + step)}
              disabled={atMax}
              aria-label={`${label} +`}
            >
              +
            </button>
          </div>
        </label>
      );
    }
    case "boolean": {
      const current = typeof value === "boolean" ? value : field.default;
      return (
        <label className="lobby__setting">
          <span>{label}</span>
          <div className="segmented" role="group" aria-label={label}>
            {[true, false].map((option) => (
              <button
                key={String(option)}
                type="button"
                className="segmented__option"
                aria-pressed={current === option}
                onClick={() => onChange(option)}
              >
                {option ? t("option.on") : t("option.off")}
              </button>
            ))}
          </div>
        </label>
      );
    }
    case "select": {
      const current = typeof value === "string" ? value : field.default;
      return (
        <label className="lobby__setting">
          <span>{label}</span>
          <div className="segmented" role="group" aria-label={label}>
            {field.choices.map((choice) => {
              const option = typeof choice === "string" ? choice : choice.value;
              const optionLabel =
                typeof choice === "string" ? t(`${field.labelKey}.${choice}`) : t(choice.labelKey);
              return (
                <button
                  key={option}
                  type="button"
                  className="segmented__option"
                  aria-pressed={current === option}
                  onClick={() => onChange(option)}
                >
                  {optionLabel}
                </button>
              );
            })}
          </div>
        </label>
      );
    }
  }
}
