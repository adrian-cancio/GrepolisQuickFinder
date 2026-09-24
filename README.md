# Grepolis Quick Finder

A userscript that adds a quick command palette (`Ctrl+Shift+F`) to
[Grepolis](https://www.grepolis.com/) for searching players, alliances, towns,
and coordinates, with real in-game navigation (no new tabs).

## Features

- **Ctrl+Shift+F** opens a searchable palette over the game.
- Fuzzy search across players, alliances, and towns, built from the game's own
  public data dumps (`/data/players.txt`, `/data/alliances.txt`,
  `/data/towns.txt`), loaded once per session and cached in memory.
- Coordinate search (`55:123`) that jumps straight to a known town or the map
  position.
- Opens player/alliance profiles and town info windows using the same
  internal mechanisms the game client itself uses
  (`Layout.playerProfile.open`, `Layout.allianceProfile.open`, and the game's
  own town-link hash format).
- **Automatic localization**: the UI text (placeholder, footer hints, badges,
  empty/loading/error states) is selected based on the Grepolis market
  detected from the current subdomain (e.g. `en37`, `es12`, `de44`, `zz2`).
  See [Supported markets](#supported-markets-and-languages) below.

## Installation

1. Install a userscript manager (e.g.
   [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/)).
2. Open `GrepolisQuickFinder.user.js` in your browser, or import it manually
   into your userscript manager.
3. Visit any Grepolis world (`https://<market><number>.grepolis.com/game/*`)
   and press `Ctrl+Shift+F`.

## Supported markets and languages

Grepolis worlds are hosted on subdomains shaped like
`<market><number>.grepolis.com` (for example `en37`, `es12`, `zz2`). The
2-letter market prefix is mapped to a UI language as follows. This mapping was
verified directly against the game's own onboarding endpoint
(`https://om.grepolis.com/grepo/<market>`), which returns the exact
`lang`/`locale` pair the official client uses per market.

| Market prefix | Language      | Notes                                   |
| -------------- | ------------- | ---------------------------------------- |
| `en`           | English       |                                           |
| `us`           | English       | US market, shares English UI             |
| `zz`           | English       | International / test-and-beta world      |
| `es`           | Spanish       |                                           |
| `ar`           | Spanish       | Argentina market, shares Spanish UI      |
| `de`           | German        |                                           |
| `fr`           | French        |                                           |
| `it`           | Italian       |                                           |
| `nl`           | Dutch         |                                           |
| `pl`           | Polish        |                                           |
| `pt`           | Portuguese    |                                           |
| `br`           | Portuguese    | Brazilian variant                        |
| `tr`           | Turkish       |                                           |
| `ru`           | Russian       |                                           |
| `gr`           | Greek         |                                           |
| `hu`           | Hungarian     |                                           |
| `ro`           | Romanian      |                                           |
| `cz`           | Czech         |                                           |
| `sk`           | Slovak        |                                           |

Any market not listed above falls back to English.

## Usage

- `Ctrl+Shift+F` — open/close the palette.
- Type a player name, alliance name, town name, or coordinates (`x:y`).
- `↑` / `↓` — navigate results.
- `Enter` — open the selected result.
- `Esc` — close the palette.

## Development

This is a single-file userscript with no build step and no external
dependencies (project hygiene files aside). Edit `GrepolisQuickFinder.user.js`
directly.

### Debugging

The script exposes a `window.QF` object in the page for inspection and manual
testing from the DevTools console:

```js
QF.debug();                  // dumps world/market/index/game-API status
QF.search('some name');      // runs a search without opening the UI
QF.setQuery('55:123');       // opens the palette and searches programmatically
QF.openIndex(0);             // selects and opens result at index 0
```

### Manual test checklist

1. Load the script on a live world (e.g. a `zz` test world) via your
   userscript manager.
2. Confirm the console prints the detected world/market and that
   `Ctrl+Shift+F` opens the palette with the placeholder and footer text in
   the expected language for that market.
3. Search a known player, alliance, and town name; confirm results and that
   `Enter`/click opens the correct in-game window.
4. Search a coordinate pair (`x:y`); confirm it opens the town info window when
   the island holds a single town, and jumps the map otherwise (shared islands
   and empty coordinates).

There is no automated test suite; this is a browser-only userscript and
changes are verified live against a running Grepolis world (see the checklist
above).

## Project status

Early-stage, actively iterated prototype-turned-real-project. No build tooling
is required to use or modify it.
