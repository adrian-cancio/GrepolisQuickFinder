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
