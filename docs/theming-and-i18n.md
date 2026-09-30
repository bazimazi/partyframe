# Theming and i18n

## Theme

`styles.css` styles both screens from a handful of custom properties on
`:root`. Override them in your own stylesheet, loaded after the kit's:

```css
:root {
  --pf-bg: #0b0f1a;
  --pf-fg: #f8fafc;
  --pf-muted: #94a3b8;
  --pf-card: #121a2b;
  --pf-card-2: #1b2438;
  --pf-border: #2b3650;
  --pf-accent: #f97316;       /* primary buttons, progress, "connected" */
  --pf-on-accent: #1c0a00;
  --pf-warn: #f59e0b;
  --pf-danger: #ef4444;
  --pf-focus: #ffffff;
  --pf-font: "Nunito", system-ui, sans-serif;
  --pf-mono: ui-monospace, monospace;
  --pf-radius: 16px;
  --pf-space: 16px;
}
```

Class names follow BEM (`.player-card__name`, `.btn--primary`) and are stable,
so deeper overrides are safe. Game-specific styles belong in your own CSS; the
example's `games.css` shows the pattern.

### Fonts

`styles.css` does not load web fonts. Import `@bazimazi/partyframe-client/fonts.css`
for Inter and JetBrains Mono from Google Fonts, or self-host any font and set
`--pf-font`. A party on a LAN without internet must not wait on a font.

### Design rules the kit follows

- Readable from four metres: large names and scores, high contrast.
- Colour is never the only signal: state is also shown by text or shape.
- Touch targets are at least 44 px; the phone body blocks pull-to-refresh,
  text selection and double-tap zoom while a controller is mounted.
- `prefers-reduced-motion` disables animation.
- Layouts use logical properties, so RTL locales mirror correctly.

## Localisation

Every visible string goes through `t(key, params)`. English ships built in;
add a locale with `registerLocale` and a game's strings with `addMessages`:

```ts
import { addMessages, registerLocale } from "@bazimazi/partyframe-client";

registerLocale({
  code: "fa",
  label: "فارسی",
  dir: "rtl",
  messages: { "host.scanToJoin": "برای ورود اسکن کنید", ... },
});
addMessages("fa", { "game.tap.name": "مسابقه ضربه" });
```

Keys a locale omits fall back to English, so a partial translation still
renders. `addMessages` for a locale that is not registered yet keeps the
strings and merges them once it is, so a game package can ship translations
for languages a host app may or may not enable.

The active locale comes from `localStorage` (`party:locale`), then the
browser's languages, then English. `<LocaleSwitcher />` renders a picker once
two or more locales exist and the TV header shows it automatically. The
document's `lang` and `dir` follow the locale.

### Plurals

Give a key `.one`/`.other` (or any [CLDR category](https://cldr.unicode.org/index/cldr-spec/plural-rules))
variants and pass a numeric `count`:

```ts
"host.wins.one": "{count} win",
"host.wins.other": "{count} wins",

t("host.wins", { count: 3 }); // "3 wins"
```

The category is chosen with `Intl.PluralRules` for the locale. A key without
variants works as before.

### Placeholders

`{name}` placeholders are replaced from `params`; an unmatched placeholder is
left visible rather than rendered as `undefined`, so a missing param shows up
in review.

## Sound

The shared screen synthesises its cues with the Web Audio API and only after a
user gesture, per browser autoplay policy. Map event kinds to voices in
`WebGame.sfx`, and register your own cues:

```ts
import { sfx } from "@bazimazi/partyframe-client";

sfx.define("drumroll", (ctx, master) => { /* oscillators or a decoded buffer */ });
```

Built-in voices: `join`, `ready`, `tick`, `accept`, `reject`, `explode`,
`score`, `win`, `start`. Phones use `haptic(pattern)` for feedback; iOS has no
vibration API, so never make an interaction depend on it.
