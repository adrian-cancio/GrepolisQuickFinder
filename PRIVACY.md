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

The only network requests that reach outside `*.grepolis.com` are the ones
your userscript manager (Tampermonkey/Violentmonkey/Greasemonkey) performs on
its own, using the `@updateURL`/`@downloadURL` metadata in the script header,
to check for and download script updates from:

```
https://raw.githubusercontent.com/adrian-cancio/GrepolisQuickFinder/master/GrepolisQuickFinder.user.js
```

This is a plain, unauthenticated HTTPS GET request to GitHub's raw content
CDN. Like any HTTP request, it inherently exposes standard network-level
metadata to GitHub and any network intermediary (e.g. your IP address, user
agent, and request timestamp) — the same metadata every HTTPS request on the
web exposes. The script itself does not add any identifying information,
query parameters, or payload to this request; it is entirely managed by your
userscript manager's built-in update mechanism, on whatever schedule it uses
(typically once every 24 hours), not by code in this script.

See GitHub's own privacy statement for how it handles requests to
`raw.githubusercontent.com`: https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement

## Third-party requests initiated by the script itself

None, beyond the same-origin `/data/*.txt` requests described above, which
stay within the Grepolis world's own domain and carry no more information
than any other page load on that world already does.

## Contact

Questions or concerns: open an issue at
https://github.com/adrian-cancio/GrepolisQuickFinder/issues
