# AGENTS.md — Grepolis Quick Finder

## Project type

Single-file browser userscript (Tampermonkey/Violentmonkey/Greasemonkey). No
build step, no package manager, no external dependencies. All logic lives in
`GrepolisQuickFinder.user.js`.

## Language policy

All committed content (code, comments, identifiers, commit messages, README,
this file) must be written in 100% English. This repo previously had
Spanish comments/strings from an early prototype phase; if you touch any
remaining non-English content, translate it as part of that change.

## Localization

The UI text lives in the `LOCALES` object near the top of
`GrepolisQuickFinder.user.js`, keyed by language code. `MARKET_TO_LANGUAGE`
maps the 2-letter Grepolis market prefix (from the world subdomain, e.g. `en`
in `en37.grepolis.com`) to one of those language keys. When adding a new
market/language:

1. Verify the market's actual language by checking
   `https://om.grepolis.com/grepo/<market>` (look for `"lang"`/`"locale"` in
   the base64-encoded runtime config embedded in the page) rather than
   guessing from the prefix.
2. Add the market → language mapping in `MARKET_TO_LANGUAGE`.
3. Add or reuse a dictionary in `LOCALES` with all keys present in `LOCALES.en`.
4. Update the market table in `README.md`.

Unmapped markets fall back to English (`LOCALES.en`), so a missing mapping is
a soft failure, not a crash — but should still be filled in when known.

## Manual testing

There is no automated test suite (this is a live-page userscript that reads
real game data over HTTP). To verify changes:

1. Load the script via a userscript manager on a real Grepolis world.
   `zz2.grepolis.com` is a convenient international test world for manual
   verification without touching a live production market.
2. Use the `userscript-dev` skill's Level 1 workflow (strip the
   `==UserScript==` block, patch `unsafeWindow` if needed, evaluate the body
   directly on the live page with `playwright`/`chrome-devtools`) instead of
   installing a real userscript manager extension.
3. Check via `QF.debug()` in the console that `world`/`market` are detected
   correctly and that the index loaded (`players`/`alliances`/`towns` counts
   > 0).
4. Open the palette (`Ctrl+Shift+F` or `QF.openPalette()`), confirm the
   placeholder/footer text matches the expected language for that market.
5. Run a few searches (`QF.search('...')` or typing in the UI) covering a
   player, an alliance, a town, and a coordinate pair; confirm opening each
   result triggers the expected in-game window. Also try `>island`, `>near`,
   `>ocean`, and `>ghost near`, plus an exact `@p`/`@a` match, and confirm
   they list the expected island/town/member breakdown.

## Conventions

- Keep everything in the single `.user.js` file unless the project grows
  enough to justify a build step — this is intentionally a zero-dependency,
  zero-build project.
- Do not introduce `GM_*` API usage without checking it's actually needed;
  `fetch`/`document` already cover this script's needs since the data files
  are same-origin.
- No comments unless they explain non-obvious behavior (matching the existing
  style of documenting *why*, not *what*).

## UI style & theme

All CSS lives in a single `document.createElement('style')` block near the
end of the file (search `CSS` in the section banner). New UI must extend that
one block rather than injecting separate `<style>` tags or inline
`element.style.*` for anything visual (inline `style.*` is only acceptable
for pure positioning/visibility hacks like the existing hidden-textarea and
overlay `display` toggles).

Follow the existing dark-theme language:

- **Naming**: every new ID/class is kebab-case prefixed with `qf-`
  (`#qf-thing`, `.qf-thing`), to avoid colliding with Grepolis' own page
  styles. State/variant modifiers are separate classes toggled via
  `classList`, e.g. `qf-selected`, `qf-favorite`, `qf-chip-active`,
  `qf-status-error`, `qf-toast-visible` — never encode state in inline
  styles.
- **Color palette**: base surfaces use
  `linear-gradient(180deg, #2c2c2c, #1a1a1a)` with a
  `1px solid rgba(255, 255, 255, .16)` border and a soft black
  `box-shadow`. Text/border/background hierarchy is expressed as
  `rgba(255, 255, 255, <alpha>)` at varying alpha (roughly `.08`–`.16` for
  hairline borders/dividers, `.3`–`.5` for secondary text, `.68`–`1` for
  primary text) — don't introduce new hardcoded grays; reuse this
  white-with-alpha scale.
- **Accent color**: gold `#d7a33f` (hover/lighter variant `#e6bd6c`) marks
  selection, active state, favorites and the spinner accent. Use it for any
  new "active/selected/primary accent" affordance instead of inventing
  another accent hue.
- **Semantic badge colors** (used for entity-type badges): player blue
  (`#9cc4ff` on `rgba(90, 160, 255, .16)`), alliance gold (`#e6bd6c` on
  `rgba(215, 163, 63, .18)`), town green (`#8fdba9` on
  `rgba(100, 200, 140, .16)`), coordinate purple (`#dda6ea` on
  `rgba(200, 120, 220, .16)`). Reuse these for the same entity types; only
  add a new hue for a genuinely new entity/category.
- **Error/danger color**: `#e6a2a2` (title/strong) / `#e08a8a` (status text)
  on the same dark surfaces — reuse instead of red/other error colors.
- **Typography**: UI text uses
  `-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
  monospace elements (`kbd`, inline codes) use
  `ui-monospace, SFMono-Regular, Consolas, monospace`. No web fonts/`@font-face`.
- **Radius scale**: 4px for small chips (badges, scrollbar thumb), 5px for
  `kbd`/key hints, 7px for filter chips, 10px for the toast, 12px for the
  main window. Pick the closest existing value instead of a new one.
- **Icons**: inline SVG only, added to the `ICONS` map and rendered with the
  `qf-icon-svg` class (`stroke="currentColor"`, `stroke-width="1.8"`). Never
  use emoji glyphs — they render inconsistently across OSes and are missing
  on systems without an emoji font.
- **Motion**: short, subtle transitions (`.06s`–`.15s`, `ease`/`ease-out`) for
  hover/selection state, and short keyframe animations (`.12s`–`.7s`) for
  entrances/spinners. New keyframes are prefixed `qf-` (see
  `qf-window-in`, `qf-spin`). Avoid long/bouncy animations that would feel
  out of place in a command-palette-style UI.
- **Layering**: any new overlay/toast that must sit above the Grepolis page
  uses `z-index: 2147483647` (max signed 32-bit int), matching `#qf-overlay`
  and `#qf-toast`.
- **DOM construction**: build markup via template strings and always run
  user/game-supplied text through `escapeHTML()` before interpolating it —
  never build HTML from untrusted strings without escaping.

When adding a new UI element, first find the closest existing pattern above
(a chip, a badge, a result row, a section header, the toast) and match its
color/spacing/radius/animation values before introducing new ones.
