// ==UserScript==
// @name         Grepolis Quick Finder
// @namespace    https://github.com/adrian-cancio/GrepolisQuickFinder
// @version      2.14.0-beta.1
// @description  Quick palette (Ctrl+Shift+F) to search players, alliances and towns in Grepolis, with real in-game navigation, segments, commands, history/favorites and a local cache. Automatically localized based on the current world/market. (Privacy policy: https://github.com/adrian-cancio/GrepolisQuickFinder/blob/master/PRIVACY.md)
// @author       adrian-cancio
// @match        https://*.grepolis.com/game/*
// @match        http://*.grepolis.com/game/*
// @updateURL    https://raw.githubusercontent.com/adrian-cancio/GrepolisQuickFinder/release/stable/GrepolisQuickFinder.user.js
// @downloadURL  https://raw.githubusercontent.com/adrian-cancio/GrepolisQuickFinder/release/stable/GrepolisQuickFinder.user.js
// @homepageURL  https://github.com/adrian-cancio/GrepolisQuickFinder
// @supportURL   https://github.com/adrian-cancio/GrepolisQuickFinder/issues
// @icon         https://www.grepolis.com/favicon.ico
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '2.14.0-beta.1';

    /*
     * ============================================================
     * CONFIG
     * ============================================================
     */

    const CONFIG = {
        HOTKEY: 'f',              // Ctrl+Shift+<HOTKEY>
        MAX_RESULTS: 30,          // cap for command output (>ghost, >near, >ocean...)
        RESULTS_PAGE_SIZE: 40,    // free-text search: rows rendered per page, more load on scroll
        MIN_TOWN_QUERY_LENGTH: 2, // avoids listing half an island with 1 letter
        SEARCH_DELAY: 150,        // debounce in ms
        FAV_KEY: 'f',             // Ctrl+<FAV_KEY> inside the palette: toggle favorite
        REFRESH_KEY: 'r',         // Ctrl+<REFRESH_KEY> inside the palette: reload data
        BBCODE_KEY: 'b',          // Ctrl+<BBCODE_KEY> inside the palette: copy BBCode and close
        SAVE_SEARCH_KEY: 'd',     // Ctrl+<SAVE_SEARCH_KEY> inside the palette: save current query
        RENAME_KEY: 'e',          // Ctrl+<RENAME_KEY> inside the palette: rename selected saved search
        ORIGIN_KEY: 'o',          // Ctrl+<ORIGIN_KEY> inside the palette: pin selected row as distance origin
        NOTE_KEY: 'n',            // Ctrl+<NOTE_KEY> inside the palette: edit note on selected favorite
        EXPORT_KEY: 'b',          // Ctrl+Shift+<EXPORT_KEY> inside the palette: bulk-export visible rows as BBCode
        HELP_CHAR: '?',           // typing this alone shows the shortcuts/commands panel
        COMMAND_PREFIX: '>',      // commands: >goto, >ghost, >dist, >island, >near, >ocean, >help
        SEGMENTS: ['all', 'player', 'alliance', 'town', 'island', 'coordinate'],
        DEFAULT_SEGMENT: 'all',
        HISTORY_SEGMENTS: ['all', 'saved', 'favorite', 'recent'],
        DEFAULT_HISTORY_SEGMENT: 'all',
        SCOPE_ALIASES: { t: 'town', p: 'player', a: 'alliance', c: 'coordinate', i: 'island' },
        NEAR_MAX_RADIUS: 15,
        HISTORY_MAX: 12,
        FAVORITES_MAX: 30,
        SAVED_SEARCHES_MAX: 20,
        CACHE_TTL: 6 * 60 * 60 * 1000, // reuse world data for at most this long
        GHOST_MIN_POINTS: 0,
        HIERARCHY_MAX_DEPTH: 2, // alliance->player->town or island->town: at most 2 pushes
        UPDATE_CHECK_INTERVAL_MS: 12 * 60 * 60 * 1000, // throttle the background update check
        CONQUEST_HISTORY_ENABLED: false, // opt-in: /data/conquers.txt is multi-MB, see SETTINGS
        CONQUEST_HISTORY_CACHE_TTL: 6 * 60 * 60 * 1000, // same freshness window as the main cache
        RECENT_CONQUEST_WINDOW_MS: 3 * 24 * 60 * 60 * 1000, // "recently changed hands" badge threshold
        HISTORY_MAX_EVENTS: 12, // rows shown by >history before truncating
    };

    /*
     * ============================================================
     * SETTINGS (user-adjustable overrides for some of the CONFIG
     * values above, persisted globally in localStorage — shared by
     * every world, unlike history/favorites which are per-world.
     * Opened via the footer gear icon or the >settings command; see
     * the "SETTINGS PANEL" section further below for the UI/logic.
     * ============================================================
     */

    const SETTINGS_KEY = 'qf:settings';

    const SETTINGS_DEFAULTS = {
        language: 'auto', // 'auto' = derive from the world market, otherwise a LOCALES key
        hotkey: CONFIG.HOTKEY,
        resultsPageSize: CONFIG.RESULTS_PAGE_SIZE,
        maxResults: CONFIG.MAX_RESULTS,
        cacheTtlHours: CONFIG.CACHE_TTL / (60 * 60 * 1000),
        nearMaxRadius: CONFIG.NEAR_MAX_RADIUS,
        ghostMinPoints: CONFIG.GHOST_MIN_POINTS,
        conquestHistoryEnabled: CONFIG.CONQUEST_HISTORY_ENABLED,
    };

    const SETTINGS_BOUNDS = {
        resultsPageSize: { min: 10, max: 200 },
        maxResults: { min: 5, max: 100 },
        cacheTtlHours: { min: 1, max: 168 },
        nearMaxRadius: { min: 1, max: 50 },
        ghostMinPoints: { min: 0, max: 100000 },
    };

    let settings = { ...SETTINGS_DEFAULTS };

    /*
     * ============================================================
     * UPDATE CHECK
     * ============================================================
     *
     * Compares VERSION against the @version header of whatever file
     * GM_info.script.downloadURL points to (the channel this install
     * actually came from — Stable or Beta, whichever @updateURL the
     * user installed), so the checker never has to hardcode which
     * branch/channel is running. Throttled to run at most once per
     * UPDATE_CHECK_INTERVAL_MS via localStorage, and entirely silent
     * on failure: a network hiccup here must never affect the rest
     * of the script. See PRIVACY.md for what this request exposes.
     */

    const UPDATE_CHECK_KEY = 'qf:updateCheck';

    /*
     * Compares two "MAJOR.MINOR.PATCH[-beta.N]" version strings.
     * Returns >0 if a > b, <0 if a < b, 0 if equal. A clean release
     * always outranks any prerelease of the same MAJOR.MINOR.PATCH
     * (e.g. 2.12.0 > 2.12.0-beta.3); between two prereleases, the
     * -beta.N suffix is compared numerically.
     */
    function compareVersions(a, b) {
        const parse = (v) => {
            const match = String(v || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/);
            if (!match) return null;
            return {
                major: Number(match[1]),
                minor: Number(match[2]),
                patch: Number(match[3]),
                beta: match[4] === undefined ? null : Number(match[4]),
            };
        };
        const pa = parse(a);
        const pb = parse(b);
        if (!pa || !pb) return 0;

        if (pa.major !== pb.major) return pa.major - pb.major;
        if (pa.minor !== pb.minor) return pa.minor - pb.minor;
        if (pa.patch !== pb.patch) return pa.patch - pb.patch;
        if (pa.beta === pb.beta) return 0;
        if (pa.beta === null) return 1; // clean release beats any prerelease
        if (pb.beta === null) return -1;
        return pa.beta - pb.beta;
    }

    /*
     * Returns the URL this install should be checked against, derived
     * from GM_info (never hardcoded): whichever @downloadURL/@updateURL
     * the user's userscript manager installed this script from. Falls
     * back to null (checker disabled) when GM_info isn't available,
     * e.g. a manual dev injection without a real userscript manager.
     */
    function getUpdateCheckUrl() {
        try {
            const info = typeof GM_info !== 'undefined' ? GM_info : (typeof unsafeWindow !== 'undefined' ? unsafeWindow.GM_info : null);
            const script = info && info.script;
            return (script && (script.downloadURL || script.updateURL)) || null;
        } catch (_) {
            return null;
        }
    }

    function loadUpdateCheckState() {
        try {
            const raw = localStorage.getItem(UPDATE_CHECK_KEY);
            if (!raw) return { lastCheckedAt: 0, remoteVersion: null };
            const parsed = JSON.parse(raw);
            return {
                lastCheckedAt: Number(parsed && parsed.lastCheckedAt) || 0,
                remoteVersion: (parsed && parsed.remoteVersion) || null,
            };
        } catch (_) {
            return { lastCheckedAt: 0, remoteVersion: null };
        }
    }

    function saveUpdateCheckState(update) {
        try {
            const current = loadUpdateCheckState();
            localStorage.setItem(UPDATE_CHECK_KEY, JSON.stringify({ ...current, ...update }));
        } catch (_) {
            // Best-effort: a failed write here just means we re-check sooner.
        }
    }

    /*
     * Fetches the raw .user.js text from `url` and extracts its
     * @version header value. Returns null on any failure (network
     * error, timeout, missing header) — callers treat that as "no
     * update info available" rather than an error to surface.
     */
    function fetchRemoteVersion(url) {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;

        return fetch(url, { cache: 'no-store', signal: controller ? controller.signal : undefined })
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.text();
            })
            .then((text) => {
                const match = text.match(/@version\s+([^\s]+)/);
                return match ? match[1] : null;
            })
            .catch(() => null)
            .finally(() => {
                if (timeoutId) clearTimeout(timeoutId);
            });
    }

    /*
     * Runs the update check (throttled unless force=true) and updates
     * state.updateAvailable with the remote version string, or null
     * if the current install is already up to date / the check could
     * not run. Never throws; safe to call fire-and-forget.
     */
    function checkForUpdates(options) {
        const force = Boolean(options && options.force);
        const url = getUpdateCheckUrl();
        if (!url) return Promise.resolve(null);

        const saved = loadUpdateCheckState();
        const age = Date.now() - saved.lastCheckedAt;
        if (!force && age < CONFIG.UPDATE_CHECK_INTERVAL_MS) {
            state.updateAvailable = compareVersions(saved.remoteVersion, VERSION) > 0 ? saved.remoteVersion : null;
            return Promise.resolve(state.updateAvailable);
        }

        return fetchRemoteVersion(url).then((remoteVersion) => {
            saveUpdateCheckState({ lastCheckedAt: Date.now(), remoteVersion });
            state.updateAvailable = remoteVersion && compareVersions(remoteVersion, VERSION) > 0 ? remoteVersion : null;
            return state.updateAvailable;
        });
    }

    /*
     * ============================================================
     * I18N (localization based on the current Grepolis market)
     * ============================================================
     *
     * Grepolis worlds are hosted on subdomains shaped like
     * "<market><number>.grepolis.com" (e.g. en37, es12, zz2).
     * The 2-letter market prefix maps 1:1 to the game's own market
     * IDs, which was confirmed directly against the official
     * onboarding endpoint (https://om.grepolis.com/grepo/<market>),
     * whose runtime config exposes the exact "lang"/"locale" pair
     * used by the game client itself for every market:
     *
     *   en -> en_DK   es -> es_ES   de -> de_DE   fr -> fr_FR
     *   it -> it_IT   nl -> nl_NL   pl -> pl_PL   pt -> pt_PT
     *   tr -> tr_TR   ru -> ru_RU   gr -> el_GR   hu -> hu_HU
     *   ro -> ro_RO   cz -> cs_CZ   sk -> sk_SK   br -> pt_BR
     *   us -> en_US   ar -> es_AR   zz -> en_DK (international/beta)
     *
     * MARKET_TO_LANGUAGE maps each market prefix to one of the
     * translation dictionaries in LOCALES below. Markets that share
     * a language with another market (us/zz -> English, ar -> the
     * Spanish used in Argentina, br -> Brazilian Portuguese) reuse
     * the closest dictionary. Any market not listed here falls back
     * to English.
     */

    const MARKET_TO_LANGUAGE = {
        en: 'en', us: 'en', zz: 'en',
        es: 'es', ar: 'es',
        de: 'de',
        fr: 'fr',
        it: 'it',
        nl: 'nl',
        pl: 'pl',
        pt: 'pt',
        br: 'br',
        tr: 'tr',
        ru: 'ru',
        gr: 'el',
        hu: 'hu',
        ro: 'ro',
        cz: 'cs',
        sk: 'sk',
    };

    const LOCALES = {
        en: {
            searchPlaceholder: 'Search players, alliances or towns...',
            footerNavigate: '\u2191 \u2193 navigate',
            footerOpen: 'Enter to open',
            shortcutsEscTwoStage: 'Close panel / palette (press twice if a detail pane is open)',
            emptyTitle: 'Search Grepolis',
            emptySubtitle: 'Players \u00b7 Alliances \u00b7 Towns',
            emptyHintCoords: 'You can also enter coordinates: <strong>{example}</strong>',
            emptyHintCommands: 'Type <strong>&gt;</strong> for commands (ghost towns, distances...) or <strong>?</strong> for all shortcuts.',
            loadingWorldData: 'Loading world data...',
            noResults: 'No results found.',
            resultsMore: 'Showing {shown} of {total} \u2014 scroll for more',
            errorLoadingDataGeneric: 'Could not load world data. Try refreshing.',
            errorLoadingDataTimeout: 'The request took too long. Check your connection and try refreshing.',
            errorLoadingDataWorldNotDetected: 'Could not detect the current world.',
            badgePlayer: 'Player',
            badgeAlliance: 'Alliance',
            badgeTown: 'Town',
            badgeCoordinate: 'Coordinates',
            ptsSuffix: 'pts',
            membersSuffix: 'members',
            segmentAll: 'All',
            segmentPlayers: 'Players',
            segmentAlliances: 'Alliances',
            segmentTowns: 'Towns',
            segmentCoords: 'Coords',
            townsSuffix: 'towns',
            onIslandInfo: '{n} towns on this island',
            favoritesTitle: 'Favorites',
            recentTitle: 'Recent',
            recentClearAll: 'Clear',
            recentRemove: 'Remove from history',
            recentCleared: 'Recent history cleared',
            footerTab: 'Tab filter',
            footerFav: 'Ctrl+F favorite',
            footerBBCode: 'Ctrl+B copy BBCode',
            footerExport: 'Export list',
            exportEmpty: 'Nothing to export in the current list.',
            exportCopied: 'Copied {n} BBCode entries',
            bbcodeCopied: 'Copied',
            footerRefresh: 'Ctrl+R refresh',
            footerHelp: '? help',
            menuItem: 'QuickFinder',
            dataFresh: 'Data fresh',
            dataFreshMin: 'Data {n} min old',
            dataFreshHour: 'Data {n} h old',
            dataFreshDay: 'Data {n} d old',
            dataError: 'Data error',
            shortcutsTitle: 'Shortcuts',
            shortcutsFirstLast: 'Jump to first/last result',
            shortcutsRemoveRecent: 'Remove selected from history',
            shortcutsClearRecent: 'Clear entire Recent list',
            shortcutsHelp: 'Show this help',
            commandHelpTitle: 'Commands',
            commandGotoHelp: '>goto 123:456 \u2014 jump to an island',
            commandGhostHelp: '>ghost [minPts] [near] \u2014 ghost towns by points or distance',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 island distance',
            commandIslandHelp: '>island X:Y \u2014 every town on an island',
            commandNearHelp: '>near [X:Y] [radius] \u2014 islands around a point',
            commandOceanHelp: '>ocean M34 [alliance] \u2014 ocean snapshot',
            commandHelpHint: '>help \u2014 show this list',
            commandUnknown: 'Unknown command: {cmd}',
            premiumRequired: 'Requires the Administrator advisor (Premium) to be active.',
            ghostEmpty: 'No ghost towns found.',
            distResult: 'Island distance: {n}',
            distFromActive: 'from your active city',
            distFromOrigin: 'from the pinned origin',
            distNeedOrigin: 'Give two coordinates, or one if your active city can be detected.',
            originSet: 'Origin set to {x}:{y}',
            originSetTooltip: 'Set as distance origin (Ctrl+O)',
            originCleared: 'Origin cleared',
            originIndicator: 'Origin {x}:{y}',
            originIndicatorTooltip: 'Click to clear the pinned origin',
            shortcutsSetOrigin: 'Set as distance origin',
            favoriteNoteTooltip: 'Edit note (Ctrl+N)',
            favoriteNoteTitle: 'Note for {name}',
            favoriteNoteLabel: 'Note',
            favoriteNoteSaved: 'Note saved',
            shortcutsEditNote: 'Edit note on selected favorite',
            distBandSame: 'same island',
            distBandAdjacent: 'adjacent islands',
            distBandRegional: 'regional',
            distBandFar: 'long range',
            scopeHelpTitle: 'Scopes',
            scopeHelpDesc: '@p players \u00b7 @a alliances \u00b7 @t towns \u00b7 @i islands \u00b7 @c coordinates',
            badgeIsland: 'Island',
            badgeCommand: 'Command',
            segmentIslands: 'Islands',
            ghostLabel: 'Ghost',
            islandTowns: '{n} towns',
            islandAlliances: '{n} alliances',
            islandGhosts: '{n} ghosts',
            openIslandMap: 'Open island on the map',
            nearSummary: '{islands} islands \u00b7 {towns} towns within {n}',
            nearNeedOrigin: 'Give a radius, or coordinates plus a radius. The active city is used when it can be detected.',
            oceanEmpty: 'Nothing indexed in that ocean.',
            oceanNeed: 'Use >ocean M34 or >ocean M34 AllianceName.',
            oceanSummary: '{players} players \u00b7 {alliances} alliances \u00b7 {towns} towns \u00b7 {ghosts} ghosts',
            playerTownsTitle: 'Towns',
            allianceSpreadTitle: 'Where they sit',
            allianceMembersTitle: 'Members',
            drillTowns: 'show towns',
            sortPoints: 'by points',
            sortDistance: 'by distance',
            shortcutsOpen: 'Open/close QuickFinder',
            commandSettingsHelp: '>settings — open the settings panel',
            settingsTitle: 'Settings',
            settingsLanguage: 'Language',
            settingsLanguageAuto: 'Automatic (detected from world)',
            settingsHotkey: 'Keyboard shortcut',
            settingsPageSize: 'Results per page',
            settingsMaxResults: 'Max. command results',
            settingsCacheTtl: 'Data cache (hours)',
            settingsNearRadius: 'Max. radius for >near',
            settingsGhostMin: 'Default min. points for >ghost',
            settingsSave: 'Save',
            settingsReset: 'Reset to defaults',
            settingsSaved: 'Settings saved',
            settingsResetDone: 'Settings reset to defaults',
            segmentSaved: 'Saved',
            segmentFavorites: 'Favorites',
            segmentRecent: 'Recent',
            savedSearchesTitle: 'Saved searches',
            savedSearchesCleared: 'Saved searches cleared',
            saveSearchTooltip: 'Ctrl+D save search',
            saveSearchPanelTitle: 'Save search',
            saveSearchEditTitle: 'Rename saved search',
            saveSearchEditTooltip: 'Rename (Ctrl+E)',
            saveSearchNameLabel: 'Name',
            saveSearchSave: 'Save',
            saveSearchCancel: 'Cancel',
            saveSearchSaved: 'Search saved',
            saveSearchRenamed: 'Saved search renamed',
            saveSearchRemove: 'Remove saved search',
            badgeSavedSearch: 'Saved',
            shortcutsSaveSearch: 'Save current search',
            shortcutsRenameSaved: 'Rename selected saved search',
            hierarchyDrillTooltip: 'View details (→)',
            shortcutsHierarchyNav: '← → drill in/out',
            updateAvailableToast: 'A new version ({version}) is available.',
            updateAvailableTooltip: 'New version {version} available — click to download',
            settingsCheckUpdates: 'Check for updates',
            updateUpToDate: 'You already have the latest version',
            settingsConquestHistory: 'Enable conquest history',
            settingsConquestHistoryHint: 'Downloads a multi-MB file (conquers.txt) to power >history',
            islandTownsWithCapacity: '{n}/{cap} towns',
            recentlyConquered: 'conquered {n}d ago',
            lastActivity: 'last activity {n}d ago',
            commandHistoryHelp: '>history <name|x:y> — conquest history for a town, player or coordinate',
            commandTravelHelp: '>travel <unit,...> [X:Y] [X:Y] [sirens=N] — troop travel time',
            commandTopHelp: '>top players|alliances [N] — points ranking',
            commandVsHelp: '>vs <alliance1> vs <alliance2> — compare two alliances',
            travelUnknownUnit: 'Unknown unit: {unit}',
            travelCalcFailed: 'Could not calculate travel time (missing live game data).',
            travelLimitedBy: 'Limited by: {unit}',
            travelColonizeShipLimit: 'This exceeds the normal 48h colony ship limit.',
            travelFlyingNote: 'Flying units can cross islands without a transport ship.',
            travelNoBonusData: 'City research/building bonuses unavailable — showing base speed only.',
            travelUsedActiveCity: 'Used your active city\u2019s bonuses (origin isn\u2019t one of your towns).',
            travelScopeNote: 'Does not include the Olympus Great Temple of Ares bonus or hero effects.',
            historyEmpty: 'No conquest history recorded for this entity.',
            historyNotLoaded: 'Conquest history is still loading...',
            historyDisabled: 'Enable "conquest history" in Settings to use >history.',
            historyGhost: 'nobody (ghost)',
            historyEventConquest: '{from} \u2192 {to}',
            historyEventColonized: 'colonized by {to}',
            historyEventCount: '{n} recorded events',
            historyPlayerSummary: '{conquered} conquered \u00b7 {lost} lost',
        },
        es: {
            searchPlaceholder: 'Buscar jugadores, alianzas o ciudades...',
            footerNavigate: '\u2191 \u2193 seleccionar',
            footerOpen: 'Enter abrir',
            shortcutsEscTwoStage: 'Cerrar panel / paleta (pulsa dos veces si hay un panel de detalle abierto)',
            emptyTitle: 'Buscar en Grepolis',
            emptySubtitle: 'Jugadores \u00b7 Alianzas \u00b7 Ciudades',
            emptyHintCoords: 'Tambi\u00e9n puedes introducir coordenadas: <strong>{example}</strong>',
            emptyHintCommands: 'Escribe <strong>&gt;</strong> para comandos (ciudades fantasma, distancias...) o <strong>?</strong> para ver todos los atajos.',
            loadingWorldData: 'Cargando datos del mundo...',
            noResults: 'No se encontraron resultados.',
            resultsMore: 'Mostrando {shown} de {total} \u2014 desplaza para ver m\u00e1s',
            errorLoadingDataGeneric: 'No se pudieron cargar los datos del mundo. Intenta refrescar.',
            errorLoadingDataTimeout: 'La solicitud tardó demasiado. Revisa tu conexión e intenta refrescar.',
            errorLoadingDataWorldNotDetected: 'No se pudo detectar el mundo actual.',
            badgePlayer: 'Jugador',
            badgeAlliance: 'Alianza',
            badgeTown: 'Ciudad',
            badgeCoordinate: 'Coordenadas',
            ptsSuffix: 'pts',
            membersSuffix: 'miembros',
            segmentAll: 'Todo',
            segmentPlayers: 'Jugadores',
            segmentAlliances: 'Alianzas',
            segmentTowns: 'Ciudades',
            segmentCoords: 'Coord',
            townsSuffix: 'ciudades',
            onIslandInfo: '{n} ciudades en esta isla',
            favoritesTitle: 'Favoritos',
            recentTitle: 'Recientes',
            recentClearAll: 'Vaciar',
            recentRemove: 'Quitar del historial',
            recentCleared: 'Historial reciente vaciado',
            footerTab: 'Tab filtrar',
            footerFav: 'Ctrl+F favoritos',
            footerBBCode: 'Ctrl+B copiar BBCode',
            footerExport: 'Exportar lista',
            exportEmpty: 'Nada que exportar en la lista actual.',
            exportCopied: 'Copiadas {n} entradas BBCode',
            bbcodeCopied: 'Copiado',
            footerRefresh: 'Ctrl+R recargar',
            footerHelp: '? ayuda',
            menuItem: 'QuickFinder',
            dataFresh: 'Datos nuevos',
            dataFreshMin: 'Datos de hace {n} min',
            dataFreshHour: 'Datos de hace {n} h',
            dataFreshDay: 'Datos de hace {n} d',
            dataError: 'Error de datos',
            shortcutsTitle: 'Atajos',
            shortcutsFirstLast: 'saltar al primer/\u00faltimo resultado',
            shortcutsRemoveRecent: 'Quitar el seleccionado del historial',
            shortcutsClearRecent: 'Vaciar todo el historial reciente',
            shortcutsHelp: 'mostrar esta ayuda',
            commandHelpTitle: 'Comandos',
            commandGotoHelp: '>goto 123:456 \u2014 saltar a una isla',
            commandGhostHelp: '>ghost [minPts] [near] \u2014 fantasmas por puntos o distancia',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 distancia de islas',
            commandIslandHelp: '>island X:Y \u2014 todas las ciudades de una isla',
            commandNearHelp: '>near [X:Y] [radio] \u2014 islas alrededor de un punto',
            commandOceanHelp: '>ocean M34 [alianza] \u2014 resumen del oc\u00e9ano',
            commandHelpHint: '>help \u2014 mostrar esta lista',
            commandUnknown: 'Comando desconocido: {cmd}',
            premiumRequired: 'Requiere tener activo el asesor Administrador (Premium).',
            ghostEmpty: 'No se encontraron ciudades fantasma.',
            distResult: 'Distancia de islas: {n}',
            distFromActive: 'desde tu ciudad activa',
            distFromOrigin: 'desde el origen fijado',
            distNeedOrigin: 'Da dos coordenadas, o una si se puede detectar tu ciudad activa.',
            originSet: 'Origen fijado en {x}:{y}',
            originSetTooltip: 'Fijar como origen de distancia (Ctrl+O)',
            originCleared: 'Origen eliminado',
            originIndicator: 'Origen {x}:{y}',
            originIndicatorTooltip: 'Haz clic para eliminar el origen fijado',
            shortcutsSetOrigin: 'Fijar como origen de distancia',
            favoriteNoteTooltip: 'Editar nota (Ctrl+N)',
            favoriteNoteTitle: 'Nota para {name}',
            favoriteNoteLabel: 'Nota',
            favoriteNoteSaved: 'Nota guardada',
            shortcutsEditNote: 'Editar nota del favorito seleccionado',
            distBandSame: 'misma isla',
            distBandAdjacent: 'islas adyacentes',
            distBandRegional: 'regional',
            distBandFar: 'larga distancia',
            scopeHelpTitle: 'Ambitos',
            scopeHelpDesc: '@p jugadores \u00b7 @a alianzas \u00b7 @t ciudades \u00b7 @i islas \u00b7 @c coordenadas',
            badgeIsland: 'Isla',
            badgeCommand: 'Comando',
            segmentIslands: 'Islas',
            ghostLabel: 'Fantasma',
            islandTowns: '{n} ciudades',
            islandAlliances: '{n} alianzas',
            islandGhosts: '{n} fantasmas',
            openIslandMap: 'Abrir isla en el mapa',
            nearSummary: '{islands} islas \u00b7 {towns} ciudades a {n} o menos',
            nearNeedOrigin: 'Da un radio, o coordenadas y un radio. Si se detecta, se usa la ciudad activa.',
            oceanEmpty: 'No hay nada indexado en ese oc\u00e9ano.',
            oceanNeed: 'Usa >ocean M34 o >ocean M34 NombreAlianza.',
            oceanSummary: '{players} jugadores \u00b7 {alliances} alianzas \u00b7 {towns} ciudades \u00b7 {ghosts} fantasmas',
            playerTownsTitle: 'Ciudades',
            allianceSpreadTitle: 'D\u00f3nde est\u00e1n',
            allianceMembersTitle: 'Miembros',
            drillTowns: 'ver ciudades',
            sortPoints: 'por puntos',
            sortDistance: 'por distancia',
            shortcutsOpen: 'Abrir/cerrar QuickFinder',
            commandSettingsHelp: '>settings — abrir el panel de ajustes',
            settingsTitle: 'Ajustes',
            settingsLanguage: 'Idioma',
            settingsLanguageAuto: 'Automático (detectado del mundo)',
            settingsHotkey: 'Atajo de teclado',
            settingsPageSize: 'Resultados por página',
            settingsMaxResults: 'Máx. resultados de comandos',
            settingsCacheTtl: 'Caché de datos (horas)',
            settingsNearRadius: 'Radio máx. para >near',
            settingsGhostMin: 'Puntos mín. por defecto para >ghost',
            settingsSave: 'Guardar',
            settingsReset: 'Restablecer valores',
            settingsSaved: 'Ajustes guardados',
            settingsResetDone: 'Ajustes restablecidos',
            segmentSaved: 'Guardadas',
            segmentFavorites: 'Favoritos',
            segmentRecent: 'Recientes',
            savedSearchesTitle: 'Búsquedas guardadas',
            savedSearchesCleared: 'Búsquedas guardadas vaciadas',
            saveSearchTooltip: 'Ctrl+D guardar búsqueda',
            saveSearchPanelTitle: 'Guardar búsqueda',
            saveSearchEditTitle: 'Renombrar búsqueda guardada',
            saveSearchEditTooltip: 'Renombrar (Ctrl+E)',
            saveSearchNameLabel: 'Nombre',
            saveSearchSave: 'Guardar',
            saveSearchCancel: 'Cancelar',
            saveSearchSaved: 'Búsqueda guardada',
            saveSearchRenamed: 'Búsqueda guardada renombrada',
            saveSearchRemove: 'Eliminar búsqueda guardada',
            badgeSavedSearch: 'Guardada',
            shortcutsSaveSearch: 'Guardar búsqueda actual',
            shortcutsRenameSaved: 'Renombrar la búsqueda guardada seleccionada',
            hierarchyDrillTooltip: 'Ver detalles (→)',
            shortcutsHierarchyNav: '← → entrar/salir',
            updateAvailableToast: 'Hay una nueva versión disponible ({version}).',
            updateAvailableTooltip: 'Nueva versión {version} disponible — haz clic para descargar',
            settingsCheckUpdates: 'Buscar actualizaciones',
            updateUpToDate: 'Ya tienes la última versión',
            settingsConquestHistory: 'Activar historial de conquistas',
            settingsConquestHistoryHint: 'Descarga un archivo de varios MB (conquers.txt) para >history',
            islandTownsWithCapacity: '{n}/{cap} ciudades',
            recentlyConquered: 'conquistada hace {n}d',
            lastActivity: 'última actividad hace {n}d',
            commandHistoryHelp: '>history <nombre|x:y> — historial de conquistas de una ciudad, jugador o coordenada',
            commandTravelHelp: '>travel <unidad,...> [X:Y] [X:Y] [sirens=N] — tiempo de viaje de tropas',
            commandTopHelp: '>top players|alliances [N] — ranking por puntos',
            commandVsHelp: '>vs <alianza1> vs <alianza2> — compara dos alianzas',
            travelUnknownUnit: 'Unidad desconocida: {unit}',
            travelCalcFailed: 'No se pudo calcular el tiempo de viaje (faltan datos en vivo del juego).',
            travelLimitedBy: 'Limitado por: {unit}',
            travelColonizeShipLimit: 'Esto supera el l\u00edmite normal de 48h del barco de colonizaci\u00f3n.',
            travelFlyingNote: 'Las unidades voladoras pueden cruzar islas sin barco de transporte.',
            travelNoBonusData: 'Bonificaciones de investigaci\u00f3n/edificios no disponibles: se muestra solo la velocidad base.',
            travelUsedActiveCity: 'Se usaron las bonificaciones de tu ciudad activa (el origen no es una de tus ciudades).',
            travelScopeNote: 'No incluye la bonificaci\u00f3n del Gran Templo de Ares de Olimpo ni efectos de h\u00e9roe.',
            historyEmpty: 'No hay historial de conquistas registrado para esto.',
            historyNotLoaded: 'Cargando historial de conquistas...',
            historyDisabled: 'Activa "historial de conquistas" en Ajustes para usar >history.',
            historyGhost: 'nadie (fantasma)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'colonizada por {to}',
            historyEventCount: '{n} eventos registrados',
            historyPlayerSummary: '{conquered} conquistadas · {lost} perdidas',
        },
        de: {
            searchPlaceholder: 'Spieler, Allianzen oder St\u00e4dte suchen...',
            footerNavigate: '\u2191 \u2193 ausw\u00e4hlen',
            footerOpen: 'Enter \u00f6ffnen',
            shortcutsEscTwoStage: 'Panel/Palette schließen (bei geöffnetem Detailbereich zweimal drücken)',
            emptyTitle: 'Grepolis durchsuchen',
            emptySubtitle: 'Spieler \u00b7 Allianzen \u00b7 St\u00e4dte',
            emptyHintCoords: 'Du kannst auch Koordinaten eingeben: <strong>{example}</strong>',
            emptyHintCommands: 'Gib <strong>&gt;</strong> für Befehle ein (Geisterstädte, Entfernungen ...) oder <strong>?</strong> für alle Tastenkürzel.',
            loadingWorldData: 'Weltdaten werden geladen...',
            noResults: 'Keine Ergebnisse gefunden.',
            resultsMore: '{shown} von {total} angezeigt \u2014 scrollen f\u00fcr mehr',
            errorLoadingDataGeneric: 'Weltdaten konnten nicht geladen werden. Bitte aktualisieren.',
            errorLoadingDataTimeout: 'Die Anfrage hat zu lange gedauert. Überprüfe deine Verbindung und aktualisiere erneut.',
            errorLoadingDataWorldNotDetected: 'Die aktuelle Welt konnte nicht erkannt werden.',
            badgePlayer: 'Spieler',
            badgeAlliance: 'Allianz',
            badgeTown: 'Stadt',
            badgeCoordinate: 'Koordinaten',
            ptsSuffix: 'Punkte',
            membersSuffix: 'Mitglieder',
            segmentAll: 'Alle',
            segmentPlayers: 'Spieler',
            segmentAlliances: 'Allianzen',
            segmentTowns: 'St\u00e4dte',
            segmentCoords: 'Koordinaten',
            townsSuffix: 'St\u00e4dte',
            onIslandInfo: '{n} St\u00e4dte auf dieser Insel',
            favoritesTitle: 'Favoriten',
            recentTitle: 'Zuletzt',
            recentClearAll: 'Leeren',
            recentRemove: 'Aus dem Verlauf entfernen',
            recentCleared: 'Verlauf geleert',
            footerTab: 'Tab filter',
            footerFav: 'Strg+F Favorit',
            footerBBCode: 'Strg+B BBCode kopieren',
            footerExport: 'Liste exportieren',
            exportEmpty: 'Nichts zu exportieren in der aktuellen Liste.',
            exportCopied: '{n} BBCode-Eintr\u00e4ge kopiert',
            bbcodeCopied: 'Kopiert',
            footerRefresh: 'Strg+R aktualisieren',
            footerHelp: '? Hilfe',
            menuItem: 'QuickFinder',
            dataFresh: 'Daten aktuell',
            dataFreshMin: 'Daten {n} Min. alt',
            dataFreshHour: 'Daten {n} Std. alt',
            dataFreshDay: 'Daten {n} T. alt',
            dataError: 'Datenfehler',
            shortcutsTitle: 'Tastenk\u00fcrzel',
            shortcutsFirstLast: 'zum ersten/letzten Ergebnis springen',
            shortcutsRemoveRecent: 'Ausgewähltes aus dem Verlauf entfernen',
            shortcutsClearRecent: 'Gesamten Verlauf leeren',
            shortcutsHelp: 'diese Hilfe anzeigen',
            commandHelpTitle: 'Befehle',
            commandGotoHelp: '>goto 123:456 \u2014 zu einer Insel springen',
            commandGhostHelp: '>ghost [minPkt] \u2014 Geisterst\u00e4dte auflisten',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 Inselentfernung',
            commandHelpHint: '>help \u2014 diese Liste zeigen',
            commandUnknown: 'Unbekannter Befehl: {cmd}',
            premiumRequired: 'Erfordert den aktiven Berater Verwalter (Premium).',
            ghostEmpty: 'Keine Geisterst\u00e4dte gefunden.',
            distResult: 'Inselentfernung: {n}',
            distFromActive: 'von deiner aktiven Stadt',
            distFromOrigin: 'vom festgelegten Ursprung',
            distNeedOrigin: 'Gib zwei Koordinaten an, oder eine, wenn deine aktive Stadt erkannt werden kann.',
            originSet: 'Ursprung auf {x}:{y} gesetzt',
            originSetTooltip: 'Als Distanz-Ursprung festlegen (Strg+O)',
            originCleared: 'Ursprung entfernt',
            originIndicator: 'Ursprung {x}:{y}',
            originIndicatorTooltip: 'Klicken, um den festgelegten Ursprung zu entfernen',
            shortcutsSetOrigin: 'Als Distanz-Ursprung festlegen',
            favoriteNoteTooltip: 'Notiz bearbeiten (Strg+N)',
            favoriteNoteTitle: 'Notiz f\u00fcr {name}',
            favoriteNoteLabel: 'Notiz',
            favoriteNoteSaved: 'Notiz gespeichert',
            shortcutsEditNote: 'Notiz des ausgew\u00e4hlten Favoriten bearbeiten',
            scopeHelpTitle: 'Bereiche',
            scopeHelpDesc: '@p Spieler \u00b7 @a Allianzen \u00b7 @t St\u00e4dte \u00b7 @c Koordinaten',
            commandIslandHelp: '>island X:Y \u2014 alle St\u00e4dte einer Insel',
            commandNearHelp: '>near [X:Y] [Radius] \u2014 Inseln um einen Punkt',
            commandOceanHelp: '>ocean M34 [Allianz] \u2014 Ozean-\u00dcbersicht',
            distBandSame: 'gleiche Insel',
            distBandAdjacent: 'benachbarte Inseln',
            distBandRegional: 'regional',
            distBandFar: 'weite Entfernung',
            badgeIsland: 'Insel',
            badgeCommand: 'Befehl',
            segmentIslands: 'Inseln',
            ghostLabel: 'Geist',
            islandTowns: '{n} St\u00e4dte',
            islandAlliances: '{n} Allianzen',
            islandGhosts: '{n} Geisterst\u00e4dte',
            openIslandMap: 'Insel auf der Karte \u00f6ffnen',
            nearSummary: '{islands} Inseln \u00b7 {towns} St\u00e4dte innerhalb {n}',
            nearNeedOrigin: 'Gib einen Radius an, oder Koordinaten plus Radius. Deine aktive Stadt wird verwendet, wenn sie erkannt werden kann.',
            oceanEmpty: 'In diesem Ozean ist nichts indexiert.',
            oceanNeed: 'Verwende >ocean M34 oder >ocean M34 Allianzname.',
            oceanSummary: '{players} Spieler \u00b7 {alliances} Allianzen \u00b7 {towns} St\u00e4dte \u00b7 {ghosts} Geisterst\u00e4dte',
            playerTownsTitle: 'St\u00e4dte',
            allianceSpreadTitle: 'Wo sie sitzen',
            allianceMembersTitle: 'Mitglieder',
            drillTowns: 'Städte anzeigen',
            sortPoints: 'nach Punkten',
            sortDistance: 'nach Entfernung',
            shortcutsOpen: 'QuickFinder öffnen/schließen',
            commandSettingsHelp: '>settings — Einstellungen öffnen',
            settingsTitle: 'Einstellungen',
            settingsLanguage: 'Sprache',
            settingsLanguageAuto: 'Automatisch (anhand der Welt erkannt)',
            settingsHotkey: 'Tastenkürzel',
            settingsPageSize: 'Ergebnisse pro Seite',
            settingsMaxResults: 'Max. Befehlsergebnisse',
            settingsCacheTtl: 'Daten-Cache (Stunden)',
            settingsNearRadius: 'Max. Radius für >near',
            settingsGhostMin: 'Standard-Mindestpunkte für >ghost',
            settingsSave: 'Speichern',
            settingsReset: 'Auf Standard zurücksetzen',
            settingsSaved: 'Einstellungen gespeichert',
            settingsResetDone: 'Einstellungen zurückgesetzt',
            segmentSaved: 'Gespeichert',
            segmentFavorites: 'Favoriten',
            segmentRecent: 'Zuletzt',
            savedSearchesTitle: 'Gespeicherte Suchen',
            savedSearchesCleared: 'Gespeicherte Suchen geleert',
            saveSearchTooltip: 'Strg+D Suche speichern',
            saveSearchPanelTitle: 'Suche speichern',
            saveSearchEditTitle: 'Gespeicherte Suche umbenennen',
            saveSearchEditTooltip: 'Umbenennen (Strg+E)',
            saveSearchNameLabel: 'Name',
            saveSearchSave: 'Speichern',
            saveSearchCancel: 'Abbrechen',
            saveSearchSaved: 'Suche gespeichert',
            saveSearchRenamed: 'Gespeicherte Suche umbenannt',
            saveSearchRemove: 'Gespeicherte Suche entfernen',
            badgeSavedSearch: 'Gespeichert',
            shortcutsSaveSearch: 'Aktuelle Suche speichern',
            shortcutsRenameSaved: 'Ausgewählte gespeicherte Suche umbenennen',
            hierarchyDrillTooltip: 'Details anzeigen (→)',
            shortcutsHierarchyNav: '← → rein/raus',
            updateAvailableToast: 'Eine neue Version ({version}) ist verfügbar.',
            updateAvailableTooltip: 'Neue Version {version} verfügbar — klicken zum Herunterladen',
            settingsCheckUpdates: 'Nach Updates suchen',
            updateUpToDate: 'Du hast bereits die neueste Version',
            settingsConquestHistory: 'Eroberungshistorie aktivieren',
            settingsConquestHistoryHint: 'Lädt eine mehrere MB große Datei (conquers.txt) für >history',
            islandTownsWithCapacity: '{n}/{cap} Städte',
            recentlyConquered: 'erobert vor {n}T',
            lastActivity: 'letzte Aktivität vor {n}T',
            commandHistoryHelp: '>history <Name|x:y> — Eroberungshistorie einer Stadt, eines Spielers oder einer Koordinate',
            commandTravelHelp: '>travel <Einheit,...> [X:Y] [X:Y] [sirens=N] — Reisezeit der Truppen',
            commandTopHelp: '>top players|alliances [N] — Punkte-Rangliste',
            commandVsHelp: '>vs <Allianz1> vs <Allianz2> — vergleicht zwei Allianzen',
            travelUnknownUnit: 'Unbekannte Einheit: {unit}',
            travelCalcFailed: 'Reisezeit konnte nicht berechnet werden (Live-Spieldaten fehlen).',
            travelLimitedBy: 'Begrenzt durch: {unit}',
            travelColonizeShipLimit: 'Dies \u00fcberschreitet das normale 48h-Limit des Kolonisationsschiffs.',
            travelFlyingNote: 'Fliegende Einheiten k\u00f6nnen Inseln ohne Transportschiff \u00fcberqueren.',
            travelNoBonusData: 'Forschungs-/Geb\u00e4udeboni der Stadt nicht verf\u00fcgbar — es wird nur die Grundgeschwindigkeit angezeigt.',
            travelUsedActiveCity: 'Boni deiner aktiven Stadt verwendet (Ursprung ist keine deiner St\u00e4dte).',
            travelScopeNote: 'Enth\u00e4lt nicht den Bonus des Olymp-Gro\u00dftempels des Ares oder Heldeneffekte.',
            historyEmpty: 'Keine Eroberungshistorie für diese Einheit vorhanden.',
            historyNotLoaded: 'Eroberungshistorie wird noch geladen...',
            historyDisabled: 'Aktiviere "Eroberungshistorie" in den Einstellungen, um >history zu nutzen.',
            historyGhost: 'niemand (Geist)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'gegründet von {to}',
            historyEventCount: '{n} erfasste Ereignisse',
            historyPlayerSummary: '{conquered} erobert · {lost} verloren',
        },
        fr: {
            searchPlaceholder: 'Rechercher des joueurs, alliances ou villes...',
            footerNavigate: '\u2191 \u2193 s\u00e9lectionner',
            footerOpen: 'Entr\u00e9e ouvrir',
            shortcutsEscTwoStage: 'Fermer le panneau / la palette (appuyez deux fois si un panneau de détail est ouvert)',
            emptyTitle: 'Rechercher dans Grepolis',
            emptySubtitle: 'Joueurs \u00b7 Alliances \u00b7 Villes',
            emptyHintCoords: 'Vous pouvez aussi saisir des coordonn\u00e9es : <strong>{example}</strong>',
            emptyHintCommands: 'Tapez <strong>&gt;</strong> pour les commandes (villes fantômes, distances...) ou <strong>?</strong> pour tous les raccourcis.',
            loadingWorldData: 'Chargement des donn\u00e9es du monde...',
            noResults: 'Aucun r\u00e9sultat trouv\u00e9.',
            resultsMore: '{shown} sur {total} affich\u00e9s \u2014 faites d\u00e9filer pour plus',
            errorLoadingDataGeneric: 'Impossible de charger les données du monde. Essayez de rafraîchir.',
            errorLoadingDataTimeout: 'La requête a pris trop de temps. Vérifiez votre connexion et réessayez.',
            errorLoadingDataWorldNotDetected: 'Impossible de détecter le monde actuel.',
            badgePlayer: 'Joueur',
            badgeAlliance: 'Alliance',
            badgeTown: 'Ville',
            badgeCoordinate: 'Coordonn\u00e9es',
            ptsSuffix: 'pts',
            membersSuffix: 'membres',
            segmentAll: 'Tout',
            segmentPlayers: 'Joueurs',
            segmentAlliances: 'Alliances',
            segmentTowns: 'Villes',
            segmentCoords: 'Coordonn\u00e9es',
            townsSuffix: 'villes',
            onIslandInfo: '{n} villes sur cette \u00eele',
            favoritesTitle: 'Favoris',
            recentTitle: 'R\u00e9cents',
            recentClearAll: 'Vider',
            recentRemove: 'Retirer de l’historique',
            recentCleared: 'Historique récent vidé',
            footerTab: 'Tab filtrer',
            footerFav: 'Ctrl+F favori',
            footerBBCode: 'Ctrl+B copier le BBCode',
            footerExport: 'Exporter la liste',
            exportEmpty: 'Rien \u00e0 exporter dans la liste actuelle.',
            exportCopied: '{n} entr\u00e9es BBCode copi\u00e9es',
            bbcodeCopied: 'Copi\u00e9',
            footerRefresh: 'Ctrl+R actualiser',
            footerHelp: '? aide',
            menuItem: 'QuickFinder',
            dataFresh: 'Donn\u00e9es \u00e0 jour',
            dataFreshMin: 'Donn\u00e9es vieilles de {n} min',
            dataFreshHour: 'Donn\u00e9es vieilles de {n} h',
            dataFreshDay: 'Donn\u00e9es vieilles de {n} j',
            dataError: 'Erreur de donn\u00e9es',
            shortcutsTitle: 'Raccourcis',
            shortcutsFirstLast: 'aller au premier/dernier r\u00e9sultat',
            shortcutsRemoveRecent: 'Retirer la sélection de l’historique',
            shortcutsClearRecent: 'Vider tout l’historique récent',
            shortcutsHelp: 'afficher cette aide',
            commandHelpTitle: 'Commandes',
            commandGotoHelp: '>goto 123:456 \u2014 aller \u00e0 une \u00eele',
            commandGhostHelp: '>ghost [minPts] \u2014 lister les villes fant\u00f4mes',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 distance d\u2019\u00eeles',
            commandHelpHint: '>help \u2014 afficher cette liste',
            commandUnknown: 'Commande inconnue : {cmd}',
            premiumRequired: 'Nécessite que le conseiller Administrateur (Premium) soit actif.',
            ghostEmpty: 'Aucune ville fant\u00f4me trouv\u00e9e.',
            distResult: 'Distance d\u2019\u00eeles : {n}',
            distFromActive: 'depuis votre ville active',
            distFromOrigin: 'depuis l\u2019origine \u00e9pingl\u00e9e',
            distNeedOrigin: 'Donnez deux coordonn\u00e9es, ou une si votre ville active peut \u00eatre d\u00e9tect\u00e9e.',
            originSet: 'Origine d\u00e9finie sur {x}:{y}',
            originSetTooltip: 'D\u00e9finir comme origine de distance (Ctrl+O)',
            originCleared: 'Origine effac\u00e9e',
            originIndicator: 'Origine {x}:{y}',
            originIndicatorTooltip: 'Cliquez pour effacer l\u2019origine \u00e9pingl\u00e9e',
            shortcutsSetOrigin: 'D\u00e9finir comme origine de distance',
            favoriteNoteTooltip: 'Modifier la note (Ctrl+N)',
            favoriteNoteTitle: 'Note pour {name}',
            favoriteNoteLabel: 'Note',
            favoriteNoteSaved: 'Note enregistr\u00e9e',
            shortcutsEditNote: 'Modifier la note du favori s\u00e9lectionn\u00e9',
            scopeHelpTitle: 'Port\u00e9es',
            scopeHelpDesc: '@p joueurs \u00b7 @a alliances \u00b7 @t villes \u00b7 @c coordonn\u00e9es',
            commandIslandHelp: '>island X:Y \u2014 toutes les villes d\u2019une \u00eele',
            commandNearHelp: '>near [X:Y] [rayon] \u2014 \u00eeles autour d\u2019un point',
            commandOceanHelp: '>ocean M34 [alliance] \u2014 aper\u00e7u d\u2019oc\u00e9an',
            distBandSame: 'm\u00eame \u00eele',
            distBandAdjacent: '\u00eeles adjacentes',
            distBandRegional: 'r\u00e9gional',
            distBandFar: 'longue distance',
            badgeIsland: '\u00cele',
            badgeCommand: 'Commande',
            segmentIslands: '\u00celes',
            ghostLabel: 'Fant\u00f4me',
            islandTowns: '{n} villes',
            islandAlliances: '{n} alliances',
            islandGhosts: '{n} fant\u00f4mes',
            openIslandMap: 'Ouvrir l\u2019\u00eele sur la carte',
            nearSummary: '{islands} \u00eeles \u00b7 {towns} villes dans un rayon de {n}',
            nearNeedOrigin: 'Donnez un rayon, ou des coordonn\u00e9es plus un rayon. La ville active est utilis\u00e9e si elle peut \u00eatre d\u00e9tect\u00e9e.',
            oceanEmpty: 'Rien d\u2019index\u00e9 dans cet oc\u00e9an.',
            oceanNeed: 'Utilisez >ocean M34 ou >ocean M34 NomAlliance.',
            oceanSummary: '{players} joueurs \u00b7 {alliances} alliances \u00b7 {towns} villes \u00b7 {ghosts} fant\u00f4mes',
            playerTownsTitle: 'Villes',
            allianceSpreadTitle: 'O\u00f9 ils se trouvent',
            allianceMembersTitle: 'Membres',
            drillTowns: 'afficher les villes',
            sortPoints: 'par points',
            sortDistance: 'par distance',
            shortcutsOpen: 'Ouvrir/fermer QuickFinder',
            commandSettingsHelp: '>settings — ouvrir le panneau des paramètres',
            settingsTitle: 'Paramètres',
            settingsLanguage: 'Langue',
            settingsLanguageAuto: 'Automatique (détectée depuis le monde)',
            settingsHotkey: 'Raccourci clavier',
            settingsPageSize: 'Résultats par page',
            settingsMaxResults: 'Max. résultats de commande',
            settingsCacheTtl: 'Cache de données (heures)',
            settingsNearRadius: 'Rayon max. pour >near',
            settingsGhostMin: 'Points min. par défaut pour >ghost',
            settingsSave: 'Enregistrer',
            settingsReset: 'Réinitialiser',
            settingsSaved: 'Paramètres enregistrés',
            settingsResetDone: 'Paramètres réinitialisés',
            segmentSaved: 'Enregistrées',
            segmentFavorites: 'Favoris',
            segmentRecent: 'Récents',
            savedSearchesTitle: 'Recherches enregistrées',
            savedSearchesCleared: 'Recherches enregistrées effacées',
            saveSearchTooltip: 'Ctrl+D enregistrer la recherche',
            saveSearchPanelTitle: 'Enregistrer la recherche',
            saveSearchEditTitle: 'Renommer la recherche enregistrée',
            saveSearchEditTooltip: 'Renommer (Ctrl+E)',
            saveSearchNameLabel: 'Nom',
            saveSearchSave: 'Enregistrer',
            saveSearchCancel: 'Annuler',
            saveSearchSaved: 'Recherche enregistrée',
            saveSearchRenamed: 'Recherche enregistrée renommée',
            saveSearchRemove: 'Supprimer la recherche enregistrée',
            badgeSavedSearch: 'Enregistrée',
            shortcutsSaveSearch: 'Enregistrer la recherche actuelle',
            shortcutsRenameSaved: 'Renommer la recherche enregistrée sélectionnée',
            hierarchyDrillTooltip: 'Voir les détails (→)',
            shortcutsHierarchyNav: '← → entrer/sortir',
            updateAvailableToast: 'Une nouvelle version ({version}) est disponible.',
            updateAvailableTooltip: 'Nouvelle version {version} disponible — cliquez pour télécharger',
            settingsCheckUpdates: 'Vérifier les mises à jour',
            updateUpToDate: 'Vous avez déjà la dernière version',
            settingsConquestHistory: 'Activer l’historique des conquêtes',
            settingsConquestHistoryHint: 'Télécharge un fichier de plusieurs Mo (conquers.txt) pour >history',
            islandTownsWithCapacity: '{n}/{cap} villes',
            recentlyConquered: 'conquise il y a {n}j',
            lastActivity: 'dernière activité il y a {n}j',
            commandHistoryHelp: '>history <nom|x:y> — historique des conquêtes d’une ville, d’un joueur ou d’une coordonnée',
            commandTravelHelp: '>travel <unit\u00e9,...> [X:Y] [X:Y] [sirens=N] — temps de trajet des troupes',
            commandTopHelp: '>top players|alliances [N] — classement par points',
            commandVsHelp: '>vs <alliance1> vs <alliance2> — comparer deux alliances',
            travelUnknownUnit: 'Unit\u00e9 inconnue\u00a0: {unit}',
            travelCalcFailed: 'Impossible de calculer le temps de trajet (donn\u00e9es de jeu en direct manquantes).',
            travelLimitedBy: 'Limit\u00e9 par\u00a0: {unit}',
            travelColonizeShipLimit: 'Cela d\u00e9passe la limite normale de 48h du bateau de colonisation.',
            travelFlyingNote: 'Les unit\u00e9s volantes peuvent traverser les \u00eeles sans bateau de transport.',
            travelNoBonusData: 'Bonus de recherche/b\u00e2timent de la ville indisponibles — affichage de la vitesse de base uniquement.',
            travelUsedActiveCity: 'Bonus de votre ville active utilis\u00e9s (l\u2019origine n\u2019est pas l\u2019une de vos villes).',
            travelScopeNote: 'N\u2019inclut pas le bonus du Grand Temple d\u2019Ar\u00e8s de l\u2019Olympe ni les effets de h\u00e9ros.',
            historyEmpty: 'Aucun historique de conquête enregistré pour cette entité.',
            historyNotLoaded: 'Chargement de l’historique des conquêtes...',
            historyDisabled: 'Activez « historique des conquêtes » dans les Paramètres pour utiliser >history.',
            historyGhost: 'personne (fantôme)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'colonisée par {to}',
            historyEventCount: '{n} événements enregistrés',
            historyPlayerSummary: '{conquered} conquises · {lost} perdues',
        },
        it: {
            searchPlaceholder: 'Cerca giocatori, alleanze o citt\u00e0...',
            footerNavigate: '\u2191 \u2193 seleziona',
            footerOpen: 'Invio apri',
            shortcutsEscTwoStage: 'Chiudi pannello / palette (premi due volte se un pannello dettagli è aperto)',
            emptyTitle: 'Cerca in Grepolis',
            emptySubtitle: 'Giocatori \u00b7 Alleanze \u00b7 Citt\u00e0',
            emptyHintCoords: 'Puoi anche inserire le coordinate: <strong>{example}</strong>',
            emptyHintCommands: 'Digita <strong>&gt;</strong> per i comandi (città fantasma, distanze...) o <strong>?</strong> per tutte le scorciatoie.',
            loadingWorldData: 'Caricamento dati del mondo...',
            noResults: 'Nessun risultato trovato.',
            resultsMore: '{shown} di {total} mostrati \u2014 scorri per altri',
            errorLoadingDataGeneric: 'Impossibile caricare i dati del mondo. Prova ad aggiornare.',
            errorLoadingDataTimeout: 'La richiesta ha impiegato troppo tempo. Controlla la connessione e riprova.',
            errorLoadingDataWorldNotDetected: 'Impossibile rilevare il mondo attuale.',
            badgePlayer: 'Giocatore',
            badgeAlliance: 'Alleanza',
            badgeTown: 'Citt\u00e0',
            badgeCoordinate: 'Coordinate',
            ptsSuffix: 'punti',
            membersSuffix: 'membri',
            segmentAll: 'Tutti',
            segmentPlayers: 'Giocatori',
            segmentAlliances: 'Alleanze',
            segmentTowns: 'Citt\u00e0',
            segmentCoords: 'Coordinate',
            townsSuffix: 'citt\u00e0',
            onIslandInfo: '{n} citt\u00e0 su quest\u2019isola',
            favoritesTitle: 'Preferiti',
            recentTitle: 'Recenti',
            recentClearAll: 'Svuota',
            recentRemove: 'Rimuovi dalla cronologia',
            recentCleared: 'Cronologia recente svuotata',
            footerTab: 'Tab filtra',
            footerFav: 'Ctrl+F preferito',
            footerBBCode: 'Ctrl+B copia BBCode',
            footerExport: 'Esporta lista',
            exportEmpty: 'Niente da esportare nella lista attuale.',
            exportCopied: '{n} voci BBCode copiate',
            bbcodeCopied: 'Copiato',
            footerRefresh: 'Ctrl+R aggiorna',
            footerHelp: '? aiuto',
            menuItem: 'QuickFinder',
            dataFresh: 'Dati aggiornati',
            dataFreshMin: 'Dati di {n} min fa',
            dataFreshHour: 'Dati di {n} h fa',
            dataFreshDay: 'Dati di {n} g fa',
            dataError: 'Errore dati',
            shortcutsTitle: 'Scorciatoie',
            shortcutsFirstLast: 'vai al primo/ultimo risultato',
            shortcutsRemoveRecent: 'Rimuovi la selezione dalla cronologia',
            shortcutsClearRecent: 'Svuota tutta la cronologia recente',
            shortcutsHelp: 'mostra questo aiuto',
            commandHelpTitle: 'Comandi',
            commandGotoHelp: '>goto 123:456 \u2014 vai a un\u2019isola',
            commandGhostHelp: '>ghost [minPts] \u2014 elenca citt\u00e0 fantasma',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 distanza di isole',
            commandHelpHint: '>help \u2014 mostra questo elenco',
            commandUnknown: 'Comando sconosciuto: {cmd}',
            premiumRequired: 'Richiede il consigliere Amministratore (Premium) attivo.',
            ghostEmpty: 'Nessuna citt\u00e0 fantasma trovata.',
            distResult: 'Distanza di isole: {n}',
            distFromActive: 'dalla tua citt\u00e0 attiva',
            distFromOrigin: 'dall\u2019origine impostata',
            distNeedOrigin: 'Indica due coordinate, o una se la tua citt\u00e0 attiva pu\u00f2 essere rilevata.',
            originSet: 'Origine impostata su {x}:{y}',
            originSetTooltip: 'Imposta come origine per la distanza (Ctrl+O)',
            originCleared: 'Origine rimossa',
            originIndicator: 'Origine {x}:{y}',
            originIndicatorTooltip: 'Clicca per rimuovere l\u2019origine impostata',
            shortcutsSetOrigin: 'Imposta come origine per la distanza',
            favoriteNoteTooltip: 'Modifica nota (Ctrl+N)',
            favoriteNoteTitle: 'Nota per {name}',
            favoriteNoteLabel: 'Nota',
            favoriteNoteSaved: 'Nota salvata',
            shortcutsEditNote: 'Modifica la nota del preferito selezionato',
            scopeHelpTitle: 'Ambiti',
            scopeHelpDesc: '@p giocatori \u00b7 @a alleanze \u00b7 @t citt\u00e0 \u00b7 @c coordinate',
            commandIslandHelp: '>island X:Y \u2014 tutte le citt\u00e0 di un\u2019isola',
            commandNearHelp: '>near [X:Y] [raggio] \u2014 isole attorno a un punto',
            commandOceanHelp: '>ocean M34 [alleanza] \u2014 riepilogo dell\u2019oceano',
            distBandSame: 'stessa isola',
            distBandAdjacent: 'isole adiacenti',
            distBandRegional: 'regionale',
            distBandFar: 'lunga distanza',
            badgeIsland: 'Isola',
            badgeCommand: 'Comando',
            segmentIslands: 'Isole',
            ghostLabel: 'Fantasma',
            islandTowns: '{n} citt\u00e0',
            islandAlliances: '{n} alleanze',
            islandGhosts: '{n} fantasmi',
            openIslandMap: 'Apri l\u2019isola sulla mappa',
            nearSummary: '{islands} isole \u00b7 {towns} citt\u00e0 entro {n}',
            nearNeedOrigin: 'Indica un raggio, o coordinate pi\u00f9 un raggio. Se rilevabile, viene usata la tua citt\u00e0 attiva.',
            oceanEmpty: 'Nulla di indicizzato in quell\u2019oceano.',
            oceanNeed: 'Usa >ocean M34 oppure >ocean M34 NomeAlleanza.',
            oceanSummary: '{players} giocatori \u00b7 {alliances} alleanze \u00b7 {towns} citt\u00e0 \u00b7 {ghosts} fantasmi',
            playerTownsTitle: 'Citt\u00e0',
            allianceSpreadTitle: 'Dove si trovano',
            allianceMembersTitle: 'Membri',
            drillTowns: 'mostra città',
            sortPoints: 'per punti',
            sortDistance: 'per distanza',
            shortcutsOpen: 'Apri/chiudi QuickFinder',
            commandSettingsHelp: '>settings — apri il pannello impostazioni',
            settingsTitle: 'Impostazioni',
            settingsLanguage: 'Lingua',
            settingsLanguageAuto: 'Automatica (rilevata dal mondo)',
            settingsHotkey: 'Scorciatoia da tastiera',
            settingsPageSize: 'Risultati per pagina',
            settingsMaxResults: 'Max. risultati comando',
            settingsCacheTtl: 'Cache dati (ore)',
            settingsNearRadius: 'Raggio max. per >near',
            settingsGhostMin: 'Punti min. predefiniti per >ghost',
            settingsSave: 'Salva',
            settingsReset: 'Ripristina predefiniti',
            settingsSaved: 'Impostazioni salvate',
            settingsResetDone: 'Impostazioni ripristinate',
            segmentSaved: 'Salvate',
            segmentFavorites: 'Preferiti',
            segmentRecent: 'Recenti',
            savedSearchesTitle: 'Ricerche salvate',
            savedSearchesCleared: 'Ricerche salvate cancellate',
            saveSearchTooltip: 'Ctrl+D salva ricerca',
            saveSearchPanelTitle: 'Salva ricerca',
            saveSearchEditTitle: 'Rinomina ricerca salvata',
            saveSearchEditTooltip: 'Rinomina (Ctrl+E)',
            saveSearchNameLabel: 'Nome',
            saveSearchSave: 'Salva',
            saveSearchCancel: 'Annulla',
            saveSearchSaved: 'Ricerca salvata',
            saveSearchRenamed: 'Ricerca salvata rinominata',
            saveSearchRemove: 'Rimuovi ricerca salvata',
            badgeSavedSearch: 'Salvata',
            shortcutsSaveSearch: 'Salva la ricerca attuale',
            shortcutsRenameSaved: 'Rinomina la ricerca salvata selezionata',
            hierarchyDrillTooltip: 'Vedi dettagli (→)',
            shortcutsHierarchyNav: '← → entra/esci',
            updateAvailableToast: 'È disponibile una nuova versione ({version}).',
            updateAvailableTooltip: 'Nuova versione {version} disponibile — clicca per scaricare',
            settingsCheckUpdates: 'Controlla aggiornamenti',
            updateUpToDate: 'Hai già l’ultima versione',
            settingsConquestHistory: 'Attiva cronologia conquiste',
            settingsConquestHistoryHint: 'Scarica un file di alcuni MB (conquers.txt) per >history',
            islandTownsWithCapacity: '{n}/{cap} città',
            recentlyConquered: 'conquistata {n}g fa',
            lastActivity: 'ultima attività {n}g fa',
            commandHistoryHelp: '>history <nome|x:y> — cronologia conquiste di una città, giocatore o coordinata',
            commandTravelHelp: '>travel <unit\u00e0,...> [X:Y] [X:Y] [sirens=N] — tempo di viaggio delle truppe',
            commandTopHelp: '>top players|alliances [N] — classifica per punti',
            commandVsHelp: '>vs <alleanza1> vs <alleanza2> — confronta due alleanze',
            travelUnknownUnit: 'Unit\u00e0 sconosciuta: {unit}',
            travelCalcFailed: 'Impossibile calcolare il tempo di viaggio (dati di gioco live mancanti).',
            travelLimitedBy: 'Limitato da: {unit}',
            travelColonizeShipLimit: 'Questo supera il normale limite di 48h della nave di colonizzazione.',
            travelFlyingNote: 'Le unit\u00e0 volanti possono attraversare le isole senza nave da trasporto.',
            travelNoBonusData: 'Bonus di ricerca/edifici della citt\u00e0 non disponibili — viene mostrata solo la velocit\u00e0 base.',
            travelUsedActiveCity: 'Usati i bonus della tua citt\u00e0 attiva (l\u2019origine non \u00e8 una delle tue citt\u00e0).',
            travelScopeNote: 'Non include il bonus del Grande Tempio di Ares dell\u2019Olimpo n\u00e9 gli effetti degli eroi.',
            historyEmpty: 'Nessuna cronologia di conquiste registrata per questo elemento.',
            historyNotLoaded: 'Caricamento della cronologia conquiste...',
            historyDisabled: 'Attiva "cronologia conquiste" nelle Impostazioni per usare >history.',
            historyGhost: 'nessuno (fantasma)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'colonizzata da {to}',
            historyEventCount: '{n} eventi registrati',
            historyPlayerSummary: '{conquered} conquistate · {lost} perse',
        },
        nl: {
            searchPlaceholder: 'Zoek spelers, allianties of steden...',
            footerNavigate: '\u2191 \u2193 selecteren',
            footerOpen: 'Enter openen',
            shortcutsEscTwoStage: 'Paneel/palet sluiten (druk tweemaal als er een detailvenster open staat)',
            emptyTitle: 'Zoeken in Grepolis',
            emptySubtitle: 'Spelers \u00b7 Allianties \u00b7 Steden',
            emptyHintCoords: 'Je kunt ook co\u00f6rdinaten invoeren: <strong>{example}</strong>',
            emptyHintCommands: 'Typ <strong>&gt;</strong> voor opdrachten (spooksteden, afstanden...) of <strong>?</strong> voor alle sneltoetsen.',
            loadingWorldData: 'Wereldgegevens laden...',
            noResults: 'Geen resultaten gevonden.',
            resultsMore: '{shown} van {total} weergegeven \u2014 scroll voor meer',
            errorLoadingDataGeneric: 'Kon wereldgegevens niet laden. Probeer te vernieuwen.',
            errorLoadingDataTimeout: 'De aanvraag duurde te lang. Controleer je verbinding en probeer opnieuw.',
            errorLoadingDataWorldNotDetected: 'Kon de huidige wereld niet detecteren.',
            badgePlayer: 'Speler',
            badgeAlliance: 'Alliantie',
            badgeTown: 'Stad',
            badgeCoordinate: 'Co\u00f6rdinaten',
            ptsSuffix: 'punten',
            membersSuffix: 'leden',
            segmentAll: 'Alles',
            segmentPlayers: 'Spelers',
            segmentAlliances: 'Allianties',
            segmentTowns: 'Steden',
            segmentCoords: 'Co\u00f6rdinaten',
            townsSuffix: 'steden',
            onIslandInfo: '{n} steden op dit eiland',
            favoritesTitle: 'Favorieten',
            recentTitle: 'Recent',
            recentClearAll: 'Wissen',
            recentRemove: 'Verwijderen uit geschiedenis',
            recentCleared: 'Recente geschiedenis gewist',
            footerTab: 'Tab filteren',
            footerFav: 'Ctrl+F favoriet',
            footerBBCode: 'Ctrl+B BBCode kopi\u00ebren',
            footerExport: 'Lijst exporteren',
            exportEmpty: 'Niets te exporteren in de huidige lijst.',
            exportCopied: '{n} BBCode-items gekopieerd',
            bbcodeCopied: 'Gekopieerd',
            footerRefresh: 'Ctrl+R verversen',
            footerHelp: '? help',
            menuItem: 'QuickFinder',
            dataFresh: 'Gegevens actueel',
            dataFreshMin: 'Gegevens {n} min oud',
            dataFreshHour: 'Gegevens {n} u oud',
            dataFreshDay: 'Gegevens {n} d oud',
            dataError: 'Gegevensfout',
            shortcutsTitle: 'Sneltoetsen',
            shortcutsFirstLast: 'naar eerste/laatste resultaat gaan',
            shortcutsRemoveRecent: 'Selectie verwijderen uit geschiedenis',
            shortcutsClearRecent: 'Hele recente geschiedenis wissen',
            shortcutsHelp: 'deze hulp tonen',
            commandHelpTitle: 'Opdrachten',
            commandGotoHelp: '>goto 123:456 \u2014 naar een eiland springen',
            commandGhostHelp: '>ghost [minPts] \u2014 spooksteden weergeven',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 eilandafstand',
            commandHelpHint: '>help \u2014 deze lijst tonen',
            commandUnknown: 'Onbekende opdracht: {cmd}',
            premiumRequired: 'Vereist dat de adviseur Beheerder (Premium) actief is.',
            ghostEmpty: 'Geen spooksteden gevonden.',
            distResult: 'Eilandafstand: {n}',
            distFromActive: 'vanaf je actieve stad',
            distFromOrigin: 'vanaf het vastgezette startpunt',
            distNeedOrigin: 'Geef twee co\u00f6rdinaten, of \u00e9\u00e9n als je actieve stad kan worden gedetecteerd.',
            originSet: 'Startpunt ingesteld op {x}:{y}',
            originSetTooltip: 'Instellen als afstandsstartpunt (Ctrl+O)',
            originCleared: 'Startpunt gewist',
            originIndicator: 'Startpunt {x}:{y}',
            originIndicatorTooltip: 'Klik om het vastgezette startpunt te wissen',
            shortcutsSetOrigin: 'Instellen als afstandsstartpunt',
            favoriteNoteTooltip: 'Notitie bewerken (Ctrl+N)',
            favoriteNoteTitle: 'Notitie voor {name}',
            favoriteNoteLabel: 'Notitie',
            favoriteNoteSaved: 'Notitie opgeslagen',
            shortcutsEditNote: 'Notitie van geselecteerde favoriet bewerken',
            scopeHelpTitle: 'Bereiken',
            scopeHelpDesc: '@p spelers \u00b7 @a allianties \u00b7 @t steden \u00b7 @c co\u00f6rdinaten',
            commandIslandHelp: '>island X:Y \u2014 alle steden op een eiland',
            commandNearHelp: '>near [X:Y] [straal] \u2014 eilanden rond een punt',
            commandOceanHelp: '>ocean M34 [alliantie] \u2014 overzicht van een oceaan',
            distBandSame: 'zelfde eiland',
            distBandAdjacent: 'aangrenzende eilanden',
            distBandRegional: 'regionaal',
            distBandFar: 'lange afstand',
            badgeIsland: 'Eiland',
            badgeCommand: 'Opdracht',
            segmentIslands: 'Eilanden',
            ghostLabel: 'Spook',
            islandTowns: '{n} steden',
            islandAlliances: '{n} allianties',
            islandGhosts: '{n} spooksteden',
            openIslandMap: 'Eiland op de kaart openen',
            nearSummary: '{islands} eilanden \u00b7 {towns} steden binnen {n}',
            nearNeedOrigin: 'Geef een straal, of co\u00f6rdinaten plus een straal. Je actieve stad wordt gebruikt als deze kan worden gedetecteerd.',
            oceanEmpty: 'Niets ge\u00efndexeerd in die oceaan.',
            oceanNeed: 'Gebruik >ocean M34 of >ocean M34 Alliantienaam.',
            oceanSummary: '{players} spelers \u00b7 {alliances} allianties \u00b7 {towns} steden \u00b7 {ghosts} spooksteden',
            playerTownsTitle: 'Steden',
            allianceSpreadTitle: 'Waar ze zitten',
            allianceMembersTitle: 'Leden',
            drillTowns: 'steden tonen',
            sortPoints: 'op punten',
            sortDistance: 'op afstand',
            shortcutsOpen: 'QuickFinder openen/sluiten',
            commandSettingsHelp: '>settings — instellingenpaneel openen',
            settingsTitle: 'Instellingen',
            settingsLanguage: 'Taal',
            settingsLanguageAuto: 'Automatisch (gedetecteerd via wereld)',
            settingsHotkey: 'Sneltoets',
            settingsPageSize: 'Resultaten per pagina',
            settingsMaxResults: 'Max. opdrachtresultaten',
            settingsCacheTtl: 'Gegevenscache (uren)',
            settingsNearRadius: 'Max. straal voor >near',
            settingsGhostMin: 'Standaard min. punten voor >ghost',
            settingsSave: 'Opslaan',
            settingsReset: 'Standaardwaarden herstellen',
            settingsSaved: 'Instellingen opgeslagen',
            settingsResetDone: 'Instellingen hersteld',
            segmentSaved: 'Opgeslagen',
            segmentFavorites: 'Favorieten',
            segmentRecent: 'Recent',
            savedSearchesTitle: 'Opgeslagen zoekopdrachten',
            savedSearchesCleared: 'Opgeslagen zoekopdrachten gewist',
            saveSearchTooltip: 'Ctrl+D zoekopdracht opslaan',
            saveSearchPanelTitle: 'Zoekopdracht opslaan',
            saveSearchEditTitle: 'Opgeslagen zoekopdracht hernoemen',
            saveSearchEditTooltip: 'Hernoemen (Ctrl+E)',
            saveSearchNameLabel: 'Naam',
            saveSearchSave: 'Opslaan',
            saveSearchCancel: 'Annuleren',
            saveSearchSaved: 'Zoekopdracht opgeslagen',
            saveSearchRenamed: 'Opgeslagen zoekopdracht hernoemd',
            saveSearchRemove: 'Opgeslagen zoekopdracht verwijderen',
            badgeSavedSearch: 'Opgeslagen',
            shortcutsSaveSearch: 'Huidige zoekopdracht opslaan',
            shortcutsRenameSaved: 'Geselecteerde opgeslagen zoekopdracht hernoemen',
            hierarchyDrillTooltip: 'Details bekijken (→)',
            shortcutsHierarchyNav: '← → in/uit',
            updateAvailableToast: 'Er is een nieuwe versie ({version}) beschikbaar.',
            updateAvailableTooltip: 'Nieuwe versie {version} beschikbaar — klik om te downloaden',
            settingsCheckUpdates: 'Controleren op updates',
            updateUpToDate: 'Je hebt al de laatste versie',
            settingsConquestHistory: 'Veroveringsgeschiedenis inschakelen',
            settingsConquestHistoryHint: 'Downloadt een bestand van meerdere MB (conquers.txt) voor >history',
            islandTownsWithCapacity: '{n}/{cap} steden',
            recentlyConquered: '{n}d geleden veroverd',
            lastActivity: 'laatste activiteit {n}d geleden',
            commandHistoryHelp: '>history <naam|x:y> — veroveringsgeschiedenis van een stad, speler of coördinaat',
            commandTravelHelp: '>travel <eenheid,...> [X:Y] [X:Y] [sirens=N] — reistijd van troepen',
            commandTopHelp: '>top players|alliances [N] — puntenranglijst',
            commandVsHelp: '>vs <alliantie1> vs <alliantie2> — vergelijk twee allianties',
            travelUnknownUnit: 'Onbekende eenheid: {unit}',
            travelCalcFailed: 'Kon reistijd niet berekenen (live spelgegevens ontbreken).',
            travelLimitedBy: 'Beperkt door: {unit}',
            travelColonizeShipLimit: 'Dit overschrijdt de normale 48u-limiet van het kolonisatieschip.',
            travelFlyingNote: 'Vliegende eenheden kunnen eilanden oversteken zonder transportschip.',
            travelNoBonusData: 'Onderzoeks-/gebouwbonussen van de stad niet beschikbaar — alleen basissnelheid getoond.',
            travelUsedActiveCity: 'Bonussen van je actieve stad gebruikt (oorsprong is niet een van je steden).',
            travelScopeNote: 'Bevat niet de bonus van de Olympus Grote Tempel van Ares of heldeneffecten.',
            historyEmpty: 'Geen veroveringsgeschiedenis geregistreerd voor dit item.',
            historyNotLoaded: 'Veroveringsgeschiedenis wordt geladen...',
            historyDisabled: 'Schakel "veroveringsgeschiedenis" in bij Instellingen om >history te gebruiken.',
            historyGhost: 'niemand (spook)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'gesticht door {to}',
            historyEventCount: '{n} geregistreerde gebeurtenissen',
            historyPlayerSummary: '{conquered} veroverd · {lost} verloren',
        },
        pl: {
            searchPlaceholder: 'Szukaj graczy, sojuszy lub miast...',
            footerNavigate: '\u2191 \u2193 wybierz',
            footerOpen: 'Enter otw\u00f3rz',
            shortcutsEscTwoStage: 'Zamknij panel / paletę (naciśnij dwukrotnie, jeśli otwarty jest panel szczegółów)',
            emptyTitle: 'Szukaj w Grepolis',
            emptySubtitle: 'Gracze \u00b7 Sojusze \u00b7 Miasta',
            emptyHintCoords: 'Mo\u017cesz te\u017c wpisa\u0107 wsp\u00f3\u0142rz\u0119dne: <strong>{example}</strong>',
            emptyHintCommands: 'Wpisz <strong>&gt;</strong>, aby użyć poleceń (miasta widma, odległości...) lub <strong>?</strong>, aby zobaczyć wszystkie skróty.',
            loadingWorldData: '\u0141adowanie danych \u015bwiata...',
            noResults: 'Nie znaleziono wynik\u00f3w.',
            resultsMore: 'Pokazano {shown} z {total} \u2014 przewi\u0144, aby zobaczy\u0107 wi\u0119cej',
            errorLoadingDataGeneric: 'Nie udało się wczytać danych świata. Spróbuj odświeżyć.',
            errorLoadingDataTimeout: 'Żądanie trwało zbyt długo. Sprawdź połączenie i spróbuj ponownie.',
            errorLoadingDataWorldNotDetected: 'Nie można wykryć bieżącego świata.',
            badgePlayer: 'Gracz',
            badgeAlliance: 'Sojusz',
            badgeTown: 'Miasto',
            badgeCoordinate: 'Wsp\u00f3\u0142rz\u0119dne',
            ptsSuffix: 'pkt',
            membersSuffix: 'cz\u0142onk\u00f3w',
            segmentAll: 'Wszystkie',
            segmentPlayers: 'Gracze',
            segmentAlliances: 'Sojusze',
            segmentTowns: 'Miasta',
            segmentCoords: 'Wsp\u00f3\u0142rz\u0119dne',
            townsSuffix: 'miast',
            onIslandInfo: '{n} miast na tej wyspie',
            favoritesTitle: 'Ulubione',
            recentTitle: 'Ostatnie',
            recentClearAll: 'Wyczyść',
            recentRemove: 'Usuń z historii',
            recentCleared: 'Historia wyczyszczona',
            footerTab: 'Tab filtr',
            footerFav: 'Ctrl+F ulubione',
            footerBBCode: 'Ctrl+B kopiuj BBCode',
            footerExport: 'Eksportuj list\u0119',
            exportEmpty: 'Nic do wyeksportowania na bie\u017c\u0105cej li\u015bcie.',
            exportCopied: 'Skopiowano {n} wpis\u00f3w BBCode',
            bbcodeCopied: 'Skopiowano',
            footerRefresh: 'Ctrl+R od\u015bwie\u017c',
            footerHelp: '? pomoc',
            menuItem: 'QuickFinder',
            dataFresh: 'Dane aktualne',
            dataFreshMin: 'Dane sprzed {n} min',
            dataFreshHour: 'Dane sprzed {n} godz.',
            dataFreshDay: 'Dane sprzed {n} dni',
            dataError: 'B\u0142\u0105d danych',
            shortcutsTitle: 'Skr\u00f3ty',
            shortcutsFirstLast: 'przejd\u017a do pierwszego/ostatniego wyniku',
            shortcutsRemoveRecent: 'Usuń wybrane z historii',
            shortcutsClearRecent: 'Wyczyść całą historię ostatnich',
            shortcutsHelp: 'poka\u017c t\u0119 pomoc',
            commandHelpTitle: 'Polecenia',
            commandGotoHelp: '>goto 123:456 \u2014 przeskocz na wysp\u0119',
            commandGhostHelp: '>ghost [minPts] \u2014 lista miast-widm',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 odleg\u0142o\u015b\u0107 wysp',
            commandHelpHint: '>help \u2014 poka\u017c t\u0119 list\u0119',
            commandUnknown: 'Nieznane polecenie: {cmd}',
            premiumRequired: 'Wymaga aktywnego doradcy Administrator (Premium).',
            ghostEmpty: 'Nie znaleziono miast-widm.',
            distResult: 'Odleg\u0142o\u015b\u0107 wysp: {n}',
            distFromActive: 'od aktywnego miasta',
            distFromOrigin: 'od przypi\u0119tego punktu pocz\u0105tkowego',
            distNeedOrigin: 'Podaj dwie wsp\u00f3\u0142rz\u0119dne lub jedn\u0105, je\u015bli mo\u017cna wykry\u0107 twoje aktywne miasto.',
            originSet: 'Ustawiono punkt pocz\u0105tkowy na {x}:{y}',
            originSetTooltip: 'Ustaw jako punkt pocz\u0105tkowy odleg\u0142o\u015bci (Ctrl+O)',
            originCleared: 'Usuni\u0119to punkt pocz\u0105tkowy',
            originIndicator: 'Punkt pocz\u0105tkowy {x}:{y}',
            originIndicatorTooltip: 'Kliknij, aby usun\u0105\u0107 przypi\u0119ty punkt pocz\u0105tkowy',
            shortcutsSetOrigin: 'Ustaw jako punkt pocz\u0105tkowy odleg\u0142o\u015bci',
            favoriteNoteTooltip: 'Edytuj notatk\u0119 (Ctrl+N)',
            favoriteNoteTitle: 'Notatka dla {name}',
            favoriteNoteLabel: 'Notatka',
            favoriteNoteSaved: 'Notatka zapisana',
            shortcutsEditNote: 'Edytuj notatk\u0119 wybranego ulubionego',
            scopeHelpTitle: 'Zakresy',
            scopeHelpDesc: '@p gracze \u00b7 @a sojusze \u00b7 @t miasta \u00b7 @c wsp\u00f3\u0142rz\u0119dne',
            commandIslandHelp: '>island X:Y \u2014 wszystkie miasta na wyspie',
            commandNearHelp: '>near [X:Y] [promie\u0144] \u2014 wyspy wok\u00f3\u0142 punktu',
            commandOceanHelp: '>ocean M34 [sojusz] \u2014 podgl\u0105d oceanu',
            distBandSame: 'ta sama wyspa',
            distBandAdjacent: 's\u0105siednie wyspy',
            distBandRegional: 'regionalna',
            distBandFar: 'du\u017ca odleg\u0142o\u015b\u0107',
            badgeIsland: 'Wyspa',
            badgeCommand: 'Polecenie',
            segmentIslands: 'Wyspy',
            ghostLabel: 'Duch',
            islandTowns: '{n} miast',
            islandAlliances: '{n} sojuszy',
            islandGhosts: '{n} miast-widm',
            openIslandMap: 'Otw\u00f3rz wysp\u0119 na mapie',
            nearSummary: '{islands} wysp \u00b7 {towns} miast w promieniu {n}',
            nearNeedOrigin: 'Podaj promie\u0144 lub wsp\u00f3\u0142rz\u0119dne i promie\u0144. U\u017cywane jest aktywne miasto, je\u015bli mo\u017cna je wykry\u0107.',
            oceanEmpty: 'Nic nie zaindeksowano w tym oceanie.',
            oceanNeed: 'U\u017cyj >ocean M34 lub >ocean M34 NazwaSojuszu.',
            oceanSummary: '{players} graczy \u00b7 {alliances} sojuszy \u00b7 {towns} miast \u00b7 {ghosts} miast-widm',
            playerTownsTitle: 'Miasta',
            allianceSpreadTitle: 'Gdzie si\u0119 znajduj\u0105',
            allianceMembersTitle: 'Cz\u0142onkowie',
            drillTowns: 'pokaż miasta',
            sortPoints: 'wg punktów',
            sortDistance: 'wg odległości',
            shortcutsOpen: 'Otwórz/zamknij QuickFinder',
            commandSettingsHelp: '>settings — otwórz panel ustawień',
            settingsTitle: 'Ustawienia',
            settingsLanguage: 'Język',
            settingsLanguageAuto: 'Automatyczny (wykryty ze świata)',
            settingsHotkey: 'Skrót klawiszowy',
            settingsPageSize: 'Wyników na stronę',
            settingsMaxResults: 'Maks. wyników polecenia',
            settingsCacheTtl: 'Pamięć podręczna danych (godziny)',
            settingsNearRadius: 'Maks. promień dla >near',
            settingsGhostMin: 'Domyślne min. punkty dla >ghost',
            settingsSave: 'Zapisz',
            settingsReset: 'Przywróć domyślne',
            settingsSaved: 'Ustawienia zapisane',
            settingsResetDone: 'Ustawienia przywrócone',
            segmentSaved: 'Zapisane',
            segmentFavorites: 'Ulubione',
            segmentRecent: 'Ostatnie',
            savedSearchesTitle: 'Zapisane wyszukiwania',
            savedSearchesCleared: 'Zapisane wyszukiwania wyczyszczone',
            saveSearchTooltip: 'Ctrl+D zapisz wyszukiwanie',
            saveSearchPanelTitle: 'Zapisz wyszukiwanie',
            saveSearchEditTitle: 'Zmień nazwę zapisanego wyszukiwania',
            saveSearchEditTooltip: 'Zmień nazwę (Ctrl+E)',
            saveSearchNameLabel: 'Nazwa',
            saveSearchSave: 'Zapisz',
            saveSearchCancel: 'Anuluj',
            saveSearchSaved: 'Wyszukiwanie zapisane',
            saveSearchRenamed: 'Zmieniono nazwę zapisanego wyszukiwania',
            saveSearchRemove: 'Usuń zapisane wyszukiwanie',
            badgeSavedSearch: 'Zapisane',
            shortcutsSaveSearch: 'Zapisz bieżące wyszukiwanie',
            shortcutsRenameSaved: 'Zmień nazwę wybranego zapisanego wyszukiwania',
            hierarchyDrillTooltip: 'Zobacz szczegóły (→)',
            shortcutsHierarchyNav: '← → wejdź/wyjdź',
            updateAvailableToast: 'Dostępna jest nowa wersja ({version}).',
            updateAvailableTooltip: 'Dostępna nowa wersja {version} — kliknij, aby pobrać',
            settingsCheckUpdates: 'Sprawdź aktualizacje',
            updateUpToDate: 'Masz już najnowszą wersję',
            settingsConquestHistory: 'Włącz historię podbojów',
            settingsConquestHistoryHint: 'Pobiera kilkumegabajtowy plik (conquers.txt) dla >history',
            islandTownsWithCapacity: '{n}/{cap} miast',
            recentlyConquered: 'podbito {n}d temu',
            lastActivity: 'ostatnia aktywność {n}d temu',
            commandHistoryHelp: '>history <nazwa|x:y> — historia podbojów miasta, gracza lub współrzędnej',
            commandTravelHelp: '>travel <jednostka,...> [X:Y] [X:Y] [sirens=N] — czas podró\u017cy wojsk',
            commandTopHelp: '>top players|alliances [N] — ranking punktowy',
            commandVsHelp: '>vs <sojusz1> vs <sojusz2> — por\u00f3wnaj dwa sojusze',
            travelUnknownUnit: 'Nieznana jednostka: {unit}',
            travelCalcFailed: 'Nie mo\u017cna obliczy\u0107 czasu podr\u00f3\u017cy (brak danych na \u017cywo z gry).',
            travelLimitedBy: 'Ograniczone przez: {unit}',
            travelColonizeShipLimit: 'Przekracza to normalny limit 48h dla statku kolonizacyjnego.',
            travelFlyingNote: 'Jednostki lataj\u0105ce mog\u0105 przekracza\u0107 wyspy bez statku transportowego.',
            travelNoBonusData: 'Bonusy bada\u0144/budynk\u00f3w miasta niedost\u0119pne — pokazano tylko podstawow\u0105 pr\u0119dko\u015b\u0107.',
            travelUsedActiveCity: 'U\u017cyto bonus\u00f3w twojego aktywnego miasta (punkt startowy nie jest jednym z twoich miast).',
            travelScopeNote: 'Nie uwzgl\u0119dnia bonusu Wielkiej \u015awi\u0105tyni Aresa z Olimpu ani efekt\u00f3w bohater\u00f3w.',
            historyEmpty: 'Brak zarejestrowanej historii podbojów dla tego elementu.',
            historyNotLoaded: 'Trwa wczytywanie historii podbojów...',
            historyDisabled: 'Włącz "historię podbojów" w Ustawieniach, aby korzystać z >history.',
            historyGhost: 'nikt (duch)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'skolonizowane przez {to}',
            historyEventCount: '{n} zarejestrowanych zdarzeń',
            historyPlayerSummary: '{conquered} podbitych · {lost} utraconych',
        },
        pt: {
            searchPlaceholder: 'Pesquisar jogadores, alian\u00e7as ou cidades...',
            footerNavigate: '\u2191 \u2193 selecionar',
            footerOpen: 'Enter abrir',
            shortcutsEscTwoStage: 'Fechar painel / paleta (prime duas vezes se um painel de detalhe estiver aberto)',
            emptyTitle: 'Pesquisar no Grepolis',
            emptySubtitle: 'Jogadores \u00b7 Alian\u00e7as \u00b7 Cidades',
            emptyHintCoords: 'Tamb\u00e9m podes introduzir coordenadas: <strong>{example}</strong>',
            emptyHintCommands: 'Escreve <strong>&gt;</strong> para comandos (cidades fantasma, distâncias...) ou <strong>?</strong> para todos os atalhos.',
            loadingWorldData: 'A carregar dados do mundo...',
            noResults: 'Nenhum resultado encontrado.',
            resultsMore: 'A mostrar {shown} de {total} \u2014 desloque para ver mais',
            errorLoadingDataGeneric: 'Não foi possível carregar os dados do mundo. Tenta atualizar.',
            errorLoadingDataTimeout: 'O pedido demorou demasiado. Verifica a tua ligação e tenta novamente.',
            errorLoadingDataWorldNotDetected: 'Não foi possível detetar o mundo atual.',
            badgePlayer: 'Jogador',
            badgeAlliance: 'Alian\u00e7a',
            badgeTown: 'Cidade',
            badgeCoordinate: 'Coordenadas',
            ptsSuffix: 'pts',
            membersSuffix: 'membros',
            segmentAll: 'Tudo',
            segmentPlayers: 'Jogadores',
            segmentAlliances: 'Alian\u00e7as',
            segmentTowns: 'Cidades',
            segmentCoords: 'Coordenadas',
            townsSuffix: 'cidades',
            onIslandInfo: '{n} cidades nesta ilha',
            favoritesTitle: 'Favoritos',
            recentTitle: 'Recentes',
            recentClearAll: 'Limpar',
            recentRemove: 'Remover do histórico',
            recentCleared: 'Histórico recente limpo',
            footerTab: 'Tab filtrar',
            footerFav: 'Ctrl+F favorito',
            footerBBCode: 'Ctrl+B copiar BBCode',
            footerExport: 'Exportar lista',
            exportEmpty: 'Nada para exportar na lista atual.',
            exportCopied: '{n} entradas BBCode copiadas',
            bbcodeCopied: 'Copiado',
            footerRefresh: 'Ctrl+R atualizar',
            footerHelp: '? ajuda',
            menuItem: 'QuickFinder',
            dataFresh: 'Dados atuais',
            dataFreshMin: 'Dados com {n} min',
            dataFreshHour: 'Dados com {n} h',
            dataFreshDay: 'Dados com {n} d',
            dataError: 'Erro de dados',
            shortcutsTitle: 'Atalhos',
            commandHelpTitle: 'Comandos',
            commandGotoHelp: '>goto 123:456 \u2014 saltar para uma ilha',
            shortcutsFirstLast: 'ir para o primeiro/\u00faltimo resultado',
            shortcutsRemoveRecent: 'Remover selecionado do histórico',
            shortcutsClearRecent: 'Limpar todo o histórico recente',
            shortcutsHelp: 'mostrar esta ajuda',
            commandGhostHelp: '>ghost [minPts] \u2014 listar cidades fantasma',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 dist\u00e2ncia de ilhas',
            commandHelpHint: '>help \u2014 mostrar esta lista',
            commandUnknown: 'Comando desconhecido: {cmd}',
            premiumRequired: 'Requer o conselheiro Administrador (Premium) ativo.',
            ghostEmpty: 'Nenhuma cidade fantasma encontrada.',
            distResult: 'Dist\u00e2ncia de ilhas: {n}',
            distFromActive: 'da sua cidade ativa',
            distFromOrigin: 'a partir da origem fixada',
            distNeedOrigin: 'Indique duas coordenadas, ou uma, se a sua cidade ativa puder ser detetada.',
            originSet: 'Origem definida em {x}:{y}',
            originSetTooltip: 'Definir como origem de dist\u00e2ncia (Ctrl+O)',
            originCleared: 'Origem removida',
            originIndicator: 'Origem {x}:{y}',
            originIndicatorTooltip: 'Clique para remover a origem fixada',
            shortcutsSetOrigin: 'Definir como origem de dist\u00e2ncia',
            favoriteNoteTooltip: 'Editar nota (Ctrl+N)',
            favoriteNoteTitle: 'Nota para {name}',
            favoriteNoteLabel: 'Nota',
            favoriteNoteSaved: 'Nota guardada',
            shortcutsEditNote: 'Editar a nota do favorito selecionado',
            scopeHelpTitle: '\u00c2mbitos',
            scopeHelpDesc: '@p jogadores \u00b7 @a alian\u00e7as \u00b7 @t cidades \u00b7 @c coordenadas',
            commandIslandHelp: '>island X:Y \u2014 todas as cidades de uma ilha',
            commandNearHelp: '>near [X:Y] [raio] \u2014 ilhas em torno de um ponto',
            commandOceanHelp: '>ocean M34 [alian\u00e7a] \u2014 resumo do oceano',
            distBandSame: 'mesma ilha',
            distBandAdjacent: 'ilhas adjacentes',
            distBandRegional: 'regional',
            distBandFar: 'longa dist\u00e2ncia',
            badgeIsland: 'Ilha',
            badgeCommand: 'Comando',
            segmentIslands: 'Ilhas',
            ghostLabel: 'Fantasma',
            islandTowns: '{n} cidades',
            islandAlliances: '{n} alian\u00e7as',
            islandGhosts: '{n} fantasmas',
            openIslandMap: 'Abrir a ilha no mapa',
            nearSummary: '{islands} ilhas \u00b7 {towns} cidades num raio de {n}',
            nearNeedOrigin: 'Indique um raio, ou coordenadas mais um raio. A cidade ativa \u00e9 usada quando pode ser detetada.',
            oceanEmpty: 'Nada indexado nesse oceano.',
            oceanNeed: 'Use >ocean M34 ou >ocean M34 NomeDaAlian\u00e7a.',
            oceanSummary: '{players} jogadores \u00b7 {alliances} alian\u00e7as \u00b7 {towns} cidades \u00b7 {ghosts} fantasmas',
            playerTownsTitle: 'Cidades',
            allianceSpreadTitle: 'Onde est\u00e3o',
            allianceMembersTitle: 'Membros',
            drillTowns: 'ver cidades',
            sortPoints: 'por pontos',
            sortDistance: 'por distância',
            shortcutsOpen: 'Abrir/fechar QuickFinder',
            commandSettingsHelp: '>settings — abrir o painel de definições',
            settingsTitle: 'Definições',
            settingsLanguage: 'Idioma',
            settingsLanguageAuto: 'Automático (detetado a partir do mundo)',
            settingsHotkey: 'Atalho de teclado',
            settingsPageSize: 'Resultados por página',
            settingsMaxResults: 'Máx. de resultados de comandos',
            settingsCacheTtl: 'Cache de dados (horas)',
            settingsNearRadius: 'Raio máx. para >near',
            settingsGhostMin: 'Pontos mín. predefinidos para >ghost',
            settingsSave: 'Guardar',
            settingsReset: 'Repor predefinições',
            settingsSaved: 'Definições guardadas',
            settingsResetDone: 'Definições repostas',
            segmentSaved: 'Guardadas',
            segmentFavorites: 'Favoritos',
            segmentRecent: 'Recentes',
            savedSearchesTitle: 'Pesquisas guardadas',
            savedSearchesCleared: 'Pesquisas guardadas limpas',
            saveSearchTooltip: 'Ctrl+D guardar pesquisa',
            saveSearchPanelTitle: 'Guardar pesquisa',
            saveSearchEditTitle: 'Renomear pesquisa guardada',
            saveSearchEditTooltip: 'Renomear (Ctrl+E)',
            saveSearchNameLabel: 'Nome',
            saveSearchSave: 'Guardar',
            saveSearchCancel: 'Cancelar',
            saveSearchSaved: 'Pesquisa guardada',
            saveSearchRenamed: 'Pesquisa guardada renomeada',
            saveSearchRemove: 'Remover pesquisa guardada',
            badgeSavedSearch: 'Guardada',
            shortcutsSaveSearch: 'Guardar pesquisa atual',
            shortcutsRenameSaved: 'Renomear a pesquisa guardada selecionada',
            hierarchyDrillTooltip: 'Ver detalhes (→)',
            shortcutsHierarchyNav: '← → entrar/sair',
            updateAvailableToast: 'Está disponível uma nova versão ({version}).',
            updateAvailableTooltip: 'Nova versão {version} disponível — clique para descarregar',
            settingsCheckUpdates: 'Procurar atualizações',
            updateUpToDate: 'Já tem a versão mais recente',
            settingsConquestHistory: 'Ativar histórico de conquistas',
            settingsConquestHistoryHint: 'Descarrega um ficheiro de vários MB (conquers.txt) para >history',
            islandTownsWithCapacity: '{n}/{cap} cidades',
            recentlyConquered: 'conquistada há {n}d',
            lastActivity: 'última atividade há {n}d',
            commandHistoryHelp: '>history <nome|x:y> — histórico de conquistas de uma cidade, jogador ou coordenada',
            commandTravelHelp: '>travel <unidade,...> [X:Y] [X:Y] [sirens=N] — tempo de viagem das tropas',
            commandTopHelp: '>top players|alliances [N] — ranking por pontos',
            commandVsHelp: '>vs <alian\u00e7a1> vs <alian\u00e7a2> — compara duas alian\u00e7as',
            travelUnknownUnit: 'Unidade desconhecida: {unit}',
            travelCalcFailed: 'N\u00e3o foi poss\u00edvel calcular o tempo de viagem (faltam dados em direto do jogo).',
            travelLimitedBy: 'Limitado por: {unit}',
            travelColonizeShipLimit: 'Isto excede o limite normal de 48h do barco de coloniza\u00e7\u00e3o.',
            travelFlyingNote: 'As unidades voadoras podem atravessar ilhas sem barco de transporte.',
            travelNoBonusData: 'B\u00f3nus de investiga\u00e7\u00e3o/edif\u00edcios da cidade indispon\u00edveis — a mostrar apenas a velocidade base.',
            travelUsedActiveCity: 'Foram usados os b\u00f3nus da sua cidade ativa (a origem n\u00e3o \u00e9 uma das suas cidades).',
            travelScopeNote: 'N\u00e3o inclui o b\u00f3nus do Grande Templo de Ares do Olimpo nem efeitos de her\u00f3i.',
            historyEmpty: 'Sem histórico de conquistas registado para isto.',
            historyNotLoaded: 'A carregar o histórico de conquistas...',
            historyDisabled: 'Ative "histórico de conquistas" nas Definições para usar >history.',
            historyGhost: 'ninguém (fantasma)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'colonizada por {to}',
            historyEventCount: '{n} eventos registados',
            historyPlayerSummary: '{conquered} conquistadas · {lost} perdidas',
        },
        br: {
            searchPlaceholder: 'Pesquisar jogadores, alian\u00e7as ou cidades...',
            footerNavigate: '\u2191 \u2193 selecionar',
            footerOpen: 'Enter abrir',
            shortcutsEscTwoStage: 'Fechar painel / paleta (pressione duas vezes se um painel de detalhes estiver aberto)',
            emptyTitle: 'Pesquisar no Grepolis',
            emptySubtitle: 'Jogadores \u00b7 Alian\u00e7as \u00b7 Cidades',
            emptyHintCoords: 'Voc\u00ea tamb\u00e9m pode digitar coordenadas: <strong>{example}</strong>',
            emptyHintCommands: 'Digite <strong>&gt;</strong> para comandos (cidades fantasma, distâncias...) ou <strong>?</strong> para todos os atalhos.',
            loadingWorldData: 'Carregando dados do mundo...',
            noResults: 'Nenhum resultado encontrado.',
            resultsMore: 'Exibindo {shown} de {total} \u2014 role para ver mais',
            errorLoadingDataGeneric: 'Não foi possível carregar os dados do mundo. Tente atualizar.',
            errorLoadingDataTimeout: 'A solicitação demorou demais. Verifique sua conexão e tente novamente.',
            errorLoadingDataWorldNotDetected: 'Não foi possível detectar o mundo atual.',
            badgePlayer: 'Jogador',
            badgeAlliance: 'Alian\u00e7a',
            badgeTown: 'Cidade',
            badgeCoordinate: 'Coordenadas',
            ptsSuffix: 'pts',
            membersSuffix: 'membros',
            segmentAll: 'Tudo',
            segmentPlayers: 'Jogadores',
            segmentAlliances: 'Alian\u00e7as',
            segmentTowns: 'Cidades',
            segmentCoords: 'Coordenadas',
            townsSuffix: 'cidades',
            onIslandInfo: '{n} cidades nesta ilha',
            favoritesTitle: 'Favoritos',
            recentTitle: 'Recentes',
            recentClearAll: 'Limpar',
            recentRemove: 'Remover do histórico',
            recentCleared: 'Histórico recente limpo',
            footerTab: 'Tab filtrar',
            footerFav: 'Ctrl+F favorito',
            footerBBCode: 'Ctrl+B copiar BBCode',
            footerExport: 'Exportar lista',
            exportEmpty: 'Nada para exportar na lista atual.',
            exportCopied: '{n} entradas BBCode copiadas',
            bbcodeCopied: 'Copiado',
            footerRefresh: 'Ctrl+R atualizar',
            footerHelp: '? ajuda',
            menuItem: 'QuickFinder',
            dataFresh: 'Dados atuais',
            dataFreshMin: 'Dados com {n} min',
            dataFreshHour: 'Dados com {n} h',
            dataFreshDay: 'Dados com {n} d',
            dataError: 'Erro de dados',
            shortcutsTitle: 'Atalhos',
            commandHelpTitle: 'Comandos',
            commandGotoHelp: '>goto 123:456 \u2014 pular para uma ilha',
            shortcutsFirstLast: 'ir para o primeiro/\u00faltimo resultado',
            shortcutsRemoveRecent: 'Remover selecionado do histórico',
            shortcutsClearRecent: 'Limpar todo o histórico recente',
            shortcutsHelp: 'mostrar esta ajuda',
            commandGhostHelp: '>ghost [minPts] \u2014 listar cidades fantasma',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 dist\u00e2ncia de ilhas',
            commandHelpHint: '>help \u2014 mostrar esta lista',
            commandUnknown: 'Comando desconhecido: {cmd}',
            premiumRequired: 'Requer o conselheiro Administrador (Premium) ativo.',
            ghostEmpty: 'Nenhuma cidade fantasma encontrada.',
            distResult: 'Dist\u00e2ncia de ilhas: {n}',
            distFromActive: 'da sua cidade ativa',
            distFromOrigin: 'a partir da origem fixada',
            distNeedOrigin: 'Informe duas coordenadas, ou uma, se sua cidade ativa puder ser detectada.',
            originSet: 'Origem definida em {x}:{y}',
            originSetTooltip: 'Definir como origem de dist\u00e2ncia (Ctrl+O)',
            originCleared: 'Origem removida',
            originIndicator: 'Origem {x}:{y}',
            originIndicatorTooltip: 'Clique para remover a origem fixada',
            shortcutsSetOrigin: 'Definir como origem de dist\u00e2ncia',
            favoriteNoteTooltip: 'Editar nota (Ctrl+N)',
            favoriteNoteTitle: 'Nota para {name}',
            favoriteNoteLabel: 'Nota',
            favoriteNoteSaved: 'Nota salva',
            shortcutsEditNote: 'Editar a nota do favorito selecionado',
            scopeHelpTitle: '\u00c2mbitos',
            scopeHelpDesc: '@p jogadores \u00b7 @a alian\u00e7as \u00b7 @t cidades \u00b7 @c coordenadas',
            commandIslandHelp: '>island X:Y \u2014 todas as cidades de uma ilha',
            commandNearHelp: '>near [X:Y] [raio] \u2014 ilhas ao redor de um ponto',
            commandOceanHelp: '>ocean M34 [alian\u00e7a] \u2014 resumo do oceano',
            distBandSame: 'mesma ilha',
            distBandAdjacent: 'ilhas adjacentes',
            distBandRegional: 'regional',
            distBandFar: 'longa dist\u00e2ncia',
            badgeIsland: 'Ilha',
            badgeCommand: 'Comando',
            segmentIslands: 'Ilhas',
            ghostLabel: 'Fantasma',
            islandTowns: '{n} cidades',
            islandAlliances: '{n} alian\u00e7as',
            islandGhosts: '{n} fantasmas',
            openIslandMap: 'Abrir a ilha no mapa',
            nearSummary: '{islands} ilhas \u00b7 {towns} cidades num raio de {n}',
            nearNeedOrigin: 'Informe um raio, ou coordenadas mais um raio. A cidade ativa \u00e9 usada quando pode ser detectada.',
            oceanEmpty: 'Nada indexado nesse oceano.',
            oceanNeed: 'Use >ocean M34 ou >ocean M34 NomeDaAlian\u00e7a.',
            oceanSummary: '{players} jogadores \u00b7 {alliances} alian\u00e7as \u00b7 {towns} cidades \u00b7 {ghosts} fantasmas',
            playerTownsTitle: 'Cidades',
            allianceSpreadTitle: 'Onde est\u00e3o',
            allianceMembersTitle: 'Membros',
            drillTowns: 'ver cidades',
            sortPoints: 'por pontos',
            sortDistance: 'por distância',
            shortcutsOpen: 'Abrir/fechar o QuickFinder',
            commandSettingsHelp: '>settings — abrir o painel de configurações',
            settingsTitle: 'Configurações',
            settingsLanguage: 'Idioma',
            settingsLanguageAuto: 'Automático (detectado a partir do mundo)',
            settingsHotkey: 'Atalho de teclado',
            settingsPageSize: 'Resultados por página',
            settingsMaxResults: 'Máx. de resultados de comandos',
            settingsCacheTtl: 'Cache de dados (horas)',
            settingsNearRadius: 'Raio máx. para >near',
            settingsGhostMin: 'Pontos mín. padrão para >ghost',
            settingsSave: 'Salvar',
            settingsReset: 'Restaurar padrões',
            settingsSaved: 'Configurações salvas',
            settingsResetDone: 'Configurações restauradas',
            segmentSaved: 'Salvas',
            segmentFavorites: 'Favoritos',
            segmentRecent: 'Recentes',
            savedSearchesTitle: 'Pesquisas salvas',
            savedSearchesCleared: 'Pesquisas salvas limpas',
            saveSearchTooltip: 'Ctrl+D salvar pesquisa',
            saveSearchPanelTitle: 'Salvar pesquisa',
            saveSearchEditTitle: 'Renomear pesquisa salva',
            saveSearchEditTooltip: 'Renomear (Ctrl+E)',
            saveSearchNameLabel: 'Nome',
            saveSearchSave: 'Salvar',
            saveSearchCancel: 'Cancelar',
            saveSearchSaved: 'Pesquisa salva',
            saveSearchRenamed: 'Pesquisa salva renomeada',
            saveSearchRemove: 'Remover pesquisa salva',
            badgeSavedSearch: 'Salva',
            shortcutsSaveSearch: 'Salvar pesquisa atual',
            shortcutsRenameSaved: 'Renomear a pesquisa salva selecionada',
            hierarchyDrillTooltip: 'Ver detalhes (→)',
            shortcutsHierarchyNav: '← → entrar/sair',
            updateAvailableToast: 'Uma nova versão ({version}) está disponível.',
            updateAvailableTooltip: 'Nova versão {version} disponível — clique para baixar',
            settingsCheckUpdates: 'Verificar atualizações',
            updateUpToDate: 'Você já tem a versão mais recente',
            settingsConquestHistory: 'Ativar histórico de conquistas',
            settingsConquestHistoryHint: 'Baixa um arquivo de vários MB (conquers.txt) para >history',
            islandTownsWithCapacity: '{n}/{cap} cidades',
            recentlyConquered: 'conquistada há {n}d',
            lastActivity: 'última atividade há {n}d',
            commandHistoryHelp: '>history <nome|x:y> — histórico de conquistas de uma cidade, jogador ou coordenada',
            commandTravelHelp: '>travel <unidade,...> [X:Y] [X:Y] [sirens=N] — tempo de viagem das tropas',
            commandTopHelp: '>top players|alliances [N] — ranking por pontos',
            commandVsHelp: '>vs <alian\u00e7a1> vs <alian\u00e7a2> — compara duas alian\u00e7as',
            travelUnknownUnit: 'Unidade desconhecida: {unit}',
            travelCalcFailed: 'N\u00e3o foi poss\u00edvel calcular o tempo de viagem (faltam dados em tempo real do jogo).',
            travelLimitedBy: 'Limitado por: {unit}',
            travelColonizeShipLimit: 'Isso excede o limite normal de 48h do barco de coloniza\u00e7\u00e3o.',
            travelFlyingNote: 'Unidades voadoras podem atravessar ilhas sem navio de transporte.',
            travelNoBonusData: 'B\u00f4nus de pesquisa/constru\u00e7\u00e3o da cidade indispon\u00edveis — mostrando apenas a velocidade base.',
            travelUsedActiveCity: 'Foram usados os b\u00f4nus da sua cidade ativa (a origem n\u00e3o \u00e9 uma das suas cidades).',
            travelScopeNote: 'N\u00e3o inclui o b\u00f4nus do Grande Templo de Ares do Olimpo nem efeitos de her\u00f3i.',
            historyEmpty: 'Nenhum histórico de conquistas registrado para isso.',
            historyNotLoaded: 'Carregando histórico de conquistas...',
            historyDisabled: 'Ative "histórico de conquistas" nas Configurações para usar >history.',
            historyGhost: 'ninguém (fantasma)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'colonizada por {to}',
            historyEventCount: '{n} eventos registrados',
            historyPlayerSummary: '{conquered} conquistadas · {lost} perdidas',
        },
        tr: {
            searchPlaceholder: 'Oyuncu, ittifak veya \u015fehir ara...',
            footerNavigate: '\u2191 \u2193 se\u00e7',
            footerOpen: 'Enter a\u00e7',
            shortcutsEscTwoStage: 'Paneli / paleti kapat (bir ayrıntı paneli açıksa iki kez basın)',
            emptyTitle: "Grepolis'te ara",
            emptySubtitle: 'Oyuncular \u00b7 \u0130ttifaklar \u00b7 \u015eehirler',
            emptyHintCoords: 'Koordinat da girebilirsin: <strong>{example}</strong>',
            emptyHintCommands: 'Komutlar için (hayalet şehirler, mesafeler...) <strong>&gt;</strong>, tüm kısayollar için <strong>?</strong> yazın.',
            loadingWorldData: 'D\u00fcnya verileri y\u00fckleniyor...',
            noResults: 'Sonu\u00e7 bulunamad\u0131.',
            resultsMore: '{total} sonu\u00e7tan {shown} g\u00f6steriliyor \u2014 daha fazlas\u0131 i\u00e7in kayd\u0131r\u0131n',
            errorLoadingDataGeneric: 'Dünya verileri yüklenemedi. Yenilemeyi deneyin.',
            errorLoadingDataTimeout: 'İstek çok uzun sürdü. Bağlantınızı kontrol edip tekrar deneyin.',
            errorLoadingDataWorldNotDetected: 'Mevcut dünya tespit edilemedi.',
            badgePlayer: 'Oyuncu',
            badgeAlliance: '\u0130ttifak',
            badgeTown: '\u015eehir',
            badgeCoordinate: 'Koordinatlar',
            ptsSuffix: 'puan',
            membersSuffix: '\u00fcye',
            segmentAll: 'T\u00fcm\u00fc',
            segmentPlayers: 'Oyuncular',
            segmentAlliances: '\u0130ttifaklar',
            segmentTowns: '\u015eehirler',
            segmentCoords: 'Koordinatlar',
            townsSuffix: '\u015fehir',
            onIslandInfo: 'Bu adada {n} \u015fehir',
            favoritesTitle: 'Favoriler',
            recentTitle: 'Son',
            recentClearAll: 'Temizle',
            recentRemove: 'Geçmişden kaldır',
            recentCleared: 'Son geçmiş temizlendi',
            footerTab: 'Tab filtrele',
            footerFav: 'Ctrl+F favori',
            footerBBCode: 'Ctrl+B BBCode kopyala',
            footerExport: 'Listeyi d\u0131\u015fa aktar',
            exportEmpty: 'Mevcut listede d\u0131\u015fa aktar\u0131lacak bir \u015fey yok.',
            exportCopied: '{n} BBCode kayd\u0131 kopyaland\u0131',
            bbcodeCopied: 'Kopyaland\u0131',
            footerRefresh: 'Ctrl+R yenile',
            footerHelp: '? yard\u0131m',
            menuItem: 'QuickFinder',
            dataFresh: 'Veriler g\u00fcncel',
            dataFreshMin: 'Veriler {n} dk eski',
            dataFreshHour: 'Veriler {n} sa eski',
            dataFreshDay: 'Veriler {n} g eski',
            dataError: 'Veri hatas\u0131',
            shortcutsTitle: 'K\u0131sayollar',
            shortcutsFirstLast: 'ilk/son sonuca git',
            shortcutsRemoveRecent: 'Seçileni geçmişden kaldır',
            shortcutsClearRecent: 'Tüm son geçmişi temizle',
            shortcutsHelp: 'bu yard\u0131m\u0131 g\u00f6ster',
            commandHelpTitle: 'Komutlar',
            commandGotoHelp: '>goto 123:456 \u2014 bir adaya git',
            commandGhostHelp: '>ghost [minPts] \u2014 hayalet \u015fehirleri listele',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 ada mesafesi',
            commandHelpHint: '>help \u2014 bu listeyi g\u00f6ster',
            commandUnknown: 'Bilinmeyen komut: {cmd}',
            premiumRequired: 'Yönetici danışmanının (Premium) aktif olmasını gerektirir.',
            ghostEmpty: 'Hayalet \u015fehir bulunamad\u0131.',
            distResult: 'Ada mesafesi: {n}',
            distFromActive: 'aktif \u015fehrinden',
            distFromOrigin: 'sabitlenmi\u015f ba\u015flang\u0131\u00e7 noktas\u0131ndan',
            distNeedOrigin: '\u0130ki koordinat ver veya aktif \u015fehrin alg\u0131lanabiliyorsa bir tane ver.',
            originSet: 'Ba\u015flang\u0131\u00e7 noktas\u0131 {x}:{y} olarak ayarland\u0131',
            originSetTooltip: 'Mesafe ba\u015flang\u0131\u00e7 noktas\u0131 olarak ayarla (Ctrl+O)',
            originCleared: 'Ba\u015flang\u0131\u00e7 noktas\u0131 temizlendi',
            originIndicator: 'Ba\u015flang\u0131\u00e7 {x}:{y}',
            originIndicatorTooltip: 'Sabitlenmi\u015f ba\u015flang\u0131\u00e7 noktas\u0131n\u0131 temizlemek i\u00e7in t\u0131kla',
            shortcutsSetOrigin: 'Mesafe ba\u015flang\u0131\u00e7 noktas\u0131 olarak ayarla',
            favoriteNoteTooltip: 'Notu d\u00fczenle (Ctrl+N)',
            favoriteNoteTitle: '{name} i\u00e7in not',
            favoriteNoteLabel: 'Not',
            favoriteNoteSaved: 'Not kaydedildi',
            shortcutsEditNote: 'Se\u00e7ili favorinin notunu d\u00fczenle',
            scopeHelpTitle: 'Kapsamlar',
            scopeHelpDesc: '@p oyuncular \u00b7 @a ittifaklar \u00b7 @t \u015fehirler \u00b7 @c koordinatlar',
            commandIslandHelp: '>island X:Y \u2014 bir adadaki t\u00fcm \u015fehirler',
            commandNearHelp: '>near [X:Y] [yar\u0131\u00e7ap] \u2014 bir noktan\u0131n etraf\u0131ndaki adalar',
            commandOceanHelp: '>ocean M34 [ittifak] \u2014 okyanus \u00f6zeti',
            distBandSame: 'ayn\u0131 ada',
            distBandAdjacent: 'kom\u015fu adalar',
            distBandRegional: 'b\u00f6lgesel',
            distBandFar: 'uzun mesafe',
            badgeIsland: 'Ada',
            badgeCommand: 'Komut',
            segmentIslands: 'Adalar',
            ghostLabel: 'Hayalet',
            islandTowns: '{n} \u015fehir',
            islandAlliances: '{n} ittifak',
            islandGhosts: '{n} hayalet',
            openIslandMap: 'Aday\u0131 haritada a\u00e7',
            nearSummary: '{islands} ada \u00b7 {towns} \u015fehir {n} yar\u0131\u00e7ap i\u00e7inde',
            nearNeedOrigin: 'Bir yar\u0131\u00e7ap ver, ya da koordinat art\u0131 yar\u0131\u00e7ap. Alg\u0131lanabiliyorsa aktif \u015fehrin kullan\u0131l\u0131r.',
            oceanEmpty: 'Bu okyanusta hi\u00e7bir \u015fey indekslenmedi.',
            oceanNeed: '>ocean M34 veya >ocean M34 \u0130ttifakAd\u0131 kullan.',
            oceanSummary: '{players} oyuncu \u00b7 {alliances} ittifak \u00b7 {towns} \u015fehir \u00b7 {ghosts} hayalet',
            playerTownsTitle: '\u015eehirler',
            allianceSpreadTitle: 'Nerede bulunuyorlar',
            allianceMembersTitle: '\u00dcyeler',
            drillTowns: 'şehirleri göster',
            sortPoints: 'puana göre',
            sortDistance: 'mesafeye göre',
            shortcutsOpen: 'QuickFinder\'ı aç/kapat',
            commandSettingsHelp: '>settings — ayarlar panelini aç',
            settingsTitle: 'Ayarlar',
            settingsLanguage: 'Dil',
            settingsLanguageAuto: 'Otomatik (dünyadan algılanır)',
            settingsHotkey: 'Klavye kısayolu',
            settingsPageSize: 'Sayfa başına sonuç',
            settingsMaxResults: 'Maks. komut sonucu',
            settingsCacheTtl: 'Veri önbelleği (saat)',
            settingsNearRadius: '>near için maks. yarıçap',
            settingsGhostMin: '>ghost için varsayılan min. puan',
            settingsSave: 'Kaydet',
            settingsReset: 'Varsayılanlara sıfırla',
            settingsSaved: 'Ayarlar kaydedildi',
            settingsResetDone: 'Ayarlar sıfırlandı',
            segmentSaved: 'Kayıtlı',
            segmentFavorites: 'Favoriler',
            segmentRecent: 'Son',
            savedSearchesTitle: 'Kayıtlı aramalar',
            savedSearchesCleared: 'Kayıtlı aramalar temizlendi',
            saveSearchTooltip: 'Ctrl+D aramayı kaydet',
            saveSearchPanelTitle: 'Aramayı kaydet',
            saveSearchEditTitle: 'Kayıtlı aramayı yeniden adlandır',
            saveSearchEditTooltip: 'Yeniden adlandır (Ctrl+E)',
            saveSearchNameLabel: 'Ad',
            saveSearchSave: 'Kaydet',
            saveSearchCancel: 'İptal',
            saveSearchSaved: 'Arama kaydedildi',
            saveSearchRenamed: 'Kayıtlı arama yeniden adlandırıldı',
            saveSearchRemove: 'Kayıtlı aramayı kaldır',
            badgeSavedSearch: 'Kayıtlı',
            shortcutsSaveSearch: 'Geçerli aramayı kaydet',
            shortcutsRenameSaved: 'Seçili kayıtlı aramayı yeniden adlandır',
            hierarchyDrillTooltip: 'Ayrıntıları görüntüle (→)',
            shortcutsHierarchyNav: '← → gir/çık',
            updateAvailableToast: 'Yeni bir sürüm ({version}) mevcut.',
            updateAvailableTooltip: 'Yeni sürüm {version} mevcut — indirmek için tıklayın',
            settingsCheckUpdates: 'Güncellemeleri denetle',
            updateUpToDate: 'Zaten en son sürüme sahipsiniz',
            settingsConquestHistory: 'Fetih geçmişini etkinleştir',
            settingsConquestHistoryHint: '>history için birkaç MB\'lık bir dosya (conquers.txt) indirir',
            islandTownsWithCapacity: '{n}/{cap} şehir',
            recentlyConquered: '{n} gün önce fethedildi',
            lastActivity: 'son etkinlik {n} gün önce',
            commandHistoryHelp: '>history <isim|x:y> — bir şehrin, oyuncunun veya koordinatın fetih geçmişi',
            commandTravelHelp: '>travel <birim,...> [X:Y] [X:Y] [sirens=N] — birlik seyahat s\u00fcresi',
            commandTopHelp: '>top players|alliances [N] — puan s\u0131ralamas\u0131',
            commandVsHelp: '>vs <ittifak1> vs <ittifak2> — iki ittifak\u0131 kar\u015f\u0131la\u015ft\u0131r',
            travelUnknownUnit: 'Bilinmeyen birim: {unit}',
            travelCalcFailed: 'Seyahat s\u00fcresi hesaplanamad\u0131 (canl\u0131 oyun verisi eksik).',
            travelLimitedBy: 'S\u0131n\u0131rlayan: {unit}',
            travelColonizeShipLimit: 'Bu, koloni gemisinin normal 48 saatlik s\u0131n\u0131r\u0131n\u0131 a\u015f\u0131yor.',
            travelFlyingNote: 'U\u00e7an birimler nakliye gemisi olmadan adalar aras\u0131 ge\u00e7i\u015f yapabilir.',
            travelNoBonusData: '\u015eehir ara\u015ft\u0131rma/bina bonuslar\u0131 mevcut de\u011fil — yaln\u0131zca temel h\u0131z g\u00f6steriliyor.',
            travelUsedActiveCity: 'Aktif \u015fehrinizin bonuslar\u0131 kullan\u0131ld\u0131 (ba\u015flang\u0131\u00e7 noktas\u0131 \u015fehirlerinizden biri de\u011fil).',
            travelScopeNote: 'Olympus B\u00fcy\u00fck Ares Tap\u0131na\u011f\u0131 bonusunu veya kahraman etkilerini i\u00e7ermez.',
            historyEmpty: 'Bunun için kayıtlı fetih geçmişi yok.',
            historyNotLoaded: 'Fetih geçmişi yükleniyor...',
            historyDisabled: '>history kullanmak için Ayarlar\'da "fetih geçmişi"ni etkinleştirin.',
            historyGhost: 'kimse (hayalet)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: '{to} tarafından kuruldu',
            historyEventCount: '{n} kayıtlı olay',
            historyPlayerSummary: '{conquered} fethedildi · {lost} kaybedildi',
        },
        ru: {
            searchPlaceholder: '\u041f\u043e\u0438\u0441\u043a \u0438\u0433\u0440\u043e\u043a\u043e\u0432, \u0430\u043b\u044c\u044f\u043d\u0441\u043e\u0432 \u0438\u043b\u0438 \u0433\u043e\u0440\u043e\u0434\u043e\u0432...',
            footerNavigate: '\u2191 \u2193 \u0432\u044b\u0431\u0440\u0430\u0442\u044c',
            footerOpen: 'Enter \u043e\u0442\u043a\u0440\u044b\u0442\u044c',
            shortcutsEscTwoStage: 'Закрыть панель / палитру (нажмите дважды, если открыта панель деталей)',
            emptyTitle: '\u041f\u043e\u0438\u0441\u043a \u0432 Grepolis',
            emptySubtitle: '\u0418\u0433\u0440\u043e\u043a\u0438 \u00b7 \u0410\u043b\u044c\u044f\u043d\u0441\u044b \u00b7 \u0413\u043e\u0440\u043e\u0434\u0430',
            emptyHintCoords: '\u041c\u043e\u0436\u043d\u043e \u0442\u0430\u043a\u0436\u0435 \u0432\u0432\u0435\u0441\u0442\u0438 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b: <strong>{example}</strong>',
            emptyHintCommands: 'Введите <strong>&gt;</strong> для команд (города-призраки, расстояния...) или <strong>?</strong> для всех горячих клавиш.',
            loadingWorldData: '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0434\u0430\u043d\u043d\u044b\u0445 \u043c\u0438\u0440\u0430...',
            noResults: '\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u044b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.',
            resultsMore: '\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u043e {shown} \u0438\u0437 {total} \u2014 \u043f\u0440\u043e\u043a\u0440\u0443\u0442\u0438\u0442\u0435 \u0434\u043b\u044f \u0431\u043e\u043b\u044c\u0448\u0435\u0433\u043e',
            errorLoadingDataGeneric: 'Не удалось загрузить данные мира. Попробуйте обновить.',
            errorLoadingDataTimeout: 'Запрос занял слишком много времени. Проверьте соединение и попробуйте снова.',
            errorLoadingDataWorldNotDetected: 'Не удалось определить текущий мир.',
            badgePlayer: '\u0418\u0433\u0440\u043e\u043a',
            badgeAlliance: '\u0410\u043b\u044c\u044f\u043d\u0441',
            badgeTown: '\u0413\u043e\u0440\u043e\u0434',
            badgeCoordinate: '\u041a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b',
            ptsSuffix: '\u043e\u0447\u043a\u043e\u0432',
            membersSuffix: '\u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u043e\u0432',
            segmentAll: '\u0412\u0441\u0435',
            segmentPlayers: '\u0418\u0433\u0440\u043e\u043a\u0438',
            segmentAlliances: '\u0410\u043b\u044c\u044f\u043d\u0441\u044b',
            segmentTowns: '\u0413\u043e\u0440\u043e\u0434\u0430',
            segmentCoords: '\u041a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b',
            townsSuffix: '\u0433\u043e\u0440\u043e\u0434\u043e\u0432',
            onIslandInfo: '{n} \u0433\u043e\u0440\u043e\u0434\u043e\u0432 \u043d\u0430 \u044d\u0442\u043e\u043c \u043e\u0441\u0442\u0440\u043e\u0432\u0435',
            favoritesTitle: '\u0418\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435',
            recentTitle: '\u041d\u0435\u0434\u0430\u0432\u043d\u0438\u0435',
            recentClearAll: 'Очистить',
            recentRemove: 'Удалить из истории',
            recentCleared: 'История очищена',
            footerTab: 'Tab \u0444\u0438\u043b\u044c\u0442\u0440',
            footerFav: 'Ctrl+F \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435',
            footerBBCode: 'Ctrl+B \u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c BBCode',
            footerExport: '\u042d\u043a\u0441\u043f\u043e\u0440\u0442 \u0441\u043f\u0438\u0441\u043a\u0430',
            exportEmpty: '\u041d\u0435\u0447\u0435\u0433\u043e \u044d\u043a\u0441\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0432 \u0442\u0435\u043a\u0443\u0449\u0435\u043c \u0441\u043f\u0438\u0441\u043a\u0435.',
            exportCopied: '\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u043e \u0437\u0430\u043f\u0438\u0441\u0435\u0439 BBCode: {n}',
            bbcodeCopied: '\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u043e',
            footerRefresh: 'Ctrl+R \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c',
            footerHelp: '? \u0441\u043f\u0440\u0430\u0432\u043a\u0430',
            menuItem: 'QuickFinder',
            dataFresh: '\u0414\u0430\u043d\u043d\u044b\u0435 \u0430\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u044b',
            dataFreshMin: '\u0414\u0430\u043d\u043d\u044b\u0435 \u0437\u0430 {n} \u043c\u0438\u043d',
            dataFreshHour: '\u0414\u0430\u043d\u043d\u044b\u0435 \u0437\u0430 {n} \u0447',
            dataFreshDay: '\u0414\u0430\u043d\u043d\u044b\u0435 \u0437\u0430 {n} \u0434\u043d',
            dataError: '\u041e\u0448\u0438\u0431\u043a\u0430 \u0434\u0430\u043d\u043d\u044b\u0445',
            shortcutsTitle: '\u0413\u043e\u0440\u044f\u0447\u0438\u0435 \u043a\u043b\u0430\u0432\u0438\u0448\u0438',
            shortcutsFirstLast: '\u043f\u0435\u0440\u0435\u0439\u0442\u0438 \u043a \u043f\u0435\u0440\u0432\u043e\u043c\u0443/\u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u043c\u0443 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0443',
            shortcutsRemoveRecent: 'удалить выбранное из истории',
            shortcutsClearRecent: 'очистить всю историю',
            shortcutsHelp: '\u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u044d\u0442\u0443 \u0441\u043f\u0440\u0430\u0432\u043a\u0443',
            commandHelpTitle: '\u041a\u043e\u043c\u0430\u043d\u0434\u044b',
            commandGotoHelp: '>goto 123:456 \u2014 \u043f\u0435\u0440\u0435\u0439\u0442\u0438 \u043a \u043e\u0441\u0442\u0440\u043e\u0432\u0443',
            commandGhostHelp: '>ghost [\u043c\u0438\u043d.] \u2014 \u0441\u043f\u0438\u0441\u043e\u043a \u0433\u043e\u0440\u043e\u0434\u043e\u0432-\u043f\u0440\u0438\u0437\u0440\u0430\u043a\u043e\u0432',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 \u0440\u0430\u0441\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u043c\u0435\u0436\u0434\u0443 \u043e\u0441\u0442\u0440\u043e\u0432\u0430\u043c\u0438',
            commandHelpHint: '>help \u2014 \u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u044d\u0442\u043e\u0442 \u0441\u043f\u0438\u0441\u043e\u043a',
            commandUnknown: '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043a\u043e\u043c\u0430\u043d\u0434\u0430: {cmd}',
            premiumRequired: '\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0441\u043e\u0432\u0435\u0442\u043d\u0438\u043a \u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 (\u041f\u0440\u0435\u043c\u0438\u0443\u043c).',
            ghostEmpty: '\u0413\u043e\u0440\u043e\u0434\u0430-\u043f\u0440\u0438\u0437\u0440\u0430\u043a\u0438 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.',
            distResult: '\u0420\u0430\u0441\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u043c\u0435\u0436\u0434\u0443 \u043e\u0441\u0442\u0440\u043e\u0432\u0430\u043c\u0438: {n}',
            distFromActive: '\u043e\u0442 \u0432\u0430\u0448\u0435\u0433\u043e \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0433\u043e \u0433\u043e\u0440\u043e\u0434\u0430',
            distFromOrigin: '\u043e\u0442 \u0437\u0430\u043a\u0440\u0435\u043f\u043b\u0451\u043d\u043d\u043e\u0439 \u0442\u043e\u0447\u043a\u0438 \u043e\u0442\u0441\u0447\u0451\u0442\u0430',
            distNeedOrigin: '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0434\u0432\u0435 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b \u0438\u043b\u0438 \u043e\u0434\u043d\u0443, \u0435\u0441\u043b\u0438 \u0432\u0430\u0448 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0433\u043e\u0440\u043e\u0434 \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0451\u043d.',
            originSet: '\u0422\u043e\u0447\u043a\u0430 \u043e\u0442\u0441\u0447\u0451\u0442\u0430 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0430 \u043d\u0430 {x}:{y}',
            originSetTooltip: '\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c \u043a\u0430\u043a \u0442\u043e\u0447\u043a\u0443 \u043e\u0442\u0441\u0447\u0451\u0442\u0430 \u0440\u0430\u0441\u0441\u0442\u043e\u044f\u043d\u0438\u044f (Ctrl+O)',
            originCleared: '\u0422\u043e\u0447\u043a\u0430 \u043e\u0442\u0441\u0447\u0451\u0442\u0430 \u0441\u0431\u0440\u043e\u0448\u0435\u043d\u0430',
            originIndicator: '\u0422\u043e\u0447\u043a\u0430 \u043e\u0442\u0441\u0447\u0451\u0442\u0430 {x}:{y}',
            originIndicatorTooltip: '\u041d\u0430\u0436\u043c\u0438\u0442\u0435, \u0447\u0442\u043e\u0431\u044b \u0441\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u0437\u0430\u043a\u0440\u0435\u043f\u043b\u0451\u043d\u043d\u0443\u044e \u0442\u043e\u0447\u043a\u0443 \u043e\u0442\u0441\u0447\u0451\u0442\u0430',
            shortcutsSetOrigin: '\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c \u043a\u0430\u043a \u0442\u043e\u0447\u043a\u0443 \u043e\u0442\u0441\u0447\u0451\u0442\u0430 \u0440\u0430\u0441\u0441\u0442\u043e\u044f\u043d\u0438\u044f',
            favoriteNoteTooltip: '\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u0437\u0430\u043c\u0435\u0442\u043a\u0443 (Ctrl+N)',
            favoriteNoteTitle: '\u0417\u0430\u043c\u0435\u0442\u043a\u0430 \u0434\u043b\u044f {name}',
            favoriteNoteLabel: '\u0417\u0430\u043c\u0435\u0442\u043a\u0430',
            favoriteNoteSaved: '\u0417\u0430\u043c\u0435\u0442\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430',
            shortcutsEditNote: '\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u0437\u0430\u043c\u0435\u0442\u043a\u0443 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e',
            scopeHelpTitle: '\u041e\u0431\u043b\u0430\u0441\u0442\u0438',
            scopeHelpDesc: '@p \u0438\u0433\u0440\u043e\u043a\u0438 \u00b7 @a \u0430\u043b\u044c\u044f\u043d\u0441\u044b \u00b7 @t \u0433\u043e\u0440\u043e\u0434\u0430 \u00b7 @c \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b',
            commandIslandHelp: '>island X:Y \u2014 \u0432\u0441\u0435 \u0433\u043e\u0440\u043e\u0434\u0430 \u043e\u0441\u0442\u0440\u043e\u0432\u0430',
            commandNearHelp: '>near [X:Y] [\u0440\u0430\u0434\u0438\u0443\u0441] \u2014 \u043e\u0441\u0442\u0440\u043e\u0432\u0430 \u0432\u043e\u043a\u0440\u0443\u0433 \u0442\u043e\u0447\u043a\u0438',
            commandOceanHelp: '>ocean M34 [\u0430\u043b\u044c\u044f\u043d\u0441] \u2014 \u0441\u0432\u043e\u0434\u043a\u0430 \u043f\u043e \u043e\u043a\u0435\u0430\u043d\u0443',
            distBandSame: '\u043e\u0434\u0438\u043d \u043e\u0441\u0442\u0440\u043e\u0432',
            distBandAdjacent: '\u0441\u043e\u0441\u0435\u0434\u043d\u0438\u0435 \u043e\u0441\u0442\u0440\u043e\u0432\u0430',
            distBandRegional: '\u0440\u0435\u0433\u0438\u043e\u043d\u0430\u043b\u044c\u043d\u043e',
            distBandFar: '\u0434\u0430\u043b\u044c\u043d\u044f\u044f \u0434\u0438\u0441\u0442\u0430\u043d\u0446\u0438\u044f',
            badgeIsland: '\u041e\u0441\u0442\u0440\u043e\u0432',
            badgeCommand: '\u041a\u043e\u043c\u0430\u043d\u0434\u0430',
            segmentIslands: '\u041e\u0441\u0442\u0440\u043e\u0432\u0430',
            ghostLabel: '\u041f\u0440\u0438\u0437\u0440\u0430\u043a',
            islandTowns: '{n} \u0433\u043e\u0440\u043e\u0434\u043e\u0432',
            islandAlliances: '{n} \u0430\u043b\u044c\u044f\u043d\u0441\u043e\u0432',
            islandGhosts: '{n} \u043f\u0440\u0438\u0437\u0440\u0430\u043a\u043e\u0432',
            openIslandMap: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043e\u0441\u0442\u0440\u043e\u0432 \u043d\u0430 \u043a\u0430\u0440\u0442\u0435',
            nearSummary: '{islands} \u043e\u0441\u0442\u0440\u043e\u0432\u043e\u0432 \u00b7 {towns} \u0433\u043e\u0440\u043e\u0434\u043e\u0432 \u0432 \u0440\u0430\u0434\u0438\u0443\u0441\u0435 {n}',
            nearNeedOrigin: '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0440\u0430\u0434\u0438\u0443\u0441 \u0438\u043b\u0438 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b \u0438 \u0440\u0430\u0434\u0438\u0443\u0441. \u0415\u0441\u043b\u0438 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e, \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f \u0432\u0430\u0448 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0433\u043e\u0440\u043e\u0434.',
            oceanEmpty: '\u0412 \u044d\u0442\u043e\u043c \u043e\u043a\u0435\u0430\u043d\u0435 \u043d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043f\u0440\u043e\u0438\u043d\u0434\u0435\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u043e.',
            oceanNeed: '\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 >ocean M34 \u0438\u043b\u0438 >ocean M34 \u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435\u0410\u043b\u044c\u044f\u043d\u0441\u0430.',
            oceanSummary: '{players} \u0438\u0433\u0440\u043e\u043a\u043e\u0432 \u00b7 {alliances} \u0430\u043b\u044c\u044f\u043d\u0441\u043e\u0432 \u00b7 {towns} \u0433\u043e\u0440\u043e\u0434\u043e\u0432 \u00b7 {ghosts} \u043f\u0440\u0438\u0437\u0440\u0430\u043a\u043e\u0432',
            playerTownsTitle: '\u0413\u043e\u0440\u043e\u0434\u0430',
            allianceSpreadTitle: '\u0413\u0434\u0435 \u043e\u043d\u0438 \u043d\u0430\u0445\u043e\u0434\u044f\u0442\u0441\u044f',
            allianceMembersTitle: '\u0423\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0438',
            drillTowns: 'показать города',
            sortPoints: 'по очкам',
            sortDistance: 'по расстоянию',
            shortcutsOpen: 'Открыть/закрыть QuickFinder',
            commandSettingsHelp: '>settings — открыть панель настроек',
            settingsTitle: 'Настройки',
            settingsLanguage: 'Язык',
            settingsLanguageAuto: 'Автоматически (определяется по миру)',
            settingsHotkey: 'Горячая клавиша',
            settingsPageSize: 'Результатов на странице',
            settingsMaxResults: 'Макс. результатов команды',
            settingsCacheTtl: 'Кэш данных (часы)',
            settingsNearRadius: 'Макс. радиус для >near',
            settingsGhostMin: 'Мин. очки по умолчанию для >ghost',
            settingsSave: 'Сохранить',
            settingsReset: 'Сбросить настройки',
            settingsSaved: 'Настройки сохранены',
            settingsResetDone: 'Настройки сброшены',
            segmentSaved: 'Сохранённые',
            segmentFavorites: 'Избранное',
            segmentRecent: 'Недавние',
            savedSearchesTitle: 'Сохранённые поиски',
            savedSearchesCleared: 'Сохранённые поиски очищены',
            saveSearchTooltip: 'Ctrl+D сохранить поиск',
            saveSearchPanelTitle: 'Сохранить поиск',
            saveSearchEditTitle: 'Переименовать сохранённый поиск',
            saveSearchEditTooltip: 'Переименовать (Ctrl+E)',
            saveSearchNameLabel: 'Название',
            saveSearchSave: 'Сохранить',
            saveSearchCancel: 'Отмена',
            saveSearchSaved: 'Поиск сохранён',
            saveSearchRenamed: 'Сохранённый поиск переименован',
            saveSearchRemove: 'Удалить сохранённый поиск',
            badgeSavedSearch: 'Сохранён',
            shortcutsSaveSearch: 'Сохранить текущий поиск',
            shortcutsRenameSaved: 'Переименовать выбранный сохранённый поиск',
            hierarchyDrillTooltip: 'Подробнее (→)',
            shortcutsHierarchyNav: '← → войти/выйти',
            updateAvailableToast: 'Доступна новая версия ({version}).',
            updateAvailableTooltip: 'Доступна новая версия {version} — нажмите, чтобы скачать',
            settingsCheckUpdates: 'Проверить обновления',
            updateUpToDate: 'У вас уже установлена последняя версия',
            settingsConquestHistory: 'Включить историю завоеваний',
            settingsConquestHistoryHint: 'Загружает файл размером в несколько МБ (conquers.txt) для >history',
            islandTownsWithCapacity: '{n}/{cap} городов',
            recentlyConquered: 'завоёван {n} дн. назад',
            lastActivity: 'последняя активность {n} дн. назад',
            commandHistoryHelp: '>history <имя|x:y> — история завоеваний города, игрока или координаты',
            commandTravelHelp: '>travel <\u044e\u043d\u0438\u0442,...> [X:Y] [X:Y] [sirens=N] — \u0432\u0440\u0435\u043c\u044f \u043f\u0435\u0440\u0435\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u044f \u0432\u043e\u0439\u0441\u043a',
            commandTopHelp: '>top players|alliances [N] — \u0440\u0435\u0439\u0442\u0438\u043d\u0433 \u043f\u043e \u043e\u0447\u043a\u0430\u043c',
            commandVsHelp: '>vs <\u0430\u043b\u044c\u044f\u043d\u04411> vs <\u0430\u043b\u044c\u044f\u043d\u04412> — \u0441\u0440\u0430\u0432\u043d\u0438\u0442\u044c \u0434\u0432\u0430 \u0430\u043b\u044c\u044f\u043d\u0441\u0430',
            travelUnknownUnit: '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0439 \u044e\u043d\u0438\u0442: {unit}',
            travelCalcFailed: '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0440\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u0442\u044c \u0432\u0440\u0435\u043c\u044f \u043f\u0435\u0440\u0435\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u044f (\u043d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445 \u0438\u0433\u0440\u044b \u0432 \u0440\u0435\u0430\u043b\u044c\u043d\u043e\u043c \u0432\u0440\u0435\u043c\u0435\u043d\u0438).',
            travelLimitedBy: '\u041e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u043e: {unit}',
            travelColonizeShipLimit: '\u042d\u0442\u043e \u043f\u0440\u0435\u0432\u044b\u0448\u0430\u0435\u0442 \u043e\u0431\u044b\u0447\u043d\u044b\u0439 \u043b\u0438\u043c\u0438\u0442 \u043a\u043e\u043b\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u043e\u043d\u043d\u043e\u0433\u043e \u043a\u043e\u0440\u0430\u0431\u043b\u044f \u0432 48 \u0447.',
            travelFlyingNote: '\u041b\u0435\u0442\u0430\u044e\u0449\u0438\u0435 \u044e\u043d\u0438\u0442\u044b \u043c\u043e\u0433\u0443\u0442 \u043f\u0435\u0440\u0435\u0441\u0435\u043a\u0430\u0442\u044c \u043e\u0441\u0442\u0440\u043e\u0432\u0430 \u0431\u0435\u0437 \u0442\u0440\u0430\u043d\u0441\u043f\u043e\u0440\u0442\u043d\u043e\u0433\u043e \u043a\u043e\u0440\u0430\u0431\u043b\u044f.',
            travelNoBonusData: '\u0411\u043e\u043d\u0443\u0441\u044b \u0438\u0441\u0441\u043b\u0435\u0434\u043e\u0432\u0430\u043d\u0438\u0439/\u0437\u0434\u0430\u043d\u0438\u0439 \u0433\u043e\u0440\u043e\u0434\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b — \u043f\u043e\u043a\u0430\u0437\u0430\u043d\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0431\u0430\u0437\u043e\u0432\u0430\u044f \u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c.',
            travelUsedActiveCity: '\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u044b \u0431\u043e\u043d\u0443\u0441\u044b \u0432\u0430\u0448\u0435\u0433\u043e \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0433\u043e \u0433\u043e\u0440\u043e\u0434\u0430 (\u0442\u043e\u0447\u043a\u0430 \u043e\u0442\u0441\u0447\u0451\u0442\u0430 \u043d\u0435 \u044f\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u0432\u0430\u0448\u0438\u043c \u0433\u043e\u0440\u043e\u0434\u043e\u043c).',
            travelScopeNote: '\u041d\u0435 \u0432\u043a\u043b\u044e\u0447\u0430\u0435\u0442 \u0431\u043e\u043d\u0443\u0441 \u0411\u043e\u043b\u044c\u0448\u043e\u0433\u043e \u0445\u0440\u0430\u043c\u0430 \u0410\u0440\u0435\u0441\u0430 \u041e\u043b\u0438\u043c\u043f\u0430 \u0438\u043b\u0438 \u044d\u0444\u0444\u0435\u043a\u0442\u044b \u0433\u0435\u0440\u043e\u0435\u0432.',
            historyEmpty: 'История завоеваний для этого объекта не найдена.',
            historyNotLoaded: 'Загрузка истории завоеваний...',
            historyDisabled: 'Включите «историю завоеваний» в Настройках, чтобы использовать >history.',
            historyGhost: 'никто (призрак)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'основан игроком {to}',
            historyEventCount: '{n} зарегистрированных событий',
            historyPlayerSummary: 'завоёвано: {conquered} · потеряно: {lost}',
        },
        el: {
            searchPlaceholder: '\u0391\u03bd\u03b1\u03b6\u03ae\u03c4\u03b7\u03c3\u03b7 \u03c0\u03b1\u03b9\u03ba\u03c4\u03ce\u03bd, \u03c3\u03c5\u03bc\u03bc\u03b1\u03c7\u03b9\u03ce\u03bd \u03ae \u03c0\u03cc\u03bb\u03b5\u03c9\u03bd...',
            footerNavigate: '\u2191 \u2193 \u03b5\u03c0\u03b9\u03bb\u03bf\u03b3\u03ae',
            footerOpen: 'Enter \u03ac\u03bd\u03bf\u03b9\u03b3\u03bc\u03b1',
            shortcutsEscTwoStage: 'Κλείσιμο πίνακα / παλέτας (πατήστε δύο φορές αν είναι ανοιχτό ένα πλαίσιο λεπτομερειών)',
            emptyTitle: '\u0391\u03bd\u03b1\u03b6\u03ae\u03c4\u03b7\u03c3\u03b7 \u03c3\u03c4\u03bf Grepolis',
            emptySubtitle: '\u03a0\u03b1\u03af\u03ba\u03c4\u03b5\u03c2 \u00b7 \u03a3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b5\u03c2 \u00b7 \u03a0\u03cc\u03bb\u03b5\u03b9\u03c2',
            emptyHintCoords: '\u039c\u03c0\u03bf\u03c1\u03b5\u03af\u03c2 \u03b5\u03c0\u03af\u03c3\u03b7\u03c2 \u03bd\u03b1 \u03b5\u03b9\u03c3\u03b1\u03b3\u03ac\u03b3\u03b5\u03b9\u03c2 \u03c3\u03c5\u03bd\u03c4\u03b5\u03c4\u03b1\u03b3\u03bc\u03ad\u03bd\u03b5\u03c2: <strong>{example}</strong>',
            emptyHintCommands: 'Πληκτρολόγησε <strong>&gt;</strong> για εντολές (πόλεις-φαντάσματα, αποστάσεις...) ή <strong>?</strong> για όλες τις συντομεύσεις.',
            loadingWorldData: '\u03a6\u03cc\u03c1\u03c4\u03c9\u03c3\u03b7 \u03b4\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03c9\u03bd \u03ba\u03cc\u03c3\u03bc\u03bf\u03c5...',
            noResults: '\u0394\u03b5\u03bd \u03b2\u03c1\u03ad\u03b8\u03b7\u03ba\u03b1\u03bd \u03b1\u03c0\u03bf\u03c4\u03b5\u03bb\u03ad\u03c3\u03bc\u03b1\u03c4\u03b1.',
            resultsMore: '\u0395\u03bc\u03c6\u03ac\u03bd\u03b9\u03c3\u03b7 {shown} \u03b1\u03c0\u03cc {total} \u2014 \u03ba\u03c5\u03bb\u03af\u03c3\u03c4\u03b5 \u03b3\u03b9\u03b1 \u03c0\u03b5\u03c1\u03b9\u03c3\u03c3\u03cc\u03c4\u03b5\u03c1\u03b1',
            errorLoadingDataGeneric: 'Δεν ήταν δυνατή η φόρτωση των δεδομένων του κόσμου. Δοκίμασε ανανέωση.',
            errorLoadingDataTimeout: 'Η αίτηση καθυστέρησε πολύ. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.',
            errorLoadingDataWorldNotDetected: 'Δεν ήταν δυνατός ο εντοπισμός του τρέχοντος κόσμου.',
            badgePlayer: '\u03a0\u03b1\u03af\u03ba\u03c4\u03b7\u03c2',
            badgeAlliance: '\u03a3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b1',
            badgeTown: '\u03a0\u03cc\u03bb\u03b7',
            badgeCoordinate: '\u03a3\u03c5\u03bd\u03c4\u03b5\u03c4\u03b1\u03b3\u03bc\u03ad\u03bd\u03b5\u03c2',
            ptsSuffix: '\u03c0\u03cc\u03bd\u03c4\u03bf\u03b9',
            membersSuffix: '\u03bc\u03ad\u03bb\u03b7',
            segmentAll: '\u038c\u03bb\u03b1',
            segmentPlayers: '\u03a0\u03b1\u03af\u03ba\u03c4\u03b5\u03c2',
            segmentAlliances: '\u03a3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b5\u03c2',
            segmentTowns: '\u03a0\u03cc\u03bb\u03b5\u03b9\u03c2',
            segmentCoords: '\u03a3\u03c5\u03bd\u03c4\u03b5\u03c4\u03b1\u03b3\u03bc\u03ad\u03bd\u03b5\u03c2',
            townsSuffix: '\u03c0\u03cc\u03bb\u03b5\u03b9\u03c2',
            onIslandInfo: '{n} \u03c0\u03cc\u03bb\u03b5\u03b9\u03c2 \u03c3\u03b5 \u03b1\u03c5\u03c4\u03cc \u03c4\u03bf \u03bd\u03b7\u03c3\u03af',
            favoritesTitle: '\u0391\u03b3\u03b1\u03c0\u03b7\u03bc\u03ad\u03bd\u03b1',
            recentTitle: '\u03a0\u03c1\u03cc\u03c3\u03c6\u03b1\u03c4\u03b1',
            recentClearAll: 'Εκκαθάριση',
            recentRemove: 'Αφαίρεση από το ιστορικό',
            recentCleared: 'Το πρόσφατο ιστορικό εκκαθαρίστηκε',
            footerTab: 'Tab \u03c6\u03af\u03bb\u03c4\u03c1\u03bf',
            footerFav: 'Ctrl+F \u03b1\u03b3\u03b1\u03c0\u03b7\u03bc\u03ad\u03bd\u03bf',
            footerBBCode: 'Ctrl+B \u03b1\u03bd\u03c4\u03b9\u03b3\u03c1\u03b1\u03c6\u03ae BBCode',
            footerExport: '\u0395\u03be\u03b1\u03b3\u03c9\u03b3\u03ae \u03bb\u03af\u03c3\u03c4\u03b1\u03c2',
            exportEmpty: '\u0394\u03b5\u03bd \u03c5\u03c0\u03ac\u03c1\u03c7\u03b5\u03b9 \u03c4\u03af\u03c0\u03bf\u03c4\u03b1 \u03b3\u03b9\u03b1 \u03b5\u03be\u03b1\u03b3\u03c9\u03b3\u03ae \u03c3\u03c4\u03b7\u03bd \u03c4\u03c1\u03ad\u03c7\u03bf\u03c5\u03c3\u03b1 \u03bb\u03af\u03c3\u03c4\u03b1.',
            exportCopied: '\u0391\u03bd\u03c4\u03b9\u03b3\u03c1\u03ac\u03c6\u03b7\u03ba\u03b1\u03bd {n} \u03ba\u03b1\u03c4\u03b1\u03c7\u03c9\u03c1\u03ae\u03c3\u03b5\u03b9\u03c2 BBCode',
            bbcodeCopied: '\u0391\u03bd\u03c4\u03b9\u03b3\u03c1\u03ac\u03c6\u03b7\u03ba\u03b5',
            footerRefresh: 'Ctrl+R \u03b1\u03bd\u03ac\u03ba\u03c4\u03b7\u03c3\u03b7',
            footerHelp: '? \u03b2\u03bf\u03ae\u03b8\u03b5\u03b9\u03b1',
            menuItem: 'QuickFinder',
            dataFresh: '\u0394\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03b1 \u03b5\u03bd\u03b7\u03bc\u03b5\u03c1\u03c9\u03bc\u03ad\u03bd\u03b1',
            dataFreshMin: '\u0394\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03b1 {n} \u03bb\u03b5\u03c0\u03c4. \u03c0\u03c1\u03b9\u03bd',
            dataFreshHour: '\u0394\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03b1 {n} \u03c9\u03c1. \u03c0\u03c1\u03b9\u03bd',
            dataFreshDay: '\u0394\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03b1 {n} \u03b7\u03bc. \u03c0\u03c1\u03b9\u03bd',
            dataError: '\u03a3\u03c6\u03ac\u03bb\u03bc\u03b1 \u03b4\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03c9\u03bd',
            shortcutsTitle: '\u03a3\u03c5\u03bd\u03c4\u03bf\u03bc\u03b5\u03cd\u03c3\u03b5\u03b9\u03c2',
            shortcutsFirstLast: '\u03bc\u03b5\u03c4\u03ac\u03b2\u03b1\u03c3\u03b7 \u03c3\u03c4\u03bf \u03c0\u03c1\u03ce\u03c4\u03bf/\u03c4\u03b5\u03bb\u03b5\u03c5\u03c4\u03b1\u03af\u03bf \u03b1\u03c0\u03bf\u03c4\u03ad\u03bb\u03b5\u03c3\u03bc\u03b1',
            shortcutsRemoveRecent: 'αφαίρεση επιλεγμένου από το ιστορικό',
            shortcutsClearRecent: 'εκκαθάριση όλου του πρόσφατου ιστορικού',
            shortcutsHelp: '\u03b5\u03bc\u03c6\u03ac\u03bd\u03b9\u03c3\u03b7 \u03b1\u03c5\u03c4\u03ae\u03c2 \u03c4\u03b7\u03c2 \u03b2\u03bf\u03ae\u03b8\u03b5\u03b9\u03b1\u03c2',
            commandHelpTitle: '\u0395\u03bd\u03c4\u03bf\u03bb\u03ad\u03c2',
            commandGotoHelp: '>goto 123:456 \u2014 \u03bc\u03b5\u03c4\u03ac\u03b2\u03b1\u03c3\u03b7 \u03c3\u03b5 \u03bd\u03b7\u03c3\u03af',
            commandGhostHelp: '>ghost [minPts] \u2014 \u03bb\u03af\u03c3\u03c4\u03b1 \u03c0\u03cc\u03bb\u03b5\u03c9\u03bd-\u03c6\u03b1\u03bd\u03c4\u03b1\u03c3\u03bc\u03ac\u03c4\u03c9\u03bd',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 \u03b1\u03c0\u03cc\u03c3\u03c4\u03b1\u03c3\u03b7 \u03bd\u03b7\u03c3\u03b9\u03ce\u03bd',
            commandHelpHint: '>help \u2014 \u03b5\u03bc\u03c6\u03ac\u03bd\u03b9\u03c3\u03b7 \u03b1\u03c5\u03c4\u03ae\u03c2 \u03c4\u03b7\u03c2 \u03bb\u03af\u03c3\u03c4\u03b1\u03c2',
            commandUnknown: '\u0386\u03b3\u03bd\u03c9\u03c3\u03c4\u03b7 \u03b5\u03bd\u03c4\u03bf\u03bb\u03ae: {cmd}',
            premiumRequired: '\u0391\u03c0\u03b1\u03b9\u03c4\u03b5\u03af \u03b5\u03bd\u03b5\u03c1\u03b3\u03cc \u03c3\u03cd\u03bc\u03b2\u03bf\u03c5\u03bb\u03bf \u0394\u03b9\u03bf\u03b9\u03ba\u03b7\u03c4\u03ae (Premium).',
            ghostEmpty: '\u0394\u03b5\u03bd \u03b2\u03c1\u03ad\u03b8\u03b7\u03ba\u03b1\u03bd \u03c0\u03cc\u03bb\u03b5\u03b9\u03c2-\u03c6\u03b1\u03bd\u03c4\u03ac\u03c3\u03bc\u03b1\u03c4\u03b1.',
            distResult: '\u0391\u03c0\u03cc\u03c3\u03c4\u03b1\u03c3\u03b7 \u03bd\u03b7\u03c3\u03b9\u03ce\u03bd: {n}',
            distFromActive: '\u03b1\u03c0\u03cc \u03c4\u03b7\u03bd \u03b5\u03bd\u03b5\u03c1\u03b3\u03ae \u03c0\u03cc\u03bb\u03b7 \u03c3\u03bf\u03c5',
            distFromOrigin: '\u03b1\u03c0\u03cc \u03c4\u03bf \u03ba\u03b1\u03c1\u03c6\u03b9\u03c4\u03c9\u03bc\u03ad\u03bd\u03bf \u03c3\u03b7\u03bc\u03b5\u03af\u03bf \u03b5\u03ba\u03ba\u03af\u03bd\u03b7\u03c3\u03b7\u03c2',
            distNeedOrigin: '\u0394\u03ce\u03c3\u03b5 \u03b4\u03cd\u03bf \u03c3\u03c5\u03bd\u03c4\u03b5\u03c4\u03b1\u03b3\u03bc\u03ad\u03bd\u03b5\u03c2, \u03ae \u03bc\u03af\u03b1 \u03b1\u03bd \u03bc\u03c0\u03bf\u03c1\u03b5\u03af \u03bd\u03b1 \u03b1\u03bd\u03b9\u03c7\u03bd\u03b5\u03c5\u03b8\u03b5\u03af \u03b7 \u03b5\u03bd\u03b5\u03c1\u03b3\u03ae \u03c0\u03cc\u03bb\u03b7 \u03c3\u03bf\u03c5.',
            originSet: '\u03a4\u03bf \u03c3\u03b7\u03bc\u03b5\u03af\u03bf \u03b5\u03ba\u03ba\u03af\u03bd\u03b7\u03c3\u03b7\u03c2 \u03bf\u03c1\u03af\u03c3\u03c4\u03b7\u03ba\u03b5 \u03c3\u03b5 {x}:{y}',
            originSetTooltip: '\u039f\u03c1\u03b9\u03c3\u03bc\u03cc\u03c2 \u03c9\u03c2 \u03c3\u03b7\u03bc\u03b5\u03af\u03bf \u03b5\u03ba\u03ba\u03af\u03bd\u03b7\u03c3\u03b7\u03c2 \u03b1\u03c0\u03cc\u03c3\u03c4\u03b1\u03c3\u03b7\u03c2 (Ctrl+O)',
            originCleared: '\u03a4\u03bf \u03c3\u03b7\u03bc\u03b5\u03af\u03bf \u03b5\u03ba\u03ba\u03af\u03bd\u03b7\u03c3\u03b7\u03c2 \u03b4\u03b9\u03b1\u03b3\u03c1\u03ac\u03c6\u03b7\u03ba\u03b5',
            originIndicator: '\u03a3\u03b7\u03bc\u03b5\u03af\u03bf \u03b5\u03ba\u03ba\u03af\u03bd\u03b7\u03c3\u03b7\u03c2 {x}:{y}',
            originIndicatorTooltip: '\u039a\u03ac\u03bd\u03c4\u03b5 \u03ba\u03bb\u03b9\u03ba \u03b3\u03b9\u03b1 \u03b4\u03b9\u03b1\u03b3\u03c1\u03b1\u03c6\u03ae \u03c4\u03bf\u03c5 \u03ba\u03b1\u03c1\u03c6\u03b9\u03c4\u03c9\u03bc\u03ad\u03bd\u03bf\u03c5 \u03c3\u03b7\u03bc\u03b5\u03af\u03bf\u03c5',
            shortcutsSetOrigin: '\u039f\u03c1\u03b9\u03c3\u03bc\u03cc\u03c2 \u03c9\u03c2 \u03c3\u03b7\u03bc\u03b5\u03af\u03bf \u03b5\u03ba\u03ba\u03af\u03bd\u03b7\u03c3\u03b7\u03c2 \u03b1\u03c0\u03cc\u03c3\u03c4\u03b1\u03c3\u03b7\u03c2',
            favoriteNoteTooltip: '\u0395\u03c0\u03b5\u03be\u03b5\u03c1\u03b3\u03b1\u03c3\u03af\u03b1 \u03c3\u03b7\u03bc\u03b5\u03af\u03c9\u03c3\u03b7\u03c2 (Ctrl+N)',
            favoriteNoteTitle: '\u03a3\u03b7\u03bc\u03b5\u03af\u03c9\u03c3\u03b7 \u03b3\u03b9\u03b1 {name}',
            favoriteNoteLabel: '\u03a3\u03b7\u03bc\u03b5\u03af\u03c9\u03c3\u03b7',
            favoriteNoteSaved: '\u0397 \u03c3\u03b7\u03bc\u03b5\u03af\u03c9\u03c3\u03b7 \u03b1\u03c0\u03bf\u03b8\u03b7\u03ba\u03b5\u03cd\u03c4\u03b7\u03ba\u03b5',
            shortcutsEditNote: '\u0395\u03c0\u03b5\u03be\u03b5\u03c1\u03b3\u03b1\u03c3\u03af\u03b1 \u03c3\u03b7\u03bc\u03b5\u03af\u03c9\u03c3\u03b7\u03c2 \u03b5\u03c0\u03b9\u03bb\u03b5\u03b3\u03bc\u03ad\u03bd\u03bf\u03c5 \u03b1\u03b3\u03b1\u03c0\u03b7\u03bc\u03ad\u03bd\u03bf\u03c5',
            scopeHelpTitle: '\u03a0\u03b5\u03b4\u03af\u03b1',
            scopeHelpDesc: '@p \u03c0\u03b1\u03af\u03ba\u03c4\u03b5\u03c2 \u00b7 @a \u03c3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b5\u03c2 \u00b7 @t \u03c0\u03cc\u03bb\u03b5\u03b9\u03c2 \u00b7 @c \u03c3\u03c5\u03bd\u03c4\u03b5\u03c4\u03b1\u03b3\u03bc\u03ad\u03bd\u03b5\u03c2',
            commandIslandHelp: '>island X:Y \u2014 \u03cc\u03bb\u03b5\u03c2 \u03bf\u03b9 \u03c0\u03cc\u03bb\u03b5\u03b9\u03c2 \u03b5\u03bd\u03cc\u03c2 \u03bd\u03b7\u03c3\u03b9\u03bf\u03cd',
            commandNearHelp: '>near [X:Y] [\u03b1\u03ba\u03c4\u03af\u03bd\u03b1] \u2014 \u03bd\u03b7\u03c3\u03b9\u03ac \u03b3\u03cd\u03c1\u03c9 \u03b1\u03c0\u03cc \u03ad\u03bd\u03b1 \u03c3\u03b7\u03bc\u03b5\u03af\u03bf',
            commandOceanHelp: '>ocean M34 [\u03c3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b1] \u2014 \u03b5\u03c0\u03b9\u03c3\u03ba\u03cc\u03c0\u03b7\u03c3\u03b7 \u03c9\u03ba\u03b5\u03b1\u03bd\u03bf\u03cd',
            distBandSame: '\u03af\u03b4\u03b9\u03bf \u03bd\u03b7\u03c3\u03af',
            distBandAdjacent: '\u03b3\u03b5\u03b9\u03c4\u03bf\u03bd\u03b9\u03ba\u03ac \u03bd\u03b7\u03c3\u03b9\u03ac',
            distBandRegional: '\u03c0\u03b5\u03c1\u03b9\u03c6\u03b5\u03c1\u03b5\u03b9\u03b1\u03ba\u03cc',
            distBandFar: '\u03bc\u03b5\u03b3\u03ac\u03bb\u03b7 \u03b1\u03c0\u03cc\u03c3\u03c4\u03b1\u03c3\u03b7',
            badgeIsland: '\u039d\u03b7\u03c3\u03af',
            badgeCommand: '\u0395\u03bd\u03c4\u03bf\u03bb\u03ae',
            segmentIslands: '\u039d\u03b7\u03c3\u03b9\u03ac',
            ghostLabel: '\u03a6\u03ac\u03bd\u03c4\u03b1\u03c3\u03bc\u03b1',
            islandTowns: '{n} \u03c0\u03cc\u03bb\u03b5\u03b9\u03c2',
            islandAlliances: '{n} \u03c3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b5\u03c2',
            islandGhosts: '{n} \u03c6\u03b1\u03bd\u03c4\u03ac\u03c3\u03bc\u03b1\u03c4\u03b1',
            openIslandMap: '\u0386\u03bd\u03bf\u03b9\u03b3\u03bc\u03b1 \u03bd\u03b7\u03c3\u03b9\u03bf\u03cd \u03c3\u03c4\u03bf\u03bd \u03c7\u03ac\u03c1\u03c4\u03b7',
            nearSummary: '{islands} \u03bd\u03b7\u03c3\u03b9\u03ac \u00b7 {towns} \u03c0\u03cc\u03bb\u03b5\u03b9\u03c2 \u03b5\u03bd\u03c4\u03cc\u03c2 {n}',
            nearNeedOrigin: '\u0394\u03ce\u03c3\u03b5 \u03bc\u03b9\u03b1 \u03b1\u03ba\u03c4\u03af\u03bd\u03b1, \u03ae \u03c3\u03c5\u03bd\u03c4\u03b5\u03c4\u03b1\u03b3\u03bc\u03ad\u03bd\u03b5\u03c2 \u03ba\u03b1\u03b9 \u03b1\u03ba\u03c4\u03af\u03bd\u03b1. \u0397 \u03b5\u03bd\u03b5\u03c1\u03b3\u03ae \u03c0\u03cc\u03bb\u03b7 \u03c3\u03bf\u03c5 \u03c7\u03c1\u03b7\u03c3\u03b9\u03bc\u03bf\u03c0\u03bf\u03b9\u03b5\u03af\u03c4\u03b1\u03b9 \u03cc\u03c4\u03b1\u03bd \u03bc\u03c0\u03bf\u03c1\u03b5\u03af \u03bd\u03b1 \u03b1\u03bd\u03b9\u03c7\u03bd\u03b5\u03c5\u03b8\u03b5\u03af.',
            oceanEmpty: '\u0394\u03b5\u03bd \u03c5\u03c0\u03ac\u03c1\u03c7\u03b5\u03b9 \u03c4\u03af\u03c0\u03bf\u03c4\u03b1 \u03ba\u03b1\u03c4\u03b1\u03c7\u03c9\u03c1\u03b9\u03c3\u03bc\u03ad\u03bd\u03bf \u03c3\u03b5 \u03b1\u03c5\u03c4\u03cc\u03bd \u03c4\u03bf\u03bd \u03c9\u03ba\u03b5\u03b1\u03bd\u03cc.',
            oceanNeed: '\u03a7\u03c1\u03b7\u03c3\u03b9\u03bc\u03bf\u03c0\u03bf\u03af\u03b7\u03c3\u03b5 >ocean M34 \u03ae >ocean M34 \u038c\u03bd\u03bf\u03bc\u03b1\u03a3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b1\u03c2.',
            oceanSummary: '{players} \u03c0\u03b1\u03af\u03ba\u03c4\u03b5\u03c2 \u00b7 {alliances} \u03c3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b5\u03c2 \u00b7 {towns} \u03c0\u03cc\u03bb\u03b5\u03b9\u03c2 \u00b7 {ghosts} \u03c6\u03b1\u03bd\u03c4\u03ac\u03c3\u03bc\u03b1\u03c4\u03b1',
            playerTownsTitle: '\u03a0\u03cc\u03bb\u03b5\u03b9\u03c2',
            allianceSpreadTitle: '\u03a0\u03bf\u03cd \u03b2\u03c1\u03af\u03c3\u03ba\u03bf\u03bd\u03c4\u03b1\u03b9',
            allianceMembersTitle: '\u039c\u03ad\u03bb\u03b7',
            drillTowns: 'εμφάνιση πόλεων',
            sortPoints: 'κατά πόντους',
            sortDistance: 'κατά απόσταση',
            shortcutsOpen: 'Άνοιγμα/κλείσιμο QuickFinder',
            commandSettingsHelp: '>settings — άνοιγμα πίνακα ρυθμίσεων',
            settingsTitle: 'Ρυθμίσεις',
            settingsLanguage: 'Γλώσσα',
            settingsLanguageAuto: 'Αυτόματη (εντοπισμός από τον κόσμο)',
            settingsHotkey: 'Συντόμευση πληκτρολογίου',
            settingsPageSize: 'Αποτελέσματα ανά σελίδα',
            settingsMaxResults: 'Μέγ. αποτελέσματα εντολής',
            settingsCacheTtl: 'Προσωρινή μνήμη δεδομένων (ώρες)',
            settingsNearRadius: 'Μέγ. ακτίνα για >near',
            settingsGhostMin: 'Προεπιλεγμένοι ελάχ. πόντοι για >ghost',
            settingsSave: 'Αποθήκευση',
            settingsReset: 'Επαναφορά προεπιλογών',
            settingsSaved: 'Οι ρυθμίσεις αποθηκεύτηκαν',
            settingsResetDone: 'Οι ρυθμίσεις επαναφέρθηκαν',
            segmentSaved: 'Αποθηκευμένες',
            segmentFavorites: 'Αγαπημένα',
            segmentRecent: 'Πρόσφατα',
            savedSearchesTitle: 'Αποθηκευμένες αναζητήσεις',
            savedSearchesCleared: 'Οι αποθηκευμένες αναζητήσεις διαγράφηκαν',
            saveSearchTooltip: 'Ctrl+D αποθήκευση αναζήτησης',
            saveSearchPanelTitle: 'Αποθήκευση αναζήτησης',
            saveSearchEditTitle: 'Μετονομασία αποθηκευμένης αναζήτησης',
            saveSearchEditTooltip: 'Μετονομασία (Ctrl+E)',
            saveSearchNameLabel: 'Όνομα',
            saveSearchSave: 'Αποθήκευση',
            saveSearchCancel: 'Ακύρωση',
            saveSearchSaved: 'Η αναζήτηση αποθηκεύτηκε',
            saveSearchRenamed: 'Η αποθηκευμένη αναζήτηση μετονομάστηκε',
            saveSearchRemove: 'Αφαίρεση αποθηκευμένης αναζήτησης',
            badgeSavedSearch: 'Αποθηκευμένη',
            shortcutsSaveSearch: 'Αποθήκευση τρέχουσας αναζήτησης',
            shortcutsRenameSaved: 'Μετονομασία επιλεγμένης αποθηκευμένης αναζήτησης',
            hierarchyDrillTooltip: 'Προβολή λεπτομερειών (→)',
            shortcutsHierarchyNav: '← → είσοδος/έξοδος',
            updateAvailableToast: 'Διατίθεται νέα έκδοση ({version}).',
            updateAvailableTooltip: 'Διαθέσιμη νέα έκδοση {version} — κάντε κλικ για λήψη',
            settingsCheckUpdates: 'Έλεγχος για ενημερώσεις',
            updateUpToDate: 'Έχετε ήδη την πιο πρόσφατη έκδοση',
            settingsConquestHistory: 'Ενεργοποίηση ιστορικού κατακτήσεων',
            settingsConquestHistoryHint: 'Κατεβάζει ένα αρχείο πολλών MB (conquers.txt) για το >history',
            islandTownsWithCapacity: '{n}/{cap} πόλεις',
            recentlyConquered: 'κατακτήθηκε πριν από {n}μ',
            lastActivity: 'τελευταία δραστηριότητα πριν από {n}μ',
            commandHistoryHelp: '>history <όνομα|x:y> — ιστορικό κατακτήσεων μιας πόλης, παίκτη ή συντεταγμένης',
            commandTravelHelp: '>travel <\u03bc\u03bf\u03bd\u03ac\u03b4\u03b1,...> [X:Y] [X:Y] [sirens=N] — \u03c7\u03c1\u03cc\u03bd\u03bf\u03c2 \u03bc\u03b5\u03c4\u03b1\u03ba\u03af\u03bd\u03b7\u03c3\u03b7\u03c2 \u03c3\u03c4\u03c1\u03b1\u03c4\u03bf\u03cd',
            commandTopHelp: '>top players|alliances [N] — \u03ba\u03b1\u03c4\u03ac\u03c4\u03b1\u03be\u03b7 \u03b2\u03b1\u03b8\u03bc\u03bf\u03bb\u03bf\u03b3\u03af\u03b1\u03c2',
            commandVsHelp: '>vs <\u03c3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b11> vs <\u03c3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b12> — \u03c3\u03cd\u03b3\u03ba\u03c1\u03b9\u03c3\u03b7 \u03b4\u03cd\u03bf \u03c3\u03c5\u03bc\u03bc\u03b1\u03c7\u03b9\u03ce\u03bd',
            travelUnknownUnit: '\u0386\u03b3\u03bd\u03c9\u03c3\u03c4\u03b7 \u03bc\u03bf\u03bd\u03ac\u03b4\u03b1: {unit}',
            travelCalcFailed: '\u0394\u03b5\u03bd \u03ae\u03c4\u03b1\u03bd \u03b4\u03c5\u03bd\u03b1\u03c4\u03cc\u03c2 \u03bf \u03c5\u03c0\u03bf\u03bb\u03bf\u03b3\u03b9\u03c3\u03bc\u03cc\u03c2 \u03c4\u03bf\u03c5 \u03c7\u03c1\u03cc\u03bd\u03bf\u03c5 \u03bc\u03b5\u03c4\u03b1\u03ba\u03af\u03bd\u03b7\u03c3\u03b7\u03c2 (\u03bb\u03b5\u03af\u03c0\u03bf\u03c5\u03bd \u03b4\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03b1 \u03c0\u03b1\u03b9\u03c7\u03bd\u03b9\u03b4\u03b9\u03bf\u03cd \u03c3\u03b5 \u03c0\u03c1\u03b1\u03b3\u03bc\u03b1\u03c4\u03b9\u03ba\u03cc \u03c7\u03c1\u03cc\u03bd\u03bf).',
            travelLimitedBy: '\u03a0\u03b5\u03c1\u03b9\u03bf\u03c1\u03af\u03b6\u03b5\u03c4\u03b1\u03b9 \u03b1\u03c0\u03cc: {unit}',
            travelColonizeShipLimit: '\u0391\u03c5\u03c4\u03cc \u03be\u03b5\u03c0\u03b5\u03c1\u03bd\u03ac \u03c4\u03bf \u03ba\u03b1\u03bd\u03bf\u03bd\u03b9\u03ba\u03cc \u03cc\u03c1\u03b9\u03bf \u03c4\u03c9\u03bd 48\u03c9\u03c1\u03ce\u03bd \u03b3\u03b9\u03b1 \u03c4\u03bf \u03b1\u03c0\u03bf\u03b9\u03ba\u03b9\u03c3\u03c4\u03b9\u03ba\u03cc \u03c0\u03bb\u03bf\u03af\u03bf.',
            travelFlyingNote: '\u039f\u03b9 \u03b9\u03c0\u03c4\u03ac\u03bc\u03b5\u03bd\u03b5\u03c2 \u03bc\u03bf\u03bd\u03ac\u03b4\u03b5\u03c2 \u03bc\u03c0\u03bf\u03c1\u03bf\u03cd\u03bd \u03bd\u03b1 \u03b4\u03b9\u03b1\u03c3\u03c7\u03af\u03b6\u03bf\u03c5\u03bd \u03bd\u03b7\u03c3\u03b9\u03ac \u03c7\u03c9\u03c1\u03af\u03c2 \u03bc\u03b5\u03c4\u03b1\u03b3\u03c9\u03b3\u03b9\u03ba\u03cc \u03c0\u03bb\u03bf\u03af\u03bf.',
            travelNoBonusData: '\u0394\u03b5\u03bd \u03c5\u03c0\u03ac\u03c1\u03c7\u03bf\u03c5\u03bd \u03bc\u03c0\u03cc\u03bd\u03bf\u03c5\u03c2 \u03ad\u03c1\u03b5\u03c5\u03bd\u03b1\u03c2/\u03ba\u03c4\u03b9\u03c1\u03af\u03c9\u03bd \u03c0\u03cc\u03bb\u03b7\u03c2 — \u03b5\u03bc\u03c6\u03b1\u03bd\u03af\u03b6\u03b5\u03c4\u03b1\u03b9 \u03bc\u03cc\u03bd\u03bf \u03b7 \u03b2\u03b1\u03c3\u03b9\u03ba\u03ae \u03c4\u03b1\u03c7\u03cd\u03c4\u03b7\u03c4\u03b1.',
            travelUsedActiveCity: '\u03a7\u03c1\u03b7\u03c3\u03b9\u03bc\u03bf\u03c0\u03bf\u03b9\u03ae\u03b8\u03b7\u03ba\u03b1\u03bd \u03bf\u03b9 \u03bc\u03c0\u03cc\u03bd\u03bf\u03b9 \u03c4\u03b7\u03c2 \u03b5\u03bd\u03b5\u03c1\u03b3\u03ae\u03c2 \u03c0\u03cc\u03bb\u03b7\u03c2 \u03c3\u03b1\u03c2 (\u03b7 \u03b1\u03c6\u03b5\u03c4\u03b7\u03c1\u03af\u03b1 \u03b4\u03b5\u03bd \u03b5\u03af\u03bd\u03b1\u03b9 \u03bc\u03af\u03b1 \u03b1\u03c0\u03cc \u03c4\u03b9\u03c2 \u03c0\u03cc\u03bb\u03b5\u03b9\u03c2 \u03c3\u03b1\u03c2).',
            travelScopeNote: '\u0394\u03b5\u03bd \u03c0\u03b5\u03c1\u03b9\u03bb\u03b1\u03bc\u03b2\u03ac\u03bd\u03b5\u03b9 \u03c4\u03bf \u03bc\u03c0\u03cc\u03bd\u03bf\u03c5\u03c2 \u03c4\u03bf\u03c5 \u039c\u03b5\u03b3\u03ac\u03bb\u03bf\u03c5 \u039d\u03b1\u03bf\u03cd \u03c4\u03bf\u03c5 \u0386\u03c1\u03b7 \u03c4\u03bf\u03c5 \u039f\u03bb\u03cd\u03bc\u03c0\u03bf\u03c5 \u03ae \u03b5\u03c0\u03b9\u03b4\u03c1\u03ac\u03c3\u03b5\u03b9\u03c2 \u03ae\u03c1\u03ce\u03c9\u03bd.',
            historyEmpty: 'Δεν υπάρχει καταγεγραμμένο ιστορικό κατακτήσεων για αυτό.',
            historyNotLoaded: 'Φόρτωση ιστορικού κατακτήσεων...',
            historyDisabled: 'Ενεργοποιήστε το «ιστορικό κατακτήσεων» στις Ρυθμίσεις για να χρησιμοποιήσετε το >history.',
            historyGhost: 'κανείς (φάντασμα)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'αποικίστηκε από {to}',
            historyEventCount: '{n} καταγεγραμμένα γεγονότα',
            historyPlayerSummary: '{conquered} κατακτήθηκαν · {lost} χάθηκαν',
        },
        hu: {
            searchPlaceholder: 'J\u00e1t\u00e9kosok, sz\u00f6vets\u00e9gek vagy v\u00e1rosok keres\u00e9se...',
            footerNavigate: '\u2191 \u2193 kiv\u00e1laszt\u00e1s',
            footerOpen: 'Enter megnyit\u00e1s',
            shortcutsEscTwoStage: 'Panel / paletta bezárása (kattints kétszer, ha egy részletnézet nyitva van)',
            emptyTitle: 'Keres\u00e9s a Grepolisban',
            emptySubtitle: 'J\u00e1t\u00e9kosok \u00b7 Sz\u00f6vets\u00e9gek \u00b7 V\u00e1rosok',
            emptyHintCoords: 'Koordin\u00e1t\u00e1kat is megadhatsz: <strong>{example}</strong>',
            emptyHintCommands: 'Írj <strong>&gt;</strong> jelet a parancsokhoz (szellemvárosok, távolságok...), vagy <strong>?</strong>-et az összes gyorsbillentyűhöz.',
            loadingWorldData: 'Vil\u00e1gadatok bet\u00f6lt\u00e9se...',
            noResults: 'Nincs tal\u00e1lat.',
            resultsMore: '{shown}/{total} tal\u00e1lat megjelen\u0151\u2014 g\u00f6rgessen tov\u00e1bbiak\u00e9rt',
            errorLoadingDataGeneric: 'Nem sikerült betölteni a világ adatait. Próbáld meg frissíteni.',
            errorLoadingDataTimeout: 'A kérés túl sok ideig tartott. Ellenőrizd a kapcsolatot, majd próbáld újra.',
            errorLoadingDataWorldNotDetected: 'Nem sikerült felismerni az aktuális világot.',
            badgePlayer: 'J\u00e1t\u00e9kos',
            badgeAlliance: 'Sz\u00f6vets\u00e9g',
            badgeTown: 'V\u00e1ros',
            badgeCoordinate: 'Koordin\u00e1t\u00e1k',
            ptsSuffix: 'pont',
            membersSuffix: 'tag',
            segmentAll: '\u00d6sszes',
            segmentPlayers: 'J\u00e1t\u00e9kosok',
            segmentAlliances: 'Sz\u00f6vets\u00e9gek',
            segmentTowns: 'V\u00e1rosok',
            segmentCoords: 'Koordin\u00e1t\u00e1k',
            townsSuffix: 'v\u00e1ros',
            onIslandInfo: '{n} v\u00e1ros ezen a szigeten',
            favoritesTitle: 'Kedvencek',
            recentTitle: 'Legut\u00f3bbi',
            recentClearAll: 'Törlés',
            recentRemove: 'Eltávolítás az előzményekből',
            recentCleared: 'Előzmények törölve',
            footerTab: 'Tab sz\u0171r\u00e9s',
            footerFav: 'Ctrl+F kedvenc',
            footerBBCode: 'Ctrl+B BBCode m\u00e1sol\u00e1sa',
            footerExport: 'Lista export\u00e1l\u00e1sa',
            exportEmpty: 'Nincs mit export\u00e1lni az aktu\u00e1lis list\u00e1ban.',
            exportCopied: '{n} BBCode bejegyz\u00e9s m\u00e1solva',
            bbcodeCopied: 'M\u00e1solva',
            footerRefresh: 'Ctrl+R friss\u00edt\u00e9s',
            footerHelp: '? s\u00fag\u00f3',
            menuItem: 'QuickFinder',
            dataFresh: 'Adatok frissek',
            dataFreshMin: 'Adatok {n} perce',
            dataFreshHour: 'Adatok {n} \u00f3r\u00e1ja',
            dataFreshDay: 'Adatok {n} napja',
            dataError: 'Adathiba',
            shortcutsTitle: 'Gyorsbillenty\u0171k',
            shortcutsFirstLast: 'ugr\u00e1s az els\u0151/utols\u00f3 tal\u00e1lathoz',
            shortcutsRemoveRecent: 'kijelölt eltávolítása az előzményekből',
            shortcutsClearRecent: 'teljes előzménylista törlése',
            shortcutsHelp: 's\u00fag\u00f3 megjelen\u00edt\u00e9se',
            commandHelpTitle: 'Parancsok',
            commandGotoHelp: '>goto 123:456 \u2014 ugr\u00e1s egy szigetre',
            commandGhostHelp: '>ghost [minPts] \u2014 szellemv\u00e1rosok list\u00e1ja',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 szigett\u00e1vols\u00e1g',
            commandHelpHint: '>help \u2014 lista megjelen\u00edt\u00e9se',
            commandUnknown: 'Ismeretlen parancs: {cmd}',
            premiumRequired: 'Az Adminisztrátor tanácsadó (Premium) aktív állapotát igényli.',
            ghostEmpty: 'Nincs szellemv\u00e1ros.',
            distResult: 'Szigett\u00e1vols\u00e1g: {n}',
            distFromActive: 'az akt\u00edv v\u00e1rosodb\u00f3l',
            distFromOrigin: 'a kit\u0171z\u00f6tt kiindul\u00f3pontb\u00f3l',
            distNeedOrigin: 'Adj meg k\u00e9t koordin\u00e1t\u00e1t, vagy egyet, ha az akt\u00edv v\u00e1rosod felismerhet\u0151.',
            originSet: 'Kiindul\u00f3pont be\u00e1ll\u00edtva: {x}:{y}',
            originSetTooltip: 'Be\u00e1ll\u00edt\u00e1s t\u00e1vols\u00e1g-kiindul\u00f3pontk\u00e9nt (Ctrl+O)',
            originCleared: 'Kiindul\u00f3pont t\u00f6r\u00f6lve',
            originIndicator: 'Kiindul\u00f3pont {x}:{y}',
            originIndicatorTooltip: 'Kattints a kit\u0171z\u00f6tt kiindul\u00f3pont t\u00f6rl\u00e9s\u00e9hez',
            shortcutsSetOrigin: 'Be\u00e1ll\u00edt\u00e1s t\u00e1vols\u00e1g-kiindul\u00f3pontk\u00e9nt',
            favoriteNoteTooltip: 'Jegyzet szerkeszt\u00e9se (Ctrl+N)',
            favoriteNoteTitle: 'Jegyzet ehhez: {name}',
            favoriteNoteLabel: 'Jegyzet',
            favoriteNoteSaved: 'Jegyzet mentve',
            shortcutsEditNote: 'A kiv\u00e1lasztott kedvenc jegyzet\u00e9nek szerkeszt\u00e9se',
            scopeHelpTitle: 'Tartom\u00e1nyok',
            scopeHelpDesc: '@p j\u00e1t\u00e9kosok \u00b7 @a sz\u00f6vets\u00e9gek \u00b7 @t v\u00e1rosok \u00b7 @c koordin\u00e1t\u00e1k',
            commandIslandHelp: '>island X:Y \u2014 egy sziget \u00f6sszes v\u00e1rosa',
            commandNearHelp: '>near [X:Y] [sug\u00e1r] \u2014 szigetek egy pont k\u00f6r\u00fcl',
            commandOceanHelp: '>ocean M34 [sz\u00f6vets\u00e9g] \u2014 \u00f3ce\u00e1n \u00e1ttekint\u00e9s',
            distBandSame: 'ugyanaz a sziget',
            distBandAdjacent: 'szomsz\u00e9dos szigetek',
            distBandRegional: 'region\u00e1lis',
            distBandFar: 'nagy t\u00e1vols\u00e1g',
            badgeIsland: 'Sziget',
            badgeCommand: 'Parancs',
            segmentIslands: 'Szigetek',
            ghostLabel: 'Szellem',
            islandTowns: '{n} v\u00e1ros',
            islandAlliances: '{n} sz\u00f6vets\u00e9g',
            islandGhosts: '{n} szellemv\u00e1ros',
            openIslandMap: 'Sziget megnyit\u00e1sa a t\u00e9rk\u00e9pen',
            nearSummary: '{islands} sziget \u00b7 {towns} v\u00e1ros {n} sug\u00e1ron bel\u00fcl',
            nearNeedOrigin: 'Adj meg egy sug\u00e1rt, vagy koordin\u00e1t\u00e1kat plusz sug\u00e1rt. Ha felismerhet\u0151, az akt\u00edv v\u00e1rosod ker\u00fcl felhaszn\u00e1l\u00e1sra.',
            oceanEmpty: 'Ebben az \u00f3ce\u00e1nban semmi sincs indexelve.',
            oceanNeed: 'Haszn\u00e1ld: >ocean M34 vagy >ocean M34 Sz\u00f6vets\u00e9gN\u00e9v.',
            oceanSummary: '{players} j\u00e1t\u00e9kos \u00b7 {alliances} sz\u00f6vets\u00e9g \u00b7 {towns} v\u00e1ros \u00b7 {ghosts} szellemv\u00e1ros',
            playerTownsTitle: 'V\u00e1rosok',
            allianceSpreadTitle: 'Hol tal\u00e1lhat\u00f3k',
            allianceMembersTitle: 'Tagok',
            drillTowns: 'városok megjelenítése',
            sortPoints: 'pont szerint',
            sortDistance: 'távolság szerint',
            shortcutsOpen: 'QuickFinder megnyitása/bezárása',
            commandSettingsHelp: '>settings — beállítások panel megnyitása',
            settingsTitle: 'Beállítások',
            settingsLanguage: 'Nyelv',
            settingsLanguageAuto: 'Automatikus (a világ alapján)',
            settingsHotkey: 'Billentyűparancs',
            settingsPageSize: 'Találatok oldalanként',
            settingsMaxResults: 'Max. parancs-találat',
            settingsCacheTtl: 'Adat gyorsítótár (óra)',
            settingsNearRadius: 'Max. sugár a >near-hez',
            settingsGhostMin: 'Alapértelmezett min. pont a >ghost-hoz',
            settingsSave: 'Mentés',
            settingsReset: 'Alapértelmezés visszaállítása',
            settingsSaved: 'Beállítások mentve',
            settingsResetDone: 'Beállítások visszaállítva',
            segmentSaved: 'Mentett',
            segmentFavorites: 'Kedvencek',
            segmentRecent: 'Legutóbbi',
            savedSearchesTitle: 'Mentett keresések',
            savedSearchesCleared: 'Mentett keresések törölve',
            saveSearchTooltip: 'Ctrl+D keresés mentése',
            saveSearchPanelTitle: 'Keresés mentése',
            saveSearchEditTitle: 'Mentett keresés átnevezése',
            saveSearchEditTooltip: 'Átnevezés (Ctrl+E)',
            saveSearchNameLabel: 'Név',
            saveSearchSave: 'Mentés',
            saveSearchCancel: 'Mégse',
            saveSearchSaved: 'Keresés mentve',
            saveSearchRenamed: 'Mentett keresés átnevezve',
            saveSearchRemove: 'Mentett keresés eltávolítása',
            badgeSavedSearch: 'Mentett',
            shortcutsSaveSearch: 'Jelenlegi keresés mentése',
            shortcutsRenameSaved: 'Kijelölt mentett keresés átnevezése',
            hierarchyDrillTooltip: 'Részletek megtekintése (→)',
            shortcutsHierarchyNav: '← → be/ki',
            updateAvailableToast: 'Elérhető egy új verzió ({version}).',
            updateAvailableTooltip: 'Új verzió elérhető: {version} — kattints a letöltéshez',
            settingsCheckUpdates: 'Frissítések keresése',
            updateUpToDate: 'Már a legújabb verziót használod',
            settingsConquestHistory: 'Hódítási előzmények engedélyezése',
            settingsConquestHistoryHint: 'Letölt egy több MB-os fájlt (conquers.txt) a >history parancshoz',
            islandTownsWithCapacity: '{n}/{cap} város',
            recentlyConquered: '{n} napja meghódítva',
            lastActivity: 'utolsó aktivitás {n} napja',
            commandHistoryHelp: '>history <név|x:y> — egy város, játékos vagy koordináta hódítási előzményei',
            commandTravelHelp: '>travel <egys\u00e9g,...> [X:Y] [X:Y] [sirens=N] — csapatmozg\u00e1s ideje',
            commandTopHelp: '>top players|alliances [N] — pontrangsor',
            commandVsHelp: '>vs <sz\u00f6vets\u00e9g1> vs <sz\u00f6vets\u00e9g2> — k\u00e9t sz\u00f6vets\u00e9g \u00f6sszehasonl\u00edt\u00e1sa',
            travelUnknownUnit: 'Ismeretlen egys\u00e9g: {unit}',
            travelCalcFailed: 'Nem siker\u00fclt kisz\u00e1m\u00edtani az utaz\u00e1si id\u0151t (hi\u00e1nyz\u00f3 \u00e9l\u0151 j\u00e1t\u00e9kadatok).',
            travelLimitedBy: 'Korl\u00e1tozza: {unit}',
            travelColonizeShipLimit: 'Ez meghaladja a koloniz\u00e1l\u00f3haj\u00f3 szok\u00e1sos 48 \u00f3r\u00e1s korl\u00e1tj\u00e1t.',
            travelFlyingNote: 'A rep\u00fcl\u0151 egys\u00e9gek sziget\u00e1thaj\u00f3z\u00e1shoz sz\u00e1ll\u00edt\u00f3haj\u00f3 n\u00e9lk\u00fcl is \u00e1tkelhetnek.',
            travelNoBonusData: 'A v\u00e1ros kutat\u00e1si/\u00e9p\u00fclet-bonuszai nem el\u00e9rhet\u0151k — csak az alapsebess\u00e9g l\u00e1that\u00f3.',
            travelUsedActiveCity: 'Az akt\u00edv v\u00e1rosod bonuszait haszn\u00e1ltuk (a kiindul\u00f3pont nem az egyik v\u00e1rosod).',
            travelScopeNote: 'Nem tartalmazza az Olimposzi Nagy Ar\u00e9sz-templom bonuszt vagy a h\u0151s hat\u00e1sait.',
            historyEmpty: 'Nincs rögzített hódítási előzmény ehhez.',
            historyNotLoaded: 'Hódítási előzmények betöltése...',
            historyDisabled: 'Engedélyezd a "hódítási előzmények" opciót a Beállításokban a >history használatához.',
            historyGhost: 'senki (szellem)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: '{to} alapította',
            historyEventCount: '{n} rögzített esemény',
            historyPlayerSummary: '{conquered} meghódítva · {lost} elveszítve',
        },
        ro: {
            searchPlaceholder: 'Caut\u0103 juc\u0103tori, alian\u021be sau ora\u0219e...',
            footerNavigate: '\u2191 \u2193 selecteaz\u0103',
            footerOpen: 'Enter deschide',
            shortcutsEscTwoStage: 'Închide panoul / paleta (apasă de două ori dacă un panou de detalii este deschis)',
            emptyTitle: 'Caut\u0103 \u00een Grepolis',
            emptySubtitle: 'Juc\u0103tori \u00b7 Alian\u021be \u00b7 Ora\u0219e',
            emptyHintCoords: 'Po\u021bi introduce \u0219i coordonate: <strong>{example}</strong>',
            emptyHintCommands: 'Tastează <strong>&gt;</strong> pentru comenzi (orașe fantomă, distanțe...) sau <strong>?</strong> pentru toate scurtăturile.',
            loadingWorldData: 'Se \u00eencarc\u0103 datele lumii...',
            noResults: 'Niciun rezultat g\u0103sit.',
            resultsMore: 'Se afi\u0219eaz\u0103 {shown} din {total} \u2014 derula\u021bi pentru mai multe',
            errorLoadingDataGeneric: 'Nu s-au putut încărca datele lumii. Încearcă să reîmprosătești.',
            errorLoadingDataTimeout: 'Cererea a durat prea mult. Verifică-ți conexiunea și încearcă din nou.',
            errorLoadingDataWorldNotDetected: 'Nu s-a putut detecta lumea curentă.',
            badgePlayer: 'Juc\u0103tor',
            badgeAlliance: 'Alian\u021b\u0103',
            badgeTown: 'Ora\u0219',
            badgeCoordinate: 'Coordonate',
            ptsSuffix: 'puncte',
            membersSuffix: 'membri',
            segmentAll: 'Toate',
            segmentPlayers: 'Juc\u0103tori',
            segmentAlliances: 'Alian\u021be',
            segmentTowns: 'Ora\u0219e',
            segmentCoords: 'Coordonate',
            townsSuffix: 'ora\u0219e',
            onIslandInfo: '{n} ora\u0219e pe aceast\u0103 insul\u0103',
            favoritesTitle: 'Favorite',
            recentTitle: 'Recente',
            recentClearAll: 'Golește',
            recentRemove: 'Elimină din istoric',
            recentCleared: 'Istoricul recent a fost golit',
            footerTab: 'Tab filtreaz\u0103',
            footerFav: 'Ctrl+F favorit',
            footerBBCode: 'Ctrl+B copiaz\u0103 BBCode',
            footerExport: 'Exporta lista',
            exportEmpty: 'Nimic de exportat \u00een lista curent\u0103.',
            exportCopied: '{n} intr\u0103ri BBCode copiate',
            bbcodeCopied: 'Copiat',
            footerRefresh: 'Ctrl+R re\u00eencarc\u0103',
            footerHelp: '? ajutor',
            menuItem: 'QuickFinder',
            dataFresh: 'Date actuale',
            dataFreshMin: 'Date vechi de {n} min',
            dataFreshHour: 'Date vechi de {n} h',
            dataFreshDay: 'Date vechi de {n} z',
            dataError: 'Eroare de date',
            shortcutsTitle: 'Scurt\u0103turi',
            shortcutsFirstLast: 'mergi la primul/ultimul rezultat',
            shortcutsRemoveRecent: 'elimină selecția din istoric',
            shortcutsClearRecent: 'golește tot istoricul recent',
            shortcutsHelp: 'afi\u0219eaz\u0103 acest ajutor',
            commandHelpTitle: 'Comenzi',
            commandGotoHelp: '>goto 123:456 \u2014 mergi la o insul\u0103',
            commandGhostHelp: '>ghost [minPts] \u2014 listeaz\u0103 ora\u0219ele fantom\u0103',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 distan\u021b\u0103 de insule',
            commandHelpHint: '>help \u2014 arat\u0103 aceast\u0103 list\u0103',
            commandUnknown: 'Comand\u0103 necunoscut\u0103: {cmd}',
            premiumRequired: 'Necesit\u0103 consilierul Administrator (Premium) activ.',
            ghostEmpty: 'Nu s-au g\u0103sit ora\u0219e fantom\u0103.',
            distResult: 'Distan\u021b\u0103 de insule: {n}',
            distFromActive: 'din ora\u0219ul t\u0103u activ',
            distFromOrigin: 'din originea fixat\u0103',
            distNeedOrigin: 'D\u0103 dou\u0103 coordonate, sau una dac\u0103 ora\u0219ul t\u0103u activ poate fi detectat.',
            originSet: 'Origine setat\u0103 la {x}:{y}',
            originSetTooltip: 'Seteaz\u0103 ca origine de distan\u021b\u0103 (Ctrl+O)',
            originCleared: 'Origine \u0219tears\u0103',
            originIndicator: 'Origine {x}:{y}',
            originIndicatorTooltip: 'Apas\u0103 pentru a \u0219terge originea fixat\u0103',
            shortcutsSetOrigin: 'Seteaz\u0103 ca origine de distan\u021b\u0103',
            favoriteNoteTooltip: 'Editeaz\u0103 nota (Ctrl+N)',
            favoriteNoteTitle: 'Not\u0103 pentru {name}',
            favoriteNoteLabel: 'Not\u0103',
            favoriteNoteSaved: 'Not\u0103 salvat\u0103',
            shortcutsEditNote: 'Editeaz\u0103 nota favoritului selectat',
            scopeHelpTitle: 'Domenii',
            scopeHelpDesc: '@p juc\u0103tori \u00b7 @a alian\u021be \u00b7 @t ora\u0219e \u00b7 @c coordonate',
            commandIslandHelp: '>island X:Y \u2014 toate ora\u0219ele de pe o insul\u0103',
            commandNearHelp: '>near [X:Y] [raz\u0103] \u2014 insule \u00een jurul unui punct',
            commandOceanHelp: '>ocean M34 [alian\u021b\u0103] \u2014 rezumat al oceanului',
            distBandSame: 'aceea\u0219i insul\u0103',
            distBandAdjacent: 'insule adiacente',
            distBandRegional: 'regional',
            distBandFar: 'distan\u021b\u0103 mare',
            badgeIsland: 'Insul\u0103',
            badgeCommand: 'Comand\u0103',
            segmentIslands: 'Insule',
            ghostLabel: 'Fantom\u0103',
            islandTowns: '{n} ora\u0219e',
            islandAlliances: '{n} alian\u021be',
            islandGhosts: '{n} fantome',
            openIslandMap: 'Deschide insula pe hart\u0103',
            nearSummary: '{islands} insule \u00b7 {towns} ora\u0219e \u00een raza de {n}',
            nearNeedOrigin: 'D\u0103 o raz\u0103, sau coordonate plus o raz\u0103. Ora\u0219ul t\u0103u activ este folosit dac\u0103 poate fi detectat.',
            oceanEmpty: 'Nimic indexat \u00een acel ocean.',
            oceanNeed: 'Folose\u0219te >ocean M34 sau >ocean M34 NumeAlian\u021b\u0103.',
            oceanSummary: '{players} juc\u0103tori \u00b7 {alliances} alian\u021be \u00b7 {towns} ora\u0219e \u00b7 {ghosts} fantome',
            playerTownsTitle: 'Ora\u0219e',
            allianceSpreadTitle: 'Unde se afl\u0103',
            allianceMembersTitle: 'Membri',
            drillTowns: 'arată orașele',
            sortPoints: 'după puncte',
            sortDistance: 'după distanță',
            shortcutsOpen: 'Deschide/închide QuickFinder',
            commandSettingsHelp: '>settings — deschide panoul de setări',
            settingsTitle: 'Setări',
            settingsLanguage: 'Limbă',
            settingsLanguageAuto: 'Automat (detectată din lume)',
            settingsHotkey: 'Comandă rapidă',
            settingsPageSize: 'Rezultate pe pagină',
            settingsMaxResults: 'Max. rezultate comandă',
            settingsCacheTtl: 'Cache date (ore)',
            settingsNearRadius: 'Rază max. pentru >near',
            settingsGhostMin: 'Puncte min. implicite pentru >ghost',
            settingsSave: 'Salvează',
            settingsReset: 'Resetează la valori implicite',
            settingsSaved: 'Setări salvate',
            settingsResetDone: 'Setări resetate',
            segmentSaved: 'Salvate',
            segmentFavorites: 'Favorite',
            segmentRecent: 'Recente',
            savedSearchesTitle: 'Căutări salvate',
            savedSearchesCleared: 'Căutările salvate au fost șterse',
            saveSearchTooltip: 'Ctrl+D salvează căutarea',
            saveSearchPanelTitle: 'Salvează căutarea',
            saveSearchEditTitle: 'Redenumește căutarea salvată',
            saveSearchEditTooltip: 'Redenumește (Ctrl+E)',
            saveSearchNameLabel: 'Nume',
            saveSearchSave: 'Salvează',
            saveSearchCancel: 'Anulează',
            saveSearchSaved: 'Căutare salvată',
            saveSearchRenamed: 'Căutarea salvată a fost redenumită',
            saveSearchRemove: 'Elimină căutarea salvată',
            badgeSavedSearch: 'Salvată',
            shortcutsSaveSearch: 'Salvează căutarea curentă',
            shortcutsRenameSaved: 'Redenumește căutarea salvată selectată',
            hierarchyDrillTooltip: 'Vezi detalii (→)',
            shortcutsHierarchyNav: '← → intră/ieși',
            updateAvailableToast: 'Este disponibilă o versiune nouă ({version}).',
            updateAvailableTooltip: 'Versiune nouă {version} disponibilă — clic pentru descărcare',
            settingsCheckUpdates: 'Caută actualizări',
            updateUpToDate: 'Ai deja cea mai recentă versiune',
            settingsConquestHistory: 'Activează istoricul cuceririlor',
            settingsConquestHistoryHint: 'Descarcă un fișier de câțiva MB (conquers.txt) pentru >history',
            islandTownsWithCapacity: '{n}/{cap} orașe',
            recentlyConquered: 'cucerit acum {n}z',
            lastActivity: 'ultima activitate acum {n}z',
            commandHistoryHelp: '>history <nume|x:y> — istoricul cuceririlor unui oraș, jucător sau coordonate',
            commandTravelHelp: '>travel <unitate,...> [X:Y] [X:Y] [sirens=N] — timp de deplasare al trupelor',
            commandTopHelp: '>top players|alliances [N] — clasament dup\u0103 puncte',
            commandVsHelp: '>vs <alian\u021b\u01031> vs <alian\u021b\u01032> — compar\u0103 dou\u0103 alian\u021be',
            travelUnknownUnit: 'Unitate necunoscut\u0103: {unit}',
            travelCalcFailed: 'Timpul de deplasare nu a putut fi calculat (lipsesc date live din joc).',
            travelLimitedBy: 'Limitat de: {unit}',
            travelColonizeShipLimit: 'Acest lucru dep\u0103\u0219e\u0219te limita normal\u0103 de 48h a navei de colonizare.',
            travelFlyingNote: 'Unit\u0103\u021bile zbur\u0103toare pot traversa insulele f\u0103r\u0103 nav\u0103 de transport.',
            travelNoBonusData: 'Bonusurile de cercetare/cl\u0103diri ale ora\u0219ului nu sunt disponibile — se afi\u0219eaz\u0103 doar viteza de baz\u0103.',
            travelUsedActiveCity: 'Au fost folosite bonusurile ora\u0219ului t\u0103u activ (originea nu este unul dintre ora\u0219ele tale).',
            travelScopeNote: 'Nu include bonusul Marelui Templu al lui Ares din Olimp sau efectele eroilor.',
            historyEmpty: 'Nu există istoric de cuceriri înregistrat pentru aceasta.',
            historyNotLoaded: 'Se încarcă istoricul cuceririlor...',
            historyDisabled: 'Activează „istoricul cuceririlor” din Setări pentru a folosi >history.',
            historyGhost: 'nimeni (fantomă)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'colonizat de {to}',
            historyEventCount: '{n} evenimente înregistrate',
            historyPlayerSummary: '{conquered} cucerite · {lost} pierdute',
        },
        cs: {
            searchPlaceholder: 'Hledat hr\u00e1\u010de, aliance nebo m\u011bsta...',
            footerNavigate: '\u2191 \u2193 vybrat',
            footerOpen: 'Enter otev\u0159\u00edt',
            shortcutsEscTwoStage: 'Zavřít panel / paletu (stiskněte dvakrát, pokud je otevřený panel podrobností)',
            emptyTitle: 'Hledat v Grepolis',
            emptySubtitle: 'Hr\u00e1\u010di \u00b7 Aliance \u00b7 M\u011bsta',
            emptyHintCoords: 'M\u016f\u017ee\u0161 tak\u00e9 zadat sou\u0159adnice: <strong>{example}</strong>',
            emptyHintCommands: 'Napiš <strong>&gt;</strong> pro příkazy (opuštěná města, vzdálenosti...) nebo <strong>?</strong> pro všechny zkratky.',
            loadingWorldData: 'Na\u010d\u00edt\u00e1n\u00ed dat sv\u011bta...',
            noResults: 'Nebyly nalezeny \u017e\u00e1dn\u00e9 v\u00fdsledky.',
            resultsMore: 'Zobrazeno {shown} z {total} \u2014 posunut\u00edm zobraz\u00edte dal\u0161\u00ed',
            errorLoadingDataGeneric: 'Data světa se nepodařilo načíst. Zkuste obnovit stránku.',
            errorLoadingDataTimeout: 'Požadavek trval příliš dlouho. Zkontrolujte připojení a zkuste to znovu.',
            errorLoadingDataWorldNotDetected: 'Nepodařilo se rozpoznat aktuální svět.',
            badgePlayer: 'Hr\u00e1\u010d',
            badgeAlliance: 'Aliance',
            badgeTown: 'M\u011bsto',
            badgeCoordinate: 'Sou\u0159adnice',
            ptsSuffix: 'bod\u016f',
            membersSuffix: '\u010dlen\u016f',
            segmentAll: 'V\u0161e',
            segmentPlayers: 'Hr\u00e1\u010di',
            segmentAlliances: 'Aliance',
            segmentTowns: 'M\u011bsta',
            segmentCoords: 'Sou\u0159adnice',
            townsSuffix: 'm\u011bst',
            onIslandInfo: '{n} m\u011bst na tomto ostrov\u011b',
            favoritesTitle: 'Obl\u00edben\u00e9',
            recentTitle: 'Ned\u00e1vn\u00e9',
            recentClearAll: 'Vymazat',
            recentRemove: 'Odebrat z historie',
            recentCleared: 'Historie vymazána',
            footerTab: 'Tab filtr',
            footerFav: 'Ctrl+F obl\u00edben\u00e9',
            footerBBCode: 'Ctrl+B kop\u00edrovat BBCode',
            footerExport: 'Exportovat seznam',
            exportEmpty: 'V aktu\u00e1ln\u00edm seznamu nen\u00ed nic k exportu.',
            exportCopied: 'Zkop\u00edrov\u00e1no {n} polo\u017eek BBCode',
            bbcodeCopied: 'Zkop\u00edrov\u00e1no',
            footerRefresh: 'Ctrl+R obnovit',
            footerHelp: '? n\u00e1pov\u011bda',
            menuItem: 'QuickFinder',
            dataFresh: 'Data \u010derstv\u00e1',
            dataFreshMin: 'Data star\u00e1 {n} min',
            dataFreshHour: 'Data star\u00e1 {n} h',
            dataFreshDay: 'Data star\u00e1 {n} d',
            dataError: 'Chyba dat',
            shortcutsTitle: 'Zkr\u00e1tky',
            shortcutsFirstLast: 'p\u0159esko\u010dit na prvn\u00ed/posledn\u00ed v\u00fdsledek',
            shortcutsRemoveRecent: 'odebrat vybrané z historie',
            shortcutsClearRecent: 'vymazat celou historii posledních',
            shortcutsHelp: 'zobrazit tuto n\u00e1pov\u011bdu',
            commandHelpTitle: 'P\u0159\u00edkazy',
            commandGotoHelp: '>goto 123:456 \u2014 p\u0159esko\u010dit na ostrov',
            commandGhostHelp: '>ghost [minPts] \u2014 m\u011bsta duch\u016f',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 vzd\u00e1lenost ostrov\u016f',
            commandHelpHint: '>help \u2014 zobrazit tento seznam',
            commandUnknown: 'Nezn\u00e1m\u00fd p\u0159\u00edkaz: {cmd}',
            premiumRequired: 'Vy\u017eaduje aktivn\u00edho poradce Spr\u00e1vce (Premium).',
            ghostEmpty: 'Nebyla nalezena \u017e\u00e1dn\u00e1 m\u011bsta duch\u016f.',
            distResult: 'Vzd\u00e1lenost ostrov\u016f: {n}',
            distFromActive: 'z va\u0161eho aktivn\u00edho m\u011bsta',
            distFromOrigin: 'z p\u0159ipnut\u00e9ho po\u010d\u00e1tku',
            distNeedOrigin: 'Zadejte dv\u011b sou\u0159adnice, nebo jednu, pokud lze zjistit va\u0161e aktivn\u00ed m\u011bsto.',
            originSet: 'Po\u010d\u00e1tek nastaven na {x}:{y}',
            originSetTooltip: 'Nastavit jako po\u010d\u00e1tek vzd\u00e1lenosti (Ctrl+O)',
            originCleared: 'Po\u010d\u00e1tek zru\u0161en',
            originIndicator: 'Po\u010d\u00e1tek {x}:{y}',
            originIndicatorTooltip: 'Kliknut\u00edm zru\u0161\u00edte p\u0159ipnut\u00fd po\u010d\u00e1tek',
            shortcutsSetOrigin: 'Nastavit jako po\u010d\u00e1tek vzd\u00e1lenosti',
            favoriteNoteTooltip: 'Upravit pozn\u00e1mku (Ctrl+N)',
            favoriteNoteTitle: 'Pozn\u00e1mka pro {name}',
            favoriteNoteLabel: 'Pozn\u00e1mka',
            favoriteNoteSaved: 'Pozn\u00e1mka ulo\u017eena',
            shortcutsEditNote: 'Upravit pozn\u00e1mku vybran\u00e9 obl\u00edben\u00e9 polo\u017eky',
            scopeHelpTitle: 'Rozsahy',
            scopeHelpDesc: '@p hr\u00e1\u010di \u00b7 @a aliance \u00b7 @t m\u011bsta \u00b7 @c sou\u0159adnice',
            commandIslandHelp: '>island X:Y \u2014 v\u0161echna m\u011bsta na ostrov\u011b',
            commandNearHelp: '>near [X:Y] [polom\u011br] \u2014 ostrovy kolem bodu',
            commandOceanHelp: '>ocean M34 [aliance] \u2014 p\u0159ehled oce\u00e1nu',
            distBandSame: 'stejn\u00fd ostrov',
            distBandAdjacent: 'sousedn\u00ed ostrovy',
            distBandRegional: 'region\u00e1ln\u00ed',
            distBandFar: 'velk\u00e1 vzd\u00e1lenost',
            badgeIsland: 'Ostrov',
            badgeCommand: 'P\u0159\u00edkaz',
            segmentIslands: 'Ostrovy',
            ghostLabel: 'Duch',
            islandTowns: '{n} m\u011bst',
            islandAlliances: '{n} aliance',
            islandGhosts: '{n} duch\u016f',
            openIslandMap: 'Otev\u0159\u00edt ostrov na map\u011b',
            nearSummary: '{islands} ostrov\u016f \u00b7 {towns} m\u011bst v okruhu {n}',
            nearNeedOrigin: 'Zadejte polom\u011br, nebo sou\u0159adnice a polom\u011br. Pokud lze zjistit, pou\u017eije se va\u0161e aktivn\u00ed m\u011bsto.',
            oceanEmpty: 'V tomto oce\u00e1nu nic nen\u00ed indexov\u00e1no.',
            oceanNeed: 'Pou\u017eijte >ocean M34 nebo >ocean M34 N\u00e1zevAliance.',
            oceanSummary: '{players} hr\u00e1\u010d\u016f \u00b7 {alliances} aliance \u00b7 {towns} m\u011bst \u00b7 {ghosts} duch\u016f',
            playerTownsTitle: 'M\u011bsta',
            allianceSpreadTitle: 'Kde se nach\u00e1z\u00ed',
            allianceMembersTitle: '\u010clenov\u00e9',
            drillTowns: 'zobrazit města',
            sortPoints: 'podle bodů',
            sortDistance: 'podle vzdálenosti',
            shortcutsOpen: 'Otevřít/zavřít QuickFinder',
            commandSettingsHelp: '>settings — otevřít panel nastavení',
            settingsTitle: 'Nastavení',
            settingsLanguage: 'Jazyk',
            settingsLanguageAuto: 'Automaticky (podle světa)',
            settingsHotkey: 'Klávesová zkratka',
            settingsPageSize: 'Výsledků na stránku',
            settingsMaxResults: 'Max. výsledků příkazu',
            settingsCacheTtl: 'Mezipaměť dat (hodiny)',
            settingsNearRadius: 'Max. poloměr pro >near',
            settingsGhostMin: 'Výchozí min. body pro >ghost',
            settingsSave: 'Uložit',
            settingsReset: 'Obnovit výchozí',
            settingsSaved: 'Nastavení uloženo',
            settingsResetDone: 'Nastavení obnoveno',
            segmentSaved: 'Uložené',
            segmentFavorites: 'Oblíbené',
            segmentRecent: 'Nedávné',
            savedSearchesTitle: 'Uložená hledání',
            savedSearchesCleared: 'Uložená hledání vymazána',
            saveSearchTooltip: 'Ctrl+D uložit hledání',
            saveSearchPanelTitle: 'Uložit hledání',
            saveSearchEditTitle: 'Přejmenovat uložené hledání',
            saveSearchEditTooltip: 'Přejmenovat (Ctrl+E)',
            saveSearchNameLabel: 'Název',
            saveSearchSave: 'Uložit',
            saveSearchCancel: 'Zrušit',
            saveSearchSaved: 'Hledání uloženo',
            saveSearchRenamed: 'Uložené hledání přejmenováno',
            saveSearchRemove: 'Odebrat uložené hledání',
            badgeSavedSearch: 'Uložené',
            shortcutsSaveSearch: 'Uložit aktuální hledání',
            shortcutsRenameSaved: 'Přejmenovat vybrané uložené hledání',
            hierarchyDrillTooltip: 'Zobrazit podrobnosti (→)',
            shortcutsHierarchyNav: '← → vstoupit/opustit',
            updateAvailableToast: 'Je k dispozici nová verze ({version}).',
            updateAvailableTooltip: 'K dispozici je nová verze {version} — klikněte pro stažení',
            settingsCheckUpdates: 'Zkontrolovat aktualizace',
            updateUpToDate: 'Již máte nejnovější verzi',
            settingsConquestHistory: 'Povolit historii dobývání',
            settingsConquestHistoryHint: 'Stáhne několika MB soubor (conquers.txt) pro >history',
            islandTownsWithCapacity: '{n}/{cap} měst',
            recentlyConquered: 'dobyto před {n} dny',
            lastActivity: 'poslední aktivita před {n} dny',
            commandHistoryHelp: '>history <jméno|x:y> — historie dobývání města, hráče nebo souřadnice',
            commandTravelHelp: '>travel <jednotka,...> [X:Y] [X:Y] [sirens=N] — doba p\u0159esunu jednotek',
            commandTopHelp: '>top players|alliances [N] — \u017eeb\u0159\u00ed\u010dek podle bod\u016f',
            commandVsHelp: '>vs <aliance1> vs <aliance2> — porovn\u00e1 dv\u011b aliance',
            travelUnknownUnit: 'Nezn\u00e1m\u00e1 jednotka: {unit}',
            travelCalcFailed: 'Dobu p\u0159esunu se nepoda\u0159ilo vypo\u010d\u00edtat (chyb\u011bj\u00ed live data ze hry).',
            travelLimitedBy: 'Omezeno: {unit}',
            travelColonizeShipLimit: 'To p\u0159ekra\u010duje b\u011b\u017en\u00fd 48h limit kolonizační lodi.',
            travelFlyingNote: 'L\u00e9taj\u00edc\u00ed jednotky mohou p\u0159ekonat ostrovy bez transportn\u00ed lodi.',
            travelNoBonusData: 'Bonusy v\u00fdzkumu/budov m\u011bsta nejsou dostupn\u00e9 — zobrazena jen z\u00e1kladn\u00ed rychlost.',
            travelUsedActiveCity: 'Pou\u017eity bonusy va\u0161eho aktivn\u00edho m\u011bsta (po\u010d\u00e1tek nen\u00ed jedn\u00edm z va\u0161ich m\u011bst).',
            travelScopeNote: 'Nezahrnuje bonus Velk\u00e9ho chr\u00e1mu Area na Olympu ani efekty hrdiny.',
            historyEmpty: 'Pro tuto položku není zaznamenána žádná historie dobývání.',
            historyNotLoaded: 'Načítání historie dobývání...',
            historyDisabled: 'Povolte "historii dobývání" v Nastavení pro použití >history.',
            historyGhost: 'nikdo (duch)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'založeno hráčem {to}',
            historyEventCount: '{n} zaznamenaných událostí',
            historyPlayerSummary: '{conquered} dobyto · {lost} ztraceno',
        },
        sk: {
            searchPlaceholder: 'H\u013ead\u0165 hr\u00e1\u010dov, alianciu alebo mest\u00e1...',
            footerNavigate: '\u2191 \u2193 vybra\u0165',
            footerOpen: 'Enter otvori\u0165',
            shortcutsEscTwoStage: 'Zatvoriť panel / paletu (stlačte dvakrát, ak je otvorený panel podrobností)',
            emptyTitle: 'H\u013eada\u0165 v Grepolis',
            emptySubtitle: 'Hr\u00e1\u010di \u00b7 Aliancie \u00b7 Mest\u00e1',
            emptyHintCoords: 'M\u00f4\u017ee\u0161 zada\u0165 aj s\u00faradnice: <strong>{example}</strong>',
            emptyHintCommands: 'Napíš <strong>&gt;</strong> pre príkazy (opustené mestá, vzdialenosti...) alebo <strong>?</strong> pre všetky skratky.',
            loadingWorldData: 'Na\u010d\u00edtavanie d\u00e1t sveta...',
            noResults: 'Neboli n\u00e1jden\u00e9 \u017eiadne v\u00fdsledky.',
            resultsMore: 'Zobrazen\u00fdch {shown} z {total} \u2014 posunut\u00edm zobraz\u00edte \u010fal\u0161ie',
            errorLoadingDataGeneric: 'Dáta sveta sa nepodarilo načítať. Skúste obnoviť stránku.',
            errorLoadingDataTimeout: 'Požiadavka trvala príliš dlho. Skontrolujte pripojenie a skúste to znova.',
            errorLoadingDataWorldNotDetected: 'Nepodarilo sa rozpoznať aktuálny svet.',
            badgePlayer: 'Hr\u00e1\u010d',
            badgeAlliance: 'Aliancia',
            badgeTown: 'Mesto',
            badgeCoordinate: 'S\u00faradnice',
            ptsSuffix: 'bodov',
            membersSuffix: '\u010dlenov',
            segmentAll: 'V\u0161etko',
            segmentPlayers: 'Hr\u00e1\u010di',
            segmentAlliances: 'Aliance',
            segmentTowns: 'Mest\u00e1',
            segmentCoords: 'S\u00faradnice',
            townsSuffix: 'miest',
            onIslandInfo: '{n} miest na tomto ostrove',
            favoritesTitle: 'Ob\u013e\u00faben\u00e9',
            recentTitle: 'Ned\u00e1vne',
            recentClearAll: 'Vymazať',
            recentRemove: 'Odstrániť z histórie',
            recentCleared: 'História vymazaná',
            footerTab: 'Tab filter',
            footerFav: 'Ctrl+F ob\u013e\u00faben\u00e9',
            footerBBCode: 'Ctrl+B kop\u00edrova\u0165 BBCode',
            footerExport: 'Exportova\u0165 zoznam',
            exportEmpty: 'V aktu\u00e1lnom zozname nie je ni\u010d na export.',
            exportCopied: 'Skop\u00edrovan\u00fdch {n} polo\u017eiek BBCode',
            bbcodeCopied: 'Skop\u00edrovan\u00e9',
            footerRefresh: 'Ctrl+R obnovi\u0165',
            footerHelp: '? pomoc',
            menuItem: 'QuickFinder',
            dataFresh: 'D\u00e1ta \u010derstv\u00e9',
            dataFreshMin: 'D\u00e1ta star\u00e9 {n} min',
            dataFreshHour: 'D\u00e1ta star\u00e9 {n} h',
            dataFreshDay: 'D\u00e1ta star\u00e9 {n} d',
            dataError: 'Chyba d\u00e1t',
            shortcutsTitle: 'Skratky',
            shortcutsFirstLast: 'prejs\u0165 na prv\u00fd/posledn\u00fd v\u00fdsledok',
            shortcutsRemoveRecent: 'odstrániť vybrané z histórie',
            shortcutsClearRecent: 'vymazať celú históriu posledných',
            shortcutsHelp: 'zobrazi\u0165 t\u00fato pomoc',
            commandHelpTitle: 'Pr\u00edkazy',
            commandGotoHelp: '>goto 123:456 \u2014 sko\u010di\u0165 na ostrov',
            commandGhostHelp: '>ghost [minPts] \u2014 mest\u00e1 duchov',
            commandDistHelp: '>dist X:Y [X:Y...] \u2014 vzdialenos\u0165 ostrovov',
            commandHelpHint: '>help \u2014 zobrazi\u0165 tento zoznam',
            commandUnknown: 'Nezn\u00e1my pr\u00edkaz: {cmd}',
            premiumRequired: 'Vy\u017eaduje aktívneho poradcu Správca (Premium).',
            ghostEmpty: 'Nena\u0161li sa \u017eiadne mest\u00e1 duchov.',
            distResult: 'Vzdialenos\u0165 ostrovov: {n}',
            distFromActive: 'z va\u0161eho akt\u00edvneho mesta',
            distFromOrigin: 'z pripnut\u00e9ho po\u010diatku',
            distNeedOrigin: 'Zadajte dve s\u00faradnice, alebo jednu, ak mo\u017eno zisti\u0165 va\u0161e akt\u00edvne mesto.',
            originSet: 'Po\u010diatok nastaven\u00fd na {x}:{y}',
            originSetTooltip: 'Nastavi\u0165 ako po\u010diatok vzdialenosti (Ctrl+O)',
            originCleared: 'Po\u010diatok zru\u0161en\u00fd',
            originIndicator: 'Po\u010diatok {x}:{y}',
            originIndicatorTooltip: 'Kliknut\u00edm zru\u0161\u00edte pripnut\u00fd po\u010diatok',
            shortcutsSetOrigin: 'Nastavi\u0165 ako po\u010diatok vzdialenosti',
            favoriteNoteTooltip: 'Upravi\u0165 pozn\u00e1mku (Ctrl+N)',
            favoriteNoteTitle: 'Pozn\u00e1mka pre {name}',
            favoriteNoteLabel: 'Pozn\u00e1mka',
            favoriteNoteSaved: 'Pozn\u00e1mka ulo\u017een\u00e1',
            shortcutsEditNote: 'Upravi\u0165 pozn\u00e1mku vybranej obl\u00fabenej polo\u017eky',
            scopeHelpTitle: 'Rozsahy',
            scopeHelpDesc: '@p hr\u00e1\u010di \u00b7 @a aliancie \u00b7 @t mest\u00e1 \u00b7 @c s\u00faradnice',
            commandIslandHelp: '>island X:Y \u2014 v\u0161etky mest\u00e1 na ostrove',
            commandNearHelp: '>near [X:Y] [polomer] \u2014 ostrovy okolo bodu',
            commandOceanHelp: '>ocean M34 [aliancia] \u2014 preh\u013ead oce\u00e1nu',
            distBandSame: 'rovnak\u00fd ostrov',
            distBandAdjacent: 'susedn\u00e9 ostrovy',
            distBandRegional: 'region\u00e1lne',
            distBandFar: 've\u013ek\u00e1 vzdialenos\u0165',
            badgeIsland: 'Ostrov',
            badgeCommand: 'Pr\u00edkaz',
            segmentIslands: 'Ostrovy',
            ghostLabel: 'Duch',
            islandTowns: '{n} miest',
            islandAlliances: '{n} alianci\u00ed',
            islandGhosts: '{n} duchov',
            openIslandMap: 'Otvori\u0165 ostrov na mape',
            nearSummary: '{islands} ostrovov \u00b7 {towns} miest v okruhu {n}',
            nearNeedOrigin: 'Zadajte polomer, alebo s\u00faradnice a polomer. Ak mo\u017eno zisti\u0165, pou\u017eije sa va\u0161e akt\u00edvne mesto.',
            oceanEmpty: 'V tomto oce\u00e1ne nie je ni\u010d indexovan\u00e9.',
            oceanNeed: 'Pou\u017eite >ocean M34 alebo >ocean M34 N\u00e1zovAliancie.',
            oceanSummary: '{players} hr\u00e1\u010dov \u00b7 {alliances} alianci\u00ed \u00b7 {towns} miest \u00b7 {ghosts} duchov',
            playerTownsTitle: 'Mest\u00e1',
            allianceSpreadTitle: 'Kde sa nach\u00e1dzaj\u00fa',
            allianceMembersTitle: '\u010clenovia',
            drillTowns: 'zobraziť mestá',
            sortPoints: 'podľa bodov',
            sortDistance: 'podľa vzdialenosti',
            shortcutsOpen: 'Otvoriť/zavrieť QuickFinder',
            commandSettingsHelp: '>settings — otvoriť panel nastavení',
            settingsTitle: 'Nastavenia',
            settingsLanguage: 'Jazyk',
            settingsLanguageAuto: 'Automaticky (podľa sveta)',
            settingsHotkey: 'Klávesová skratka',
            settingsPageSize: 'Výsledkov na stránku',
            settingsMaxResults: 'Max. výsledkov príkazu',
            settingsCacheTtl: 'Vyrovnávacia pamäť dát (hodiny)',
            settingsNearRadius: 'Max. polomer pre >near',
            settingsGhostMin: 'Predvolené min. body pre >ghost',
            settingsSave: 'Uložiť',
            settingsReset: 'Obnoviť predvolené',
            settingsSaved: 'Nastavenia uložené',
            settingsResetDone: 'Nastavenia obnovené',
            segmentSaved: 'Uložené',
            segmentFavorites: 'Obľúbené',
            segmentRecent: 'Nedávne',
            savedSearchesTitle: 'Uložené vyhľadávania',
            savedSearchesCleared: 'Uložené vyhľadávania vymazané',
            saveSearchTooltip: 'Ctrl+D uložiť vyhľadávanie',
            saveSearchPanelTitle: 'Uložiť vyhľadávanie',
            saveSearchEditTitle: 'Premenovať uložené vyhľadávanie',
            saveSearchEditTooltip: 'Premenovať (Ctrl+E)',
            saveSearchNameLabel: 'Názov',
            saveSearchSave: 'Uložiť',
            saveSearchCancel: 'Zrušiť',
            saveSearchSaved: 'Vyhľadávanie uložené',
            saveSearchRenamed: 'Uložené vyhľadávanie premenované',
            saveSearchRemove: 'Odstrániť uložené vyhľadávanie',
            badgeSavedSearch: 'Uložené',
            shortcutsSaveSearch: 'Uložiť aktuálne vyhľadávanie',
            shortcutsRenameSaved: 'Premenovať vybrané uložené vyhľadávanie',
            hierarchyDrillTooltip: 'Zobraziť podrobnosti (→)',
            shortcutsHierarchyNav: '← → vstúpiť/opustiť',
            updateAvailableToast: 'Je k dispozícii nová verzia ({version}).',
            updateAvailableTooltip: 'K dispozícii je nová verzia {version} — kliknite pre stiahnutie',
            settingsCheckUpdates: 'Skontrolovať aktualizácie',
            updateUpToDate: 'Už máte najnovšiu verziu',
            settingsConquestHistory: 'Povoliť históriu dobýjania',
            settingsConquestHistoryHint: 'Stiahne niekoľko MB veľký súbor (conquers.txt) pre >history',
            islandTownsWithCapacity: '{n}/{cap} miest',
            recentlyConquered: 'dobyté pred {n} dňami',
            lastActivity: 'posledná aktivita pred {n} dňami',
            commandHistoryHelp: '>history <meno|x:y> — história dobýjania mesta, hráča alebo súradnice',
            commandTravelHelp: '>travel <jednotka,...> [X:Y] [X:Y] [sirens=N] — \u010das presunu jednotiek',
            commandTopHelp: '>top players|alliances [N] — rebr\u00ed\u010dek pod\u013ea bodov',
            commandVsHelp: '>vs <aliancia1> vs <aliancia2> — porovnaj dve aliancie',
            travelUnknownUnit: 'Nezn\u00e1ma jednotka: {unit}',
            travelCalcFailed: '\u010cas presunu sa nepodarilo vypo\u010d\u00edta\u0165 (ch\u00fdbaj\u00face live d\u00e1ta hry).',
            travelLimitedBy: 'Obmedzen\u00e9: {unit}',
            travelColonizeShipLimit: 'Toto prekra\u010duje be\u017en\u00fd 48h limit kolonizačnej lode.',
            travelFlyingNote: 'Lietaj\u00face jednotky m\u00f4\u017eu prekona\u0165 ostrovy bez transportnej lode.',
            travelNoBonusData: 'Bonusy v\u00fdskumu/budov mesta nie s\u00fa dostupn\u00e9 — zobrazen\u00e1 iba z\u00e1kladn\u00e1 r\u00fdchlos\u0165.',
            travelUsedActiveCity: 'Pou\u017eit\u00e9 bonusy va\u0161eho akt\u00edvneho mesta (po\u010diatok nie je jedn\u00fdm z va\u0161ich miest).',
            travelScopeNote: 'Nezah\u0155\u0148a bonus Ve\u013ek\u00e9ho chr\u00e1mu Area na Olympe ani efekty hrdinu.',
            historyEmpty: 'Pre túto položku nie je zaznamenaná žiadna história dobýjania.',
            historyNotLoaded: 'Načítava sa história dobýjania...',
            historyDisabled: 'Povoľte "históriu dobýjania" v Nastaveniach na použitie >history.',
            historyGhost: 'nikto (duch)',
            historyEventConquest: '{from} → {to}',
            historyEventColonized: 'založené hráčom {to}',
            historyEventCount: '{n} zaznamenaných udalostí',
            historyPlayerSummary: '{conquered} dobyté · {lost} stratené',
        },
    };

    // Native display names for each LOCALES key, used in the settings
    // panel's language dropdown (kept separate from LOCALES so it
    // doesn't need a translation lookup for its own labels).
    const LANGUAGE_NAMES = {
        en: 'English',
        es: 'Español',
        de: 'Deutsch',
        fr: 'Français',
        it: 'Italiano',
        nl: 'Nederlands',
        pl: 'Polski',
        pt: 'Português',
        br: 'Português (Brasil)',
        tr: 'Türkçe',
        ru: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439',
        el: '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac',
        hu: 'Magyar',
        ro: 'Rom\u00e2n\u0103',
        cs: '\u010ce\u0161tina',
        sk: 'Sloven\u010dina',
    };

    function translate(key, params) {
        const lang = state.locale || LOCALES.en;
        let text = lang[key] || LOCALES.en[key] || key;
        if (params) {
            for (const [name, value] of Object.entries(params)) {
                text = text.split(`{${name}}`).join(value);
            }
        }
        return text;
    }

    /*
     * ============================================================
     * GREPOLIS PAGE CONTEXT
     * ============================================================
     *
     * Tampermonkey runs the userscript in a sandbox that has its own
     * `window` object. The globals that the Grepolis bundle attaches
     * at runtime (Game, Layout, WMap, ITowns...) do NOT exist on that
     * isolated `window`: they live on the page's real `window`.
     *
     * `unsafeWindow` gives us access to that real `window`. Standard
     * web APIs like `fetch` or `document` work the same in both
     * contexts, so we only use GP to reach Grepolis client objects.
     */

    const GP = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    /*
     * ============================================================
     * WORLD DETECTION
     * ============================================================
     */

    function getWorld() {
        const match = location.hostname.match(/^([a-z]{2}\d+)\.grepolis\.com$/i);
        return match ? match[1].toLowerCase() : null;
    }

    function getMarket(world) {
        if (!world) return null;
        const match = world.match(/^[a-z]+/);
        return match ? match[0] : null;
    }

    /*
     * Resolves the active locale dictionary. A manual override in
     * settings.language (anything other than 'auto') always wins;
     * otherwise falls back to the market-based auto-detection.
     */
    function resolveLocale(world) {
        if (settings.language && settings.language !== 'auto' && LOCALES[settings.language]) {
            return LOCALES[settings.language];
        }
        const market = getMarket(world);
        const languageKey = market && MARKET_TO_LANGUAGE[market];
        return LOCALES[languageKey] || LOCALES.en;
    }

    const WORLD = getWorld();
    const MARKET = getMarket(WORLD);

    /*
     * ============================================================
     * SETTINGS PERSISTENCE
     * ============================================================
     *
     * Unlike history/favorites, settings are stored under a single
     * global localStorage key (not namespaced per world): they are
     * user preferences about how the tool itself behaves, and are
     * expected to be the same across every Grepolis world the same
     * browser profile plays on.
     */

    function loadSettings() {
        let raw = null;
        try {
            raw = localStorage.getItem(SETTINGS_KEY);
        } catch (_) {
            raw = null;
        }
        if (!raw) {
            return { ...SETTINGS_DEFAULTS };
        }
        try {
            const parsed = JSON.parse(raw);
            return { ...SETTINGS_DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
        } catch (_) {
            return { ...SETTINGS_DEFAULTS };
        }
    }

    function persistSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (_) {
            // Quota exceeded or storage disabled: settings are best-effort.
        }
    }

    function clampSetting(key, value) {
        const bounds = SETTINGS_BOUNDS[key];
        if (!bounds) return value;
        return Math.min(bounds.max, Math.max(bounds.min, value));
    }

    /*
     * Re-applies the runtime-relevant settings onto CONFIG so every
     * function reading CONFIG.* immediately reflects the current
     * settings without needing a page reload.
     */
    function applySettingsToConfig() {
        CONFIG.HOTKEY = settings.hotkey || SETTINGS_DEFAULTS.hotkey;
        CONFIG.RESULTS_PAGE_SIZE = clampSetting('resultsPageSize', settings.resultsPageSize);
        CONFIG.MAX_RESULTS = clampSetting('maxResults', settings.maxResults);
        CONFIG.CACHE_TTL = clampSetting('cacheTtlHours', settings.cacheTtlHours) * 60 * 60 * 1000;
        CONFIG.NEAR_MAX_RADIUS = clampSetting('nearMaxRadius', settings.nearMaxRadius);
        CONFIG.GHOST_MIN_POINTS = clampSetting('ghostMinPoints', settings.ghostMinPoints);
        CONFIG.CONQUEST_HISTORY_ENABLED = Boolean(settings.conquestHistoryEnabled);
    }

    settings = loadSettings();
    applySettingsToConfig();

    /*
     * ============================================================
     * STATE
     * ============================================================
     */

    const state = {
        open: false,
        query: '',
        results: [],
        selected: 0,
        loading: false,
        loaded: false,
        loadError: null,
        locale: resolveLocale(WORLD),
        fullResults: [],
        segment: CONFIG.DEFAULT_SEGMENT,
        segmentCounts: null,
        // True for command output and player/alliance drill-down views:
        // those rows mix types on purpose (info/town/player...) and must
        // not be pruned by the segment chip filter.
        detail: false,
        showHelp: false,
        showSettings: false,
        // 'all' | 'saved' | 'favorite' | 'recent': Tab-cycled filter for the
        // empty-query history view, independent from `segment` above (which
        // only applies while actively searching).
        historySegment: CONFIG.DEFAULT_HISTORY_SEGMENT,
        historyCounts: null,
        // Inline "Save search" / "Rename saved search" panel, same pattern
        // as showHelp/showSettings: mutually exclusive, own render branch.
        showSaveSearch: false,
        saveSearchMode: 'create', // 'create' (new saved search) | 'edit' (rename existing)
        saveSearchEditId: null,
        // Inline "Edit note" panel for a favorited row, same mutually-
        // exclusive pattern as showSaveSearch above.
        showNoteEditor: false,
        noteEditItem: null,
        savedAt: 0,
        dataSource: null,
        // How many of state.results are currently rendered; grows as the
        // user scrolls down instead of rendering thousands of rows at once.
        visibleCount: CONFIG.RESULTS_PAGE_SIZE,
        // Right-hand drill-down pane (Alliance -> Player -> Town, Island ->
        // Town). Each stack entry is { source: item, rows, selected,
        // premiumBlocked }. Navigated with ArrowRight/ArrowLeft (mouse:
        // the row chevron / the breadcrumb bar), independent from
        // state.selected which always tracks the left-hand list.
        hierarchyStack: [],
        // 'list' | 'detail': which column currently owns ArrowUp/ArrowDown/
        // Enter. Reset to 'list' whenever the stack empties.
        focusPane: 'list',
        // Remote @version string when checkForUpdates() finds a newer
        // build available for this install's channel, else null. Drives
        // the footer version badge and the one-time-per-version toast.
        updateAvailable: null,
    };

    /*
     * ============================================================
     * DATA (in-memory index built from Grepolis' public data
     * dumps: /data/players.txt, /data/alliances.txt, /data/towns.txt
     * and /data/islands.txt). These are same-origin, plain-text
     * files that the game client itself exposes for rankings/
     * exports. This is not a made-up endpoint: they are loaded once
     * on startup and cached in memory, so subsequent searches are
     * purely local and synchronous.
     * ============================================================
     */

    const DATA = {
        players: [],
        alliances: [],
        towns: [],
        playerById: new Map(),
        allianceById: new Map(),
        townById: new Map(),
        townsByCoord: new Map(),
        townsByPlayer: new Map(),
        townsByOcean: new Map(),
        islandsByBucket: new Map(),
        islandIdByCoord: new Map(),
        islandCapacityByCoord: new Map(),
    };

    /*
     * Conquest history (/data/conquers.txt), loaded separately and
     * only when opted in via Settings (see CONQUEST HISTORY section
     * further below): unlike the four arrays above, it is multi-MB
     * even on a few-year-old world and most users never need it.
     * `eventsByTown` holds every {ts, newOwnerId, oldOwnerId,
     * newAllianceId, oldAllianceId, points} row for a given town id,
     * oldest first (the file itself is already chronological).
     */
    const CONQUEST = {
        loaded: false,
        loading: false,
        eventsByTown: new Map(),
        totalEvents: 0,
    };

    /*
     * ============================================================
     * UTILS
     * ============================================================
     */

    function normalize(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    function escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /*
     * Grepolis data files encode names in
     * "application/x-www-form-urlencoded" style: spaces are
     * represented as "+" and everything else as %XX.
     *
     * `decodeURIComponent` does NOT turn "+" into a space (that only
     * happens with form-decoding helpers, not plain percent-decoding,
     * where "+" is literal). That's why "Panzer+of+Honor" used to
     * show up as-is instead of "Panzer of Honor": we first need to
     * replace "+" with spaces and then decode the rest.
     */

    function decodeName(value) {
        const raw = String(value ?? '').replace(/\+/g, ' ');

        try {
            return decodeURIComponent(raw);
        } catch (_) {
            return raw;
        }
    }

    /*
     * ============================================================
     * PERSISTENCE (history & favorites)
     * ============================================================
     *
     * Stored per world in localStorage so the same browser profile
     * can keep independent lists for each server. Both are small
     * (capped) lists of {type, id, name, x, y}; they are re-hydrated
     * against the current index on render, and entries whose target
     * no longer exists in the world data are dropped.
     */

    const SEGMENT_LABEL_KEYS = {
        all: 'segmentAll',
        player: 'segmentPlayers',
        alliance: 'segmentAlliances',
        town: 'segmentTowns',
        island: 'segmentIslands',
        coordinate: 'segmentCoords',
    };

    let favoriteSet = new Set();

    function storageGet(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function storageSet(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (_) {
            // Quota exceeded or storage disabled: history/favorites are best-effort.
        }
    }

    function worldKey(namespace) {
        return `qf:${namespace}:${WORLD || 'unknown'}`;
    }

    function loadHistory() {
        const list = storageGet(worldKey('history'));
        return Array.isArray(list) ? list : [];
    }

    function addHistory(item) {
        const list = loadHistory().filter((entry) => !(entry.type === item.type && String(entry.id) === String(item.id)));
        list.unshift({ type: item.type, id: item.id, name: item.name, x: item.x, y: item.y });
        if (list.length > CONFIG.HISTORY_MAX) {
            list.length = CONFIG.HISTORY_MAX;
        }
        storageSet(worldKey('history'), list);
    }

    /*
     * Coordinate entries without a town on them carry no stable `id`
     * (see searchCoordinates/hydrateHistoryItem), so type+id alone
     * cannot identify them; x/y is used instead for that one type.
     */
    function historyEntryKey(entry) {
        if (entry.type === 'coordinate') {
            return `coordinate:${entry.x}:${entry.y}`;
        }
        return `${entry.type}:${entry.id}`;
    }

    function removeHistoryItem(item) {
        const key = historyEntryKey(item);
        const list = loadHistory().filter((entry) => historyEntryKey(entry) !== key);
        storageSet(worldKey('history'), list);
    }

    function clearHistory() {
        storageSet(worldKey('history'), []);
    }

    function loadFavorites() {
        const list = storageGet(worldKey('favorites'));
        return Array.isArray(list) ? list : [];
    }

    function syncFavorites() {
        favoriteSet = new Set(loadFavorites().map((entry) => `${entry.type}:${entry.id}`));
    }

    function saveFavorites(list) {
        storageSet(worldKey('favorites'), list);
        syncFavorites();
    }

    /*
     * Toggles whether the given result is a favorite. Returns true if
     * it was removed, false if it was added.
     */
    function toggleFavorite(item) {
        const favorites = loadFavorites();
        const index = favorites.findIndex((entry) => entry.type === item.type && String(entry.id) === String(item.id));
        if (index >= 0) {
            favorites.splice(index, 1);
        } else {
            favorites.unshift({ type: item.type, id: item.id, name: item.name, x: item.x, y: item.y, note: '' });
            if (favorites.length > CONFIG.FAVORITES_MAX) {
                favorites.length = CONFIG.FAVORITES_MAX;
            }
        }
        saveFavorites(favorites);
        return index >= 0;
    }

    function isFavorite(item) {
        return favoriteSet.has(`${item.type}:${item.id}`);
    }

    /*
     * Free-text note (max 140 chars) attached to a favorite entry,
     * independent from its resolved name — e.g. "support target" or
     * "ally, do not attack". No-ops if the item isn't favorited.
     */
    function favoriteNote(item) {
        if (!item) return '';
        const entry = loadFavorites().find((favEntry) => favEntry.type === item.type && String(favEntry.id) === String(item.id));
        return entry && entry.note ? entry.note : '';
    }

    function setFavoriteNote(item, note) {
        const favorites = loadFavorites();
        const entry = favorites.find((favEntry) => favEntry.type === item.type && String(favEntry.id) === String(item.id));
        if (!entry) return false;
        entry.note = String(note || '').slice(0, 140).trim();
        saveFavorites(favorites);
        return true;
    }

    /*
     * Saved searches persist the raw query text (free-text, "@scope
     * query", or ">command args") so it can be re-run verbatim later,
     * unlike favorites/history which store a resolved player/alliance/
     * town/coordinate target.
     */
    function loadSavedSearches() {
        const list = storageGet(worldKey('savedSearches'));
        return Array.isArray(list) ? list : [];
    }

    function saveSavedSearches(list) {
        storageSet(worldKey('savedSearches'), list);
    }

    function addSavedSearch(query, name, note) {
        const list = loadSavedSearches();
        const trimmedName = String(name || '').trim();
        const entry = {
            id: Date.now(),
            query,
            name: trimmedName || query,
            note: String(note || '').slice(0, 140).trim(),
            createdAt: Date.now(),
        };
        list.unshift(entry);
        if (list.length > CONFIG.SAVED_SEARCHES_MAX) {
            list.length = CONFIG.SAVED_SEARCHES_MAX;
        }
        saveSavedSearches(list);
        return entry;
    }

    function removeSavedSearch(id) {
        const list = loadSavedSearches().filter((entry) => entry.id !== id);
        saveSavedSearches(list);
    }

    function clearSavedSearches() {
        saveSavedSearches([]);
    }

    function renameSavedSearch(id, name, note) {
        const list = loadSavedSearches();
        const entry = list.find((item) => item.id === id);
        if (!entry) return;
        const trimmedName = String(name || '').trim();
        entry.name = trimmedName || entry.query;
        if (note !== undefined) {
            entry.note = String(note || '').slice(0, 140).trim();
        }
        saveSavedSearches(list);
    }

    /*
     * ============================================================
     * ORIGIN OVERRIDE
     * ============================================================
     *
     * Per-world override for the implicit origin used by >dist,
     * >near, >ghost near, >travel and the distance columns. Set via
     * Ctrl+O / the per-row "set as origin" icon on any town/
     * coordinate/island result; effectiveOrigin() prefers this over
     * activeTownCoords() when present, so a multi-city player can
     * plan from a city other than whichever one the game client
     * currently has open.
     */
    function loadOriginOverride() {
        const value = storageGet(worldKey('origin'));
        if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
        return { x: value.x, y: value.y };
    }

    function setOriginOverride(coords) {
        if (!coords || !Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return;
        storageSet(worldKey('origin'), { x: coords.x, y: coords.y });
    }

    function clearOriginOverride() {
        storageSet(worldKey('origin'), null);
    }

    function setOriginFromItem(item) {
        if (!item) return false;
        let coords = null;
        if (item.type === 'coordinate' || item.type === 'island') {
            coords = { x: item.x, y: item.y };
        } else if (item.type === 'town') {
            const town = item.data;
            coords = town ? { x: town.islandX, y: town.islandY } : { x: item.x, y: item.y };
        }
        if (!coords) return false;
        setOriginOverride(coords);
        return true;
    }

    /*
     * Rebuilds a {type,id,name,x,y} storage entry into a searchable
     * row, resolving the name/coordinates from the live index when
     * possible and falling back to the stored snapshot otherwise (so
     * favorites still open even before the world data finishes
     * loading). Entries for deleted players/alliances/towns are
     * dropped on the spot.
     */
    function hydrateHistoryItem(entry) {
        switch (entry.type) {
            case 'player': {
                const player = DATA.playerById.get(Number(entry.id));
                if (player) {
                    return { type: 'player', id: player.id, name: player.name, data: player };
                }
                return entry.name ? { type: 'player', id: Number(entry.id), name: entry.name } : null;
            }
            case 'alliance': {
                const alliance = DATA.allianceById.get(Number(entry.id));
                if (alliance) {
                    return { type: 'alliance', id: alliance.id, name: alliance.name, data: alliance };
                }
                return entry.name ? { type: 'alliance', id: Number(entry.id), name: entry.name } : null;
            }
            case 'town': {
                const town = DATA.townById.get(Number(entry.id));
                if (town) {
                    return {
                        type: 'town',
                        id: town.id,
                        name: town.name,
                        x: town.islandX,
                        y: town.islandY,
                        playerId: town.playerId,
                        data: town,
                    };
                }
                if (entry.name && Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
                    return { type: 'town', id: Number(entry.id), name: entry.name, x: entry.x, y: entry.y };
                }
                return null;
            }
            case 'coordinate':
                if (Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
                    return { type: 'coordinate', name: `${entry.x}:${entry.y}`, x: entry.x, y: entry.y };
                }
                return null;
            case 'island':
                if (Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
                    return islandRow(entry.x, entry.y);
                }
                return null;
            default:
                return null;
        }
    }

    /*
     * Saved searches first, then favorites, then recent entries
     * (favorites/recent deduplicated by type+id; saved searches have
     * no such target to dedupe against, they're independent query
     * snapshots). Each row gets a `section` marker ('saved' |
     * 'favorite' | 'recent') that the history renderer turns into
     * group headers, and that the Tab-cycled history segment filter
     * (state.historySegment) filters by.
     */
    function buildHistoryResults() {
        const rows = [];
        const keys = new Set();

        for (const entry of loadSavedSearches()) {
            rows.push({
                type: 'saved-search',
                id: entry.id,
                name: entry.name,
                query: entry.query,
                note: entry.note || '',
                section: 'saved',
            });
        }

        for (const entry of loadFavorites()) {
            const item = hydrateHistoryItem(entry);
            if (item) {
                item.section = 'favorite';
                item.note = entry.note || '';
                rows.push(item);
                keys.add(`${item.type}:${item.id}`);
            }
        }

        for (const entry of loadHistory()) {
            const key = `${entry.type}:${entry.id}`;
            if (keys.has(key)) continue;
            const item = hydrateHistoryItem(entry);
            if (item) {
                item.section = 'recent';
                rows.push(item);
                keys.add(key);
            }
        }

        return rows;
    }

    const HISTORY_SEGMENT_LABEL_KEYS = {
        all: 'segmentAll',
        saved: 'segmentSaved',
        favorite: 'segmentFavorites',
        recent: 'segmentRecent',
    };

    function computeHistoryCounts(rows) {
        const counts = { all: rows.length, saved: 0, favorite: 0, recent: 0 };
        for (const item of rows) {
            if (item.section in counts) {
                counts[item.section]++;
            }
        }
        return counts;
    }

    function applyHistorySegment() {
        if (state.historySegment === CONFIG.DEFAULT_HISTORY_SEGMENT) {
            state.results = state.fullResults;
        } else {
            state.results = state.fullResults.filter((item) => item.section === state.historySegment);
        }
        state.selected = 0;
        state.visibleCount = CONFIG.RESULTS_PAGE_SIZE;
    }

    function setHistorySegment(name) {
        state.historySegment = CONFIG.HISTORY_SEGMENTS.includes(name) ? name : CONFIG.DEFAULT_HISTORY_SEGMENT;
        applyHistorySegment();
        render();
    }

    function cycleHistorySegment(direction) {
        if (!state.historyCounts) {
            return;
        }
        const available = CONFIG.HISTORY_SEGMENTS.filter(
            (name) => name === CONFIG.DEFAULT_HISTORY_SEGMENT || state.historyCounts[name] > 0
        );
        if (available.length < 2) {
            return;
        }
        const index = available.indexOf(state.historySegment);
        state.historySegment = available[(index + direction + available.length) % available.length];
        applyHistorySegment();
        render();
    }

    /*
     * ============================================================
     * FUZZY SCORE
     * ============================================================
     *
     * Always receives already-normalized values (nameNorm, queryNorm)
     * so we don't repeat normalize() (with its NFD + regex) on every
     * comparison for every item in the index. This way a full search
     * over ~80k towns takes a handful of milliseconds instead of
     * recomputing Unicode folding 80k times per keystroke.
     */

    function tokenizeNorm(value) {
        return value.split(/\s+/).filter(Boolean);
    }

    // A single transposed/wrong/missing letter shouldn't drop a query
    // to "no match" (e.g. "Naploi" should still find "Napoli"), but the
    // tolerance has to shrink for short queries or almost anything would
    // match almost anything (a 2-letter query with distance 2 is
    // meaningless). Capped at 3 regardless of length to keep the bounded
    // Levenshtein below cheap.
    function typoToleranceFor(length) {
        if (length <= 4) return 1;
        if (length <= 8) return 2;
        return 3;
    }

    /*
     * Bounded Levenshtein distance: returns the edit distance if it is
     * <= maxDistance, otherwise Infinity without finishing the full
     * O(a.length * b.length) table. Two fast exits keep this cheap
     * across a full-index scan: a plain length-difference check before
     * starting, and a per-row "every cell already exceeds the budget"
     * bail once the table is underway.
     */
    function editDistanceWithin(a, b, maxDistance) {
        if (a === b) return 0;
        if (Math.abs(a.length - b.length) > maxDistance) return Infinity;

        const n = b.length;
        let prevRow = new Array(n + 1);
        for (let j = 0; j <= n; j++) prevRow[j] = j;

        for (let i = 1; i <= a.length; i++) {
            const currRow = new Array(n + 1);
            currRow[0] = i;
            let rowMin = currRow[0];
            for (let j = 1; j <= n; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                currRow[j] = Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + cost);
                if (currRow[j] < rowMin) rowMin = currRow[j];
            }
            if (rowMin > maxDistance) return Infinity;
            prevRow = currRow;
        }

        return prevRow[n] <= maxDistance ? prevRow[n] : Infinity;
    }

    /*
     * Reordered multi-word match: "Honor Panzer" -> "Panzer of Honor".
     * Every query word must find its own, not-yet-used name word (via
     * exact/prefix/substring/typo-tolerant comparison) for this to
     * count as a match at all — a single unmatched query word means the
     * whole thing falls through to the plain subsequence/typo tiers
     * below instead of a false-positive partial credit.
     */
    function scoreTokens(nameNorm, queryNorm) {
        const nameTokens = tokenizeNorm(nameNorm);
        const queryTokens = tokenizeNorm(queryNorm);

        const used = new Set();
        let total = 0;

        for (const queryToken of queryTokens) {
            let best = 0;
            let bestIndex = -1;

            for (let i = 0; i < nameTokens.length; i++) {
                if (used.has(i)) continue;
                const nameToken = nameTokens[i];
                let score = 0;

                if (nameToken === queryToken) {
                    score = 1000;
                } else if (nameToken.startsWith(queryToken)) {
                    score = 800;
                } else if (nameToken.includes(queryToken)) {
                    score = 600;
                } else {
                    const distance = editDistanceWithin(nameToken, queryToken, typoToleranceFor(queryToken.length));
                    if (distance !== Infinity) {
                        score = 300 - distance * 80;
                    }
                }

                if (score > best) {
                    best = score;
                    bestIndex = i;
                }
            }

            if (best <= 0) {
                return 0;
            }
            used.add(bestIndex);
            total += best;
        }

        // Scaled below a literal substring hit (up to 6000) but above the
        // flat fuzzy-subsequence tier (3000-3900): matching every word of
        // a query against the name, just in a different order, is a much
        // stronger signal than an arbitrary scattered-letters subsequence.
        return 4000 + Math.min(900, total);
    }

    function scoreMatch(nameNorm, queryNorm) {
        if (!nameNorm || !queryNorm) {
            return 0;
        }

        if (nameNorm === queryNorm) {
            return 10000;
        }

        if (nameNorm.startsWith(queryNorm)) {
            return 8000;
        }

        const index = nameNorm.indexOf(queryNorm);
        if (index !== -1) {
            return 6000 - index;
        }

        // Only worth tokenizing when the query itself has more than one
        // word: a single-word query against a multi-word name is already
        // covered by the substring check above (nameNorm keeps its
        // spaces, so "panzer" is a substring of "panzer of honor").
        if (queryNorm.includes(' ')) {
            const tokenScore = scoreTokens(nameNorm, queryNorm);
            if (tokenScore > 0) {
                return tokenScore;
            }
        }

        // Fuzzy subsequence: "pelu" -> "Peluriano". Tighter matches (the
        // matched letters closer together in the name) score higher than
        // loose ones scattered across a long name, so among many
        // subsequence hits the closest-looking name still wins instead of
        // ties silently falling back to array order.
        let position = 0;
        let firstIndex = -1;
        for (let i = 0; i < nameNorm.length; i++) {
            if (nameNorm[i] === queryNorm[position]) {
                if (position === 0) firstIndex = i;
                position++;
                if (position === queryNorm.length) {
                    const span = i - firstIndex + 1;
                    return 3000 + Math.round((queryNorm.length / span) * 900);
                }
            }
        }

        // Typo tolerance: a wrong/missing/extra letter that breaks the
        // ordered-subsequence property above (e.g. a transposition like
        // "Naploi" vs "Napoli") still returns a low-ranked match instead
        // of vanishing entirely.
        const distance = editDistanceWithin(nameNorm, queryNorm, typoToleranceFor(queryNorm.length));
        if (distance !== Infinity) {
            return 1500 - distance * 300;
        }

        return 0;
    }

    /*
     * ============================================================
     * COORDINATES
     * ============================================================
     */

    function parseCoordinates(query) {
        const match = query.match(/^\s*(\d{1,3})\s*[:,]\s*(\d{1,3})\s*$/);
        if (!match) {
            return null;
        }
        return { x: Number(match[1]), y: Number(match[2]) };
    }

    function getSea(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
        const oceanX = Math.floor(Math.max(0, Math.min(999, x)) / 100);
        const oceanY = Math.floor(Math.max(0, Math.min(999, y)) / 100);
        return `M${oceanY}${oceanX}`;
    }

    /*
     * ============================================================
     * DATA LOADING
     * ============================================================
     *
     * /data/players.txt, /data/alliances.txt, /data/towns.txt and
     * /data/islands.txt are same-origin (same world subdomain as
     * /game/index), so a plain `fetch` is enough: no need for
     * GM_xmlhttpRequest or @connect, and we avoid the complexity of
     * manually decompressing gzip. All four are loaded in parallel
     * once on startup.
     */

    // Same-origin as these requests are, a stalled/hanging connection
    // (bad wifi, a proxy holding the socket open, etc.) would otherwise
    // leave state.loading stuck forever with no way out short of
    // reloading the whole game page: the footer's Ctrl+R/refresh button
    // is itself disabled while state.loading is true. An explicit abort
    // guarantees loadAll()'s catch branch always runs eventually.
    const FETCH_TIMEOUT_MS = 20000;

    function fetchText(path, timeoutMs) {
        const url = `https://${WORLD}.grepolis.com${path}`;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller
            ? setTimeout(() => controller.abort(), timeoutMs || FETCH_TIMEOUT_MS)
            : null;

        return fetch(url, { credentials: 'same-origin', signal: controller ? controller.signal : undefined })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} on ${path}`);
                }
                return response.text();
            })
            .catch((error) => {
                if (error && error.name === 'AbortError') {
                    throw new Error(`Timed out fetching ${path}`);
                }
                throw error;
            })
            .finally(() => {
                if (timeoutId) clearTimeout(timeoutId);
            });
    }

    function indexPlayers(players) {
        DATA.players = players;
        DATA.playerById = new Map(players.map((player) => [player.id, player]));
    }

    function indexAlliances(alliances) {
        DATA.alliances = alliances;
        DATA.allianceById = new Map(alliances.map((alliance) => [alliance.id, alliance]));
    }

    // Grid cell size (in world tiles) used to bucket islands for >near's
    // spatial lookup: a large world can have tens of thousands of
    // distinct island coordinates, and scanning every single one of
    // them on every keystroke while typing a radius is the most
    // expensive command in the file. Buckets let a given search only
    // touch the handful of cells that could possibly fall within the
    // requested radius, instead of the whole world.
    const NEAR_BUCKET_SIZE = 10;

    function bucketKeyFor(x, y) {
        return `${Math.floor(x / NEAR_BUCKET_SIZE)}:${Math.floor(y / NEAR_BUCKET_SIZE)}`;
    }

    function indexTowns(towns) {
        DATA.towns = towns;
        DATA.townById = new Map();
        DATA.townsByCoord = new Map();
        DATA.townsByPlayer = new Map();
        // Precomputed once here instead of recomputing getSea() for
        // every town on every >ocean keystroke: townsInOcean() then
        // becomes a single Map lookup instead of a full O(all towns)
        // linear scan.
        DATA.townsByOcean = new Map();

        for (const town of DATA.towns) {
            DATA.townById.set(town.id, town);

            // islandX:islandY is the ISLAND coordinate, not the town's
            // exact position: a single island can host up to 20 towns,
            // so several towns share the same key. We keep a list per
            // island; a lone town on its island is then the only case
            // where coordinates resolve to a single, unambiguous town.
            const coordKey = `${town.islandX}:${town.islandY}`;
            if (!DATA.townsByCoord.has(coordKey)) {
                DATA.townsByCoord.set(coordKey, []);
            }
            DATA.townsByCoord.get(coordKey).push(town);

            if (!DATA.townsByPlayer.has(town.playerId)) {
                DATA.townsByPlayer.set(town.playerId, []);
            }
            DATA.townsByPlayer.get(town.playerId).push(town);

            const ocean = getSea(town.islandX, town.islandY);
            if (!DATA.townsByOcean.has(ocean)) {
                DATA.townsByOcean.set(ocean, []);
            }
            DATA.townsByOcean.get(ocean).push(town);
        }

        // Spatial index for >near: one entry per distinct island
        // coordinate (reusing the town lists already grouped above),
        // grouped into NEAR_BUCKET_SIZE x NEAR_BUCKET_SIZE grid cells.
        DATA.islandsByBucket = new Map();
        for (const [key, coordTowns] of DATA.townsByCoord) {
            const [x, y] = key.split(':').map(Number);
            const bucket = bucketKeyFor(x, y);
            if (!DATA.islandsByBucket.has(bucket)) {
                DATA.islandsByBucket.set(bucket, []);
            }
            DATA.islandsByBucket.get(bucket).push({ x, y, towns: coordTowns });
        }
    }

    /*
     * Only used to resolve the internal island id that Grepolis'
     * own [island]id[/island] BBCode expects (confirmed against the
     * game's own "Island info" window: it is a numeric id, not the
     * "x:y" pair used everywhere else in this script). Indexed by
     * "x:y" since that is how every island is already looked up.
     */
    function indexIslands(islands) {
        DATA.islandIdByCoord = new Map();
        // island.capacity is islands.txt's "phase" field: the max
        // number of towns the game allows on this specific islet.
        // Confirmed empirically against a live world: it matches the
        // current town count on ~78% of islands and is >= it almost
        // everywhere else (an island not yet fully colonized), so it
        // is safe to use as "slots available", not as a fixed island
        // "growth stage" as the field name in the raw dump implies.
        DATA.islandCapacityByCoord = new Map();
        for (const island of islands) {
            const key = `${island.x}:${island.y}`;
            DATA.islandIdByCoord.set(key, island.id);
            DATA.islandCapacityByCoord.set(key, island.capacity);
        }
    }

    /*
     * Parsing /data/*.txt line-by-line is cheap per line, but a large
     * world's towns.txt alone can have tens of thousands of rows, and
     * doing all of them back-to-back in one synchronous pass blocks
     * the whole browser tab (not just the palette) right after the
     * network fetch resolves. Yielding every PARSE_CHUNK_SIZE lines via
     * requestAnimationFrame spreads that work across frames instead,
     * so the tab stays responsive (and the loading spinner keeps
     * animating) while a cold cache-miss load parses a big world.
     */
    const PARSE_CHUNK_SIZE = 3000;

    function yieldToMainThread() {
        return new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve());
            } else {
                setTimeout(resolve, 0);
            }
        });
    }

    async function parseLinesChunked(text, parseLine) {
        const lines = text.split(/\r?\n/);
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line) {
                const item = parseLine(line);
                if (item) out.push(item);
            }
            if (i % PARSE_CHUNK_SIZE === PARSE_CHUNK_SIZE - 1) {
                await yieldToMainThread();
            }
        }
        return out;
    }

    function parsePlayerLine(line) {
        const parts = line.split(',');
        if (parts.length < 2) return null;

        const id = Number(parts[0]);
        if (!id) return null;

        const name = decodeName(parts[1]);

        return {
            id,
            name,
            nameNorm: normalize(name),
            allianceId: parts[2] ? Number(parts[2]) : null,
            points: Number(parts[3]) || 0,
            rank: Number(parts[4]) || 0,
            towns: Number(parts[5]) || 0,
        };
    }

    function parsePlayers(text) {
        return parseLinesChunked(text, parsePlayerLine);
    }

    function parseAllianceLine(line) {
        const parts = line.split(',');
        if (parts.length < 2) return null;

        const id = Number(parts[0]);
        if (!id) return null;

        const name = decodeName(parts[1]);

        return {
            id,
            name,
            nameNorm: normalize(name),
            points: Number(parts[2]) || 0,
            towns: Number(parts[3]) || 0,
            members: Number(parts[4]) || 0,
            rank: Number(parts[5]) || 0,
        };
    }

    function parseAlliances(text) {
        return parseLinesChunked(text, parseAllianceLine);
    }

    function parseTownLine(line) {
        const parts = line.split(',');
        if (parts.length < 7) return null;

        const id = Number(parts[0]);
        if (!id) return null;

        const playerId = Number(parts[1]);
        const name = decodeName(parts[2]);

        return {
            id,
            playerId,
            name,
            nameNorm: normalize(name),
            islandX: Number(parts[3]),
            islandY: Number(parts[4]),
            numberOnIsland: Number(parts[5]),
            points: Number(parts[6]) || 0,
        };
    }

    function parseTowns(text) {
        return parseLinesChunked(text, parseTownLine);
    }

    /*
     * islands.txt rows: id,x,y,type,phase,resource1,resource2. "type"
     * is the islet's shape layout (unused here); "phase" is its town
     * capacity (see indexIslands for how that was confirmed).
     */
    function parseIslandLine(line) {
        const parts = line.split(',');
        if (parts.length < 3) return null;

        const id = Number(parts[0]);
        if (!id) return null;

        return {
            id,
            x: Number(parts[1]),
            y: Number(parts[2]),
            capacity: Number(parts[4]) || 0,
        };
    }

    function parseIslands(text) {
        return parseLinesChunked(text, parseIslandLine);
    }

    /*
     * conquers.txt rows: town_id,timestamp(unix seconds),new_owner_id,
     * old_owner_id,new_alliance_id,old_alliance_id,points_at_conquest.
     * old_owner_id is empty for a colonization (a brand-new town, not
     * a conquest). Confirmed against a live world: the file is
     * already chronological (oldest first) and covers the entire
     * world's history, so no client-side snapshotting is needed to
     * get a real "who owned this town and when" timeline. NOTE: a
     * town becoming a ghost (abandoned) is NOT its own event here —
     * only actual conquests/colonizations are logged, so the last
     * event for a currently-ghost town is when it was last taken,
     * not when it was abandoned.
     */
    function parseConquers(text) {
        const eventsByTown = new Map();
        let total = 0;

        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;

            const parts = line.split(',');
            if (parts.length < 7) continue;

            const townId = Number(parts[0]);
            const ts = Number(parts[1]);
            if (!townId || !Number.isFinite(ts)) continue;

            const event = {
                ts: ts * 1000,
                newOwnerId: parts[2] ? Number(parts[2]) : 0,
                oldOwnerId: parts[3] ? Number(parts[3]) : 0,
                newAllianceId: parts[4] ? Number(parts[4]) : 0,
                oldAllianceId: parts[5] ? Number(parts[5]) : 0,
                points: Number(parts[6]) || 0,
            };

            if (!eventsByTown.has(townId)) {
                eventsByTown.set(townId, []);
            }
            eventsByTown.get(townId).push(event);
            total++;
        }

        return { eventsByTown, total };
    }

    /*
     * ============================================================
     * LOCAL CACHE (IndexedDB)
     * ============================================================
     *
     * The world dumps are plain files that only change through
     * Grepolis restarts, so re-downloading three +5MB files (the
     * towns list alone is ~4.8MB) on every pageload is wasteful.
     * Cached per world in IndexedDB (localStorage can't hold the
     * tens of thousands of towns), with a generous TTL. The parsed
     * arrays are stored, never the Maps: re-indexing a few hundred
     * thousand entries only costs some milliseconds and spares us
     * from storing IndexedDB-incompatible Map objects. All helper
     * promises swallow errors: the cache is an optimization, and a
     * corrupted/unavailable store must degrade to a network load.
     */

    const DB_NAME = 'qf-cache-v1';
    const DB_STORE = 'worlds';
    // Added in v2.13.0 for conquers.txt (see CONQUEST HISTORY below).
    // Bumping the shared DB's version here (not a separate database)
    // so both stores are created/upgraded through the same onupgradeneeded
    // handler — IndexedDB rejects opening the same DB_NAME at version 1
    // once anything has opened it at version 2, so there can only be one
    // "current" version number for this whole DB_NAME across the file.
    const CONQUEST_STORE = 'conquests';
    const DB_VERSION = 2;

    function cacheKey() {
        return `qfi:${WORLD}`;
    }

    function idbOpen() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(DB_STORE)) {
                    db.createObjectStore(DB_STORE, { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains(CONQUEST_STORE)) {
                    db.createObjectStore(CONQUEST_STORE, { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function cacheGet() {
        return idbOpen()
            .then((db) => new Promise((resolve, reject) => {
                const tx = db.transaction(DB_STORE, 'readonly');
                const request = tx.objectStore(DB_STORE).get(cacheKey());
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            }))
            .catch(() => null);
    }

    function cacheSet(players, alliances, towns, islands) {
        return idbOpen()
            .then((db) => new Promise((resolve, reject) => {
                const tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).put({
                    key: cacheKey(),
                    savedAt: Date.now(),
                    players,
                    alliances,
                    towns,
                    islands,
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            }))
            .catch(() => null);
    }

    function cacheDelete() {
        return idbOpen()
            .then((db) => new Promise((resolve, reject) => {
                const tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).delete(cacheKey());
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            }))
            .catch(() => null);
    }

    function applyLoadedData(source, players, alliances, towns, islands, savedAt) {
        indexPlayers(players);
        indexAlliances(alliances);
        indexTowns(towns);
        indexIslands(islands);
        state.savedAt = savedAt || Date.now();
        state.dataSource = source;
        state.loaded = true;
        state.loadError = null;

        console.info(
            `[QF] Data loaded (${source}): ${players.length} players, ` +
            `${alliances.length} alliances, ${towns.length} towns, ${islands.length} islands.`
        );
    }

    function finishLoad() {
        // A query typed while the index was still loading was
        // discarded by performSearch() (it had nothing to search
        // against yet). Re-run it now that the index is ready, so
        // the user doesn't see a spurious "No results found."
        if (state.query) {
            performSearch(state.query, ++searchToken);
        } else if (state.open) {
            performSearch('', ++searchToken);
        } else {
            render();
        }
    }

    /*
     * Classifies a caught load error into one of a small set of
     * translation keys instead of surfacing the raw error.message
     * (an English, technical string like "HTTP 404 on /data/towns.txt"
     * or "Timed out fetching...") directly inside an otherwise fully
     * localized UI. The full untranslated detail is still logged to
     * the console for whoever actually needs to debug it.
     */
    function classifyLoadError(error) {
        const message = error && error.message ? error.message : String(error);
        if (/^Timed out fetching/.test(message)) {
            return 'errorLoadingDataTimeout';
        }
        return 'errorLoadingDataGeneric';
    }

    async function loadAll(force) {
        if (state.loaded || state.loading) {
            return;
        }

        if (!WORLD) {
            state.loadError = 'errorLoadingDataWorldNotDetected';
            return;
        }

        state.loading = true;
        render();

        try {
            if (!force) {
                const cached = await cacheGet();
                // cached.islands is only present once a user has loaded the
                // world after islands.txt support was added: older cache
                // entries are treated as stale so the BBCode island lookup
                // has data to work with instead of silently staying empty.
                if (cached && cached.savedAt && cached.islands && Date.now() - cached.savedAt < CONFIG.CACHE_TTL) {
                    applyLoadedData('cache', cached.players || [], cached.alliances || [], cached.towns || [], cached.islands || [], cached.savedAt);
                    state.loading = false;
                    finishLoad();
                    return;
                }
            }

            const [playersText, alliancesText, townsText, islandsText] = await Promise.all([
                fetchText('/data/players.txt'),
                fetchText('/data/alliances.txt'),
                fetchText('/data/towns.txt'),
                fetchText('/data/islands.txt'),
            ]);

            // Chunked/async so a large world's parse doesn't block the
            // tab in one long synchronous pass (see PARSE_CHUNK_SIZE).
            const players = await parsePlayers(playersText);
            const alliances = await parseAlliances(alliancesText);
            const towns = await parseTowns(townsText);
            const islands = await parseIslands(islandsText);

            applyLoadedData('network', players, alliances, towns, islands, Date.now());
            cacheSet(players, alliances, towns, islands); // fire-and-forget; failures are ignored
            state.loading = false;
            finishLoad();
        } catch (error) {
            state.loadError = classifyLoadError(error);
            console.error('[QF] Error loading world data:', error);
            state.loading = false;
            render();
        }
    }

    /*
     * Drops the cached copy and reloads everything from the network.
     * This is what Ctrl+R inside the palette triggers; it exists so
     * fresh data (players/new towns) can be picked up without
     * waiting for the TTL or reloading the game page.
     */
    async function refreshData() {
        if (!WORLD) {
            return;
        }
        await cacheDelete();
        state.loaded = false;
        state.savedAt = 0;
        state.dataSource = null;
        await loadAll(true);
    }

    /*
     * ============================================================
     * CONQUEST HISTORY (/data/conquers.txt) — opt-in
     * ============================================================
     *
     * Powers >history. Kept fully separate from loadAll()/DATA above:
     * conquers.txt is several MB even on a young world and grows
     * without bound as a world ages, so it is only fetched once the
     * user opts in via Settings (settings.conquestHistoryEnabled),
     * never as part of the automatic startup load. Cached via the
     * same idbOpen()/DB_NAME as the main cache, in its own object
     * store (CONQUEST_STORE, declared above), with the same
     * cache-key-per-world pattern.
     */

    function conquestCacheGet() {
        return idbOpen()
            .then((db) => new Promise((resolve, reject) => {
                const tx = db.transaction(CONQUEST_STORE, 'readonly');
                const request = tx.objectStore(CONQUEST_STORE).get(cacheKey());
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            }))
            .catch(() => null);
    }

    /*
     * Stored as the raw eventsByTown Map converted to an array of
     * [townId, events[]] pairs: IndexedDB can persist Maps directly in
     * modern browsers, but round-tripping through a plain array is
     * the same approach already used for players/alliances/towns
     * above (structured-cloned either way; this keeps the shape
     * consistent and trivially inspectable in DevTools).
     */
    function conquestCacheSet(eventsByTown, total) {
        return idbOpen()
            .then((db) => new Promise((resolve, reject) => {
                const tx = db.transaction(CONQUEST_STORE, 'readwrite');
                tx.objectStore(CONQUEST_STORE).put({
                    key: cacheKey(),
                    savedAt: Date.now(),
                    total,
                    events: [...eventsByTown.entries()],
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            }))
            .catch(() => null);
    }

    function applyConquestData(eventsByTown, total) {
        CONQUEST.eventsByTown = eventsByTown;
        CONQUEST.totalEvents = total;
        CONQUEST.loaded = true;
        console.info(`[QF] Conquest history loaded: ${total} events across ${eventsByTown.size} towns.`);
    }

    /*
     * Loads conquers.txt (cache-first, same TTL policy as the main
     * loadAll), entirely independent of DATA/state.loaded: >history
     * works as soon as this resolves, whether or not it happens
     * before or after the main world data finishes loading. Silent
     * on failure (mirrors loadAll's own network fetches) — a failed
     * conquest-history load just means >history reports no data
     * instead of breaking anything else.
     */
    async function loadConquestHistory(force) {
        if (!WORLD || CONQUEST.loaded || CONQUEST.loading) {
            return;
        }

        CONQUEST.loading = true;

        try {
            if (!force) {
                const cached = await conquestCacheGet();
                if (cached && cached.savedAt && Date.now() - cached.savedAt < CONFIG.CONQUEST_HISTORY_CACHE_TTL) {
                    applyConquestData(new Map(cached.events || []), cached.total || 0);
                    CONQUEST.loading = false;
                    if (state.open) render();
                    return;
                }
            }

            const text = await fetchText('/data/conquers.txt');
            const { eventsByTown, total } = parseConquers(text);
            applyConquestData(eventsByTown, total);
            conquestCacheSet(eventsByTown, total); // fire-and-forget
            CONQUEST.loading = false;
            if (state.open) render();
        } catch (error) {
            console.error('[QF] Error loading conquest history:', error);
            CONQUEST.loading = false;
        }
    }

    /*
     * ============================================================
     * SEARCH (synchronous, over the index already loaded in memory)
     * ============================================================
     */

    function searchPlayers(queryNorm) {
        const out = [];
        for (const player of DATA.players) {
            const score = scoreMatch(player.nameNorm, queryNorm);
            if (score > 0) {
                out.push({ type: 'player', id: player.id, name: player.name, score, data: player });
            }
        }
        return out;
    }

    function searchAlliances(queryNorm) {
        const out = [];
        for (const alliance of DATA.alliances) {
            const score = scoreMatch(alliance.nameNorm, queryNorm);
            if (score > 0) {
                out.push({ type: 'alliance', id: alliance.id, name: alliance.name, score, data: alliance });
            }
        }
        return out;
    }

    function searchTowns(queryNorm) {
        const out = [];
        for (const town of DATA.towns) {
            const score = scoreMatch(town.nameNorm, queryNorm);
            if (score > 0) {
                out.push(townResult(town, { score }));
            }
        }
        return out;
    }

    function townsOnIsland(x, y) {
        return DATA.townsByCoord.get(`${x}:${y}`) || [];
    }

    function allianceOfPlayer(player) {
        if (!player || !player.allianceId) return null;
        return DATA.allianceById.get(player.allianceId) || null;
    }

    /*
     * Player/alliance names are resolved lazily (only when a town row
     * is actually rendered) instead of on every matching town at
     * search time: a free-text search over tens of thousands of
     * towns can match thousands of rows, and only ~40 are ever drawn
     * at once, so eagerly doing two Map lookups per match wastes
     * work that scales with the full result set instead of with what
     * the user actually sees.
     */
    function townResult(town, extra) {
        return Object.assign({
            type: 'town',
            id: town.id,
            name: town.name,
            score: town.points,
            x: town.islandX,
            y: town.islandY,
            playerId: town.playerId,
            data: town,
        }, extra || {});
    }

    /*
     * Resolves the {playerName, allianceName} pair for a town row at
     * render time, from item.data when available (the common case)
     * or by looking up item.playerId (history/favorites snapshots
     * that predate a page reload of the index).
     */
    function townOwnerNames(item) {
        const playerId = item.data ? item.data.playerId : item.playerId;
        const player = playerId ? DATA.playerById.get(playerId) : null;
        const alliance = allianceOfPlayer(player);
        return {
            playerName: player ? player.name : '',
            allianceName: alliance ? alliance.name : '',
        };
    }

    /*
     * Most recent conquers.txt event for a town, or null when conquest
     * history isn't loaded/enabled or the town has no recorded event
     * (possible on very young worlds/towns). The file is already
     * chronological, so the last array entry is the most recent one.
     */
    function lastConquestEvent(townId) {
        if (!CONQUEST.loaded || !townId) return null;
        const events = CONQUEST.eventsByTown.get(townId);
        return events && events.length ? events[events.length - 1] : null;
    }

    /*
     * An island is not a row in the dump. It is every town that shares
     * the same island coordinate, which is the unit a player actually
     * looks at when scouting a spot.
     */
    function islandRow(x, y) {
        const towns = townsOnIsland(x, y).slice().sort((a, b) => b.points - a.points);
        const alliances = new Set();
        let ghosts = 0;
        for (const town of towns) {
            if (!town.playerId) {
                ghosts++;
                continue;
            }
            const player = DATA.playerById.get(town.playerId);
            const alliance = allianceOfPlayer(player);
            alliances.add(alliance ? alliance.id : `p:${town.playerId}`);
        }
        return {
            type: 'island',
            id: `${x}:${y}`,
            name: `${x}:${y}`,
            score: 16000,
            x,
            y,
            islandId: DATA.islandIdByCoord.get(`${x}:${y}`),
            townCount: towns.length,
            capacity: DATA.islandCapacityByCoord.get(`${x}:${y}`) || 0,
            allianceCount: alliances.size,
            ghostCount: ghosts,
            towns,
        };
    }

    /*
     * Plain single-coordinate row with no cross-town aggregation
     * (no townCount/allianceCount/ghostCount). Used both for empty
     * coordinates and as the non-Curator fallback for coordinates
     * that resolve to a multi-town island, since the island summary
     * itself is aggregate data gated behind isCuratorActive().
     */
    function plainCoordinateResult(x, y, score) {
        return { type: 'coordinate', name: `${x}:${y}`, x, y, score };
    }

    function searchCoordinates(rawQuery) {
        const coords = parseCoordinates(rawQuery);
        if (!coords) {
            return null;
        }

        const matching = townsOnIsland(coords.x, coords.y);
        if (matching.length === 1) {
            return townResult(matching[0], { score: 20000 });
        }
        if (matching.length > 1) {
            if (!isCuratorActive()) {
                return plainCoordinateResult(coords.x, coords.y, 15000);
            }
            return islandRow(coords.x, coords.y);
        }

        return plainCoordinateResult(coords.x, coords.y, 15000);
    }

    /*
     * Recounts how many results fall into each segment. The counts
     * are what make the Tab cycle and the chip badges work: a chip is
     * only reachable when its segment has at least one row.
     */
    function computeCounts(results) {
        const counts = { [CONFIG.DEFAULT_SEGMENT]: results.length };
        for (const name of CONFIG.SEGMENTS.slice(1)) {
            counts[name] = 0;
        }
        for (const item of results) {
            if (item.type in counts) {
                counts[item.type]++;
            }
        }
        return counts;
    }

    function applySegment() {
        if (state.detail || state.segment === CONFIG.DEFAULT_SEGMENT) {
            state.results = state.fullResults;
        } else {
            state.results = state.fullResults.filter((item) => item.type === state.segment);
        }
        state.selected = 0;
        state.visibleCount = CONFIG.RESULTS_PAGE_SIZE;
    }

    function setSegment(name) {
        state.segment = CONFIG.SEGMENTS.includes(name) ? name : CONFIG.DEFAULT_SEGMENT;
        applySegment();
        render();
    }

    function cycleSegment(direction) {
        if (!state.query || !state.fullResults.length || !state.segmentCounts) {
            return;
        }
        const available = CONFIG.SEGMENTS.filter(
            (name) => name === CONFIG.DEFAULT_SEGMENT || state.segmentCounts[name] > 0
        );
        if (available.length < 2) {
            return;
        }
        const index = available.indexOf(state.segment);
        state.segment = available[(index + direction + available.length) % available.length];
        applySegment();
        render();
    }

    function islandDistance(a, b) {
        return Math.round(Math.hypot(a.x - b.x, a.y - b.y));
    }

    /*
     * Coordinates of the player's active city, used as the implicit
     * origin of `>dist`. Grepolis exposes the active town both on
     * Layout.activeCityId (modern client) and Game.town_id (legacy);
     * in a harness/testing page neither exists, so this returns null
     * and the command falls back to asking for two coordinates.
     */
    function activeTownCoords() {
        try {
            let townId = null;
            if (GP.Game && Number.isFinite(Number(GP.Game.townId))) {
                townId = Number(GP.Game.townId);
            } else if (GP.ITowns && typeof GP.ITowns.getCurrentTown === 'function') {
                const current = GP.ITowns.getCurrentTown();
                if (current && current.id) townId = Number(current.id);
            } else if (GP.Game && Number.isFinite(Number(GP.Game.town_id))) {
                townId = Number(GP.Game.town_id);
            } else if (GP.Layout && GP.Layout.activeCityId) {
                townId = Number(GP.Layout.activeCityId);
            }
            if (!townId) return null;
            const town = DATA.townById.get(townId);
            return town ? { x: town.islandX, y: town.islandY } : null;
        } catch (_) {
            return null;
        }
    }

    /*
     * Origin actually used by >dist/>near/>ghost near/>travel and the
     * distance columns: a manually pinned origin (Ctrl+O / the per-row
     * "set as origin" icon, see ORIGIN OVERRIDE above) wins over the
     * active city; falling back to activeTownCoords() keeps every
     * existing call site working unchanged when no override is set.
     */
    function effectiveOrigin() {
        return loadOriginOverride() || activeTownCoords();
    }

    /*
     * True when `coords` matches one of the player's own towns (per
     * DATA.townsByPlayer keyed by the client's own player id) — used
     * by >travel to warn when the pinned/active origin isn't a city
     * whose research/building bonuses can actually be read, instead
     * of silently mixing bonuses from the wrong city.
     */
    function originIsOwnTown(coords) {
        if (!coords) return false;
        const towns = townsOnIsland(coords.x, coords.y);
        try {
            const ownId = GP.Game && Number.isFinite(Number(GP.Game.player_id)) ? Number(GP.Game.player_id) : null;
            if (!ownId) return false;
            return towns.some((town) => town.playerId === ownId);
        } catch (_) {
            return false;
        }
    }

    /*
     * ============================================================
     * PREMIUM GATING (Administrator/Curator advisor)
     * ============================================================
     *
     * Multi-city aggregation/listing views (>ghost, >island, >near,
     * >ocean, the player/alliance town drill-down, and the hierarchy
     * detail pane's Alliance->Player/Player->Town/Island->Town levels,
     * see pushHierarchyLevel) mirror the in-game Administrator
     * advisor's overviews, so they are gated behind
     * GameDataPremium.isAdvisorActivated('curator') the same way the
     * real advisor gates its own overviews. Plain single-item search
     * (player/alliance/town by name, single coordinate) is unaffected:
     * that data is already public via the same-origin /data/*.txt
     * dumps regardless of premium status.
     */
    function isCuratorActive() {
        try {
            return !!(
                GP.GameDataPremium &&
                typeof GP.GameDataPremium.isAdvisorActivated === 'function' &&
                GP.GameDataPremium.isAdvisorActivated('curator')
            );
        } catch (_) {
            return false;
        }
    }

    function premiumRequiredRows() {
        return [{ type: 'info', name: translate('premiumRequired') }];
    }

    function distanceBand(distance) {
        if (distance <= 0) return translate('distBandSame');
        if (distance <= 2) return translate('distBandAdjacent');
        if (distance <= 5) return translate('distBandRegional');
        return translate('distBandFar');
    }

    function distRows(rawArgs) {
        const parsePair = (token) => {
            const match = String(token).match(/(\d{1,3})\s*[:;]\s*(\d{1,3})/);
            return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
        };

        const matched = String(rawArgs).match(/\d{1,3}\s*[:;]\s*\d{1,3}/g) || [];

        let from = null;
        let to = null;
        let originLabel = '';

        if (matched.length >= 2) {
            from = parsePair(matched[0]);
            to = parsePair(matched[1]);
            // 3+ coordinates: treat the first as origin and report the
            // distance to every remaining destination, instead of only
            // ever comparing a single pair.
            if (matched.length > 2) {
                const rows = [];
                const seas = getSea(from.x, from.y);
                for (let i = 1; i < matched.length; i++) {
                    const dest = parsePair(matched[i]);
                    if (!dest) continue;
                    const distance = islandDistance(from, dest);
                    const destSeas = getSea(dest.x, dest.y) === seas ? seas : `${seas} \u2192 ${getSea(dest.x, dest.y)}`;
                    rows.push({
                        type: 'info',
                        name: `${from.x}:${from.y} \u2192 ${dest.x}:${dest.y} \u00b7 ${destSeas} \u00b7 ${translate('distResult', { n: distance })} \u00b7 ${distanceBand(distance)}`,
                    });
                }
                return rows.length ? rows : [{ type: 'info', name: translate('distNeedOrigin') }];
            }
        } else {
            const origin = effectiveOrigin();
            if (origin) {
                from = origin;
                to = matched.length === 1 ? parsePair(matched[0]) : null;
                if (to) {
                    originLabel = ` (${translate(loadOriginOverride() ? 'distFromOrigin' : 'distFromActive')})`;
                }
            }
        }

        if (!from || !to) {
            return [{ type: 'info', name: translate('distNeedOrigin') }];
        }

        const distance = islandDistance(from, to);
        const seas = getSea(from.x, from.y) === getSea(to.x, to.y)
            ? getSea(from.x, from.y)
            : `${getSea(from.x, from.y)} \u2192 ${getSea(to.x, to.y)}`;
        return [{
            type: 'info',
            name: `${from.x}:${from.y} \u2192 ${to.x}:${to.y} \u00b7 ${seas} \u00b7 ${translate('distResult', { n: distance })} \u00b7 ${distanceBand(distance)}${originLabel}`,
        }];
    }

    /*
     * Ghost towns are towns with playerId 0: abandoned by their
     * player and reclaimable. They are sorted by points (biggest
     * first, mirroring the in-game ghost listings).
     */
    function ghostRows(minPoints, near) {
        const minimum = Number.isFinite(minPoints) ? minPoints : CONFIG.GHOST_MIN_POINTS;
        const origin = near ? effectiveOrigin() : null;
        if (near && !origin) {
            return [{ type: 'info', name: translate('distNeedOrigin') }];
        }

        const towns = DATA.towns.filter((town) => town.playerId === 0 && town.points >= minimum);
        towns.sort((a, b) => {
            if (origin) {
                const left = islandDistance(origin, { x: a.islandX, y: a.islandY });
                const right = islandDistance(origin, { x: b.islandX, y: b.islandY });
                if (left !== right) return left - right;
            }
            return b.points - a.points;
        });

        const picked = towns.slice(0, CONFIG.MAX_RESULTS);
        if (!picked.length) {
            return [{ type: 'info', name: translate('ghostEmpty') }];
        }

        return picked.map((town) => townResult(town, origin ? {
            distance: islandDistance(origin, { x: town.islandX, y: town.islandY }),
        } : null));
    }

    /*
     * ============================================================
     * >travel — troop movement time calculator
     * ============================================================
     *
     * Formula verified directly against the live Grepolis client
     * (game.min.js, UnitOrder.getRuntimes/getUnitSpeed), not a
     * community wiki:
     *
     *   effectiveSpeed = GameData.units[unit].speed   (already
     *     includes the world's Unit Speed multiplier — the client
     *     never stores a separate "base" speed)
     *   seconds = floor(50 * distance / (effectiveSpeed * modifiers)
     *     + Game.constants.units.runtime_setup_time)
     *
     * Modifiers (all read live from GP, never cached, and all
     * optional/defensive — see travelModifiers()):
     *   - generalModifier (both land & naval): the temple's
     *     "Improved troop movement" power, if cast on the reference
     *     city.
     *   - groundModifier (land only): Meteorology research.
     *   - navalModifier (naval only): Cartography research +
     *     Lighthouse building (additive with each other).
     *   - colonize_ship with "Set Sail" research: navalModifier gets
     *     GameData.research_bonus.colony_ship_speed added instead of
     *     the plain naval bonuses (client-verified special case).
     *   - sirens (naval only, manual `sirens=N` argument — the
     *     client has no public API to read a town's siren count
     *     outside an actual attack-planner window): multiplies the
     *     naval speed by 1 + siren_percentage * min(N, siren_limit).
     *
     * A mixed army's travel time is the MAXIMUM of every selected
     * unit's own duration (the slowest unit determines arrival),
     * mirroring UnitOrder.getFinalRuntimes().
     *
     * Explicitly OUT of scope (documented in >help, not silently
     * guessed): hero movement bonuses (Atalanta) and the Olympus
     * Great Temple of Ares +15% all-unit bonus — neither is wired
     * into the client's own modifier pipeline
     * (initializeAvailableModifiers) the way Lighthouse/Meteorology/
     * Cartography/Set Sail/unit_movement_boost are, so there is no
     * verified formula to reproduce them.
     */

    const FLYING_UNITS = new Set(['manticore', 'harpy', 'pegasus', 'griffin', 'ladon']);
    const COLONIZE_SHIP_ID = 'colonize_ship';

    function formatDuration(totalSeconds) {
        const seconds = Math.max(0, Math.floor(totalSeconds));
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const parts = [];
        if (days) parts.push(`${days}d`);
        if (hours || days) parts.push(`${hours}h`);
        if (minutes || hours || days) parts.push(`${minutes}m`);
        if (!days && !hours) parts.push(`${secs}s`);
        return parts.join(' ');
    }

    /*
     * Resolves a Grepolis unit key from user input: either the
     * internal key itself (rider, bireme...) or a case-insensitive
     * match against the unit's display name in the client's own
     * current language (GameData.units[x].name), so `>travel
     * caballero ...` works on an es world without hardcoding any
     * translation table ourselves.
     */
    function resolveUnitKey(token) {
        const wanted = normalize(token);
        if (!wanted) return null;
        try {
            const units = GP.GameData && GP.GameData.units;
            if (!units) return null;
            if (units[token] || units[wanted]) {
                return units[token] ? token : wanted;
            }
            for (const key of Object.keys(units)) {
                if (normalize(units[key].name) === wanted) return key;
            }
        } catch (_) {
            return null;
        }
        return null;
    }

    /*
     * Live modifier state for a given reference town id, read
     * directly from the game client (never cached — researches/
     * buildings/temple powers can change at any time). Returns null
     * on any failure so travelRows() can fall back to "no bonuses"
     * instead of throwing.
     */
    function travelModifiers(townId) {
        try {
            if (!GP.ITowns || typeof GP.ITowns.getTown !== 'function') return null;
            const town = GP.ITowns.getTown(String(townId));
            if (!town) return null;
            const researches = typeof town.getResearches === 'function' ? town.getResearches() : null;
            const buildings = typeof town.getBuildings === 'function' ? town.getBuildings() : null;
            const meteorology = researches && typeof researches.get === 'function' ? Boolean(researches.get('meteorology')) : false;
            const cartography = researches && typeof researches.get === 'function' ? Boolean(researches.get('cartography')) : false;
            const setSail = researches && typeof researches.get === 'function' ? Boolean(researches.get('set_sail')) : false;
            const lighthouse = buildings && typeof buildings.hasBuildingWithLevel === 'function'
                ? Boolean(buildings.hasBuildingWithLevel('lighthouse', 1))
                : false;
            const movementBoost = typeof town.getCastedPower === 'function' ? Boolean(town.getCastedPower('unit_movement_boost')) : false;
            return { meteorology, cartography, setSail, lighthouse, movementBoost };
        } catch (_) {
            return null;
        }
    }

    /*
     * Duration (seconds) for a single unit over `distance` islands,
     * given the live modifier state and manual siren count. Returns
     * null if the unit or its speed can't be resolved.
     */
    function travelUnitSeconds(unitKey, distance, mods, sirens) {
        try {
            const unitDef = GP.GameData && GP.GameData.units && GP.GameData.units[unitKey];
            const setupTime = GP.Game && GP.Game.constants && GP.Game.constants.units
                ? Number(GP.Game.constants.units.runtime_setup_time)
                : null;
            if (!unitDef || !Number.isFinite(unitDef.speed) || unitDef.speed <= 0 || !Number.isFinite(setupTime)) {
                return null;
            }
            const additional = GP.GameData.additional_runtime_modifier || {};
            const researchBonus = GP.GameData.research_bonus || {};

            let generalMod = 1;
            if (mods && mods.movementBoost && Number.isFinite(additional.default_unit_movement_boost)) {
                generalMod += additional.default_unit_movement_boost / 100;
            }

            let scopeMod = 1;
            if (unitDef.is_naval) {
                if (mods && mods.cartography && Number.isFinite(researchBonus.cartography_speed)) {
                    scopeMod += researchBonus.cartography_speed;
                }
                if (mods && mods.lighthouse && Number.isFinite(additional.lighthouse_speed_bonus)) {
                    scopeMod += additional.lighthouse_speed_bonus;
                }
                if (unitKey === COLONIZE_SHIP_ID && mods && mods.setSail && Number.isFinite(researchBonus.colony_ship_speed)) {
                    scopeMod += researchBonus.colony_ship_speed;
                }
                const sirenCount = Number.isFinite(sirens) ? Math.max(0, sirens) : 0;
                if (sirenCount > 0 && Number.isFinite(additional.siren_percentage)) {
                    const cappedSirens = Number.isFinite(additional.siren_limit)
                        ? Math.min(sirenCount, additional.siren_limit)
                        : sirenCount;
                    scopeMod *= 1 + additional.siren_percentage * cappedSirens;
                }
            } else {
                if (mods && mods.meteorology && Number.isFinite(researchBonus.meteorology_speed)) {
                    scopeMod += researchBonus.meteorology_speed;
                }
            }

            const effectiveSpeed = unitDef.speed * generalMod * scopeMod;
            if (!Number.isFinite(effectiveSpeed) || effectiveSpeed <= 0) return null;
            return Math.max(1, Math.floor((50 * distance) / effectiveSpeed + setupTime));
        } catch (_) {
            return null;
        }
    }

    function travelRows(rawArgs) {
        const raw = String(rawArgs || '').trim();
        if (!raw) {
            return [{ type: 'info', name: translate('commandTravelHelp') }];
        }

        const sirenMatch = raw.match(/\bsirens?=(\d+)\b/i);
        const sirens = sirenMatch ? Number(sirenMatch[1]) : 0;
        const withoutSirens = raw.replace(/\bsirens?=\d+\b/i, ' ').trim();

        const coordTokens = withoutSirens.match(/\d{1,3}\s*[:,]\s*\d{1,3}/g) || [];
        let withoutCoords = withoutSirens;
        for (const token of coordTokens) withoutCoords = withoutCoords.replace(token, ' ');
        const unitTokens = withoutCoords.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);

        if (!unitTokens.length) {
            return [{ type: 'info', name: translate('commandTravelHelp') }];
        }

        const unitKeys = [];
        const unknownTokens = [];
        for (const token of unitTokens) {
            const key = resolveUnitKey(token);
            if (key && !unitKeys.includes(key)) unitKeys.push(key);
            else if (!key) unknownTokens.push(token);
        }
        if (unknownTokens.length) {
            return [{ type: 'info', name: translate('travelUnknownUnit', { unit: unknownTokens[0] }) }];
        }
        if (!unitKeys.length) {
            return [{ type: 'info', name: translate('commandTravelHelp') }];
        }

        let from = null;
        let to = null;
        if (coordTokens.length >= 2) {
            from = parseCoordinates(coordTokens[0].replace(/\s+/g, ''));
            to = parseCoordinates(coordTokens[1].replace(/\s+/g, ''));
        } else if (coordTokens.length === 1) {
            from = effectiveOrigin();
            to = parseCoordinates(coordTokens[0].replace(/\s+/g, ''));
        } else {
            from = effectiveOrigin();
        }

        if (!from || !to) {
            return [{ type: 'info', name: translate('distNeedOrigin') }];
        }

        const distance = islandDistance(from, to);

        // Modifiers are read from a real town at the origin coordinate
        // when one belongs to the player (researches/buildings/temple
        // powers are per-city, and only readable for the player's own
        // towns — see originIsOwnTown); otherwise fall back to the
        // active city, and warn that the result may not reflect the
        // pinned origin's actual bonuses.
        let refTownId = null;
        let usedFallbackCity = false;
        const ownTowns = townsOnIsland(from.x, from.y);
        try {
            const ownId = GP.Game && Number.isFinite(Number(GP.Game.player_id)) ? Number(GP.Game.player_id) : null;
            const ownTown = ownId ? ownTowns.find((town) => town.playerId === ownId) : null;
            if (ownTown) {
                refTownId = ownTown.id;
            } else if (GP.Game && Number.isFinite(Number(GP.Game.townId))) {
                refTownId = Number(GP.Game.townId);
                usedFallbackCity = true;
            }
        } catch (_) {
            refTownId = null;
        }

        const mods = refTownId ? travelModifiers(refTownId) : null;

        const results = [];
        for (const unitKey of unitKeys) {
            const seconds = travelUnitSeconds(unitKey, distance, mods, sirens);
            const unitDef = GP.GameData.units[unitKey];
            results.push({ unitKey, name: unitDef ? unitDef.name : unitKey, seconds });
        }

        const resolvable = results.filter((r) => Number.isFinite(r.seconds));
        if (!resolvable.length) {
            return [{ type: 'info', name: translate('travelCalcFailed') }];
        }

        const slowest = resolvable.reduce((worst, r) => (r.seconds > worst.seconds ? r : worst), resolvable[0]);
        const seas = getSea(from.x, from.y) === getSea(to.x, to.y)
            ? getSea(from.x, from.y)
            : `${getSea(from.x, from.y)} \u2192 ${getSea(to.x, to.y)}`;

        const rows = [{
            type: 'info',
            name: `${from.x}:${from.y} \u2192 ${to.x}:${to.y} \u00b7 ${seas} \u00b7 ${translate('distResult', { n: distance })} \u00b7 ${formatDuration(slowest.seconds)}`,
        }];

        if (resolvable.length > 1) {
            rows.push({
                type: 'info',
                name: translate('travelLimitedBy', { unit: slowest.name }),
            });
            for (const r of resolvable) {
                rows.push({ type: 'info', name: `${r.name}: ${formatDuration(r.seconds)}` });
            }
        }

        if (slowest.unitKey === COLONIZE_SHIP_ID && slowest.seconds > 48 * 3600) {
            rows.push({ type: 'info', name: translate('travelColonizeShipLimit') });
        }

        if (unitKeys.some((key) => FLYING_UNITS.has(key))) {
            rows.push({ type: 'info', name: translate('travelFlyingNote') });
        }

        if (!mods) {
            rows.push({ type: 'info', name: translate('travelNoBonusData') });
        } else if (usedFallbackCity) {
            rows.push({ type: 'info', name: translate('travelUsedActiveCity') });
        }

        rows.push({ type: 'info', name: translate('travelScopeNote') });

        return rows;
    }

    /*
     * >top players|alliances [N] — plain points ranking. Not gated:
     * this is the same public ranking already shown in-game without
     * any Premium advisor (the Hall of Fame / in-game ranking
     * window), sourced from the same players.txt/alliances.txt dumps
     * every other search already reads, so reproducing the sort
     * order isn't reproducing a paid overview.
     */
    function topRows(tokens) {
        const kind = (tokens[0] || '').toLowerCase();
        const isPlayers = kind.startsWith('player');
        const isAlliances = kind.startsWith('alliance');
        if (!isPlayers && !isAlliances) {
            return [{ type: 'info', name: translate('commandTopHelp') }];
        }
        const nToken = tokens.find((token, index) => index > 0 && Number.isFinite(Number(token)));
        const limit = Math.max(1, Math.min(CONFIG.MAX_RESULTS, nToken ? Math.floor(Number(nToken)) : CONFIG.MAX_RESULTS));

        if (isPlayers) {
            const sorted = DATA.players.slice().sort((a, b) => b.points - a.points).slice(0, limit);
            if (!sorted.length) return [{ type: 'info', name: translate('noResults') }];
            return sorted.map((player) => ({ type: 'player', id: player.id, name: player.name, data: player, score: player.points }));
        }

        const sorted = DATA.alliances.slice().sort((a, b) => b.points - a.points).slice(0, limit);
        if (!sorted.length) return [{ type: 'info', name: translate('noResults') }];
        return sorted.map((alliance) => ({ type: 'alliance', id: alliance.id, name: alliance.name, data: alliance, score: alliance.points }));
    }

    /*
     * >vs <alliance1> vs <alliance2> — side-by-side alliance totals.
     * Only shows each alliance's own already-public row (rank/
     * members/towns/points, same as a plain alliance search), never
     * a member listing, so it isn't the multi-city aggregation the
     * Curator gate exists for (same reasoning >history uses for its
     * own single-entity exemption).
     */
    function vsRows(rawArgs) {
        const raw = String(rawArgs || '').trim();
        const parts = raw.split(/\s+vs\s+|\s*\|\s*/i).map((part) => part.trim()).filter(Boolean);
        if (parts.length !== 2) {
            return [{ type: 'info', name: translate('commandVsHelp') }];
        }
        const left = findAlliance(parts[0]);
        const right = findAlliance(parts[1]);
        if (!left || !right) {
            return [{ type: 'info', name: translate('noResults') }];
        }
        return [
            { type: 'alliance', id: left.id, name: left.name, data: left, score: 30000 },
            { type: 'alliance', id: right.id, name: right.name, data: right, score: 29999 },
        ];
    }

    function islandRows(rawArgs) {
        const coords = parseCoordinates(rawArgs);
        if (!coords) {
            return [{ type: 'info', name: translate('commandIslandHelp') }];
        }
        const island = islandRow(coords.x, coords.y);
        if (!island.towns.length) {
            return [
                island,
                { type: 'coordinate', id: `${coords.x}:${coords.y}`, name: translate('openIslandMap'), x: coords.x, y: coords.y, score: 1 },
            ];
        }
        return [
            island,
            ...island.towns.map((town) => townResult(town)),
            { type: 'coordinate', id: `${coords.x}:${coords.y}`, name: translate('openIslandMap'), x: coords.x, y: coords.y, score: 1 },
        ];
    }

    function parseRadius(token) {
        const value = Number(token);
        if (!Number.isFinite(value) || value < 0) return null;
        return Math.min(CONFIG.NEAR_MAX_RADIUS, Math.floor(value));
    }

    function nearRows(rawArgs) {
        const tokens = String(rawArgs || '').trim().split(/\s+/).filter(Boolean);
        let origin = null;
        let radius = null;

        if (!tokens.length) {
            return [{ type: 'info', name: translate('nearNeedOrigin') }];
        }

        const coordToken = tokens.find((token) => parseCoordinates(token));
        if (coordToken) {
            origin = parseCoordinates(coordToken);
            const other = tokens.find((token) => token !== coordToken);
            radius = other ? parseRadius(other) : 3;
        } else {
            origin = effectiveOrigin();
            radius = parseRadius(tokens[0]);
        }

        if (!origin || radius === null) {
            return [{ type: 'info', name: translate('nearNeedOrigin') }];
        }

        // Only scan the grid buckets that could possibly contain a point
        // within `radius` of origin, instead of every island coordinate
        // in the entire world (see NEAR_BUCKET_SIZE/indexTowns).
        const islands = [];
        const bucketRadius = Math.ceil(radius / NEAR_BUCKET_SIZE) + 1;
        const originBucketX = Math.floor(origin.x / NEAR_BUCKET_SIZE);
        const originBucketY = Math.floor(origin.y / NEAR_BUCKET_SIZE);
        for (let bx = originBucketX - bucketRadius; bx <= originBucketX + bucketRadius; bx++) {
            for (let by = originBucketY - bucketRadius; by <= originBucketY + bucketRadius; by++) {
                const bucket = DATA.islandsByBucket.get(`${bx}:${by}`);
                if (!bucket) continue;
                for (const island of bucket) {
                    const distance = islandDistance(origin, island);
                    if (distance <= radius) {
                        islands.push({ x: island.x, y: island.y, distance, towns: island.towns });
                    }
                }
            }
        }
        islands.sort((a, b) => a.distance - b.distance || b.towns.length - a.towns.length);

        if (!islands.length) {
            return [{ type: 'info', name: translate('nearSummary', { islands: 0, towns: 0, n: radius }) }];
        }

        const townCount = islands.reduce((sum, island) => sum + island.towns.length, 0);
        const rows = [{
            type: 'info',
            name: translate('nearSummary', { islands: islands.length, towns: townCount, n: radius }),
        }];
        for (const island of islands) {
            if (rows.length >= CONFIG.MAX_RESULTS) break;
            const row = islandRow(island.x, island.y);
            row.distance = island.distance;
            rows.push(row);
        }
        return rows;
    }

    function oceanOf(x, y) {
        return getSea(x, y);
    }

    function townsInOcean(ocean, allianceId) {
        const wanted = ocean.toUpperCase();
        const candidates = DATA.townsByOcean.get(wanted) || [];
        if (!allianceId) {
            return candidates.slice();
        }
        const towns = [];
        for (const town of candidates) {
            const player = DATA.playerById.get(town.playerId);
            if (!player || player.allianceId !== allianceId) continue;
            towns.push(town);
        }
        return towns;
    }

    function findAlliance(name) {
        const query = normalize(name);
        if (!query) return null;
        let best = null;
        let bestScore = 0;
        for (const alliance of DATA.alliances) {
            const score = scoreMatch(alliance.nameNorm, query);
            if (score > bestScore) {
                best = alliance;
                bestScore = score;
            }
        }
        return bestScore >= 6000 ? best : null;
    }

    function findPlayer(name) {
        const query = normalize(name);
        if (!query) return null;
        let best = null;
        let bestScore = 0;
        for (const player of DATA.players) {
            const score = scoreMatch(player.nameNorm, query);
            if (score > bestScore) {
                best = player;
                bestScore = score;
            }
        }
        return bestScore >= 6000 ? best : null;
    }

    function oceanRows(rawArgs) {
        const match = String(rawArgs || '').trim().match(/^(M\d{2})(?:\s+(.+))?$/i);
        if (!match) {
            return [{ type: 'info', name: translate('oceanNeed') }];
        }
        const ocean = match[1].toUpperCase();
        const alliance = match[2] ? findAlliance(match[2]) : null;
        if (match[2] && !alliance) {
            return [{ type: 'info', name: translate('noResults') }];
        }

        const towns = townsInOcean(ocean, alliance ? alliance.id : null);
        if (!towns.length) {
            return [{ type: 'info', name: translate('oceanEmpty') }];
        }

        const players = new Set();
        const alliances = new Set();
        let ghosts = 0;
        for (const town of towns) {
            if (!town.playerId) {
                ghosts++;
                continue;
            }
            players.add(town.playerId);
            const player = DATA.playerById.get(town.playerId);
            if (player && player.allianceId) alliances.add(player.allianceId);
        }

        const summary = translate('oceanSummary', {
            players: players.size,
            alliances: alliances.size,
            towns: towns.length,
            ghosts,
        });
        const title = alliance ? `${ocean} \u00b7 ${alliance.name}` : ocean;
        const rows = [{ type: 'info', name: `${title} \u00b7 ${summary}` }];
        towns.sort((a, b) => b.points - a.points);
        for (const town of towns.slice(0, CONFIG.MAX_RESULTS - 1)) {
            rows.push(townResult(town));
        }
        return rows;
    }

    function playerDetailRows(player) {
        const header = { type: 'player', id: player.id, name: player.name, data: player, score: 30000 };
        const towns = (DATA.townsByPlayer.get(player.id) || []).slice().sort((a, b) => b.points - a.points);
        const origin = effectiveOrigin();
        const rows = [header];
        if (towns.length) {
            rows.push({ type: 'info', name: `${translate('playerTownsTitle')} \u00b7 ${towns.length}` });
        }
        for (const town of towns.slice(0, CONFIG.MAX_RESULTS - rows.length)) {
            rows.push(townResult(town, origin ? {
                distance: islandDistance(origin, { x: town.islandX, y: town.islandY }),
            } : null));
        }
        return rows;
    }

    function allianceDetailRows(alliance) {
        const header = { type: 'alliance', id: alliance.id, name: alliance.name, data: alliance, score: 30000 };
        const members = DATA.players.filter((player) => player.allianceId === alliance.id);
        const byOcean = new Map();
        let townCount = 0;
        for (const member of members) {
            for (const town of DATA.townsByPlayer.get(member.id) || []) {
                townCount++;
                const ocean = oceanOf(town.islandX, town.islandY);
                byOcean.set(ocean, (byOcean.get(ocean) || 0) + 1);
            }
        }
        const spread = [...byOcean.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        const rows = [
            header,
            {
                type: 'info',
                name: spread.length
                    ? `${translate('allianceSpreadTitle')} \u00b7 ${spread.map(([ocean, count]) => `${ocean} ${count}`).join(' \u00b7 ')}`
                    : translate('allianceSpreadTitle'),
            },
        ];
        const listed = members.slice().sort((a, b) => b.points - a.points);
        if (listed.length) {
            rows.push({ type: 'info', name: `${translate('allianceMembersTitle')} \u00b7 ${members.length} \u00b7 ${townCount} ${translate('townsSuffix')}` });
        }
        for (const member of listed.slice(0, CONFIG.MAX_RESULTS - rows.length)) {
            rows.push({ type: 'player', id: member.id, name: member.name, data: member, score: member.points });
        }
        return rows;
    }

    /*
     * ============================================================
     * >history (conquers.txt) — single-entity lookup, no gating
     * ============================================================
     *
     * Every branch below resolves to ONE town/player/alliance's own
     * timeline (a list of past events about that one entity), not an
     * aggregate multi-entity overview, so none of this needs
     * isCuratorActive(): it mirrors clicking that entity's own public
     * profile, same reasoning as the plain search paths.
     */

    function ownerLabelAt(playerId) {
        if (!playerId) return translate('historyGhost');
        const player = DATA.playerById.get(playerId);
        return player ? player.name : `#${playerId}`;
    }

    function formatEventDate(ts) {
        try {
            return new Date(ts).toLocaleDateString();
        } catch (_) {
            return new Date(ts).toISOString().slice(0, 10);
        }
    }

    /*
     * `townId` is only used to look up and prefix the town's name when
     * the row is shown outside that town's own history (e.g. inside
     * playerHistoryRows, where several different towns are listed
     * together and the reader needs to know which one each line is
     * about); townHistoryRows omits it since its header row already
     * names the town.
     */
    function conquestEventRow(event, townId) {
        const dateLabel = formatEventDate(event.ts);
        const fromLabel = ownerLabelAt(event.oldOwnerId);
        const toLabel = ownerLabelAt(event.newOwnerId);
        const key = event.oldOwnerId
            ? translate('historyEventConquest', { from: fromLabel, to: toLabel })
            : translate('historyEventColonized', { to: toLabel });
        // Not escaped here: 'info' rows are escaped once as a whole by
        // renderResult (see case 'info'), same pattern as oceanRows'
        // alliance.name interpolation above.
        const town = townId ? DATA.townById.get(townId) : null;
        const townLabel = town ? `${town.name} \u00b7 ` : '';
        return {
            type: 'info',
            name: `${dateLabel} \u00b7 ${townLabel}${key} \u00b7 ${event.points.toLocaleString()} ${translate('ptsSuffix')}`,
        };
    }

    /*
     * A town's own timeline: every recorded conquest/colonization,
     * oldest first (so reading top-to-bottom tells the town's story
     * in order), capped to HISTORY_MAX_EVENTS most recent entries.
     */
    function townHistoryRows(town) {
        const header = townResult(town);
        const events = CONQUEST.eventsByTown.get(town.id) || [];
        if (!events.length) {
            return [header, { type: 'info', name: translate('historyEmpty') }];
        }
        const recent = events.slice(-CONFIG.HISTORY_MAX_EVENTS);
        return [
            header,
            { type: 'info', name: `${translate('historyEventCount', { n: events.length })}` },
            ...recent.map((event) => conquestEventRow(event)),
        ];
    }

    /*
     * A player's own conquest/loss tally: how many towns they've
     * taken (as new_owner) and lost (as old_owner) across the whole
     * world history, plus their most recent events of each kind.
     * This is the player's own activity record, not a listing of
     * other players' towns, so it stays ungated like the rest of
     * >history.
     */
    function playerHistoryRows(player) {
        const header = { type: 'player', id: player.id, name: player.name, data: player, score: 30000 };
        if (!CONQUEST.loaded) {
            return [header, { type: 'info', name: translate('historyNotLoaded') }];
        }

        const conquered = [];
        const lost = [];
        for (const [townId, events] of CONQUEST.eventsByTown) {
            for (const event of events) {
                if (event.newOwnerId === player.id) conquered.push({ event, townId });
                if (event.oldOwnerId === player.id) lost.push({ event, townId });
            }
        }
        conquered.sort((a, b) => b.event.ts - a.event.ts);
        lost.sort((a, b) => b.event.ts - a.event.ts);

        if (!conquered.length && !lost.length) {
            return [header, { type: 'info', name: translate('historyEmpty') }];
        }

        const rows = [
            header,
            { type: 'info', name: translate('historyPlayerSummary', { conquered: conquered.length, lost: lost.length }) },
        ];
        const half = Math.max(1, Math.floor((CONFIG.HISTORY_MAX_EVENTS) / 2));
        for (const { event, townId } of conquered.slice(0, half)) {
            rows.push(conquestEventRow(event, townId));
        }
        for (const { event, townId } of lost.slice(0, half)) {
            rows.push(conquestEventRow(event, townId));
        }
        return rows;
    }

    function historyRows(rawArgs) {
        const query = String(rawArgs || '').trim();
        if (!query) {
            return [{ type: 'info', name: translate('commandHistoryHelp') }];
        }
        if (!settings.conquestHistoryEnabled) {
            return [{ type: 'info', name: translate('historyDisabled') }];
        }
        if (!CONQUEST.loaded) {
            loadConquestHistory(); // fire-and-forget, in case the setting was on but the load hasn't run yet
            return [{ type: 'info', name: translate('historyNotLoaded') }];
        }

        const coords = parseCoordinates(query);
        if (coords) {
            const towns = townsOnIsland(coords.x, coords.y);
            if (!towns.length) {
                return [{ type: 'info', name: translate('noResults') }];
            }
            if (towns.length === 1) {
                return townHistoryRows(towns[0]);
            }
            // Multiple towns share this island coordinate. Listing all
            // of them to disambiguate is the same multi-town island
            // view gated everywhere else (searchCoordinates/islandRows),
            // so it needs the same Curator check; without it, just ask
            // for an exact town name instead of a coordinate.
            if (!isCuratorActive()) return premiumRequiredRows();
            return towns.map((town) => townResult(town));
        }

        // Town names and player names share the same namespace here,
        // so an exact match on either wins outright; otherwise fall
        // back to whichever fuzzy match scored higher. searchTowns()
        // returns matches unsorted (score order is only applied by the
        // free-text search path), so the best match must be picked
        // explicitly here instead of assuming index 0.
        const player = findPlayer(query);
        const townMatches = searchTowns(normalize(query));
        const bestTown = townMatches.reduce(
            (best, town) => (!best || town.score > best.score ? town : best),
            null,
        );

        if (bestTown && bestTown.score === 10000) return townHistoryRows(bestTown.data);
        if (player && player.nameNorm === normalize(query)) return playerHistoryRows(player);
        if (bestTown && (!player || bestTown.score >= 6000)) return townHistoryRows(bestTown.data);
        if (player) return playerHistoryRows(player);
        return [{ type: 'info', name: translate('noResults') }];
    }

    /*
     * Runs a ">command". Returns the result rows (type 'info' for
     * messages, 'town' for ghost listings), or null when the command
     * already navigated (a >goto that matched) or rendered its own
     * state (help), in which case performSearch must stop there.
     */
    function runCommand(query) {
        const rest = query.slice(CONFIG.COMMAND_PREFIX.length).trim();
        const [nameRaw, ...tokens] = rest.split(/\s+/);
        const name = (nameRaw || '').toLowerCase();
        const args = tokens.join(' ');
        const knownCommands = ['goto', 'ghost', 'dist', 'island', 'near', 'ocean', 'history', 'travel', 'top', 'vs', 'settings', 'help'];

        if (!name || (tokens.length === 0 && !knownCommands.includes(name))) {
            const suggestions = [
                { type: 'command-suggestion', name: '>goto <x>:<y>', command: '>goto', helpText: translate('commandGotoHelp') },
                { type: 'command-suggestion', name: '>ghost [minPts] [near]', command: '>ghost', helpText: translate('commandGhostHelp') },
                { type: 'command-suggestion', name: '>dist X:Y [X:Y...]', command: '>dist', helpText: translate('commandDistHelp') },
                { type: 'command-suggestion', name: '>island X:Y', command: '>island', helpText: translate('commandIslandHelp') },
                { type: 'command-suggestion', name: '>near [X:Y] [radius]', command: '>near', helpText: translate('commandNearHelp') },
                { type: 'command-suggestion', name: '>ocean M34 [alliance]', command: '>ocean', helpText: translate('commandOceanHelp') },
                { type: 'command-suggestion', name: '>history <name|x:y>', command: '>history', helpText: translate('commandHistoryHelp') },
                { type: 'command-suggestion', name: '>travel <unit,...> [X:Y] [X:Y] [sirens=N]', command: '>travel', helpText: translate('commandTravelHelp') },
                { type: 'command-suggestion', name: '>top players|alliances [N]', command: '>top', helpText: translate('commandTopHelp') },
                { type: 'command-suggestion', name: '>vs <alliance1> vs <alliance2>', command: '>vs', helpText: translate('commandVsHelp') },
                { type: 'command-suggestion', name: '>settings', command: '>settings', helpText: translate('commandSettingsHelp') },
                { type: 'command-suggestion', name: '>help', command: '>help', helpText: translate('commandHelpHint') },
            ];
            const matching = suggestions.filter((item) => item.command.slice(1).startsWith(name));
            if (matching.length) {
                return matching;
            }
        }

        switch (name) {
            case 'help':
                state.showHelp = true;
                return null;

            case 'settings':
                state.showSettings = true;
                return null;

            case 'goto': {
                const coords = parseCoordinates(args);
                if (!coords) {
                    return [{ type: 'info', name: translate('commandGotoHelp') }];
                }
                openCoordinate(coords);
                return null;
            }

            case 'ghost': {
                if (!isCuratorActive()) return premiumRequiredRows();
                const near = tokens.some((token) => token.toLowerCase() === 'near');
                const numeric = tokens.find((token) => token.toLowerCase() !== 'near' && Number.isFinite(Number(token)));
                return ghostRows(numeric !== undefined ? Number(numeric) : NaN, near);
            }

            case 'dist':
                return distRows(args);

            case 'island':
                if (!isCuratorActive()) return premiumRequiredRows();
                return islandRows(args);

            case 'near':
                if (!isCuratorActive()) return premiumRequiredRows();
                return nearRows(args);

            case 'ocean':
                if (!isCuratorActive()) return premiumRequiredRows();
                return oceanRows(args);

            case 'history':
                return historyRows(args);

            case 'travel':
                return travelRows(args);

            case 'top':
                return topRows(tokens);

            case 'vs':
                return vsRows(args);

            default:
                return [{ type: 'info', name: translate('commandUnknown', { cmd: nameRaw || '' }) }];
        }
    }

    function isCommand(query) {
        return query.startsWith(CONFIG.COMMAND_PREFIX);
    }

    /*
     * A query is worth offering to save when it's non-empty and isn't
     * one of the meta-shortcuts that only open a panel instead of
     * producing results (help/settings), since re-running those via a
     * saved search would be meaningless.
     */
    function isSavableQuery(query) {
        if (!query) return false;
        if (query === CONFIG.HELP_CHAR) return false;
        const trimmedCommand = query.slice(CONFIG.COMMAND_PREFIX.length).trim().toLowerCase();
        if (isCommand(query) && (trimmedCommand === 'settings' || trimmedCommand === 'help')) return false;
        return true;
    }

    function toggleFavoriteSelected() {
        const item = getFocusedItem();
        if (!item || item.type === 'info') {
            return;
        }
        toggleFavorite(item);
        // In the history view the row set must be rebuilt so a just-
        // unfavorited item leaves the Favorites group. Toggling a
        // favorite never changes an open detail pane's own rows (those
        // are alliance members / a player's towns, not the history
        // list), so the pane itself is left alone either way.
        if (!state.query) {
            performSearch('', ++searchToken);
        } else {
            render();
        }
    }

    /*
     * Pins the currently focused row's coordinates as the distance
     * origin (see ORIGIN OVERRIDE above), then re-renders so the
     * footer origin indicator and every distance column pick it up
     * immediately. No-ops for rows without coordinates (players,
     * alliances, info rows, saved searches).
     */
    function setOriginSelected() {
        const item = getFocusedItem();
        if (!setOriginFromItem(item)) {
            return;
        }
        showToast(translate('originSet', { x: item.x, y: item.y }));
        render();
    }

    /*
     * Keyboard equivalent of clicking the per-row trash icon: removes
     * the selected row from Recent history or from Saved searches.
     * Only meaningful in the history view, and only for 'recent'/
     * 'saved' rows — favorites are managed via Ctrl+F/the star
     * instead, matching the mouse path in handleResultClick.
     */
    function removeSelectedHistoryItem() {
        // Only ever meaningful for the left-hand history list — rows in
        // an open detail pane (alliance members, a player's towns...)
        // never carry a `.section`, so this naturally no-ops for them
        // instead of needing an explicit pane check.
        const item = getFocusedItem();
        if (!item) return;
        if (item.section === 'recent') {
            removeHistoryItem(item);
            performSearch('', ++searchToken);
        } else if (item.section === 'saved') {
            removeSavedSearch(item.id);
            performSearch('', ++searchToken);
        }
    }

    /*
     * Ctrl+Shift+Delete equivalent for the currently selected row:
     * wipes the whole section (Recent or Saved searches) that row
     * belongs to, instead of always targeting Recent. No-ops when the
     * selected row isn't part of either clearable section.
     */
    function clearSelectedHistorySection() {
        const item = getFocusedItem();
        if (!item || (item.section !== 'recent' && item.section !== 'saved')) {
            return;
        }
        if (item.section === 'recent') {
            clearHistory();
            showToast(translate('recentCleared'));
        } else {
            clearSavedSearches();
            showToast(translate('savedSearchesCleared'));
        }
        performSearch('', ++searchToken);
    }

    /*
     * ============================================================
     * BBCODE
     * ============================================================
     *
     * Builds the exact BBCode Grepolis itself generates from its own
     * "Info" popups, confirmed live against the game client:
     *   - [player]Name[/player]   (by name, like the in-game chooser)
     *   - [ally]Name[/ally]       (by name, like the in-game chooser)
     *   - [town]townId[/town]     (by internal town id)
     *   - [island]islandId[/island] (by internal island id, NOT "x:y" —
     *     confirmed via the "Island info" window's own bbcode field)
     * Returns null for types that have no BBCode equivalent
     * (coordinate/command-suggestion/info, and islands whose id
     * couldn't be resolved because islands.txt hasn't loaded yet).
     */
    function bbcodeFor(item) {
        if (!item) return null;
        switch (item.type) {
            case 'player':
                return `[player]${item.name}[/player]`;
            case 'alliance':
                return `[ally]${item.name}[/ally]`;
            case 'town':
                return Number.isFinite(item.id) ? `[town]${item.id}[/town]` : null;
            case 'island': {
                const islandId = Number.isFinite(item.islandId)
                    ? item.islandId
                    : DATA.islandIdByCoord.get(`${item.x}:${item.y}`);
                return Number.isFinite(islandId) ? `[island]${islandId}[/island]` : null;
            }
            default:
                return null;
        }
    }

    function copyToClipboard(text) {
        if (GP.navigator && GP.navigator.clipboard && GP.navigator.clipboard.writeText) {
            return GP.navigator.clipboard.writeText(text).catch(() => fallbackCopyToClipboard(text));
        }
        return fallbackCopyToClipboard(text);
    }

    // GM/userscript pages can end up without Clipboard API permission
    // (e.g. no user gesture reaching the real page, or an older
    // browser); execCommand('copy') via a throwaway textarea is the
    // fallback every other in-page copy button on the web still uses.
    function fallbackCopyToClipboard(text) {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
            return Promise.resolve();
        } catch (error) {
            return Promise.reject(error);
        }
    }

    /*
     * Copies the BBCode for a given result and closes the palette,
     * mirroring Enter's "act on the selection, then close" behavior.
     * Silently no-ops for rows without a BBCode equivalent instead of
     * copying nothing useful or throwing. Shared by the Ctrl+B
     * shortcut and the per-row BBCode icon (see handleResultClick),
     * so both input methods behave identically.
     */
    function copyBBCode(item) {
        const code = bbcodeFor(item);
        if (!code) {
            return;
        }
        copyToClipboard(code).then(() => {
            addHistory(item);
            close();
            showToast(translate('bbcodeCopied'), code);
        });
    }

    function copySelectedBBCode() {
        copyBBCode(getFocusedItem());
    }

    /*
     * Bulk export (Ctrl+Shift+B / the footer "export" button): copies
     * every visible row's BBCode (see bbcodeFor), one per line, from
     * whichever list currently owns keyboard focus — the left-hand
     * list or an open detail pane (see state.focusPane) — instead of
     * only the single selected row like Ctrl+B. Rows without a BBCode
     * equivalent (info rows, coordinates, saved searches...) are
     * skipped rather than producing empty lines. Does not close the
     * palette, since exporting a whole list is a "keep working" action
     * unlike opening/copying a single result.
     */
    function exportResultsBBCode() {
        const inDetailPane = state.focusPane === 'detail' && state.hierarchyStack.length > 0;
        const list = inDetailPane ? currentHierarchyRows() : state.results;
        const codes = list.map((item) => bbcodeFor(item)).filter(Boolean);
        if (!codes.length) {
            showToast(translate('exportEmpty'));
            return;
        }
        const text = codes.join('\n');
        copyToClipboard(text).then(() => {
            showToast(translate('exportCopied', { n: codes.length }));
        });
    }

    let searchTimer = null;
    let searchToken = 0;

    function scheduleSearch(rawQuery) {
        clearTimeout(searchTimer);

        const token = ++searchToken;

        searchTimer = setTimeout(() => {
            if (token !== searchToken) {
                return; // something new was typed while we waited: discard.
            }
            performSearch(rawQuery, token);
        }, CONFIG.SEARCH_DELAY);
    }

    function performSearch(rawQuery, token) {
        const query = rawQuery.trim();
        state.query = query;
        state.showHelp = false;
        state.showSettings = false;
        // The left-hand list is about to be rebuilt; any open detail
        // pane refers to the old list's rows and must close with it.
        resetHierarchy();

        // '?' and '>help' shortcuts render the help panel even while
        // the index is still loading, so those are handled first.
        if (query === CONFIG.HELP_CHAR) {
            state.showHelp = true;
            render();
            return;
        }

        if (isCommand(query)) {
            // >settings works even while the index is still loading
            // (it doesn't need it), unlike >ghost/>dist/etc below.
            if (query.slice(CONFIG.COMMAND_PREFIX.length).trim().toLowerCase() === 'settings') {
                state.showSettings = true;
                render();
                return;
            }
            const commandResult = runCommand(query);
            if (commandResult) {
                if (!state.loaded) {
                    // Commands that need the index (>ghost, >dist)
                    // cannot run before it is ready. Show a help
                    // message instead of a misleading empty list.
                    state.showHelp = true;
                    render();
                    return;
                }
                state.fullResults = commandResult;
                state.segmentCounts = computeCounts(commandResult);
                state.detail = true;
                applySegment();
            }
            render();
            return;
        }

        if (!query) {
            // History/favorites/saved-searches view: skip the search
            // segment filter (players/alliances/towns...), use the
            // history segment filter (saved/favorites/recent) instead.
            state.query = '';
            state.segment = CONFIG.DEFAULT_SEGMENT;
            state.detail = false;
            state.fullResults = buildHistoryResults();
            state.segmentCounts = null;
            state.historyCounts = computeHistoryCounts(state.fullResults);
            state.historySegment = CONFIG.DEFAULT_HISTORY_SEGMENT;
            applyHistorySegment();
            render();
            return;
        }

        if (!state.loaded) {
            // loadAll() was already triggered in init(); it just hasn't finished yet.
            state.results = [];
            state.visibleCount = CONFIG.RESULTS_PAGE_SIZE;
            render();
            return;
        }

        // Optional "@scope" prefix pins the search to one segment,
        // e.g. "@t Naxos" or "@alliance Donners". The prefix is
        // stripped before the actual query.
        let segment = state.segment;
        let searchQuery = query;
        const scopeMatch = query.match(/^@([tpaic])\s+(.+)/);
        if (scopeMatch) {
            segment = CONFIG.SCOPE_ALIASES[scopeMatch[1]];
            state.segment = segment;
            searchQuery = scopeMatch[2];
        }

        const queryNorm = normalize(searchQuery);
        const coordinate = searchCoordinates(searchQuery);

        let results;
        let detail = false;

        const curatorActive = isCuratorActive();

        if (segment === 'island') {
            if (coordinate && coordinate.type === 'island') {
                if (curatorActive) {
                    results = [coordinate, ...coordinate.towns.map((town) => townResult(town))];
                    detail = true;
                } else {
                    results = [coordinate];
                }
            } else {
                results = [];
            }
        } else if (coordinate && coordinate.type === 'island') {
            if (curatorActive) {
                results = [coordinate, ...coordinate.towns.map((town) => townResult(town))];
                detail = true;
            } else {
                results = [coordinate];
            }
        } else if (coordinate && coordinate.type === 'town') {
            results = [coordinate];
        } else {
            if (segment === 'player') {
                const matches = searchPlayers(queryNorm);
                // An exact match reached through the explicit @p scope
                // drills straight into that player's own towns instead
                // of showing every fuzzy near-miss. Requires the
                // Administrator/Curator advisor, same as the in-game
                // overviews this mirrors.
                if (matches.length && matches[0].score === 10000 && curatorActive) {
                    results = playerDetailRows(matches[0].data);
                    detail = true;
                } else {
                    results = [...matches];
                }
            } else if (segment === 'alliance') {
                const matches = searchAlliances(queryNorm);
                if (matches.length && matches[0].score === 10000 && curatorActive) {
                    results = allianceDetailRows(matches[0].data);
                    detail = true;
                } else {
                    results = [...matches];
                }
            } else if (segment === 'town') {
                results = searchQuery.length >= CONFIG.MIN_TOWN_QUERY_LENGTH ? [...searchTowns(queryNorm)] : [];
            } else if (segment === 'coordinate') {
                results = coordinate ? [coordinate] : [];
            } else {
                results = [...searchPlayers(queryNorm), ...searchAlliances(queryNorm)];

                if (searchQuery.length >= CONFIG.MIN_TOWN_QUERY_LENGTH) {
                    results.push(...searchTowns(queryNorm));
                }

                if (coordinate) {
                    results.unshift(coordinate);
                }
            }
        }

        if (!detail) {
            results.sort((a, b) => b.score - a.score);

            const seen = new Set();
            results = results.filter((item) => {
                const key = `${item.type}:${item.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        if (token !== searchToken) {
            return; // in case something more recent already fired in the meantime.
        }

        state.detail = detail;
        state.segmentCounts = computeCounts(results);
        // Command output (>ghost, >near, >ocean...) already self-limits
        // to CONFIG.MAX_RESULTS while building its rows; free-text
        // search results are kept in full here so segment filtering
        // (Tab / chips) sees every match instead of only whatever
        // happened to survive an earlier "all types mixed" cutoff.
        // Rendering itself is paginated separately via visibleCount.
        state.fullResults = results;
        applySegment();
        render();
    }

    /*
     * ============================================================
     * OPEN RESULT (real in-game navigation, no new tabs)
     * ============================================================
     *
     * Player / alliance: `Layout.playerProfile.open(name, id)` and
     * `Layout.allianceProfile.open(name, id)` are the mechanism used
     * by the game client itself and by userscripts still maintained
     * today (verified against the code of recently maintained
     * scripts). NOTE: these are not "flat" functions
     * (Layout.playerProfile(id) does NOT exist), they are objects
     * with an `.open(name, id)` method.
     *
     * Town: Grepolis' own map navigates by assigning
     * `location.hash = base64(JSON.stringify({id, ix, iy, tp:'town',
     * number_on_island}))`. This is exactly the format used by the
     * map's native <a href="#..."> links (verified by navigating
     * with that hash: the map re-centers on the town). That's why we
     * use it as the primary mechanism instead of relying on
     * ITowns/WMap, which remain as a fallback.
     */

    function getLayoutOpener(namespace) {
        const ns = GP.Layout && GP.Layout[namespace];
        if (ns && typeof ns.open === 'function') {
            return (...args) => ns.open(...args);
        }
        return null;
    }

    function openPlayer(item) {
        console.info(`[QF] Trying to open player id=${item.id}, name="${item.name}"`);
        const opener = getLayoutOpener('playerProfile');

        if (opener) {
            try {
                opener(item.name, item.id);
                close();
                console.info('[QF] Successfully opened player via Layout.playerProfile.open');
                return true;
            } catch (error) {
                console.error('[QF] Layout.playerProfile.open() failed:', error);
            }
        }

        if (GP.gpAjax && typeof GP.gpAjax.ajaxGet === 'function') {
            try {
                GP.gpAjax.ajaxGet('player', 'get_profile_html', { player_id: item.id }, true);
                close();
                console.info('[QF] Successfully opened player via gpAjax.ajaxGet');
                return true;
            } catch (e) {
                console.error('[QF] gpAjax.ajaxGet(player, get_profile_html) failed:', e);
            }
        }

        console.warn('[QF] Could not open the player profile:', item);
        return false;
    }

    function openAlliance(item) {
        console.info(`[QF] Trying to open alliance id=${item.id}, name="${item.name}"`);
        const opener = getLayoutOpener('allianceProfile');

        if (opener) {
            try {
                opener(item.name, item.id);
                close();
                console.info('[QF] Successfully opened alliance via Layout.allianceProfile.open');
                return true;
            } catch (error) {
                console.error('[QF] Layout.allianceProfile.open() failed:', error);
            }
        }

        if (GP.gpAjax && typeof GP.gpAjax.ajaxGet === 'function') {
            try {
                GP.gpAjax.ajaxGet('alliance', 'profile', { alliance_id: item.id }, true);
                close();
                console.info('[QF] Successfully opened alliance via gpAjax.ajaxGet');
                return true;
            } catch (e) {
                console.error('[QF] gpAjax.ajaxGet(alliance, profile) failed:', e);
            }
        }

        console.warn('[QF] Could not open the alliance profile:', item);
        return false;
    }

    function encodeHashPayload(payload) {
        const json = JSON.stringify(payload);
        const b64 = GP.btoa || btoa;
        try {
            return b64(json);
        } catch (_) {
            // Fallback in case the JSON has characters outside Latin1.
            return b64(unescape(encodeURIComponent(json)));
        }
    }

    /*
     * Town: opens the town info window directly (the same modal
     * window with the Info, Attack, Support, Trade, Spells and
     * Espionage tabs, which shows the owner, alliance, points and
     * notes).
     *
     * We skip automatic map re-centering per user request, since the
     * info window itself contains the native `.info_jump_to_town`
     * button to go to the coordinates if desired.
     */

    /*
     * Creates a real <a class="gp_town_link"> with the same hash
     * format (base64 JSON) used by the game itself in reports/chat,
     * inserts it hidden in the DOM and fires a native click on it.
     *
     * That click makes Grepolis open its circular context menu
     * (#context_menu) with the Info/Attack/Support/Trade/Spells/
     * Espionage icons. Right after, we look inside that menu for the
     * icon with id="info" and click it ourselves programmatically:
     * that's what actually loads the town data (Grepolis doesn't
     * download it until that map area is visited) and opens the
     * window with #towninfo_towninfo. The circular menu closes on
     * its own after that second click, so it never stays visible to
     * the user.
     *
     * Verified live: gpwnd_XXXX appears with #towninfo_towninfo
     * populated (name, player, points...) and #context_menu
     * disappears from the DOM after the second click.
     */
    function clickTownLink(hash) {
        return new Promise((resolve) => {
            const link = document.createElement('a');
            link.className = 'gp_town_link';
            link.href = `#${hash}`;
            link.style.position = 'absolute';
            link.style.left = '-9999px';
            document.body.appendChild(link);
            link.click();
            link.remove();

            // The context menu is inserted asynchronously after the click;
            // retry briefly instead of assuming it already exists.
            let attempts = 0;
            const tryClickInfo = () => {
                attempts++;
                const contextMenu = document.getElementById('context_menu');
                const infoIcon = contextMenu ? contextMenu.querySelector('#info') : null;

                if (infoIcon) {
                    infoIcon.click();
                    resolve(true);
                    return;
                }

                if (attempts >= 10) {
                    resolve(false);
                    return;
                }

                setTimeout(tryClickInfo, 50);
            };

            setTimeout(tryClickInfo, 50);
        });
    }

    function openTown(item) {
        const targetTownId = Number(item.id);
        const townName = item.name || '';
        const townData = item.data || DATA.townById.get(targetTownId);

        console.info(`[QF] openTown: targetTownId=${targetTownId}, name="${townName}"`);

        if (!townData && !Number.isFinite(item.x)) {
            console.warn('[QF] No coordinates available for this town:', item);
            return false;
        }

        const hash = encodeHashPayload({
            id: targetTownId,
            ix: townData ? townData.islandX : item.x,
            iy: townData ? townData.islandY : item.y,
            tp: 'town',
            number_on_island: townData ? townData.numberOnIsland : 0,
        });

        clickTownLink(hash).then((success) => {
            if (success) {
                console.info('[QF] Successfully opened town via gp_town_link + click on the context menu #info icon');
            } else {
                console.warn('[QF] Could not find the #info icon inside #context_menu after the click:', item);
            }
        });

        close();
        return true;
    }

    function openCoordinate(item) {
        if (!GP.WMap) {
            console.info('[QF] WMap not available:', item.x, item.y);
            return false;
        }

        try {
            if (typeof GP.WMap.mapJump === 'function') {
                GP.WMap.mapJump({ x: item.x, y: item.y, ix: item.x, iy: item.y });
                close();
                return true;
            }
            if (typeof GP.WMap.mapGotoPosition === 'function') {
                GP.WMap.mapGotoPosition(item.x, item.y);
                close();
                return true;
            }
        } catch (error) {
            console.error('[QF] Map jump failed:', error);
        }

        return false;
    }

    function openResult(item) {
        if (!item || item.type === 'info') return false;

        if (item.type === 'command-suggestion') {
            const input = document.getElementById('qf-input');
            if (input) {
                const nextQuery = item.command + (item.command === '>help' ? '' : ' ');
                input.value = nextQuery;
                performSearch(nextQuery, ++searchToken);
                input.focus();
                if (nextQuery.length > 0) {
                    input.setSelectionRange(nextQuery.length, nextQuery.length);
                }
            }
            return true;
        }

        if (item.type === 'saved-search') {
            const input = document.getElementById('qf-input');
            if (input) {
                input.value = item.query;
                performSearch(item.query, ++searchToken);
                input.focus();
            }
            return true;
        }

        let ok;
        switch (item.type) {
            case 'player':
                ok = openPlayer(item);
                break;
            case 'alliance':
                ok = openAlliance(item);
                break;
            case 'town':
                // openTown navigates asynchronously (it waits for the
                // map to settle), so opening is recorded optimistically.
                ok = openTown(item);
                if (ok) {
                    addHistory(item);
                }
                return ok;
            case 'coordinate':
            case 'island':
                ok = openCoordinate(item);
                break;
            default:
                return false;
        }

        if (ok) {
            addHistory(item);
        }
        return ok;
    }

    /*
     * ============================================================
     * HIERARCHY DRILL-DOWN (Alliance -> Player -> Town, Island -> Town)
     * ============================================================
     *
     * A right-hand detail pane, navigated with ArrowRight (push a
     * level) / ArrowLeft (pop a level); mouse equivalents are the
     * row chevron and the breadcrumb bar (see the CLICK section and
     * renderDetailPane below). Enter/click on a row keeps opening
     * the native in-game window and closing the overlay exactly as
     * before, in both panes: this feature only adds a way to peek at
     * an entity's children without leaving the palette, it never
     * changes what Enter does. Only downward navigation is
     * supported (no Town -> Owner/Island); every level that
     * aggregates more than one child (alliance members, a player's
     * towns, an island's towns) is gated behind isCuratorActive(),
     * mirroring playerDetailRows/allianceDetailRows/islandRows.
     */

    function isDrillable(item) {
        return Boolean(item) && (item.type === 'alliance' || item.type === 'player' || item.type === 'island');
    }

    function childRowsFor(item) {
        switch (item.type) {
            case 'alliance': {
                const alliance = item.data || DATA.allianceById.get(item.id);
                if (!alliance) return [];
                return DATA.players
                    .filter((player) => player.allianceId === alliance.id)
                    .sort((a, b) => b.points - a.points)
                    .map((member) => ({ type: 'player', id: member.id, name: member.name, data: member, score: member.points }));
            }
            case 'player': {
                const towns = (DATA.townsByPlayer.get(item.id) || []).slice().sort((a, b) => b.points - a.points);
                const origin = effectiveOrigin();
                return towns.map((town) => townResult(town, origin ? {
                    distance: islandDistance(origin, { x: town.islandX, y: town.islandY }),
                } : null));
            }
            case 'island': {
                return townsOnIsland(item.x, item.y).slice().sort((a, b) => b.points - a.points).map((town) => townResult(town));
            }
            default:
                return [];
        }
    }

    function currentHierarchyLevel() {
        return state.hierarchyStack[state.hierarchyStack.length - 1] || null;
    }

    function currentHierarchyRows() {
        const level = currentHierarchyLevel();
        return level ? level.rows : [];
    }

    function resetHierarchy() {
        state.hierarchyStack = [];
        state.focusPane = 'list';
    }

    /*
     * Pushes a new detail-pane level for `item`. Starting a chain
     * from the left-hand list (fromDetailPane=false) always replaces
     * whatever chain was open before, since picking a different list
     * row is a fresh top-level choice; drilling from an already-open
     * detail-pane row (fromDetailPane=true) extends the current
     * chain instead, up to CONFIG.HIERARCHY_MAX_DEPTH.
     */
    function pushHierarchyLevel(item, fromDetailPane) {
        if (!isDrillable(item)) return false;

        if (!fromDetailPane) {
            state.hierarchyStack = [];
        } else if (state.hierarchyStack.length >= CONFIG.HIERARCHY_MAX_DEPTH) {
            return false;
        }

        const premiumBlocked = !isCuratorActive();
        const rows = premiumBlocked ? premiumRequiredRows() : childRowsFor(item).slice(0, CONFIG.MAX_RESULTS);

        state.hierarchyStack.push({ source: item, rows, selected: 0, premiumBlocked });
        state.focusPane = 'detail';
        return true;
    }

    function popHierarchyLevel() {
        if (!state.hierarchyStack.length) return false;
        state.hierarchyStack.pop();
        state.focusPane = state.hierarchyStack.length ? 'detail' : 'list';
        return true;
    }

    /*
     * Breadcrumb click: jumps back to the level at `depth`, dropping
     * everything drilled into after it.
     */
    function popHierarchyToDepth(depth) {
        if (depth < 0 || depth >= state.hierarchyStack.length - 1) return;
        state.hierarchyStack.length = depth + 1;
        state.focusPane = 'detail';
    }

    /*
     * The item that ArrowUp/ArrowDown/Enter/Ctrl+F/Ctrl+B currently
     * act on: the selected row of the detail pane while it has
     * focus, otherwise the selected row of the left-hand list.
     */
    function getFocusedItem() {
        if (state.focusPane === 'detail') {
            const level = currentHierarchyLevel();
            return level ? level.rows[level.selected] || null : null;
        }
        return state.results[state.selected] || null;
    }

    function setPaneSelected(inDetailPane, index) {
        if (inDetailPane) {
            const level = currentHierarchyLevel();
            if (level) level.selected = index;
            state.focusPane = 'detail';
        } else {
            state.selected = index;
            state.focusPane = 'list';
        }
    }

    /*
     * ============================================================
     * UI CREATION
     * ============================================================
     */

    function createUI() {
        if (document.getElementById('qf-overlay')) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'qf-overlay';

        overlay.innerHTML = `
            <div id="qf-backdrop"></div>
            <div id="qf-window">
                <div id="qf-input-row">
                    <span id="qf-search-icon">${ICONS.search}</span>
                    <input
                        id="qf-input"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="${escapeHTML(translate('searchPlaceholder'))}"
                    >
                    <button type="button" id="qf-save-search-btn" title="${escapeHTML(translate('saveSearchTooltip'))}" hidden>${ICONS.bookmark}</button>
                    <button type="button" id="qf-settings-btn" title="${escapeHTML(translate('settingsTitle'))}">${ICONS.gear}</button>
                    <kbd id="qf-esc-key">ESC</kbd>
                </div>
                <div id="qf-segments" hidden></div>
                <div id="qf-panes">
                    <div id="qf-results"></div>
                    <div id="qf-detail-pane" hidden></div>
                </div>
                <div id="qf-footer">
                    <div id="qf-footer-shortcuts">
                        <span id="qf-footer-tab">${escapeHTML(translate('footerTab'))}</span>
                        <span id="qf-footer-fav">${escapeHTML(translate('footerFav'))}</span>
                        <span id="qf-footer-bbcode">${escapeHTML(translate('footerBBCode'))}</span>
                        <button type="button" id="qf-footer-export" class="qf-footer-action">${escapeHTML(translate('footerExport'))}</button>
                        <button type="button" id="qf-footer-refresh" class="qf-footer-action">${escapeHTML(translate('footerRefresh'))}</button>
                        <button type="button" id="qf-footer-help" class="qf-footer-action">${escapeHTML(translate('footerHelp'))}</button>
                    </div>
                    <div id="qf-footer-meta">
                        <button type="button" id="qf-origin-indicator" hidden></button>
                        <span id="qf-status"></span>
                        <button type="button" id="qf-version">v${VERSION}</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('#qf-backdrop').addEventListener('mousedown', close);

        const input = overlay.querySelector('#qf-input');
        input.addEventListener('input', (event) => scheduleSearch(event.target.value));
        input.addEventListener('keydown', handleInputKeydown);

        const resultsEl = overlay.querySelector('#qf-results');
        resultsEl.addEventListener('mousedown', handleResultsMousedown);
        resultsEl.addEventListener('scroll', () => {
            const nearBottom = resultsEl.scrollTop + resultsEl.clientHeight >= resultsEl.scrollHeight - 120;
            if (nearBottom) {
                loadMoreResults();
            }
        });

        const detailPaneEl = overlay.querySelector('#qf-detail-pane');
        detailPaneEl.addEventListener('mousedown', handleDetailPaneMousedown);
        overlay.querySelector('#qf-segments').addEventListener('mousedown', (event) => {
            const chip = event.target.closest('.qf-chip');
            if (!chip) return;
            event.preventDefault();
            if (chip.dataset.historySegment) {
                setHistorySegment(chip.dataset.historySegment);
            } else {
                setSegment(chip.dataset.segment);
            }
        });

        overlay.querySelector('#qf-save-search-btn').addEventListener('click', (event) => {
            event.preventDefault();
            openSaveSearchPanel();
        });

        overlay.querySelector('#qf-settings-btn').addEventListener('click', (event) => {
            event.preventDefault();
            openSettings();
        });

        overlay.querySelector('#qf-footer-export').addEventListener('click', (event) => {
            event.preventDefault();
            exportResultsBBCode();
        });

        overlay.querySelector('#qf-footer-refresh').addEventListener('click', (event) => {
            event.preventDefault();
            if (!state.loading) {
                refreshData();
            }
        });

        overlay.querySelector('#qf-footer-help').addEventListener('click', (event) => {
            event.preventDefault();
            toggleHelp();
        });

        overlay.querySelector('#qf-version').addEventListener('click', (event) => {
            event.preventDefault();
            if (state.updateAvailable) {
                const url = getUpdateCheckUrl();
                if (url) window.open(url, '_blank', 'noopener');
            }
        });

        overlay.querySelector('#qf-origin-indicator').addEventListener('click', (event) => {
            event.preventDefault();
            clearOriginOverride();
            showToast(translate('originCleared'));
            renderFooter();
        });
    }

    /*
     * ============================================================
     * RENDER
     * ============================================================
     */

    function render() {
        createUI();

        const overlay = document.getElementById('qf-overlay');
        const windowEl = document.getElementById('qf-window');
        const input = document.getElementById('qf-input');
        const results = document.getElementById('qf-results');
        const detailPane = document.getElementById('qf-detail-pane');
        const segmentsEl = document.getElementById('qf-segments');

        if (!state.open) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'block';

        // The help/settings/save-search panels replace #qf-results
        // outright and are never split; any open detail pane from a
        // previous view is stale once one of them is showing.
        const inPanel = state.showHelp || state.showSettings || state.showSaveSearch || state.showNoteEditor;
        if (inPanel && state.hierarchyStack.length) {
            resetHierarchy();
        }
        const splitOpen = !inPanel && state.hierarchyStack.length > 0;
        windowEl.classList.toggle('qf-window-split', splitOpen);
        detailPane.hidden = !splitOpen;
        if (splitOpen) {
            renderDetailPane(detailPane);
        } else {
            detailPane.innerHTML = '';
        }

        // Only steal focus back to the search input when focus isn't
        // already somewhere inside the palette: bindSettingsEvents()
        // re-renders on every settings field's blur (to reflect clamped/
        // normalized values), and re-focusing #qf-input unconditionally
        // there would yank focus away mid-Tab-navigation from whatever
        // settings field the user just moved to.
        if (document.activeElement !== input && !overlay.contains(document.activeElement)) {
            requestAnimationFrame(() => input.focus());
        }

        const saveSearchBtn = document.getElementById('qf-save-search-btn');
        if (saveSearchBtn) {
            saveSearchBtn.hidden = !isSavableQuery(state.query);
        }

        // Esc pops the detail pane first and only closes the whole
        // palette on a second press when one is open — not otherwise
        // discoverable from the static "ESC" key hint alone, so the
        // tooltip spells it out only while that two-stage behavior
        // is actually in play.
        const escKey = document.getElementById('qf-esc-key');
        if (escKey) {
            escKey.title = splitOpen ? translate('shortcutsEscTwoStage') : '';
        }

        // Segment chips only make sense while actively searching or
        // while browsing the empty-query history view; command output
        // (ghost/dist) and the help/settings/save-search panels are not
        // segmentable.
        const showSearchSegments = Boolean(state.query) && !inPanel && !isCommand(state.query) && state.segmentCounts && !state.loading;
        const showHistorySegments = !state.query && !inPanel && state.historyCounts;
        segmentsEl.hidden = !showSearchSegments && !showHistorySegments;
        if (showSearchSegments) {
            segmentsEl.innerHTML = CONFIG.SEGMENTS
                .filter((name) => name === CONFIG.DEFAULT_SEGMENT || state.segmentCounts[name] > 0)
                .map((name) => {
                    const active = name === state.segment ? ' qf-chip-active' : '';
                    const count = name === CONFIG.DEFAULT_SEGMENT ? state.segmentCounts[CONFIG.DEFAULT_SEGMENT] : state.segmentCounts[name];
                    return (
                        `<span class="qf-chip${active}" data-segment="${name}">` +
                        `${escapeHTML(translate(SEGMENT_LABEL_KEYS[name]))}` +
                        `<span class="qf-chip-count">${count}</span>` +
                        `</span>`
                    );
                })
                .join('');
        } else if (showHistorySegments) {
            segmentsEl.innerHTML = CONFIG.HISTORY_SEGMENTS
                .filter((name) => name === CONFIG.DEFAULT_HISTORY_SEGMENT || state.historyCounts[name] > 0)
                .map((name) => {
                    const active = name === state.historySegment ? ' qf-chip-active' : '';
                    const count = state.historyCounts[name];
                    return (
                        `<span class="qf-chip${active}" data-history-segment="${name}">` +
                        `${escapeHTML(translate(HISTORY_SEGMENT_LABEL_KEYS[name]))}` +
                        `<span class="qf-chip-count">${count}</span>` +
                        `</span>`
                    );
                })
                .join('');
        }

        renderFooter();

        if (state.showSaveSearch) {
            results.innerHTML = renderSaveSearchPanel();
            bindSaveSearchEvents(results);
            return;
        }

        if (state.showNoteEditor) {
            results.innerHTML = renderNoteEditorPanel();
            bindNoteEditorEvents(results);
            return;
        }

        if (state.showSettings) {
            results.innerHTML = renderSettings();
            bindSettingsEvents(results);
            return;
        }

        if (state.showHelp) {
            results.innerHTML = renderHelp();
            return;
        }

        if (state.loading) {
            // Checked before the empty-query history branch below: a user
            // who opens the palette right after a page reload and leaves
            // the query empty would otherwise silently see the history/
            // favorites view with no indication that world data is still
            // loading underneath, only noticing once they typed something.
            // Drop any stale results while a refresh is in flight.
            state.fullResults = [];
            state.segmentCounts = null;
            state.results = [];
            state.selected = 0;
            state.visibleCount = CONFIG.RESULTS_PAGE_SIZE;
            results.innerHTML = `
                <div class="qf-loading">
                    <div class="qf-spinner"></div>
                    <div class="qf-loading-text">${escapeHTML(translate('loadingWorldData'))}</div>
                </div>
            `;
            return;
        }

        if (!state.query) {
            renderHistory(results);
            return;
        }

        if (!state.results.length) {
            if (state.loadError) {
                results.innerHTML = `
                    <div class="qf-empty qf-empty-error">
                        <div class="qf-empty-title">${escapeHTML(translate('dataError'))}</div>
                        <div class="qf-empty-hint">${escapeHTML(translate(state.loadError))}</div>
                    </div>
                `;
            } else {
                results.innerHTML = `
                    <div class="qf-empty">
                        <div class="qf-empty-title">${escapeHTML(translate('noResults'))}</div>
                    </div>
                `;
            }
            return;
        }

        renderResultRows(results);

        const selectedEl = results.querySelector('.qf-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }

    /*
     * Only the first `state.visibleCount` rows are drawn: with a
     * broad query (e.g. a single letter) a world can match thousands
     * of towns, and building/parsing that much HTML on every
     * keystroke is what made the palette feel sluggish. More rows
     * are appended as the user scrolls near the bottom (see the
     * #qf-results scroll listener in createUI), so every result is
     * still reachable, just not all rendered upfront.
     */
    function renderResultRows(container) {
        const total = state.results.length;
        // Keyboard navigation (ArrowDown/End) can move state.selected
        // past what's currently rendered; grow the visible window so
        // the selected row is always actually in the DOM instead of
        // silently doing nothing when it's off-screen below the fold.
        if (state.selected >= state.visibleCount) {
            state.visibleCount = Math.min(
                total,
                Math.ceil((state.selected + 1) / CONFIG.RESULTS_PAGE_SIZE) * CONFIG.RESULTS_PAGE_SIZE
            );
        }
        const count = Math.min(state.visibleCount, total);
        let html = '';
        for (let i = 0; i < count; i++) {
            html += renderResult(state.results[i], i);
        }
        if (count < total) {
            html += `<div class="qf-results-more">${escapeHTML(translate('resultsMore', { shown: count, total }))}</div>`;
        }
        container.innerHTML = html;
    }

    /*
     * Grows visibleCount and appends just the newly-revealed rows
     * (instead of re-running the full render()), so scrolling to
     * load more never resets scroll position or re-touches rows
     * already on screen.
     */
    function loadMoreResults() {
        const total = state.results.length;
        if (state.visibleCount >= total) {
            return;
        }
        const results = document.getElementById('qf-results');
        if (!results) return;

        const more = results.querySelector('.qf-results-more');
        if (more) more.remove();

        const start = state.visibleCount;
        state.visibleCount = Math.min(state.visibleCount + CONFIG.RESULTS_PAGE_SIZE, total);

        let html = '';
        for (let i = start; i < state.visibleCount; i++) {
            html += renderResult(state.results[i], i);
        }
        if (state.visibleCount < total) {
            html += `<div class="qf-results-more">${escapeHTML(translate('resultsMore', { shown: state.visibleCount, total }))}</div>`;
        }
        results.insertAdjacentHTML('beforeend', html);
    }

    /*
     * Footer freshness status. Adding the status span means the plain
     * "loading" branch in render() is no longer the only place that
     * informs the user about data state; the footer keeps that
     * visible while searching.
     */
    function renderFooter() {
        const status = document.getElementById('qf-status');
        if (!status) return;

        let text;
        if (state.loading) {
            text = translate('loadingWorldData');
        } else if (state.loadError) {
            text = translate('dataError');
        } else if (!state.loaded) {
            text = '';
        } else {
            const age = Date.now() - state.savedAt;
            const minutes = Math.max(0, Math.round(age / 60000));
            if (age < 60000) {
                text = translate('dataFresh');
            } else if (minutes < 60) {
                text = translate('dataFreshMin', { n: minutes });
            } else if (minutes < 1440) {
                text = translate('dataFreshHour', { n: Math.round(minutes / 60) });
            } else {
                text = translate('dataFreshDay', { n: Math.round(minutes / 1440) });
            }
        }
        status.textContent = text;
        status.classList.toggle('qf-status-error', Boolean(state.loadError));

        const versionBtn = document.getElementById('qf-version');
        if (versionBtn) {
            const hasUpdate = Boolean(state.updateAvailable);
            versionBtn.classList.toggle('qf-version-update-available', hasUpdate);
            versionBtn.title = hasUpdate
                ? translate('updateAvailableTooltip', { version: state.updateAvailable })
                : '';
        }

        const originIndicator = document.getElementById('qf-origin-indicator');
        if (originIndicator) {
            const origin = loadOriginOverride();
            if (origin) {
                originIndicator.hidden = false;
                originIndicator.textContent = translate('originIndicator', { x: origin.x, y: origin.y });
                originIndicator.title = translate('originIndicatorTooltip');
            } else {
                originIndicator.hidden = true;
                originIndicator.textContent = '';
                originIndicator.title = '';
            }
        }
    }

    const HISTORY_SECTION_TITLE_KEYS = {
        saved: 'savedSearchesTitle',
        favorite: 'favoritesTitle',
        recent: 'recentTitle',
    };

    function renderHistory(container) {
        const rows = state.results;
        if (!rows.length) {
            container.innerHTML = `
                <div class="qf-empty">
                    <div class="qf-empty-title">${escapeHTML(translate('emptyTitle'))}</div>
                    <div class="qf-empty-subtitle">${escapeHTML(translate('emptySubtitle'))}</div>
                    <div class="qf-empty-hint">
                        ${translate('emptyHintCoords', { example: '55:123' })}
                    </div>
                    <div class="qf-empty-hint">
                        ${translate('emptyHintCommands')}
                    </div>
                </div>
            `;
            return;
        }

        let html = '';
        let currentSection = null;
        for (let index = 0; index < rows.length; index++) {
            const item = rows[index];
            if (item.section && item.section !== currentSection) {
                currentSection = item.section;
                const title = escapeHTML(translate(HISTORY_SECTION_TITLE_KEYS[currentSection]));
                const clearBtn = currentSection === 'recent' || currentSection === 'saved'
                    ? `<button type="button" class="qf-section-clear" data-clear-section="${currentSection}" title="${escapeHTML(translate('recentClearAll'))}">${escapeHTML(translate('recentClearAll'))}</button>`
                    : '';
                html += `<div class="qf-section">${title}${clearBtn}</div>`;
            }
            html += renderResult(item, index);
        }

        container.innerHTML = html;

        const selectedEl = container.querySelector('.qf-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }

    /*
     * ============================================================
     * HELP PANEL
     * ============================================================
     *
     * Rendered for "?" and ">help". Scrolls if needed, but the DOM
     * is detached from the live .qf-results container, so it cannot
     * be selected or opened by the palette navigation keys.
     */

    function renderHelp() {
        const shortcuts = [
            [hotkeyLabel(), translate('shortcutsOpen')],
            ['\u2191 \u2193', translate('footerNavigate')],
            ['\u2190 \u2192', translate('shortcutsHierarchyNav')],
            ['Enter', translate('footerOpen')],
            ['Tab', translate('footerTab')],
            ['Home / End', translate('shortcutsFirstLast')],
            ['Ctrl+F', translate('footerFav')],
            ['Ctrl+B', translate('footerBBCode')],
            ['Ctrl+O', translate('shortcutsSetOrigin')],
            ['Ctrl+N', translate('shortcutsEditNote')],
            ['Ctrl+Shift+B', translate('footerExport')],
            ['Ctrl+R', translate('footerRefresh')],
            ['Ctrl+D', translate('shortcutsSaveSearch')],
            ['Ctrl+E', translate('shortcutsRenameSaved')],
            ['Delete', translate('shortcutsRemoveRecent')],
            ['Ctrl+Shift+Delete', translate('shortcutsClearRecent')],
            ['Esc', translate('shortcutsEscTwoStage')],
            ['?', translate('shortcutsHelp')],
        ];

        const commands = [
            ['>goto 123:456', translate('commandGotoHelp')],
            ['>ghost [minPts] [near]', translate('commandGhostHelp')],
            ['>dist X:Y [X:Y...]', translate('commandDistHelp')],
            ['>island X:Y', translate('commandIslandHelp')],
            ['>near [X:Y] [radius]', translate('commandNearHelp')],
            ['>ocean M34 [alliance]', translate('commandOceanHelp')],
            ['>history <name|x:y>', translate('commandHistoryHelp')],
            ['>travel <unit,...> [X:Y] [X:Y] [sirens=N]', translate('commandTravelHelp')],
            ['>top players|alliances [N]', translate('commandTopHelp')],
            ['>vs <alliance1> vs <alliance2>', translate('commandVsHelp')],
            ['>settings', translate('commandSettingsHelp')],
            ['>help', translate('commandHelpHint')],
        ];

        const rows = (entries, withDescription) => entries
            .map(([label, description]) => (
                `<tr><td><kbd>${escapeHTML(label)}</kbd></td>` +
                `<td>${escapeHTML(description)}</td></tr>`
            ))
            .join('');

        return `
            <div class="qf-help">
                <div class="qf-help-title">${escapeHTML(translate('shortcutsTitle'))}</div>
                <table class="qf-help-table">${rows(shortcuts, true)}</table>
                <div class="qf-help-title">${escapeHTML(translate('commandHelpTitle'))}</div>
                <table class="qf-help-table">${rows(commands, true)}</table>
                <div class="qf-help-title">${escapeHTML(translate('scopeHelpTitle'))}</div>
                <div class="qf-help-text">${translate('scopeHelpDesc')}</div>
            </div>
        `;
    }

    /*
     * ============================================================
     * SAVE SEARCH PANEL
     * ============================================================
     *
     * Rendered by the bookmark icon / Ctrl+D (create mode, for the
     * current query) or by a saved-search row's pencil icon / Ctrl+E
     * (edit mode, rename only). Reuses the qf-settings-* classes so it
     * matches the settings panel's look without introducing new CSS.
     */

    function renderSaveSearchPanel() {
        const editing = state.saveSearchMode === 'edit';
        let query = state.query;
        let defaultName = state.query;
        let defaultNote = '';

        if (editing) {
            const entry = loadSavedSearches().find((item) => item.id === state.saveSearchEditId);
            query = entry ? entry.query : '';
            defaultName = entry ? entry.name : '';
            defaultNote = entry ? (entry.note || '') : '';
        }

        return `
            <div class="qf-settings">
                <div class="qf-help-title">${escapeHTML(translate(editing ? 'saveSearchEditTitle' : 'saveSearchPanelTitle'))}</div>
                <div class="qf-settings-row">
                    <label class="qf-settings-label" for="qf-save-search-name">${escapeHTML(translate('saveSearchNameLabel'))}</label>
                    <input
                        id="qf-save-search-name"
                        class="qf-settings-input"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        value="${escapeHTML(defaultName)}"
                    >
                </div>
                <div class="qf-settings-row">
                    <label class="qf-settings-label" for="qf-save-search-note">${escapeHTML(translate('favoriteNoteLabel'))}</label>
                    <input
                        id="qf-save-search-note"
                        class="qf-settings-input"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        maxlength="140"
                        value="${escapeHTML(defaultNote)}"
                    >
                </div>
                <div class="qf-help-text">${escapeHTML(query)}</div>
                <div class="qf-settings-actions">
                    <button type="button" id="qf-save-search-cancel" class="qf-settings-btn qf-settings-btn-secondary">${escapeHTML(translate('saveSearchCancel'))}</button>
                    <button type="button" id="qf-save-search-confirm" class="qf-settings-btn qf-settings-btn-primary">${escapeHTML(translate('saveSearchSave'))}</button>
                </div>
            </div>
        `;
    }

    /*
     * Inline "Edit note" panel for a favorited row (Ctrl+N / the
     * per-row note icon). Same qf-settings-* look as the save-search
     * panel above.
     */
    function renderNoteEditorPanel() {
        const item = state.noteEditItem;
        const currentNote = item ? favoriteNote(item) : '';
        return `
            <div class="qf-settings">
                <div class="qf-help-title">${escapeHTML(translate('favoriteNoteTitle', { name: item ? item.name : '' }))}</div>
                <div class="qf-settings-row">
                    <label class="qf-settings-label" for="qf-note-input">${escapeHTML(translate('favoriteNoteLabel'))}</label>
                    <input
                        id="qf-note-input"
                        class="qf-settings-input"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        maxlength="140"
                        value="${escapeHTML(currentNote)}"
                    >
                </div>
                <div class="qf-settings-actions">
                    <button type="button" id="qf-note-cancel" class="qf-settings-btn qf-settings-btn-secondary">${escapeHTML(translate('saveSearchCancel'))}</button>
                    <button type="button" id="qf-note-confirm" class="qf-settings-btn qf-settings-btn-primary">${escapeHTML(translate('saveSearchSave'))}</button>
                </div>
            </div>
        `;
    }

    function bindNoteEditorEvents(container) {
        const noteInput = container.querySelector('#qf-note-input');
        if (noteInput) {
            noteInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    submitNoteEditorPanel(container);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    closeNoteEditorPanel();
                }
            });
        }

        const cancelBtn = container.querySelector('#qf-note-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => closeNoteEditorPanel());
        }

        const confirmBtn = container.querySelector('#qf-note-confirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => submitNoteEditorPanel(container));
        }
    }

    function bindSaveSearchEvents(container) {
        const nameInput = container.querySelector('#qf-save-search-name');
        if (nameInput) {
            nameInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    submitSaveSearchPanel(container);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    closeSaveSearchPanel();
                }
            });
        }

        const cancelBtn = container.querySelector('#qf-save-search-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => closeSaveSearchPanel());
        }

        const confirmBtn = container.querySelector('#qf-save-search-confirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => submitSaveSearchPanel(container));
        }
    }

    /*
     * ============================================================
     * SETTINGS PANEL
     * ============================================================
     *
     * Rendered for the footer gear icon and ">settings". Like the
     * help panel, its DOM is detached from the live .qf-results
     * container and doesn't participate in palette navigation keys.
     * Every field applies immediately (live-updates CONFIG/state and
     * persists to localStorage) rather than requiring an explicit
     * save step; the "Save" button is a confirmation/close action.
     */

    function renderSettings() {
        const languageOptions = [
            `<option value="auto"${settings.language === 'auto' ? ' selected' : ''}>${escapeHTML(translate('settingsLanguageAuto'))}</option>`,
            ...Object.keys(LANGUAGE_NAMES).map((code) => (
                `<option value="${code}"${settings.language === code ? ' selected' : ''}>${escapeHTML(LANGUAGE_NAMES[code])}</option>`
            )),
        ].join('');

        const numberField = (id, key, label, step) => `
            <div class="qf-settings-row">
                <label class="qf-settings-label" for="${id}">${escapeHTML(translate(label))}</label>
                <input
                    id="${id}"
                    class="qf-settings-input qf-settings-input-number"
                    type="number"
                    data-setting="${key}"
                    min="${SETTINGS_BOUNDS[key].min}"
                    max="${SETTINGS_BOUNDS[key].max}"
                    step="${step || 1}"
                    value="${settings[key]}"
                >
            </div>
        `;

        return `
            <div class="qf-settings">
                <div class="qf-settings-row">
                    <label class="qf-settings-label" for="qf-set-language">${escapeHTML(translate('settingsLanguage'))}</label>
                    <select id="qf-set-language" class="qf-settings-input" data-setting="language">${languageOptions}</select>
                </div>
                <div class="qf-settings-row">
                    <label class="qf-settings-label" for="qf-set-hotkey">${escapeHTML(translate('settingsHotkey'))}</label>
                    <div class="qf-settings-hotkey">
                        <span class="qf-settings-hotkey-prefix">Ctrl+Shift+</span>
                        <input
                            id="qf-set-hotkey"
                            class="qf-settings-input qf-settings-input-hotkey"
                            type="text"
                            data-setting="hotkey"
                            maxlength="1"
                            autocomplete="off"
                            spellcheck="false"
                            value="${escapeHTML((settings.hotkey || 'f').toUpperCase())}"
                        >
                    </div>
                </div>
                ${numberField('qf-set-page-size', 'resultsPageSize', 'settingsPageSize')}
                ${numberField('qf-set-max-results', 'maxResults', 'settingsMaxResults')}
                ${numberField('qf-set-cache-ttl', 'cacheTtlHours', 'settingsCacheTtl')}
                ${numberField('qf-set-near-radius', 'nearMaxRadius', 'settingsNearRadius')}
                ${numberField('qf-set-ghost-min', 'ghostMinPoints', 'settingsGhostMin')}
                <div class="qf-settings-row">
                    <label class="qf-settings-label" for="qf-set-conquest-history">
                        ${escapeHTML(translate('settingsConquestHistory'))}
                        <span class="qf-settings-hint">${escapeHTML(translate('settingsConquestHistoryHint'))}</span>
                    </label>
                    <input
                        id="qf-set-conquest-history"
                        class="qf-settings-checkbox"
                        type="checkbox"
                        data-setting="conquestHistoryEnabled"
                        ${settings.conquestHistoryEnabled ? 'checked' : ''}
                    >
                </div>
                <div class="qf-settings-actions">
                    <button type="button" id="qf-settings-check-updates" class="qf-settings-btn qf-settings-btn-secondary">${escapeHTML(translate('settingsCheckUpdates'))}</button>
                    <button type="button" id="qf-settings-reset" class="qf-settings-btn qf-settings-btn-secondary">${escapeHTML(translate('settingsReset'))}</button>
                    <button type="button" id="qf-settings-save" class="qf-settings-btn qf-settings-btn-primary">${escapeHTML(translate('settingsSave'))}</button>
                </div>
            </div>
        `;
    }

    /*
     * Applies one changed settings field: parses/clamps the raw value,
     * updates the in-memory `settings` object, persists it, and
     * re-applies the runtime-relevant subset onto CONFIG so the
     * change takes effect immediately (no reload needed).
     */
    function applySettingField(key, rawValue) {
        if (key === 'language') {
            settings.language = rawValue && LANGUAGE_NAMES[rawValue] ? rawValue : 'auto';
        } else if (key === 'hotkey') {
            const letter = String(rawValue || '').trim().toLowerCase().slice(-1);
            settings.hotkey = /^[a-z0-9]$/.test(letter) ? letter : SETTINGS_DEFAULTS.hotkey;
        } else if (key === 'conquestHistoryEnabled') {
            settings.conquestHistoryEnabled = Boolean(rawValue);
            // Enabling the toggle loads conquers.txt in the background
            // (fire-and-forget); disabling it just stops future >history
            // lookups from finding data, the cached copy is left alone.
            if (settings.conquestHistoryEnabled) {
                loadConquestHistory();
            }
        } else if (key in SETTINGS_BOUNDS) {
            const parsed = Number(rawValue);
            settings[key] = Number.isFinite(parsed) ? clampSetting(key, parsed) : SETTINGS_DEFAULTS[key];
        }

        persistSettings();
        applySettingsToConfig();
        state.locale = resolveLocale(WORLD);

        if (key === 'language') {
            // The settings panel's own labels are translated too, so a
            // language change needs a full re-render (not just the
            // static footer/placeholder refreshStaticTexts() handles).
            render();
        } else {
            refreshStaticTexts();
        }
    }

    /*
     * Wires up change handlers for the settings panel. Called after
     * every render() while state.showSettings is true, since the
     * panel's DOM is rebuilt from scratch each time (same pattern as
     * the segment chips / result rows elsewhere in this file).
     */
    function bindSettingsEvents(container) {
        container.querySelectorAll('[data-setting]').forEach((el) => {
            const key = el.dataset.setting;
            const isCheckbox = el.type === 'checkbox';
            const eventName = isCheckbox ? 'change' : (el.tagName === 'SELECT' ? 'change' : 'input');
            el.addEventListener(eventName, () => applySettingField(key, isCheckbox ? el.checked : el.value));
            // On blur, only patch this one field's displayed value from
            // the now-normalized `settings` object (e.g. an out-of-range
            // number clamped back, or an invalid hotkey falling back to
            // the default) instead of calling the full render(): a full
            // re-render tears down and rebuilds the whole panel's DOM,
            // which — since it runs synchronously inside the blur event,
            // right as the browser is about to move focus to whatever
            // element Tab targets next — destroys that target element
            // out from under the browser and silently strands focus back
            // on #qf-input instead of advancing to the next field.
            el.addEventListener('blur', () => {
                if (key === 'hotkey') {
                    el.value = (settings.hotkey || 'f').toUpperCase();
                } else if (key in SETTINGS_BOUNDS) {
                    el.value = settings[key];
                }
                // 'language'/'conquestHistoryEnabled' never need
                // normalization-on-blur: the former already re-renders
                // via applySettingField on 'change', the latter is a
                // checkbox with only two possible values.
            });
        });

        const checkUpdatesBtn = container.querySelector('#qf-settings-check-updates');
        if (checkUpdatesBtn) {
            checkUpdatesBtn.addEventListener('click', () => {
                checkUpdatesBtn.disabled = true;
                checkForUpdates({ force: true }).then((remoteVersion) => {
                    checkUpdatesBtn.disabled = false;
                    renderFooter();
                    showToast(remoteVersion
                        ? translate('updateAvailableToast', { version: remoteVersion })
                        : translate('updateUpToDate'));
                });
            });
        }

        const resetBtn = container.querySelector('#qf-settings-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                settings = { ...SETTINGS_DEFAULTS };
                persistSettings();
                applySettingsToConfig();
                state.locale = resolveLocale(WORLD);
                refreshStaticTexts();
                showToast(translate('settingsResetDone'));
                render();
            });
        }

        const saveBtn = container.querySelector('#qf-settings-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                persistSettings();
                showToast(translate('settingsSaved'));
                const input = document.getElementById('qf-input');
                input.value = '';
                performSearch('', ++searchToken);
            });
        }
    }

    /*
     * Updates the pieces of the palette UI that are only written once
     * in createUI()'s innerHTML (placeholder, footer shortcut labels,
     * settings button title) so a language change made from the
     * settings panel is reflected immediately without closing/
     * reopening the palette.
     */
    function refreshStaticTexts() {
        const input = document.getElementById('qf-input');
        if (input) input.placeholder = translate('searchPlaceholder');

        const settingsBtn = document.getElementById('qf-settings-btn');
        if (settingsBtn) settingsBtn.title = translate('settingsTitle');

        const setText = (id, key) => {
            const el = document.getElementById(id);
            if (el) el.textContent = translate(key);
        };
        setText('qf-footer-tab', 'footerTab');
        setText('qf-footer-fav', 'footerFav');
        setText('qf-footer-bbcode', 'footerBBCode');
        setText('qf-footer-export', 'footerExport');
        setText('qf-footer-refresh', 'footerRefresh');
        setText('qf-footer-help', 'footerHelp');
    }

    /*
     * ============================================================
     * ICONS
     * ============================================================
     *
     * Emoji glyphs render inconsistently across operating systems
     * (different sizes/styles, and outright missing on systems with
     * no emoji font installed, showing as a "tofu" box). Inline SVG
     * icons avoid both problems and don't need any external asset
     * or font dependency: they render identically everywhere and
     * inherit their color from CSS via `currentColor`.
     */

    function svgIcon(inner) {
        return `<svg class="qf-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
    }

    const ICONS = {
        search: svgIcon('<circle cx="10" cy="10" r="6.5"></circle><line x1="20" y1="20" x2="15" y2="15"></line>'),
        player: svgIcon('<circle cx="12" cy="8" r="3.4"></circle><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5"></path>'),
        alliance: svgIcon('<path d="M12 3l7 3v5c0 5-3.2 8.6-7 10-3.8-1.4-7-5-7-10V6l7-3z"></path>'),
        town: svgIcon('<path d="M5 21V9l7-5 7 5v12"></path><path d="M10 21v-6h4v6"></path>'),
        ghost: svgIcon('<path d="M6 21V11a6 6 0 0 1 12 0v10l-2.2-1.6L14 21l-2-1.6L10 21l-1.8-1.6L6 21z"></path><circle cx="9.5" cy="11" r="0.8" fill="currentColor" stroke="none"></circle><circle cx="14.5" cy="11" r="0.8" fill="currentColor" stroke="none"></circle>'),
        island: svgIcon('<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3c2.5 2.5 3.8 6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-6-3.8-9S9.5 5.5 12 3z"></path>'),
        command: svgIcon('<rect x="3" y="4" width="18" height="16" rx="2"></rect><polyline points="7 9 10.5 12 7 15"></polyline><line x1="12.5" y1="15" x2="17" y2="15"></line>'),
        coordinate: svgIcon('<path d="M12 21s7-7.5 7-12a7 7 0 1 0-14 0c0 4.5 7 12 7 12z"></path><circle cx="12" cy="9" r="2.4"></circle>'),
        info: svgIcon('<circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16"></line><circle cx="12" cy="7.7" r="0.9" fill="currentColor" stroke="none"></circle>'),
        bbcode: svgIcon('<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>'),
        check: svgIcon('<polyline points="4 12 9.5 17.5 20 6"></polyline>'),
        starOutline: svgIcon('<path d="M12 3.3l2.6 5.4 5.9.7-4.3 4.1 1.1 5.9L12 16.6l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.7L12 3.3z"></path>'),
        starFilled: svgIcon('<path d="M12 3.3l2.6 5.4 5.9.7-4.3 4.1 1.1 5.9L12 16.6l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.7L12 3.3z" fill="currentColor" stroke="none"></path>'),
        gear: svgIcon('<circle cx="12" cy="12" r="3.2"></circle><path d="M12 3.2v2.1M12 18.7v2.1M20.8 12h-2.1M5.3 12H3.2M17.9 6.1l-1.5 1.5M7.6 16.4l-1.5 1.5M17.9 17.9l-1.5-1.5M7.6 7.6L6.1 6.1"></path>'),
        trash: svgIcon('<polyline points="4 7 20 7"></polyline><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"></path><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>'),
        bookmark: svgIcon('<path d="M6 3.8a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 3.8v16.4l-6-3.6-6 3.6V3.8z"></path>'),
        pencil: svgIcon('<path d="M4 20l.9-4.2L15.4 5.3a1.8 1.8 0 0 1 2.5 0l1.8 1.8a1.8 1.8 0 0 1 0 2.5L9.2 19.1 4 20z"></path><line x1="14" y1="6.7" x2="17.3" y2="10"></line>'),
        chevronRight: svgIcon('<polyline points="9 5 16 12 9 19"></polyline>'),
        chevronLeft: svgIcon('<polyline points="15 5 8 12 15 19"></polyline>'),
        origin: svgIcon('<circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"></circle><line x1="12" y1="2.5" x2="12" y2="5.5"></line><line x1="12" y1="18.5" x2="12" y2="21.5"></line><line x1="2.5" y1="12" x2="5.5" y2="12"></line><line x1="18.5" y1="12" x2="21.5" y2="12"></line>'),
        note: svgIcon('<path d="M6 3h9l4 4v14H6z"></path><path d="M15 3v4h4"></path><line x1="8.5" y1="11" x2="15.5" y2="11"></line><line x1="8.5" y1="14.5" x2="15.5" y2="14.5"></line>'),
    };

    /*
     * ============================================================
     * RESULT ROW
     * ============================================================
     */

    /*
     * The first row of a player/alliance/island drill-down (a result
     * set built by playerDetailRows/allianceDetailRows/islandRows)
     * acts as a header/context line for everything listed below it,
     * so it gets a slightly bolder visual treatment instead of
     * blending in as just another selectable row.
     */
    function isDetailHeader(item, index, pane) {
        // Only the left-hand list ever has this kind of "header + list
        // of children" shape (built by playerDetailRows/
        // allianceDetailRows/islandRows via performSearch's state.detail
        // flag). The hierarchy detail pane's own rows are always a flat,
        // homogeneous list of children (all players, or all towns), so
        // this never applies there even if state.detail also happens to
        // be true for the unrelated left-hand list at the same time.
        // NOTE: townHistoryRows also builds a "header + list" shape with
        // a type:'town' header, but 'town' is intentionally excluded
        // here: >ghost/>near/>ocean also set state.detail=true over a
        // FLAT list of towns with no header row, so including 'town'
        // would wrongly bold their first (non-header) result too.
        return pane !== 'detail' && index === 0 && state.detail && (item.type === 'player' || item.type === 'alliance' || item.type === 'island');
    }

    /*
     * Shared row renderer for both the left-hand list and the
     * right-hand detail pane. `pane` ('list' | 'detail') controls
     * which selection index applies and is stamped as data-pane so
     * click handlers route to the right stack; `selectedIndex`
     * defaults to that pane's own tracked selection.
     */
    function renderResult(item, index, pane, selectedIndex) {
        pane = pane || 'list';
        if (selectedIndex === undefined) {
            selectedIndex = pane === 'detail' ? (currentHierarchyLevel() || {}).selected : state.selected;
        }
        const selected = index === selectedIndex ? ' qf-selected' : '';
        const favorite = item.type !== 'info' && item.type !== 'saved-search' && isFavorite(item) ? ' qf-favorite' : '';
        const header = isDetailHeader(item, index, pane) ? ' qf-result-header' : '';
        const paneAttr = ` data-pane="${pane}"`;
        // Alliance/player/island rows have children (members/towns) worth
        // drilling into; the chevron is always shown (even without
        // Curator) so the affordance is discoverable, same as the
        // >ghost/>island/>near/>ocean commands always appearing in >help
        // — the premium gate only applies once the user actually drills
        // in (see pushHierarchyLevel).
        const chevron = isDrillable(item)
            ? `<span class="qf-chevron" title="${escapeHTML(translate('hierarchyDrillTooltip'))}">${ICONS.chevronRight}</span>`
            : '';

        let icon = ICONS.coordinate;
        let badge = '';
        let badgeClass = '';
        let meta = '';
        let title = '';
        let info = false;

        switch (item.type) {
            case 'player': {
                icon = ICONS.player;
                badge = translate('badgePlayer');
                badgeClass = 'qf-badge-player';
                const player = item.data;
                if (player) {
                    const alliance = player.allianceId ? DATA.allianceById.get(player.allianceId) : null;
                    const parts = [];
                    if (player.rank) parts.push(`#${player.rank.toLocaleString()}`);
                    parts.push(
                        `${player.towns.toLocaleString()} ${translate('townsSuffix')}`,
                        `${player.points.toLocaleString()} ${translate('ptsSuffix')}`,
                    );
                    if (alliance) parts.push(escapeHTML(alliance.name));
                    meta = parts.join(' &middot; ');
                }
                break;
            }

            case 'alliance': {
                icon = ICONS.alliance;
                badge = translate('badgeAlliance');
                badgeClass = 'qf-badge-alliance';
                const alliance = item.data;
                if (alliance) {
                    const parts = [];
                    if (alliance.rank) parts.push(`#${alliance.rank.toLocaleString()}`);
                    parts.push(
                        `${alliance.members.toLocaleString()} ${translate('membersSuffix')}`,
                        `${alliance.towns.toLocaleString()} ${translate('townsSuffix')}`,
                        `${alliance.points.toLocaleString()} ${translate('ptsSuffix')}`,
                    );
                    meta = parts.join(' &middot; ');
                }
                break;
            }

            case 'town': {
                const { playerName, allianceName } = townOwnerNames(item);
                const isGhost = item.data ? item.data.playerId === 0 : !playerName;
                icon = isGhost ? ICONS.ghost : ICONS.town;
                badge = isGhost ? translate('ghostLabel') : translate('badgeTown');
                badgeClass = isGhost ? 'qf-badge-coordinate' : 'qf-badge-town';
                const owner = playerName ? ` &middot; ${escapeHTML(playerName)}` : '';
                const alliance = allianceName ? ` &middot; ${escapeHTML(allianceName)}` : '';
                const points = item.data ? item.data.points : (item.points || 0);
                const pts = points ? ` &middot; ${points.toLocaleString()} ${translate('ptsSuffix')}` : '';
                const sea = getSea(item.x, item.y);
                const distance = Number.isFinite(item.distance) ? ` &middot; ${item.distance}` : '';
                // Single-town lookup against conquers.txt (already
                // loaded, opt-in data): not an aggregate view, so no
                // Curator gating needed, same as the plain town/coord
                // search this row already comes from.
                const lastConquest = lastConquestEvent(item.id);
                let history = '';
                if (lastConquest) {
                    const days = Math.max(0, Math.floor((Date.now() - lastConquest.ts) / (24 * 60 * 60 * 1000)));
                    if (isGhost) {
                        // Ghost towns don't log an "abandoned" event (see
                        // parseConquers), only the last real conquest, so
                        // this is "last known activity", not "ghost for
                        // N days" — worded accordingly in the string.
                        history = ` &middot; <span class="qf-recent-conquest">${escapeHTML(translate('lastActivity', { n: days }))}</span>`;
                    } else if (lastConquest.ts >= Date.now() - CONFIG.RECENT_CONQUEST_WINDOW_MS) {
                        history = ` &middot; <span class="qf-recent-conquest">${escapeHTML(translate('recentlyConquered', { n: days }))}</span>`;
                    }
                }
                meta = `${item.x}:${item.y} &middot; ${sea}${pts}${owner}${alliance}${distance}${history}`;

                if (isCuratorActive()) {
                    const islandTowns = DATA.townsByCoord ? DATA.townsByCoord.get(`${item.x}:${item.y}`) : null;
                    if (islandTowns && islandTowns.length > 1) {
                        title = ` title="${escapeHTML(translate('onIslandInfo', { n: islandTowns.length }))}"`;
                    }
                }
                break;
            }

            case 'island': {
                icon = ICONS.island;
                badge = translate('badgeIsland');
                badgeClass = 'qf-badge-coordinate';
                const distance = Number.isFinite(item.distance) ? `${item.distance} &middot; ` : '';
                const townsLabel = item.capacity > 0
                    ? translate('islandTownsWithCapacity', { n: item.townCount, cap: item.capacity })
                    : translate('islandTowns', { n: item.townCount });
                const parts = [
                    townsLabel,
                    translate('islandAlliances', { n: item.allianceCount }),
                ];
                if (item.ghostCount) parts.push(translate('islandGhosts', { n: item.ghostCount }));
                meta = `${distance}${getSea(item.x, item.y)} &middot; ${parts.join(' &middot; ')}`;
                break;
            }

            case 'command-suggestion': {
                icon = ICONS.command;
                badge = translate('badgeCommand');
                badgeClass = 'qf-badge-coordinate';
                meta = escapeHTML(item.helpText);
                info = true;
                break;
            }

            case 'coordinate': {
                icon = ICONS.coordinate;
                badge = translate('badgeCoordinate');
                badgeClass = 'qf-badge-coordinate';
                meta = `${item.x}:${item.y}`;
                break;
            }

            case 'saved-search': {
                icon = ICONS.bookmark;
                badge = translate('badgeSavedSearch');
                badgeClass = 'qf-badge-coordinate';
                meta = item.name !== item.query ? escapeHTML(item.query) : '';
                break;
            }

            case 'info':
                icon = ICONS.info;
                info = true;
                break;
        }

        if (info) {
            return `
                <div class="qf-result-info" data-index="${index}"${paneAttr}>
                    <span class="qf-result-info-icon">${icon}</span>
                    <span class="qf-result-info-text">${escapeHTML(item.name)}</span>
                </div>
            `;
        }

        // Saved searches have no favorite/BBCode concept (they're a
        // saved query, not a resolved player/alliance/town/coordinate
        // target); they get their own edit (rename) + remove icons
        // instead of the star/BBCode/recent-trash combo below.
        if (item.type === 'saved-search') {
            const editBtn = `<span class="qf-saved-edit" title="${escapeHTML(translate('saveSearchEditTooltip'))}">${ICONS.pencil}</span>`;
            const removeBtn = `<span class="qf-saved-remove" title="${escapeHTML(translate('saveSearchRemove'))}">${ICONS.trash}</span>`;
            const noteHTML = item.note ? `<div class="qf-result-note">${escapeHTML(item.note)}</div>` : '';
            return `
                <div class="qf-result${selected}${header}" data-index="${index}"${paneAttr}>
                    <span class="qf-result-icon">${icon}</span>
                    <div class="qf-result-body">
                        <div class="qf-result-line1">
                            <span class="qf-result-name">${escapeHTML(item.name)}</span>
                            ${editBtn}
                            ${removeBtn}
                            ${badge ? `<span class="qf-badge ${badgeClass}">${escapeHTML(badge)}</span>` : ''}
                        </div>
                        ${meta ? `<div class="qf-result-meta">${meta}</div>` : ''}
                        ${noteHTML}
                    </div>
                </div>
            `;
        }

        // Filled star (favorite) vs. outline star (not) — clicking is
        // handled in handleResultClick.
        const star = `<span class="qf-star" title="${escapeHTML(translate('favoritesTitle'))}">${isFavorite(item) ? ICONS.starFilled : ICONS.starOutline}</span>`;
        // Only recent (non-favorite) history rows can be individually
        // removed; favorites are managed via the star toggle instead.
        const removeBtn = item.section === 'recent'
            ? `<span class="qf-remove" title="${escapeHTML(translate('recentRemove'))}">${ICONS.trash}</span>`
            : '';
        // Mouse equivalent of Ctrl+B: every row that has a BBCode
        // representation (see bbcodeFor) gets a clickable icon, so
        // copying isn't keyboard-only.
        const bbcodeBtn = bbcodeFor(item)
            ? `<span class="qf-bbcode-btn" title="${escapeHTML(translate('footerBBCode'))}">${ICONS.bbcode}</span>`
            : '';
        // Mouse equivalent of Ctrl+O: only rows with coordinates
        // (town/coordinate/island, see setOriginFromItem) can be
        // pinned as the >dist/>near/>ghost near/>travel origin.
        const originBtn = (item.type === 'town' || item.type === 'coordinate' || item.type === 'island')
            ? `<span class="qf-origin-btn" title="${escapeHTML(translate('originSetTooltip'))}">${ICONS.origin}</span>`
            : '';
        // Mouse equivalent of Ctrl+N: only favorited rows can carry a
        // note (see favoriteNote/setFavoriteNote), so the icon only
        // shows once a row is already starred.
        const noteBtn = item.section === 'favorite'
            ? `<span class="qf-note-btn" title="${escapeHTML(translate('favoriteNoteTooltip'))}">${ICONS.note}</span>`
            : '';
        const noteHTML = item.note ? `<div class="qf-result-note">${escapeHTML(item.note)}</div>` : '';

        return `
            <div class="qf-result${selected}${favorite}${header}" data-index="${index}"${paneAttr}${title}>
                <span class="qf-result-icon">${icon}</span>
                <div class="qf-result-body">
                    <div class="qf-result-line1">
                        <span class="qf-result-name">${escapeHTML(item.name)}</span>
                        ${star}
                        ${bbcodeBtn}
                        ${originBtn}
                        ${noteBtn}
                        ${removeBtn}
                        ${badge ? `<span class="qf-badge ${badgeClass}">${escapeHTML(badge)}</span>` : ''}
                        ${chevron}
                    </div>
                    ${meta ? `<div class="qf-result-meta">${meta}</div>` : ''}
                    ${noteHTML}
                </div>
            </div>
        `;
    }

    /*
     * ============================================================
     * DETAIL PANE (hierarchy drill-down)
     * ============================================================
     *
     * Renders the right-hand pane: a breadcrumb bar (one clickable
     * segment per stack level, jumping back to it) plus the current
     * level's rows, reusing renderResult() with pane='detail' so the
     * row markup/CSS stays identical to the left-hand list.
     */

    function renderDetailPane(container) {
        const level = currentHierarchyLevel();
        if (!level) {
            container.innerHTML = '';
            return;
        }

        const breadcrumb = state.hierarchyStack
            .map((entry, depth) => {
                const isLast = depth === state.hierarchyStack.length - 1;
                const label = escapeHTML(entry.source.name);
                return isLast
                    ? `<span class="qf-breadcrumb-item qf-breadcrumb-current">${label}</span>`
                    : `<button type="button" class="qf-breadcrumb-item" data-depth="${depth}">${label}</button>`;
            })
            .join('<span class="qf-breadcrumb-sep">&rsaquo;</span>');

        let rowsHTML;
        if (!level.rows.length) {
            rowsHTML = `
                <div class="qf-empty">
                    <div class="qf-empty-title">${escapeHTML(translate('noResults'))}</div>
                </div>
            `;
        } else {
            rowsHTML = level.rows.map((item, index) => renderResult(item, index, 'detail', level.selected)).join('');
        }

        container.innerHTML = `
            <div class="qf-detail-breadcrumb">${breadcrumb}</div>
            <div class="qf-detail-rows">${rowsHTML}</div>
        `;

        const selectedEl = container.querySelector('.qf-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }

    /*
     * ============================================================
     * KEYBOARD (inside the palette)
     * ============================================================
     */

    function handleInputKeydown(event) {
        if (event.ctrlKey || event.metaKey) {
            const key = event.key.toLowerCase();

            if (key === CONFIG.FAV_KEY) {
                event.preventDefault();
                toggleFavoriteSelected();
                return;
            }

            if (key === CONFIG.REFRESH_KEY) {
                event.preventDefault();
                if (!state.loading) {
                    refreshData();
                }
                return;
            }

            if (key === CONFIG.EXPORT_KEY && event.shiftKey) {
                event.preventDefault();
                exportResultsBBCode();
                return;
            }

            if (key === CONFIG.BBCODE_KEY) {
                event.preventDefault();
                copySelectedBBCode();
                return;
            }

            if (key === CONFIG.SAVE_SEARCH_KEY) {
                event.preventDefault();
                openSaveSearchPanel();
                return;
            }

            if (key === CONFIG.RENAME_KEY) {
                event.preventDefault();
                const item = state.results[state.selected];
                if (item && item.type === 'saved-search') {
                    openRenameSavedSearchPanel(item);
                }
                return;
            }

            if (key === CONFIG.ORIGIN_KEY) {
                event.preventDefault();
                setOriginSelected();
                return;
            }

            if (key === CONFIG.NOTE_KEY) {
                event.preventDefault();
                const item = getFocusedItem();
                if (item && isFavorite(item)) {
                    openNoteEditorPanel(item);
                }
                return;
            }
        }

        // Keyboard equivalents of the Recent/Saved-searches history
        // mouse controls: Delete removes the selected row (same guard
        // as the per-row trash icon click), Ctrl+Shift+Delete wipes
        // the whole section the selected row belongs to (same guard as
        // that section's "Clear" button click).
        if (event.key === 'Delete') {
            if (event.ctrlKey && event.shiftKey) {
                event.preventDefault();
                clearSelectedHistorySection();
                return;
            }
            if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                removeSelectedHistoryItem();
                return;
            }
        }

        const inDetailPane = state.focusPane === 'detail' && state.hierarchyStack.length > 0;
        const activeList = inDetailPane ? currentHierarchyRows() : state.results;
        const activeSelected = inDetailPane ? currentHierarchyLevel().selected : state.selected;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (activeList.length) {
                    setPaneSelected(inDetailPane, (activeSelected + 1) % activeList.length);
                    render();
                }
                break;

            case 'ArrowUp':
                event.preventDefault();
                if (activeList.length) {
                    setPaneSelected(inDetailPane, (activeSelected - 1 + activeList.length) % activeList.length);
                    render();
                }
                break;

            // Drill into (Right) / back out of (Left) the hierarchy pane.
            // Free everywhere else in the file: no prior ArrowLeft/
            // ArrowRight bindings exist to conflict with.
            case 'ArrowRight': {
                const item = activeList[activeSelected];
                if (isDrillable(item)) {
                    event.preventDefault();
                    pushHierarchyLevel(item, inDetailPane);
                    render();
                }
                break;
            }

            case 'ArrowLeft':
                if (inDetailPane) {
                    event.preventDefault();
                    popHierarchyLevel();
                    render();
                }
                break;

            case 'Tab':
                event.preventDefault();
                if (state.query) {
                    cycleSegment(event.shiftKey ? -1 : 1);
                } else {
                    cycleHistorySegment(event.shiftKey ? -1 : 1);
                }
                break;

            case 'Home':
                event.preventDefault();
                if (activeList.length) {
                    setPaneSelected(inDetailPane, 0);
                    render();
                }
                break;

            case 'End':
                event.preventDefault();
                if (activeList.length) {
                    setPaneSelected(inDetailPane, activeList.length - 1);
                    render();
                }
                break;

            case 'Enter':
                event.preventDefault();
                openResult(activeList[activeSelected]);
                break;

            case 'Escape':
                event.preventDefault();
                // First Esc only backs out of an open detail pane (pop
                // every level at once, back to the left-hand list);
                // a second Esc then closes the whole overlay, same as
                // when no pane was ever open.
                if (state.hierarchyStack.length) {
                    resetHierarchy();
                    render();
                } else {
                    close();
                }
                break;
        }
    }

    /*
     * ============================================================
     * CLICK
     * ============================================================
     */

    /*
     * Shared by both #qf-results and #qf-detail-pane (see data-pane
     * stamped on every row by renderResult): resolves which list/
     * selection setter a click applies to, then handles the same set
     * of per-row icons either pane can show, plus the chevron that
     * pushes a new detail-pane level.
     */
    function handleResultClick(event) {
        const row = event.target.closest('.qf-result');
        if (!row) return;

        const inDetailPane = row.dataset.pane === 'detail';
        const index = Number(row.dataset.index);
        const list = inDetailPane ? currentHierarchyRows() : state.results;
        const item = list[index];

        if (event.target.closest('.qf-chevron')) {
            event.stopPropagation();
            if (isDrillable(item)) {
                setPaneSelected(inDetailPane, index);
                pushHierarchyLevel(item, inDetailPane);
                render();
            }
            return;
        }

        if (event.target.closest('.qf-star')) {
            event.stopPropagation();
            if (item && item.type !== 'info') {
                toggleFavorite(item);
                // In the history view the row set must be rebuilt so a
                // just-unfavorited item leaves the Favorites group; a
                // fresh token keeps this in sync with any in-flight
                // search. Otherwise a simple re-render is enough since
                // favorite status doesn't change search result membership.
                if (!state.query) {
                    performSearch('', ++searchToken);
                } else {
                    render();
                }
            }
            return;
        }

        if (event.target.closest('.qf-remove')) {
            event.stopPropagation();
            if (item && item.section === 'recent') {
                removeHistoryItem(item);
                performSearch('', ++searchToken);
            }
            return;
        }

        if (event.target.closest('.qf-saved-remove')) {
            event.stopPropagation();
            if (item && item.type === 'saved-search') {
                removeSavedSearch(item.id);
                performSearch('', ++searchToken);
            }
            return;
        }

        if (event.target.closest('.qf-saved-edit')) {
            event.stopPropagation();
            if (item && item.type === 'saved-search') {
                setPaneSelected(inDetailPane, index);
                openRenameSavedSearchPanel(item);
            }
            return;
        }

        if (event.target.closest('.qf-bbcode-btn')) {
            event.stopPropagation();
            copyBBCode(item);
            return;
        }

        if (event.target.closest('.qf-origin-btn')) {
            event.stopPropagation();
            setPaneSelected(inDetailPane, index);
            if (setOriginFromItem(item)) {
                showToast(translate('originSet', { x: item.x, y: item.y }));
                render();
            }
            return;
        }

        if (event.target.closest('.qf-note-btn')) {
            event.stopPropagation();
            setPaneSelected(inDetailPane, index);
            if (item && isFavorite(item)) {
                openNoteEditorPanel(item);
            }
            return;
        }

        setPaneSelected(inDetailPane, index);
        openResult(item);
    }

    /*
     * The "Clear" button on a history section header (Recent or Saved
     * searches) lives outside .qf-result rows, so it needs its own
     * delegated handler instead of piggybacking on handleResultClick.
     * data-clear-section on the button tells which list to wipe.
     */
    function handleResultsMousedown(event) {
        const clearBtn = event.target.closest('.qf-section-clear');
        if (clearBtn) {
            event.stopPropagation();
            if (clearBtn.dataset.clearSection === 'saved') {
                clearSavedSearches();
                showToast(translate('savedSearchesCleared'));
            } else {
                clearHistory();
                showToast(translate('recentCleared'));
            }
            performSearch('', ++searchToken);
            return;
        }
        handleResultClick(event);
    }

    /*
     * The detail pane has its own breadcrumb bar (outside any
     * .qf-result row) on top of the same per-row icons/chevron the
     * left-hand list has, so it gets its own delegated mousedown
     * handler instead of reusing handleResultsMousedown verbatim.
     */
    function handleDetailPaneMousedown(event) {
        const crumb = event.target.closest('.qf-breadcrumb-item[data-depth]');
        if (crumb) {
            event.stopPropagation();
            popHierarchyToDepth(Number(crumb.dataset.depth));
            render();
            return;
        }
        handleResultClick(event);
    }

    /*
     * ============================================================
     * OPEN / CLOSE
     * ============================================================
     */

    function open() {
        createUI();

        state.open = true;
        // Deliberately NOT resetHierarchy() here: closing the palette
        // (Enter on a result, Esc, Ctrl+Shift+F, or the menu button)
        // never touches state.hierarchyStack/focusPane, so reopening
        // restores whatever list/detail-pane view was showing before,
        // instead of always snapping back to the flat list. A fresh
        // search (performSearch) still resets it, since a new query
        // invalidates the old pane's rows.

        const input = document.getElementById('qf-input');

        if (state.query) {
            input.value = state.query;
            render();
            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        } else {
            state.query = '';
            state.fullResults = buildHistoryResults();
            state.historyCounts = computeHistoryCounts(state.fullResults);
            state.historySegment = CONFIG.DEFAULT_HISTORY_SEGMENT;
            applyHistorySegment();
            state.segment = CONFIG.DEFAULT_SEGMENT;
            state.segmentCounts = null;
            state.showHelp = false;
            state.showSettings = false;
            state.showSaveSearch = false;
            state.showNoteEditor = false;

            input.value = '';
            render();
            requestAnimationFrame(() => input.focus());
        }
    }

    /*
     * Mouse equivalent of typing '?': shows the help panel, or (since
     * a click has no "already typed" state to fall back to) clears
     * the query back to the history view if help is already open,
     * so the footer button/icon acts as a toggle either way.
     */
    function toggleHelp() {
        const input = document.getElementById('qf-input');
        const nextQuery = state.showHelp ? '' : CONFIG.HELP_CHAR;
        input.value = nextQuery;
        performSearch(nextQuery, ++searchToken);
        input.focus();
    }

    /*
     * Only hides the overlay: state.query/results/hierarchyStack/
     * focusPane are deliberately left untouched, so the next open()
     * (hotkey, menu button, or after Enter navigated away) restores
     * the exact same list/detail-pane view instead of resetting to
     * the empty-query history screen.
     */
    function close() {
        state.open = false;

        const overlay = document.getElementById('qf-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    /*
     * Opens the palette (if needed) directly into the settings panel,
     * used by both the footer gear icon and the >settings command.
     */
    function openSettings() {
        createUI();
        state.open = true;
        state.showHelp = false;
        state.showSettings = true;
        state.showSaveSearch = false;

        const input = document.getElementById('qf-input');
        input.value = state.query || '';

        render();
    }

    /*
     * Opens the inline "Save search" panel for the current query
     * (Ctrl+D / the bookmark icon), used to save state.query verbatim
     * under a name that defaults to the query itself.
     */
    function openSaveSearchPanel() {
        if (!isSavableQuery(state.query)) return;
        state.showHelp = false;
        state.showSettings = false;
        state.showNoteEditor = false;
        state.showSaveSearch = true;
        state.saveSearchMode = 'create';
        state.saveSearchEditId = null;
        render();
        const nameInput = document.getElementById('qf-save-search-name');
        if (nameInput) {
            requestAnimationFrame(() => {
                nameInput.focus();
                nameInput.select();
            });
        }
    }

    /*
     * Opens the same inline panel in "edit" mode to rename an existing
     * saved search (Ctrl+E / the pencil icon on a saved-search row),
     * without touching its stored query.
     */
    function openRenameSavedSearchPanel(item) {
        if (!item || item.type !== 'saved-search') return;
        state.showHelp = false;
        state.showSettings = false;
        state.showNoteEditor = false;
        state.showSaveSearch = true;
        state.saveSearchMode = 'edit';
        state.saveSearchEditId = item.id;
        render();
        const nameInput = document.getElementById('qf-save-search-name');
        if (nameInput) {
            requestAnimationFrame(() => {
                nameInput.focus();
                nameInput.select();
            });
        }
    }

    /*
     * Closes the save-search panel without saving/renaming, restoring
     * whatever view was active before it (the history view, since it's
     * only reachable from there or from an active query).
     */
    function closeSaveSearchPanel() {
        state.showSaveSearch = false;
        render();
        const input = document.getElementById('qf-input');
        if (input) input.focus();
    }

    function submitSaveSearchPanel(container) {
        const nameInput = container.querySelector('#qf-save-search-name');
        const name = nameInput ? nameInput.value : '';
        const noteInput = container.querySelector('#qf-save-search-note');
        const note = noteInput ? noteInput.value : '';

        if (state.saveSearchMode === 'edit') {
            renameSavedSearch(state.saveSearchEditId, name, note);
            showToast(translate('saveSearchRenamed'));
        } else {
            addSavedSearch(state.query, name, note);
            showToast(translate('saveSearchSaved'));
        }

        state.showSaveSearch = false;
        const input = document.getElementById('qf-input');
        if (input) input.value = '';
        performSearch('', ++searchToken);
    }

    /*
     * Opens the inline "Edit note" panel for a favorited row (Ctrl+N /
     * the per-row note icon). No-ops for anything that isn't currently
     * a favorite, since only favorites/saved searches carry a note.
     */
    function openNoteEditorPanel(item) {
        if (!item || item.type === 'info' || !isFavorite(item)) return;
        state.showHelp = false;
        state.showSettings = false;
        state.showSaveSearch = false;
        state.showNoteEditor = true;
        state.noteEditItem = item;
        render();
        const noteInput = document.getElementById('qf-note-input');
        if (noteInput) {
            requestAnimationFrame(() => {
                noteInput.focus();
                noteInput.select();
            });
        }
    }

    function closeNoteEditorPanel() {
        state.showNoteEditor = false;
        state.noteEditItem = null;
        render();
        const input = document.getElementById('qf-input');
        if (input) input.focus();
    }

    function submitNoteEditorPanel(container) {
        const noteInput = container.querySelector('#qf-note-input');
        const note = noteInput ? noteInput.value : '';
        if (state.noteEditItem) {
            setFavoriteNote(state.noteEditItem, note);
        }
        state.showNoteEditor = false;
        state.noteEditItem = null;
        showToast(translate('favoriteNoteSaved'));
        performSearch('', ++searchToken);
    }

    /*
     * Main menu button injection for Grepolis UI (.nui_main_menu).
     */
    function injectMainMenuItem() {
        const menuUl = document.querySelector('.nui_main_menu .content ul');
        // Do not inject until Grepolis has rendered its main menu items (e.g., forum item exists)
        if (!menuUl || !menuUl.querySelector('li.forum, li[data-option-id="forum"]')) {
            return;
        }

        let qfLi = menuUl.querySelector('li.quickfinder');

        // If QuickFinder is already the last item in menuUl, nothing to do
        if (qfLi && menuUl.lastElementChild === qfLi) {
            return;
        }

        // Remove 'last' class from any existing items so previous bottom item expands properly
        menuUl.querySelectorAll('li.last').forEach((el) => el.classList.remove('last'));

        if (!qfLi) {
            qfLi = document.createElement('li');
            qfLi.className = 'quickfinder main_menu_item last';
            qfLi.setAttribute('data-option-id', 'quickfinder');
            qfLi.innerHTML = `
                <span class="content_wrapper">
                    <span class="button_wrapper">
                        <span class="button">
                            <span class="icon qf-main-menu-icon"></span>
                            <div class="ui_highlight" data-type="main_menu" data-subtype="quickfinder"></div>
                            <span class="indicator" data-indicator-id="quickfinder" style="display: none;"></span>
                        </span>
                    </span>
                    <span class="name_wrapper">
                        <span class="name">${escapeHTML(translate('menuItem'))}</span>
                    </span>
                </span>
            `;

            qfLi.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                open();
            });
        }

        // Move/append to the very end of menuUl and ensure 'last' class
        menuUl.appendChild(qfLi);
        qfLi.classList.add('last');
    }

    function toggle() {
        if (state.open) {
            close();
        } else {
            open();
        }
    }

    let toastTimer = null;

    /*
     * Brief confirmation toast, independent from #qf-overlay so it is
     * still visible after Ctrl+B closes the palette (otherwise the
     * only feedback for a copy would be the palette silently
     * vanishing, indistinguishable from nothing having happened).
     */
    function showToast(label, code) {
        let toast = document.getElementById('qf-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'qf-toast';
            document.body.appendChild(toast);
        }

        const codeHTML = code ? `<code>${escapeHTML(code)}</code>` : '';
        toast.innerHTML = `${ICONS.check}<span>${escapeHTML(label)}</span>${codeHTML}`;

        clearTimeout(toastTimer);
        // Force reflow so re-triggering the toast while already visible
        // still restarts the fade-in transition instead of no-op'ing.
        toast.classList.remove('qf-toast-visible');
        void toast.offsetWidth;
        toast.classList.add('qf-toast-visible');

        toastTimer = setTimeout(() => {
            toast.classList.remove('qf-toast-visible');
        }, 1800);
    }

    /*
     * Human-readable label for the current open/close hotkey, e.g.
     * "Ctrl+Shift+F". Used in the footer, help panel and settings
     * panel so all three stay in sync when the user customizes it.
     */
    function hotkeyLabel() {
        return `Ctrl+Shift+${(CONFIG.HOTKEY || 'f').toUpperCase()}`;
    }

    /*
     * ============================================================
     * HOTKEY
     * ============================================================
     *
     * Designed to minimize interference with other
     * extensions/userscripts:
     *
     * - Listener in the bubbling phase (NOT capture), so if something
     *   closer to the clicked element already handled the event and
     *   called stopPropagation(), we never see it.
     * - If another listener already marked the event as
     *   `defaultPrevented`, we step aside without touching anything.
     * - We only call `preventDefault()` on the specific combo we
     *   handle (Ctrl+Shift+F) or on Escape while the palette is open;
     *   never generically.
     * - We don't use `stopPropagation()`: we let the event continue
     *   its normal course so we don't break other legitimate
     *   listeners on the same element.
     */

    document.addEventListener(
        'keydown',
        (event) => {
            if (event.defaultPrevented || event.repeat || event.isComposing) {
                return;
            }

            const isHotkey =
                event.ctrlKey &&
                event.shiftKey &&
                !event.altKey &&
                !event.metaKey &&
                event.key.toLowerCase() === CONFIG.HOTKEY;

            if (isHotkey) {
                event.preventDefault();
                toggle();
                return;
            }

            if (state.open && event.key === 'Escape') {
                event.preventDefault();
                // Mirrors handleInputKeydown's own Escape case (see
                // there for why): this listener only fires this branch
                // when the input itself isn't focused (e.g. focus is on
                // a settings field, or nowhere in particular), so the
                // two-stage pop-then-close behavior must stay in sync
                // between both handlers.
                if (state.hierarchyStack.length) {
                    resetHierarchy();
                    render();
                } else {
                    close();
                }
            }
        },
        false
    );

    /*
     * ============================================================
     * CSS
     * ============================================================
     */

    const style = document.createElement('style');

    style.textContent = `
        #qf-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        }

        /*
         * Toast confirming a BBCode copy. Lives outside #qf-overlay and
         * outlives it (Ctrl+B copies AND closes the palette in one go,
         * mirroring Enter), so without this the only feedback would be
         * the palette silently vanishing — indistinguishable from
         * nothing having happened. Styled to match #qf-window/#qf-esc-key
         * (same gradient, border and shadow language) instead of
         * introducing a new visual style.
         */
        #qf-toast {
            position: fixed;
            left: 50%;
            bottom: 48px;
            transform: translateX(-50%) translateY(6px);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 10px 16px;
            border-radius: 10px;
            background: linear-gradient(180deg, #2c2c2c, #1a1a1a);
            border: 1px solid rgba(255, 255, 255, .16);
            box-shadow: 0 12px 40px rgba(0, 0, 0, .55);
            color: #eee;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
            font-size: 12.5px;
            font-weight: 500;
            letter-spacing: .1px;
            opacity: 0;
            pointer-events: none;
            transition: opacity .12s ease-out, transform .12s ease-out;
        }

        #qf-toast.qf-toast-visible {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        #qf-toast .qf-icon-svg {
            flex: 0 0 auto;
            width: 15px;
            height: 15px;
            color: #d7a33f;
        }

        #qf-toast code {
            padding: 1px 5px;
            border-radius: 4px;
            background: rgba(255, 255, 255, .06);
            color: rgba(255, 255, 255, .78);
            font-size: 11.5px;
        }

        /*
         * All icons in the palette are inline SVG (see the ICONS map),
         * not emoji glyphs: emoji rendering varies wildly across
         * operating systems in size/style, and is flat-out missing
         * (shows as a "tofu" box) on systems with no emoji font
         * installed. SVG icons need no font and render identically
         * everywhere; they inherit their color from currentColor.
         */
        .qf-icon-svg {
            display: block;
            width: 100%;
            height: 100%;
        }

        #qf-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, .6);
            backdrop-filter: blur(3px);
        }

        #qf-window {
            position: absolute;
            top: 12%;
            left: 50%;
            transform: translateX(-50%);
            width: min(720px, calc(100vw - 30px));
            overflow: hidden;
            color: #eee;
            background: linear-gradient(180deg, #2c2c2c, #1a1a1a);
            border: 1px solid rgba(255, 255, 255, .16);
            border-radius: 12px;
            box-shadow: 0 30px 100px rgba(0, 0, 0, .8);
            animation: qf-window-in .12s ease-out;
            transition: width .15s ease;
        }

        /*
         * Applied while a hierarchy detail pane (Alliance -> Player ->
         * Town, Island -> Town) is open, widening the window so both
         * columns stay readable instead of splitting the fixed 720px.
         */
        #qf-window.qf-window-split {
            width: min(1100px, calc(100vw - 30px));
        }

        @keyframes qf-window-in {
            from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        #qf-input-row {
            display: flex;
            align-items: center;
            height: 64px;
            padding: 0 20px;
            border-bottom: 1px solid rgba(255, 255, 255, .09);
        }

        #qf-search-icon {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            margin-right: 6px;
            color: rgba(255, 255, 255, .45);
        }

        #qf-input {
            flex: 1;
            min-width: 0;
            height: 100%;
            padding: 0 12px;
            border: 0;
            outline: 0;
            background: transparent;
            color: #fdfdfd;
            font-size: 19px;
            font-weight: 400;
            letter-spacing: .1px;
        }

        #qf-input::placeholder {
            color: rgba(255, 255, 255, .32);
            font-weight: 400;
        }

        #qf-save-search-btn,
        #qf-settings-btn {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            margin-right: 10px;
            padding: 5px;
            border: 0;
            border-radius: 6px;
            background: transparent;
            color: rgba(255, 255, 255, .42);
            cursor: pointer;
            transition: background-color .08s ease, color .08s ease;
        }

        #qf-save-search-btn:hover,
        #qf-settings-btn:hover {
            color: rgba(255, 255, 255, .85);
            background: rgba(255, 255, 255, .07);
        }

        #qf-esc-key {
            flex: 0 0 auto;
            padding: 4px 8px;
            border: 1px solid rgba(255, 255, 255, .16);
            border-radius: 5px;
            background: rgba(255, 255, 255, .04);
            color: rgba(255, 255, 255, .42);
            font-size: 10px;
            font-weight: 600;
            letter-spacing: .3px;
        }

        /*
         * Wraps #qf-results and #qf-detail-pane side by side. A plain
         * flex row: #qf-results always takes the left half (or the
         * full width when the detail pane is hidden), #qf-detail-pane
         * takes the right half only while a hierarchy level is open.
         */
        #qf-panes {
            display: flex;
            align-items: stretch;
            min-width: 0;
        }

        #qf-results {
            flex: 1 1 50%;
            min-width: 0;
            max-height: 480px;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, .16) transparent;
            padding: 6px 0;
        }

        #qf-results::-webkit-scrollbar {
            width: 8px;
        }

        #qf-results::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, .14);
            border-radius: 4px;
        }

        #qf-results::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, .22);
        }

        #qf-detail-pane {
            flex: 1 1 50%;
            min-width: 0;
            max-height: 480px;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, .16) transparent;
            padding: 6px 0;
            border-left: 1px solid rgba(255, 255, 255, .09);
            animation: qf-detail-pane-in .12s ease-out;
        }

        #qf-detail-pane[hidden] {
            display: none;
        }

        @keyframes qf-detail-pane-in {
            from { opacity: 0; transform: translateX(6px); }
            to { opacity: 1; transform: translateX(0); }
        }

        #qf-detail-pane::-webkit-scrollbar {
            width: 8px;
        }

        #qf-detail-pane::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, .14);
            border-radius: 4px;
        }

        #qf-detail-pane::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, .22);
        }

        .qf-detail-breadcrumb {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 5px;
            padding: 4px 20px 10px;
            border-bottom: 1px solid rgba(255, 255, 255, .06);
            margin-bottom: 4px;
        }

        .qf-breadcrumb-item {
            border: 0;
            padding: 0;
            background: transparent;
            color: rgba(255, 255, 255, .5);
            font-size: 11.5px;
            font-weight: 500;
            cursor: pointer;
        }

        button.qf-breadcrumb-item:hover {
            color: #e6bd6c;
            text-decoration: underline;
        }

        .qf-breadcrumb-current {
            color: #d7a33f;
            font-weight: 600;
            cursor: default;
        }

        .qf-breadcrumb-sep {
            color: rgba(255, 255, 255, .25);
            font-size: 12px;
        }

        .qf-chevron {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            margin-left: 2px;
            color: rgba(255, 255, 255, .3);
        }

        .qf-result:hover .qf-chevron {
            color: rgba(255, 255, 255, .55);
        }

        .qf-selected .qf-chevron {
            color: #d7a33f;
        }

        #qf-segments {
            display: flex;
            flex-wrap: wrap;
            gap: 7px;
            padding: 10px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, .08);
        }

        #qf-segments[hidden] {
            display: none;
        }

        .qf-chip {
            display: inline-flex;
            align-items: baseline;
            gap: 5px;
            padding: 5px 11px;
            border: 1px solid rgba(255, 255, 255, .12);
            border-radius: 7px;
            background: rgba(255, 255, 255, .03);
            color: rgba(255, 255, 255, .58);
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            transition: background-color .08s ease, border-color .08s ease, color .08s ease;
        }

        .qf-chip:hover {
            color: rgba(255, 255, 255, .85);
            border-color: rgba(255, 255, 255, .28);
            background: rgba(255, 255, 255, .06);
        }

        .qf-chip-active {
            color: #1c1608;
            background: #d7a33f;
            border-color: #d7a33f;
            font-weight: 600;
        }

        .qf-chip-count {
            opacity: .55;
            font-size: 10px;
            font-weight: 600;
        }

        .qf-chip-active .qf-chip-count {
            opacity: .65;
        }

        .qf-result {
            position: relative;
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 44px;
            padding: 5px 20px;
            border-left: 2px solid transparent;
            cursor: pointer;
            transition: background-color .06s ease;
        }

        .qf-result:hover {
            background: rgba(255, 255, 255, .045);
        }

        .qf-selected {
            background: rgba(215, 163, 63, .13);
            border-left-color: #d7a33f;
        }

        .qf-selected:hover {
            background: rgba(215, 163, 63, .17);
        }

        .qf-result-header {
            min-height: 50px;
            background: rgba(255, 255, 255, .035);
        }

        .qf-result-header.qf-selected {
            background: rgba(215, 163, 63, .15);
        }

        .qf-result-icon {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            color: rgba(255, 255, 255, .68);
            opacity: .9;
        }

        .qf-result-body {
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .qf-result-line1 {
            display: flex;
            align-items: center;
            gap: 7px;
            min-width: 0;
        }

        .qf-result-name {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #f2f2f2;
            font-size: 13.5px;
            font-weight: 500;
            text-align: left;
        }

        .qf-selected .qf-result-name,
        .qf-result-header .qf-result-name {
            color: #fff;
            font-weight: 600;
        }

        .qf-result-meta {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: rgba(255, 255, 255, .42);
            font-size: 11px;
            text-align: left;
        }

        .qf-selected .qf-result-meta {
            color: rgba(255, 255, 255, .55);
        }

        .qf-recent-conquest {
            color: #e08a8a;
        }

        .qf-badge {
            flex: 0 0 auto;
            margin-left: auto;
            padding: 2px 7px;
            border-radius: 4px;
            color: rgba(255, 255, 255, .75);
            background: rgba(255, 255, 255, .07);
            font-size: 8.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .5px;
            white-space: nowrap;
        }

        .qf-badge-player { background: rgba(90, 160, 255, .16); color: #9cc4ff; }
        .qf-badge-alliance { background: rgba(215, 163, 63, .18); color: #e6bd6c; }
        .qf-badge-town { background: rgba(100, 200, 140, .16); color: #8fdba9; }
        .qf-badge-coordinate { background: rgba(200, 120, 220, .16); color: #dda6ea; }

        .qf-star {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            padding: 3px;
            margin: -2px -2px -2px 0;
            border-radius: 4px;
            color: rgba(255, 255, 255, .22);
        }

        .qf-result:hover .qf-star {
            color: rgba(255, 255, 255, .45);
        }

        .qf-star:hover {
            color: rgba(255, 255, 255, .8) !important;
            background: rgba(255, 255, 255, .08);
        }

        .qf-favorite .qf-star {
            color: #d7a33f;
        }

        .qf-favorite:hover .qf-star {
            color: #e6bd6c;
        }

        .qf-bbcode-btn {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            padding: 3px;
            margin: -2px -2px -2px 0;
            border-radius: 4px;
            color: rgba(255, 255, 255, 0);
            opacity: 0;
            transition: color .06s ease, background-color .06s ease, opacity .06s ease;
        }

        .qf-result:hover .qf-bbcode-btn {
            color: rgba(255, 255, 255, .45);
            opacity: 1;
        }

        .qf-bbcode-btn:hover {
            color: rgba(255, 255, 255, .8) !important;
            background: rgba(255, 255, 255, .08);
        }

        .qf-remove {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            padding: 3px;
            margin: -2px -2px -2px 0;
            border-radius: 4px;
            color: rgba(255, 255, 255, 0);
            opacity: 0;
            transition: color .06s ease, background-color .06s ease, opacity .06s ease;
        }

        .qf-result:hover .qf-remove {
            color: rgba(255, 255, 255, .45);
            opacity: 1;
        }

        .qf-remove:hover {
            color: #e08a8a !important;
            background: rgba(255, 255, 255, .08);
        }

        .qf-origin-btn,
        .qf-note-btn {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            padding: 3px;
            margin: -2px -2px -2px 0;
            border-radius: 4px;
            color: rgba(255, 255, 255, 0);
            opacity: 0;
            transition: color .06s ease, background-color .06s ease, opacity .06s ease;
        }

        .qf-result:hover .qf-origin-btn,
        .qf-result:hover .qf-note-btn {
            color: rgba(255, 255, 255, .45);
            opacity: 1;
        }

        .qf-origin-btn:hover,
        .qf-note-btn:hover {
            color: #d7a33f !important;
            background: rgba(255, 255, 255, .08);
        }

        .qf-result-note {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: rgba(215, 163, 63, .75);
            font-size: 11px;
            font-style: italic;
            text-align: left;
        }

        .qf-saved-edit,
        .qf-saved-remove {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            padding: 3px;
            margin: -2px -2px -2px 0;
            border-radius: 4px;
            color: rgba(255, 255, 255, 0);
            opacity: 0;
            transition: color .06s ease, background-color .06s ease, opacity .06s ease;
        }

        .qf-result:hover .qf-saved-edit,
        .qf-result:hover .qf-saved-remove {
            color: rgba(255, 255, 255, .45);
            opacity: 1;
        }

        .qf-saved-edit:hover {
            color: #d7a33f !important;
            background: rgba(255, 255, 255, .08);
        }

        .qf-saved-remove:hover {
            color: #e08a8a !important;
            background: rgba(255, 255, 255, .08);
        }

        .qf-results-more {
            padding: 10px 20px 12px;
            text-align: center;
            color: rgba(255, 255, 255, .32);
            font-size: 11px;
            cursor: default;
        }

        .qf-result-info {
            display: flex;
            align-items: baseline;
            gap: 8px;
            padding: 6px 20px;
            color: rgba(255, 255, 255, .5);
            font-size: 11.5px;
            font-style: normal;
            cursor: default;
        }

        .qf-result-info-icon {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 14px;
            height: 14px;
            opacity: .55;
        }

        .qf-result-info-text {
            min-width: 0;
        }

        .qf-section {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 14px 20px 6px;
            color: rgba(255, 255, 255, .4);
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            border-bottom: 1px solid rgba(255, 255, 255, .06);
            margin-bottom: 2px;
        }

        .qf-section:first-child {
            padding-top: 8px;
        }

        .qf-section-clear {
            flex: 0 0 auto;
            padding: 2px 8px;
            border: none;
            border-radius: 4px;
            background: transparent;
            color: rgba(255, 255, 255, .4);
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .5px;
            cursor: pointer;
            transition: color .06s ease, background-color .06s ease;
        }

        .qf-section-clear:hover {
            color: #e08a8a;
            background: rgba(255, 255, 255, .07);
        }

        .qf-empty,
        .qf-loading {
            padding: 52px 24px;
            text-align: center;
            color: rgba(255, 255, 255, .5);
        }

        .qf-empty-title {
            margin-bottom: 9px;
            color: rgba(255, 255, 255, .8);
            font-size: 16px;
            font-weight: 500;
        }

        .qf-empty-subtitle {
            color: rgba(255, 255, 255, .45);
            font-size: 12px;
        }

        .qf-empty-hint {
            margin-top: 18px;
            color: rgba(255, 255, 255, .35);
            font-size: 11px;
        }

        .qf-empty-hint + .qf-empty-hint {
            margin-top: 8px;
        }

        .qf-empty-hint strong {
            padding: 2px 7px;
            border: 1px solid rgba(255, 255, 255, .14);
            border-radius: 4px;
            color: rgba(255, 255, 255, .6);
            font-weight: 600;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        }

        .qf-empty-error .qf-empty-title {
            color: #e6a2a2;
        }

        .qf-empty-error .qf-empty-hint {
            color: rgba(230, 162, 162, .7);
        }

        .qf-loading {
            font-size: 12px;
        }

        .qf-loading-text {
            color: rgba(255, 255, 255, .45);
        }

        .qf-spinner {
            width: 22px;
            height: 22px;
            margin: 0 auto 14px;
            border: 2px solid rgba(255, 255, 255, .18);
            border-top-color: rgba(215, 163, 63, .75);
            border-radius: 50%;
            animation: qf-spin .7s linear infinite;
        }

        @keyframes qf-spin {
            to { transform: rotate(360deg); }
        }

        #qf-footer {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 10px 20px;
            background: rgba(0, 0, 0, .18);
            border-top: 1px solid rgba(255, 255, 255, .08);
        }

        #qf-footer-shortcuts {
            display: flex;
            flex-wrap: wrap;
            gap: 14px;
            color: rgba(255, 255, 255, .34);
            font-size: 10px;
        }

        /*
         * Mouse equivalents of Ctrl+R (refresh) and '?' (help): plain
         * <button> elements styled to match the surrounding <span>
         * shortcut hints, so the footer keeps its uniform look while
         * two of its five entries are now also clickable.
         */
        .qf-footer-action {
            padding: 0;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            cursor: pointer;
        }

        .qf-footer-action:hover {
            color: rgba(255, 255, 255, .7);
        }

        #qf-footer-meta {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
        }

        #qf-status {
            color: rgba(255, 255, 255, .32);
            font-size: 10px;
        }

        #qf-status.qf-status-error {
            color: #e08a8a;
            font-weight: 600;
        }

        #qf-version {
            padding: 0;
            border: 0;
            background: transparent;
            color: rgba(255, 255, 255, .14);
            font: inherit;
            font-size: 9px;
            cursor: default;
        }

        #qf-version.qf-version-update-available {
            color: #e6bd6c;
            font-weight: 700;
            cursor: pointer;
            animation: qf-version-pulse .6s ease 2;
        }

        #qf-version.qf-version-update-available:hover {
            color: #d7a33f;
        }

        @keyframes qf-version-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: .5; }
        }

        .qf-help {
            padding: 22px 24px;
        }

        .qf-help-title {
            margin: 18px 0 8px;
            color: rgba(255, 255, 255, .62);
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .8px;
        }

        .qf-help-title:first-child {
            margin-top: 0;
        }

        .qf-help-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11.5px;
        }

        .qf-help-table td {
            padding: 4px 10px 4px 0;
            vertical-align: top;
            color: rgba(255, 255, 255, .68);
        }

        .qf-help-table td:first-child {
            width: 40%;
        }

        .qf-help-table kbd {
            padding: 2px 7px;
            border: 1px solid rgba(255, 255, 255, .16);
            border-radius: 4px;
            background: rgba(255, 255, 255, .05);
            color: rgba(255, 255, 255, .8);
            font-size: 10px;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        }

        .qf-help-text {
            font-size: 11.5px;
            line-height: 1.6;
            color: rgba(255, 255, 255, .5);
        }

        .qf-settings {
            padding: 22px 24px;
        }

        .qf-settings-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 11px 0;
            border-bottom: 1px solid rgba(255, 255, 255, .06);
        }

        .qf-settings-row:last-of-type {
            border-bottom: 0;
        }

        .qf-settings-label {
            color: rgba(255, 255, 255, .68);
            font-size: 12.5px;
            font-weight: 500;
        }

        .qf-settings-input {
            flex: 0 0 auto;
            min-width: 160px;
            padding: 7px 10px;
            border: 1px solid rgba(255, 255, 255, .16);
            border-radius: 6px;
            background: rgba(255, 255, 255, .04);
            color: #f2f2f2;
            font-size: 12.5px;
            font-family: inherit;
            outline: 0;
            transition: border-color .08s ease, background-color .08s ease;
        }

        .qf-settings-input:focus {
            border-color: rgba(215, 163, 63, .6);
            background: rgba(255, 255, 255, .06);
        }

        /* The closed <select> box inherits the dark background/light text
         * above, but Chromium/Firefox render the native <option> popup
         * list using its own colors (light background, dark text)
         * regardless of the <select>'s styling unless the <option>
         * elements are styled explicitly too — hence the separate rule. */
        select.qf-settings-input option {
            background: #2c2c2c;
            color: #f2f2f2;
        }

        .qf-settings-input-number {
            min-width: 90px;
            text-align: right;
        }

        .qf-settings-hotkey {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .qf-settings-hotkey-prefix {
            color: rgba(255, 255, 255, .4);
            font-size: 11.5px;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        }

        .qf-settings-input-hotkey {
            width: 40px;
            min-width: 0;
            text-align: center;
            text-transform: uppercase;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        }

        .qf-settings-checkbox {
            flex: 0 0 auto;
            width: 17px;
            height: 17px;
            accent-color: #d7a33f;
            cursor: pointer;
        }

        .qf-settings-hint {
            display: block;
            margin-top: 3px;
            color: rgba(255, 255, 255, .38);
            font-size: 10.5px;
            font-weight: 400;
        }

        .qf-settings-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 18px;
        }

        .qf-settings-btn {
            padding: 8px 16px;
            border: 1px solid rgba(255, 255, 255, .16);
            border-radius: 7px;
            background: rgba(255, 255, 255, .03);
            color: rgba(255, 255, 255, .7);
            font-size: 12px;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            transition: background-color .08s ease, border-color .08s ease, color .08s ease;
        }

        .qf-settings-btn:hover {
            color: rgba(255, 255, 255, .9);
            border-color: rgba(255, 255, 255, .3);
            background: rgba(255, 255, 255, .07);
        }

        .qf-settings-btn-primary {
            color: #1c1608;
            background: #d7a33f;
            border-color: #d7a33f;
        }

        .qf-settings-btn-primary:hover {
            background: #e6bd6c;
            border-color: #e6bd6c;
            color: #1c1608;
        }

        /* Main menu button icon styling */
        .nui_main_menu .quickfinder .icon {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 32px !important;
            height: 32px !important;
            margin: 0 !important;
            padding: 0 !important;
            background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cdefs%3E%3ClinearGradient id='metal' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23fff2c6'/%3E%3Cstop offset='40%25' stop-color='%23eac05d'/%3E%3Cstop offset='100%25' stop-color='%239e701e'/%3E%3C/linearGradient%3E%3ClinearGradient id='handle' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23e5b565'/%3E%3Cstop offset='50%25' stop-color='%23ab7424'/%3E%3Cstop offset='100%25' stop-color='%235e3c0b'/%3E%3C/linearGradient%3E%3CradialGradient id='lens' cx='35%25' cy='35%25' r='65%25'%3E%3Cstop offset='0%25' stop-color='rgba(255, 248, 220, 0.45)'/%3E%3Cstop offset='70%25' stop-color='rgba(214, 163, 66, 0.15)'/%3E%3Cstop offset='100%25' stop-color='rgba(130, 90, 20, 0.3)'/%3E%3C/radialGradient%3E%3C/defs%3E%3Cpath d='M15 15 L21 21' stroke='url(%23handle)' stroke-width='3.8' stroke-linecap='round'/%3E%3Ccircle cx='10.5' cy='10.5' r='6' fill='url(%23lens)'/%3E%3Ccircle cx='10.5' cy='10.5' r='6' fill='none' stroke='url(%23metal)' stroke-width='2.2'/%3E%3Ccircle cx='10.5' cy='10.5' r='5' fill='none' stroke='%23fff5d6' stroke-width='0.6' stroke-opacity='0.7'/%3E%3C/svg%3E") 7px 7px / 18px 18px no-repeat !important;
            filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .7));
        }
    `;

    document.head.appendChild(style);

    /*
     * ============================================================
     * INIT
     * ============================================================
     */

    /*
     * Runs the background update check once on startup and, if a
     * newer version is found, shows a one-time-per-version toast (a
     * sessionStorage flag prevents repeating it on every page load
     * within the same tab session) and refreshes the footer badge.
     * Fire-and-forget: never delays or blocks the rest of init().
     */
    function runStartupUpdateCheck() {
        checkForUpdates().then((remoteVersion) => {
            renderFooter();
            if (!remoteVersion) return;

            const toastFlagKey = `qf:updateToastShown:${remoteVersion}`;
            try {
                if (sessionStorage.getItem(toastFlagKey)) return;
                sessionStorage.setItem(toastFlagKey, '1');
            } catch (_) {
                // Storage unavailable: fall through and show the toast anyway.
            }
            showToast(translate('updateAvailableToast', { version: remoteVersion }));
        });
    }

    function init() {
        syncFavorites();
        createUI();
        injectMainMenuItem();
        setInterval(injectMainMenuItem, 1000);
        loadAll();
        if (CONFIG.CONQUEST_HISTORY_ENABLED) {
            loadConquestHistory();
        }
        runStartupUpdateCheck();

        console.info(`%c[Grepolis Quick Finder ${VERSION}] loaded`, 'color:#d6a342;font-weight:bold');
        console.info(`[QF] Detected world: ${WORLD} (market: ${MARKET})`);
        console.info(`[QF] ${hotkeyLabel()} to open.`);
    }

    init();
})();
