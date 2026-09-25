# Grepolis Quick Finder

A userscript that adds a quick command palette (`Ctrl+Shift+F`) and a main menu button to
[Grepolis](https://www.grepolis.com/) for searching players, alliances, towns,
and coordinates, with real in-game navigation (no new tabs).

## Features

- **Quick Access**: Press `Ctrl+Shift+F` or click the **QuickFinder** button integrated into the Grepolis main navigation menu.
- **Fast Search**: Fuzzy search across players, alliances, and towns built from game data dumps (`/data/players.txt`, `/data/alliances.txt`, `/data/towns.txt`, `/data/islands.txt`), cached locally in **IndexedDB** with automatic 6-hour TTL and instant startup.
- **Segments & Tab cycling**: Filter results by type (*All*, *Players*, *Alliances*, *Towns*, *Islands*, *Coordinates*) with live match counters, or cycle through them with `Tab` / `Shift+Tab`.
- **Scope prefixes**: Target specific categories directly using `@p` (players), `@a` (alliances), `@t` (towns), `@i` (islands), or `@c` (coordinates). An exact `@p`/`@a` match drills into that player's towns or that alliance's member/ocean spread instead of a flat list.
- **Island awareness**: Searching a coordinate that has more than one town (an island can host up to 20) resolves to an island row listing every town on it.
- **BBCode Export**: Press `Ctrl+B` on any result row to instantly copy its BBCode (`[player]`, `[alliance]`, `[town]`, `[island]`) to your clipboard.
- **History & Favorites**: Press `Ctrl+F` on any result to pin it as a favorite. Opening the palette with an empty search displays your pinned favorites and recent searches.
- **Command mode**: Type `>` to access utility commands:
  - `>goto <x>:<y>` — Jump directly to coordinates on the world map.
  - `>ghost [minPts] [near]` — List ghost towns sorted by points, or by distance from your active city with `near`.
  - `>dist [from] [to]` — Calculate island distance between two coordinates or from your active city, with origin/destination oceans and range classification.
  - `>island <x>:<y>` — List every town on an island.
  - `>near [x:y] [radius]` — List islands (and their towns) within a radius of a coordinate or your active city.
  - `>ocean <M##> [alliance]` — Snapshot of an ocean, optionally filtered to one alliance's towns in it.
  - `>settings` — Open the settings panel.
  - `>help` — Display command and shortcut documentation.
- **Help overlay**: Type `?` anytime in the search input to toggle the shortcut and command cheat sheet (also lists the palette's own open/close shortcut).
- **Settings panel**: Click the gear icon in the search bar, or type `>settings`, to customize the language override, keyboard shortcut, results-per-page/command result caps, world data cache duration, and the default radius/points used by `>near` and `>ghost`. Settings are stored globally (shared across every world) and apply instantly, no reload required.
- **Manual refresh**: Press `Ctrl+R` to force-refresh world data from game servers.
- **Automatic localization**: Fully localized across 16 supported languages based on the Grepolis market detected from the world subdomain (e.g. `en37`, `es12`, `de44`, `zz2`), with an optional manual override in Settings.

## Installation

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (recommended)
   - [Violentmonkey](https://violentmonkey.github.io/)
2. Install the userscript directly from raw URL:
   👉 **[Click here to Install Grepolis Quick Finder](https://raw.githubusercontent.com/adrian-cancio/GrepolisQuickFinder/master/GrepolisQuickFinder.user.js)**
3. Visit any Grepolis world (`https://*.grepolis.com/game/*`) and press `Ctrl+Shift+F` or click **QuickFinder** in the main side menu.

## Supported markets and languages

Grepolis worlds are hosted on subdomains shaped like `<market><number>.grepolis.com` (for example `en37`, `es12`, `zz2`). The 2-letter market prefix is mapped to a UI language as follows (verified against official client endpoint):

| Market prefix | Language      | Notes                                   |
| -------------- | ------------- | ---------------------------------------- |
| `en`           | English       | Default fallback                         |
| `us`           | English       | US market                                |
| `zz`           | English       | International / Sandbox test world       |
| `es`           | Spanish       |                                           |
| `ar`           | Spanish       | Argentina market                         |
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

## Usage & Shortcuts

- `Ctrl+Shift+F` (customizable in Settings), the **QuickFinder** menu item, or the gear icon — open the palette / open settings.
- `Tab` / `Shift+Tab` — cycle result category filters (All / Players / Alliances / Towns / Islands / Coordinates).
- `Ctrl+B` — copy BBCode for selected result.
- `Ctrl+F` — toggle favorite on selected result.
- `Ctrl+R` — force refresh world data.
- `Home` / `End` — jump to first or last result.
- `?` — toggle in-app help overlay (also shown via `>help`).
- `@p`, `@a`, `@t`, `@i`, `@c` — scope query to players, alliances, towns, islands, or coordinates.
- `>goto`, `>ghost`, `>dist`, `>island`, `>near`, `>ocean`, `>settings`, `>help` — execute commands.
- `↑` / `↓` — navigate results.
- `Enter` — open selected result.
- `Esc` — close palette.

## Development

This is a single-file userscript with no build step and no external dependencies. Edit `GrepolisQuickFinder.user.js` directly.

### Debugging

The script exposes a `window.QF` object in the page for inspection and manual testing from the DevTools console:

```js
QF.debug();                  // dumps world/market/index/game-API status
QF.search('some name');      // runs a search without opening the UI
QF.setQuery('55:123');       // opens the palette and searches programmatically
QF.setSegment('town');       // filters active query to towns
QF.refresh();                // forces a network data refresh
QF.clearCache();             // clears local IndexedDB cache
```

## License

MIT License.
