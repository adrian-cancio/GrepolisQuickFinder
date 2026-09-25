# Grepolis Quick Finder

A userscript that adds a quick command palette (`Ctrl+Shift+F`) to
[Grepolis](https://www.grepolis.com/) for searching players, alliances, towns,
and coordinates, with real in-game navigation (no new tabs).

## Features

- **Ctrl+Shift+F** opens a searchable palette over the game.
- Fuzzy search across players, alliances, and towns, built from the game's own
  public data dumps (`/data/players.txt`, `/data/alliances.txt`,
  `/data/towns.txt`), cached locally in **IndexedDB** with automatic 6-hour TTL
  and fast startup.
- **Segments & Tab cycling**: Filter results by type (*All*, *Players*, *Alliances*,
  *Towns*, *Islands*, *Coordinates*) with live match counters, or cycle through them with `Tab` / `Shift+Tab`.
- **Scope prefixes**: Target specific categories directly using `@p` (players),
  `@a` (alliances), `@t` (towns), `@i` (islands), or `@c` (coordinates). An
  exact `@p`/`@a` match drills into that player's towns or that alliance's
  member/ocean spread instead of a flat list.
- **Island awareness**: Searching a coordinate that has more than one town
  (an island can host up to 20) resolves to an island row listing every town
  on it, instead of guessing which one you meant.
- **History & Favorites**: Press `Ctrl+F` on any result — including islands —
  to pin it as a favorite. Opening the palette with an empty search displays
  your pinned favorites and recent searches.
- **Command mode**: Type `>` to access utility commands:
  - `>goto <x>:<y>` — Jump directly to coordinates on the world map.
  - `>ghost [minPts] [near]` — List ghost towns sorted by points, or by
    distance from your active city with `near`.
  - `>dist [from] [to]` — Calculate island distance between two coordinates or
    from your active city, with the origin/destination oceans and a rough
    same-island/adjacent/regional/long-range band.
  - `>island <x>:<y>` — List every town on an island.
  - `>near [x:y] [radius]` — List islands (and their towns) within a radius
    of a coordinate or your active city.
  - `>ocean <M##> [alliance]` — Snapshot of an ocean, optionally filtered to
    one alliance's towns in it.
  - `>help` — Display command and shortcut documentation.
- **Help overlay**: Type `?` anytime in the search input to toggle the shortcut and command cheat sheet.
- **External stats links**: Quick link to GrepoLife player/alliance analytics when available.
- **Manual refresh**: Press `Ctrl+R` to force-refresh world data from game servers.
- **Automatic localization**: The UI text (placeholder, footer hints, badges,
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

## Usage & Shortcuts

- `Ctrl+Shift+F` — open/close the palette.
- `Tab` / `Shift+Tab` — cycle result category filters (All / Players / Alliances / Towns / Coordinates).
- `Ctrl+F` — toggle favorite on selected result.
- `Ctrl+R` — force refresh world data.
- `Home` / `End` — jump to first or last result.
- `?` — toggle in-app help overlay.
- `@p`, `@a`, `@t`, `@i`, `@c` — scope query to players, alliances, towns, islands, or coordinates.
- `>goto`, `>ghost`, `>dist`, `>island`, `>near`, `>ocean`, `>help` — execute commands.
- `↑` / `↓` — navigate results.
- `Enter` — open selected result.
- `Esc` — close palette.

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
QF.setSegment('town');       // filters active query to towns
QF.refresh();                // forces a network data refresh
QF.clearCache();             // clears local IndexedDB cache
```

### Manual test checklist

1. Load the script on a live world (e.g. a `zz` test world) via your
   userscript manager.
2. Confirm the console prints the detected world/market and that
   `Ctrl+Shift+F` opens the palette with the placeholder and footer text in
   the expected language for that market.
3. Search a known player, alliance, and town name; confirm results and that
   `Enter`/click opens the correct in-game window.
4. Test segment tabs, `@` scope prefixes, `Ctrl+F` favorites, `?` help, and `>` commands (`>ghost`, `>goto`, `>dist`).
5. Confirm IndexedDB caching works on page reload (console reports `loaded (cache)`).

## Project status

Active development. Single-file architecture with zero build tools or external dependencies.
