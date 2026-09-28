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
real game data over HTTP), and **the script exposes no debugging API on
`window`** (see Premium gating & policy compliance below for why) — testing
must drive the actual UI (keyboard/mouse/DOM), not a `window.QF`-style
backdoor. To verify changes:

1. Load the script via a userscript manager on a real Grepolis world.
   `zz2.grepolis.com` is a convenient international test world for manual
   verification without touching a live production market.
2. Use the `userscript-dev` skill's Level 1 workflow (strip the
   `==UserScript==` block, patch `unsafeWindow` if needed, evaluate the body
   directly on the live page with `playwright`/`chrome-devtools`) instead of
   installing a real userscript manager extension.
3. Check the browser console for the `[Grepolis Quick Finder x.y.z] loaded`
   / `Detected world: ... (market: ...)` log lines to confirm `world`/`market`
   detection and that init ran.
4. Open the palette with `Ctrl+Shift+F` (or click **QuickFinder** in the main
   menu / use `chrome-devtools`/`playwright` to dispatch the keydown), confirm
   the placeholder/footer text matches the expected language for that market.
5. Run a few searches by typing into `#qf-input` (via `chrome-devtools`
   `fill`/`type` or `playwright` `browser_type`) covering a player, an
   alliance, a town, and a coordinate pair; confirm opening each result
   (click or `Enter`) triggers the expected in-game window.
6. To test the Premium-gated commands (`>ghost`, `>island`, `>near`,
   `>ocean`, and the player/alliance drill-down), you need
   `GameDataPremium.isAdvisorActivated('curator')` to return `true` on the
   test account, or temporarily stub it for the session: evaluate
   `unsafeWindow.GameDataPremium.isAdvisorActivated = (t) => t === 'curator' ? true : false;`
   in the page context (`chrome-devtools` `evaluate_script` /
   `playwright` `browser_evaluate`, run **once after page load, before**
   opening the palette) to simulate an active Administrator advisor. Verify
   both states: with the stub returning `true` the commands list
   islands/towns/members as expected; with it returning `false` (or removed)
   the same commands show the `premiumRequired` message instead, and a
   multi-town coordinate falls back to a plain "open on map" row instead of
   an island breakdown.
7. To test saved searches: type any query, save it with `Ctrl+D` or the
   bookmark icon, confirm the inline panel precharges the name field with
   the query text and `Enter` saves it (toast + returns to the empty-query
   view with the input cleared); confirm `Esc` inside that panel cancels it
   without closing the whole palette. Open the palette with an empty query,
   confirm the "Saved searches" section appears above Favorites/Recent, and
   that `Tab`/`Shift+Tab` cycle the *All/Saved/Favorites/Recent* chips.
   Selecting a saved-search row and pressing `Enter` (or clicking it) must
   re-run the stored query verbatim without closing the palette. Test
   rename (`Ctrl+E` or the pencil icon), single removal (`Delete` or the
   trash icon), and clearing the whole list (`Ctrl+Shift+Delete` or the
   section's "Clear" button) — with both a saved search and a recent entry
   present, confirm `Ctrl+Shift+Delete` only clears the section the
   currently selected row belongs to.

## Premium gating & policy compliance (Grepolis marketplace rules)

Grepolis' script review process (`forum.grepolis.com`) rejects userscripts
that reproduce **Premium advisor functionality** for free, expose a
**programmatic control API** reachable from the page/console, or omit a
**privacy policy** when the script makes external network requests. Keep
these three constraints in mind for every change:

1. **Multi-city/multi-town aggregation mirrors the Administrator (Curator)
   advisor and must stay gated.** The real advisor
   (`GameDataPremium.isAdvisorActivated('curator')`) grants in-game overviews
   that aggregate data across a player's own cities. Any QuickFinder feature
   that aggregates or lists **multiple towns/cities at once** — regardless of
   whose towns they are — must call `isCuratorActive()`
   (`GrepolisQuickFinder.user.js`, search `PREMIUM GATING`) and fall back to
   `premiumRequiredRows()` (command output) or a plain single-item result
   (search/coordinate paths) when it returns `false`. This currently covers:
   `>ghost`, `>island`, `>near`, `>ocean`, the player/alliance town
   drill-down (`playerDetailRows`/`allianceDetailRows`), and the multi-town
   island row for a coordinate search. **Features that resolve to exactly
   one item are exempt** (single player/alliance/town lookup by name, a
   single-town coordinate, `>goto`, `>dist` between two given coordinates) —
   those aren't overviews, they're direct lookups of public per-entity data
   from `/data/*.txt`, same as clicking a name in-game.
   When adding a new command or drill-down, ask: *"does this list/aggregate
   more than one town/city in a single result?"* — if yes, gate it the same
   way; if no (a single exact match, a single coordinate, a distance between
   two explicit points), it does not need gating.
2. **No programmatic control API on `window`.** Do not add a `window.QF` (or
   similarly named) object exposing methods that open the palette, run a
   search, or trigger navigation from outside the UI — this was previously
   present and removed for policy compliance (v2.9.0). Debugging aids are
   fine as long as they are read-only console `console.log`/`console.info`
   output during `init()`, never a mutable/callable object attached to
   `window`/`unsafeWindow`. See "Manual testing" above for how to test
   without such an API.
3. **External requests need a documented privacy policy.** The only external
   (non-`*.grepolis.com`) network request this script causes is the
   userscript manager's own `@updateURL`/`@downloadURL` check against
   `raw.githubusercontent.com`, declared in the header and documented in
   `PRIVACY.md`. If you ever add a *new* external request (a new host, not
   just another same-origin Grepolis endpoint), you must update
   `PRIVACY.md` to describe it and what metadata it exposes, in the same
   change.

## Conventions

- Keep everything in the single `.user.js` file unless the project grows
  enough to justify a build step — this is intentionally a zero-dependency,
  zero-build project.
- Do not introduce `GM_*` API usage without checking it's actually needed;
  `fetch`/`document` already cover this script's needs since the data files
  are same-origin.
- No comments unless they explain non-obvious behavior (matching the existing
  style of documenting *why*, not *what*).

## Interaction parity (keyboard + mouse)

QuickFinder is a command palette: everything reachable once the overlay is
open must work identically with the keyboard alone or with the mouse alone.
Neither input method is a second-class citizen — do not ship a
keyboard-only shortcut without a clickable equivalent, and do not ship a
clickable control without a keyboard shortcut.

When adding a new action inside the overlay:

- **Mouse-first features need a keyboard shortcut.** e.g. the per-row
  favorite star has `Ctrl+F`, the per-row BBCode icon has `Ctrl+B`, the
  per-row Recent/Saved-searches trash icon has `Delete`, the "Clear" button
  on a history section header has `Ctrl+Shift+Delete` (scoped to whichever
  section — Recent or Saved searches — the currently selected row belongs
  to), the bookmark icon (save current query) has `Ctrl+D`, and a saved
  search's pencil icon (rename) has `Ctrl+E`.
- **Keyboard-first features need a clickable control.** e.g. the footer
  "refresh" and "help" entries are `<button>` elements (not plain `<span>`)
  so `Ctrl+R` and `?` both have a mouse equivalent; the settings gear icon
  mirrors `>settings`.
- **List every new shortcut in `renderHelp()`** (the `shortcuts` array) so
  `?`/`>help` stays the single source of truth for what's available, and
  add the matching translation keys across all 16 `LOCALES` entries (see
  Localization above for the workflow).
- **Row-scoped actions must guard on the selected item's shape** the same
  way on both paths (e.g. compare `item.section === 'recent'` or
  `item.type !== 'info'` in both the click handler and the keydown
  handler) so a stray click/keypress on an ineligible row is a silent
  no-op instead of an error, and both paths stay behaviorally identical.
- Prefer reusing one shared function for the actual action (e.g.
  `copyBBCode(item)`, `removeHistoryItem(item)`) and calling it from both
  the click handler and the keydown handler, instead of duplicating the
  logic per input method.

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
