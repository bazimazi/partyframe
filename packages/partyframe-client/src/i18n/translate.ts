/**
 * Minimal localisation layer.
 *
 * Deliberately dependency-free: the platform only needs key lookup, `{param}`
 * interpolation, plural variants and a fallback chain. Swapping in a full i18n
 * library later only touches this file, because everything else speaks in
 * translation keys.
 */

import { en, type Dictionary, type TranslationKey } from "./en.js";

export type { TranslationKey, Dictionary };
export { en };

/** A locale that is not fully translated may omit keys; English fills the gaps. */
export type PartialDictionary = Partial<Dictionary> & Record<string, string>;

export interface LocaleDefinition {
  /** BCP 47 tag, lower case: `en`, `fa`, `pt-br`. */
  code: string;
  /** Endonym, shown in a language picker. */
  label: string;
  /** Text direction. Set to "rtl" for Persian, Arabic, Hebrew. */
  dir: "ltr" | "rtl";
  messages: PartialDictionary;
}

const locales = new Map<string, LocaleDefinition>();
/** Messages added for a locale before it was registered; merged on registration. */
const pending = new Map<string, Record<string, string>>();

export function registerLocale(locale: LocaleDefinition): void {
  const code = locale.code.toLowerCase();
  const extra = pending.get(code);
  pending.delete(code);
  locales.set(code, {
    ...locale,
    code,
    messages: { ...(locales.get(code)?.messages ?? {}), ...locale.messages, ...(extra ?? {}) },
  });
}

registerLocale({ code: "en", label: "English", dir: "ltr", messages: en });

/**
 * Merges extra keys (typically a game's strings) into a locale.
 *
 * Works before or after the locale is registered, so a game package can ship
 * translations for languages the host app may or may not enable.
 */
export function addMessages(localeCode: string, extra: Record<string, string>): void {
  const code = localeCode.toLowerCase();
  const locale = locales.get(code);
  if (locale) {
    locale.messages = { ...locale.messages, ...extra };
  } else {
    pending.set(code, { ...(pending.get(code) ?? {}), ...extra });
  }
}

export function listLocales(): LocaleDefinition[] {
  return [...locales.values()];
}

export function getLocale(code: string): LocaleDefinition | undefined {
  return locales.get(code.toLowerCase());
}

export type TranslateParams = Record<string, string | number>;

/** Replaces every `{name}` placeholder present in `params`. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * A bound translate function.
 *
 * Unknown keys return the key itself rather than throwing or rendering blank, so
 * a missing translation is visible in review but never breaks a live game.
 *
 * When `params.count` is a number, plural variants are tried first:
 * `${key}.one`, `${key}.other` and so on, following `Intl.PluralRules` for the
 * locale. A key without variants works as before.
 */
export type Translate = (key: TranslationKey | string, params?: TranslateParams) => string;

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(locale: string, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

export function createTranslator(localeCode: string): {
  t: Translate;
  dir: "ltr" | "rtl";
  code: string;
} {
  const locale = locales.get(localeCode.toLowerCase()) ?? locales.get("en")!;
  const messages = locale.messages as Record<string, string | undefined>;
  const fallback = en as Record<string, string | undefined>;

  // A dictionary's own plural variant, then its base key. The locale is
  // exhausted before English is consulted, so a translated base string is
  // never shadowed by an English variant.
  const lookup = (dict: Record<string, string | undefined>, key: string, count?: number) => {
    if (count !== undefined) {
      const variant = dict[`${key}.${pluralCategory(locale.code, count)}`] ?? dict[`${key}.other`];
      if (variant !== undefined) return variant;
    }
    return dict[key];
  };

  const t: Translate = (key, params) => {
    const count = params && typeof params.count === "number" ? params.count : undefined;
    const template = lookup(messages, key, count) ?? lookup(fallback, key, count) ?? key;
    return interpolate(template, params);
  };
  return { t, dir: locale.dir, code: locale.code };
}

/** Picks the best supported locale for a browser's `navigator.languages`. */
export function resolveLocale(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const exact = tag.toLowerCase();
    if (locales.has(exact)) return exact;
    const base = exact.split("-")[0];
    if (base && locales.has(base)) return base;
  }
  return "en";
}
