# Privacy Policy — Grepolis Quick Finder

Grepolis Quick Finder is a client-side userscript. It does not collect,
store, or transmit any personal data to a server operated by the author.

## What the script does locally

- Reads the same-origin, publicly accessible game data dumps served by the
  Grepolis world you are visiting (`/data/players.txt`, `/data/alliances.txt`,
  `/data/towns.txt`, `/data/islands.txt`) to build a local search index.
- Caches that index in your browser's IndexedDB, scoped to the current world,
  with an automatic TTL (default 6 hours, configurable in Settings).
- Stores your favorites, recent search history, and settings (language,
  hotkey, cache duration, etc.) in your browser's `localStorage`, scoped to
  the Grepolis domain.

None of the above ever leaves your browser: there is no analytics, telemetry,
or first-party backend involved.

## External network requests

Network requests that reach outside `*.grepolis.com` all target the same
host, GitHub's raw content CDN (`raw.githubusercontent.com`), and come from
two independent sources:

1. **Your userscript manager's own update check.** Tampermonkey/
   Violentmonkey/Greasemonkey use the `@updateURL`/`@downloadURL` metadata in
   the script header to periodically check for and download script updates,
   on whatever schedule the manager uses (typically once every 24 hours),
   entirely outside this script's control. The URL depends on which channel
   you installed (Stable or Beta — see the README), e.g.:

   ```
   https://raw.githubusercontent.com/adrian-cancio/GrepolisQuickFinder/release/stable/GrepolisQuickFinder.user.js
   ```

2. **The script's own in-app update checker.** In addition to the manager's
   check above, the script itself performs a plain `fetch()` against the
   same URL your install came from (read via `GM_info`, never hardcoded), at
   most once every ~12 hours, plus whenever you press the "Check for
   updates" button in Settings. It reads only the `@version` line from the
   response to decide whether to show the "update available" toast/badge —
   nothing else in the response is used, and no request body/query
   parameters/identifying data are added by this script.

Both are plain, unauthenticated HTTPS GET requests. Like any HTTP request,
they inherently expose standard network-level metadata to GitHub and any
network intermediary (e.g. your IP address, user agent, and request
timestamp) — the same metadata every HTTPS request on the web exposes.

See GitHub's own privacy statement for how it handles requests to
`raw.githubusercontent.com`: https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement

## Third-party requests initiated by the script itself

None, beyond the same-origin `/data/*.txt` requests and the update-checker
request described above. The update-checker request stays limited to
`raw.githubusercontent.com` and carries no payload beyond a standard GET;
the `/data/*.txt` requests stay within the Grepolis world's own domain and
carry no more information than any other page load on that world already
does.

## Contact

Questions or concerns: open an issue at
https://github.com/adrian-cancio/GrepolisQuickFinder/issues
