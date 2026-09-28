# Grepolis Quick Finder

A userscript that adds a quick command palette (`Ctrl+Shift+F`) and a main menu button to
[Grepolis](https://www.grepolis.com/) for searching players, alliances, towns,
and coordinates, with real in-game navigation (no new tabs).

## Features

- **Quick Access**: Press `Ctrl+Shift+F` or click the **QuickFinder** button integrated into the Grepolis main navigation menu.
- **Fast Search**: Fuzzy search across players, alliances, and towns built from game data dumps (`/data/players.txt`, `/data/alliances.txt`, `/data/towns.txt`, `/data/islands.txt`), cached locally in **IndexedDB** with automatic 6-hour TTL and instant startup.
- **Segments & Tab cycling**: Filter results by type (*All*, *Players*, *Alliances*, *Towns*, *Islands*, *Coordinates*) with live match counters, or cycle through them with `Tab` / `Shift+Tab`.
- **Scope prefixes**: Target specific categories directly using `@p` (players), `@a` (alliances), `@t` (towns), `@i` (islands), or `@c` (coordinates). An exact `@p`/`@a` match drills into that player's towns or that alliance's member/ocean spread instead of a flat list. **Drill-down requires the Administrator advisor (Premium)**; without it, an exact match still opens that player/alliance profile directly, just without the town breakdown.
- **Island awareness**: Searching a coordinate that has more than one town (an island can host up to 20) resolves to an island row listing every town on it. **Requires the Administrator advisor (Premium)**; without it, the coordinate opens the island on the map instead.
- **BBCode Export**: Press `Ctrl+B`, or click the per-row BBCode icon, to instantly copy its BBCode (`[player]`, `[alliance]`, `[town]`, `[island]`) to your clipboard.
- **History & Favorites**: Press `Ctrl+F` on any result to pin it as a favorite. Opening the palette with an empty search displays your saved searches, pinned favorites, and recent searches. Remove a single recent entry with `Delete` or its per-row trash icon, or wipe the whole Recent list with `Ctrl+Shift+Delete` or the "Clear" button on the Recent section header (favorites are unaffected either way).
- **Saved searches**: Press `Ctrl+D`, or click the bookmark icon in the search bar, to save the current query (free-text, `@scope query`, or `>command args`) under a name you choose — defaulting to the query itself. Saved searches appear in their own section in the empty-query view; opening one re-runs it exactly as typed. Rename a saved search with `Ctrl+E` or its per-row pencil icon, remove one with `Delete` or its trash icon, or clear the whole list with `Ctrl+Shift+Delete` or the "Clear" button on the section header. With the palette showing the empty-query view, `Tab` / `Shift+Tab` cycle between *All*, *Saved*, *Favorites*, and *Recent*.
- **Command mode**: Type `>` to access utility commands:
  - `>goto <x>:<y>` — Jump directly to coordinates on the world map.
  - `>dist [from] [to]` — Calculate island distance between two coordinates or from your active city, with origin/destination oceans and range classification.
  - `>ghost [minPts] [near]` — List ghost towns sorted by points, or by distance from your active city with `near`. **Requires the Administrator advisor (Premium).**
  - `>island <x>:<y>` — List every town on an island. **Requires the Administrator advisor (Premium).**
  - `>near [x:y] [radius]` — List islands (and their towns) within a radius of a coordinate or your active city. **Requires the Administrator advisor (Premium).**
  - `>ocean <M##> [alliance]` — Snapshot of an ocean, optionally filtered to one alliance's towns in it. **Requires the Administrator advisor (Premium).**
  - `>settings` — Open the settings panel.
  - `>help` — Display command and shortcut documentation.
- **Help overlay**: Type `?` anytime in the search input, or click the "help" footer button, to toggle the shortcut and command cheat sheet (also lists the palette's own open/close shortcut).
- **Settings panel**: Click the gear icon in the search bar, or type `>settings`, to customize the language override, keyboard shortcut, results-per-page/command result caps, world data cache duration, and the default radius/points used by `>near` and `>ghost`. Settings are stored globally (shared across every world) and apply instantly, no reload required.
- **Manual refresh**: Press `Ctrl+R`, or click the "refresh" footer button, to force-refresh world data from game servers.
- **Automatic localization**: Fully localized across 16 supported languages based on the Grepolis market detected from the world subdomain (e.g. `en37`, `es12`, `de44`, `zz2`), with an optional manual override in Settings.

## Premium features (Administrator advisor)

Grepolis's in-game Administrator advisor (a Premium purchase) grants access
to aggregate, multi-city overviews you don't otherwise have. To mirror that
distinction instead of reproducing it for free, QuickFinder gates the
equivalent multi-town/multi-city views behind the same advisor check
(`GameDataPremium.isAdvisorActivated('curator')`):

| Feature                                    | Requires Administrator? |
| ------------------------------------------- | :----------------------: |
| Search a single player/alliance/town by name | No                        |
| Open an exact player/alliance profile        | No                        |
| Open a single-town coordinate                | No                        |
| `>goto`, `>dist`                             | No                        |
| Player/alliance town **drill-down** list      | Yes                       |
| Island **town listing** for a multi-town coordinate | Yes                 |
| `>ghost`, `>island`, `>near`, `>ocean`         | Yes                       |

Without the advisor active, gated actions show a short message instead of
the listing (and multi-town coordinates still resolve — you just get "open
on map" instead of the per-town breakdown).

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
- `Ctrl+B` (or the per-row BBCode icon) — copy BBCode for selected result.
- `Ctrl+F` — toggle favorite on selected result.
- `Ctrl+D` (or the bookmark icon in the search bar) — save the current query.
- `Ctrl+E` (or a saved search's pencil icon) — rename the selected saved search.
- `Delete` (or the per-row trash icon) — remove the selected entry from Recent history or Saved searches.
- `Ctrl+Shift+Delete` (or the "Clear" button) — wipe the Recent or Saved searches list the selected entry belongs to.
- `Ctrl+R` (or the "refresh" footer button) — force refresh world data.
- `Home` / `End` — jump to first or last result.
- `?` (or the "help" footer button) — toggle in-app help overlay (also shown via `>help`).
- `@p`, `@a`, `@t`, `@i`, `@c` — scope query to players, alliances, towns, islands, or coordinates.
- `>goto`, `>ghost`, `>dist`, `>island`, `>near`, `>ocean`, `>settings`, `>help` — execute commands.
- `↑` / `↓` — navigate results.
- `Enter` — open selected result.
- `Esc` — close palette.

## Development

This is a single-file userscript with no build step and no external dependencies. Edit `GrepolisQuickFinder.user.js` directly.

There is no debugging API exposed on `window` in production (no `window.QF`
or similar): the production build only reacts to user input (keyboard/mouse)
inside the palette itself. See `AGENTS.md` for the manual testing workflow
used during development instead.

## Privacy

See [PRIVACY.md](PRIVACY.md) for details on what data this script reads
locally and the only external network request involved (userscript
update checks against GitHub's raw content CDN).

## License

MIT License.
