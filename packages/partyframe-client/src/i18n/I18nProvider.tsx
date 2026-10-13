/**
 * Localisation context.
 *
 * Every visible string in the app goes through `t()`. Only English ships today,
 * but the platform is intended for culture-specific party games, so adding
 * Persian or Arabic must be a data change plus a `dir="rtl"` flip - never a
 * sweep through every component looking for hard-coded text.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createTranslator, resolveLocale, type Translate } from "./translate.js";

interface I18nValue {
  t: Translate;
  locale: string;
  dir: "ltr" | "rtl";
  setLocale: (code: string) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = "party:locale";

function initialLocale(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return resolveLocale([stored]);
  } catch {
    /* storage unavailable; fall back to the browser's preference */
  }
  return resolveLocale(navigator.languages ?? [navigator.language]);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);

  const value = useMemo<I18nValue>(() => {
    const { t, dir, code } = createTranslator(locale);
    return {
      t,
      dir,
      locale: code,
      setLocale: (next: string) => {
        setLocaleState(resolveLocale([next]));
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* ignore */
        }
      },
    };
  }, [locale]);

  // Keeps assistive technology and the browser's own text rendering in sync
  // with the selected language, including direction for RTL locales.
  useEffect(() => {
    document.documentElement.lang = value.locale;
    document.documentElement.dir = value.dir;
  }, [value.locale, value.dir]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}

/** Shorthand for the common case of only needing the translate function. */
export function useT(): Translate {
  return useI18n().t;
}
