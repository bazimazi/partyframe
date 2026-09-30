/**
 * Language picker. Renders nothing until a second locale is registered, so an
 * English-only app never shows a control with one option.
 */

import { listLocales } from "@partyframe/i18n";
import { useI18n } from "./I18nProvider.js";

export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const locales = listLocales();
  if (locales.length < 2) return null;

  return (
    <label className={`locale-switcher ${className}`.trim()}>
      <span className="visually-hidden">{t("app.language")}</span>
      <select
        className="locale-switcher__select"
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
      >
        {locales.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
