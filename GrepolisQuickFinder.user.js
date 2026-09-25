// ==UserScript==
// @name         Grepolis Quick Finder
// @namespace    https://github.com/adrian-cancio/GrepolisQuickFinder
// @version      2.6.0
// @description  Quick palette (Ctrl+Shift+F) to search players, alliances and towns in Grepolis, with real in-game navigation, segments, commands, history/favorites and a local cache. Automatically localized based on the current world/market.
// @author       adrian-cancio
// @match        https://*.grepolis.com/game/*
// @match        http://*.grepolis.com/game/*
// @updateURL    https://raw.githubusercontent.com/adrian-cancio/GrepolisQuickFinder/master/GrepolisQuickFinder.user.js
// @downloadURL  https://raw.githubusercontent.com/adrian-cancio/GrepolisQuickFinder/master/GrepolisQuickFinder.user.js
// @homepageURL  https://github.com/adrian-cancio/GrepolisQuickFinder
// @supportURL   https://github.com/adrian-cancio/GrepolisQuickFinder/issues
// @icon         https://www.grepolis.com/favicon.ico
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '2.6.0';

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
        HELP_CHAR: '?',           // typing this alone shows the shortcuts/commands panel
        COMMAND_PREFIX: '>',      // commands: >goto, >ghost, >dist, >island, >near, >ocean, >help
        SEGMENTS: ['all', 'player', 'alliance', 'town', 'island', 'coordinate'],
        DEFAULT_SEGMENT: 'all',
        SCOPE_ALIASES: { t: 'town', p: 'player', a: 'alliance', c: 'coordinate', i: 'island' },
        NEAR_MAX_RADIUS: 15,
        HISTORY_MAX: 12,
        FAVORITES_MAX: 30,
        CACHE_TTL: 6 * 60 * 60 * 1000, // reuse world data for at most this long
        GHOST_MIN_POINTS: 0,
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
            footerClose: 'Esc to close',
            emptyTitle: 'Search Grepolis',
            emptySubtitle: 'Players \u00b7 Alliances \u00b7 Towns',
            emptyHintCoords: 'You can also enter coordinates: <strong>{example}</strong>',
            loadingWorldData: 'Loading world data...',
            noResults: 'No results found.',
            resultsMore: 'Showing {shown} of {total} \u2014 scroll for more',
            errorLoadingData: 'Error loading data: {error}',
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
            footerTab: 'Tab filter',
            footerFav: 'Ctrl+F favorite',
            footerBBCode: 'Ctrl+B copy BBCode',
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
            shortcutsHelp: 'Show this help',
            commandHelpTitle: 'Commands',
            commandGotoHelp: '>goto 123:456 \u2014 jump to an island',
            commandGhostHelp: '>ghost [minPts] [near] \u2014 ghost towns by points or distance',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 island distance',
            commandIslandHelp: '>island X:Y \u2014 every town on an island',
            commandNearHelp: '>near [X:Y] [radius] \u2014 islands around a point',
            commandOceanHelp: '>ocean M34 [alliance] \u2014 ocean snapshot',
            commandHelpHint: '>help \u2014 show this list',
            commandUnknown: 'Unknown command: {cmd}',
            ghostEmpty: 'No ghost towns found.',
            distResult: 'Island distance: {n}',
            distFromActive: 'from your active city',
            distNeedOrigin: 'Give two coordinates, or one if your active city can be detected.',
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
        },
        es: {
            searchPlaceholder: 'Buscar jugadores, alianzas o ciudades...',
            footerNavigate: '\u2191 \u2193 seleccionar',
            footerOpen: 'Enter abrir',
            footerClose: 'Esc cerrar',
            emptyTitle: 'Buscar en Grepolis',
            emptySubtitle: 'Jugadores \u00b7 Alianzas \u00b7 Ciudades',
            emptyHintCoords: 'Tambi\u00e9n puedes introducir coordenadas: <strong>{example}</strong>',
            loadingWorldData: 'Cargando datos del mundo...',
            noResults: 'No se encontraron resultados.',
            resultsMore: 'Mostrando {shown} de {total} \u2014 desplaza para ver m\u00e1s',
            errorLoadingData: 'Error cargando datos: {error}',
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
            footerTab: 'Tab filtrar',
            footerFav: 'Ctrl+F favoritos',
            footerBBCode: 'Ctrl+B copiar BBCode',
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
            shortcutsHelp: 'mostrar esta ayuda',
            commandHelpTitle: 'Comandos',
            commandGotoHelp: '>goto 123:456 \u2014 saltar a una isla',
            commandGhostHelp: '>ghost [minPts] [near] \u2014 fantasmas por puntos o distancia',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 distancia de islas',
            commandIslandHelp: '>island X:Y \u2014 todas las ciudades de una isla',
            commandNearHelp: '>near [X:Y] [radio] \u2014 islas alrededor de un punto',
            commandOceanHelp: '>ocean M34 [alianza] \u2014 resumen del oc\u00e9ano',
            commandHelpHint: '>help \u2014 mostrar esta lista',
            commandUnknown: 'Comando desconocido: {cmd}',
            ghostEmpty: 'No se encontraron ciudades fantasma.',
            distResult: 'Distancia de islas: {n}',
            distFromActive: 'desde tu ciudad activa',
            distNeedOrigin: 'Da dos coordenadas, o una si se puede detectar tu ciudad activa.',
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
        },
        de: {
            searchPlaceholder: 'Spieler, Allianzen oder St\u00e4dte suchen...',
            footerNavigate: '\u2191 \u2193 ausw\u00e4hlen',
            footerOpen: 'Enter \u00f6ffnen',
            footerClose: 'Esc schlie\u00dfen',
            emptyTitle: 'Grepolis durchsuchen',
            emptySubtitle: 'Spieler \u00b7 Allianzen \u00b7 St\u00e4dte',
            emptyHintCoords: 'Du kannst auch Koordinaten eingeben: <strong>{example}</strong>',
            loadingWorldData: 'Weltdaten werden geladen...',
            noResults: 'Keine Ergebnisse gefunden.',
            resultsMore: '{shown} von {total} angezeigt \u2014 scrollen f\u00fcr mehr',
            errorLoadingData: 'Fehler beim Laden der Daten: {error}',
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
            footerTab: 'Tab filter',
            footerFav: 'Strg+F Favorit',
            footerBBCode: 'Strg+B BBCode kopieren',
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
            shortcutsHelp: 'diese Hilfe anzeigen',
            commandHelpTitle: 'Befehle',
            commandGotoHelp: '>goto 123:456 \u2014 zu einer Insel springen',
            commandGhostHelp: '>ghost [minPkt] \u2014 Geisterst\u00e4dte auflisten',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 Inselentfernung',
            commandHelpHint: '>help \u2014 diese Liste zeigen',
            commandUnknown: 'Unbekannter Befehl: {cmd}',
            ghostEmpty: 'Keine Geisterst\u00e4dte gefunden.',
            distResult: 'Inselentfernung: {n}',
            distFromActive: 'von deiner aktiven Stadt',
            distNeedOrigin: 'Gib zwei Koordinaten an, oder eine, wenn deine aktive Stadt erkannt werden kann.',
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
        },
        fr: {
            searchPlaceholder: 'Rechercher des joueurs, alliances ou villes...',
            footerNavigate: '\u2191 \u2193 s\u00e9lectionner',
            footerOpen: 'Entr\u00e9e ouvrir',
            footerClose: '\u00c9chap fermer',
            emptyTitle: 'Rechercher dans Grepolis',
            emptySubtitle: 'Joueurs \u00b7 Alliances \u00b7 Villes',
            emptyHintCoords: 'Vous pouvez aussi saisir des coordonn\u00e9es : <strong>{example}</strong>',
            loadingWorldData: 'Chargement des donn\u00e9es du monde...',
            noResults: 'Aucun r\u00e9sultat trouv\u00e9.',
            resultsMore: '{shown} sur {total} affich\u00e9s \u2014 faites d\u00e9filer pour plus',
            errorLoadingData: 'Erreur lors du chargement des donn\u00e9es : {error}',
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
            footerTab: 'Tab filtrer',
            footerFav: 'Ctrl+F favori',
            footerBBCode: 'Ctrl+B copier le BBCode',
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
            shortcutsHelp: 'afficher cette aide',
            commandHelpTitle: 'Commandes',
            commandGotoHelp: '>goto 123:456 \u2014 aller \u00e0 une \u00eele',
            commandGhostHelp: '>ghost [minPts] \u2014 lister les villes fant\u00f4mes',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 distance d\u2019\u00eeles',
            commandHelpHint: '>help \u2014 afficher cette liste',
            commandUnknown: 'Commande inconnue : {cmd}',
            ghostEmpty: 'Aucune ville fant\u00f4me trouv\u00e9e.',
            distResult: 'Distance d\u2019\u00eeles : {n}',
            distFromActive: 'depuis votre ville active',
            distNeedOrigin: 'Donnez deux coordonn\u00e9es, ou une si votre ville active peut \u00eatre d\u00e9tect\u00e9e.',
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
        },
        it: {
            searchPlaceholder: 'Cerca giocatori, alleanze o citt\u00e0...',
            footerNavigate: '\u2191 \u2193 seleziona',
            footerOpen: 'Invio apri',
            footerClose: 'Esc chiudi',
            emptyTitle: 'Cerca in Grepolis',
            emptySubtitle: 'Giocatori \u00b7 Alleanze \u00b7 Citt\u00e0',
            emptyHintCoords: 'Puoi anche inserire le coordinate: <strong>{example}</strong>',
            loadingWorldData: 'Caricamento dati del mondo...',
            noResults: 'Nessun risultato trovato.',
            resultsMore: '{shown} di {total} mostrati \u2014 scorri per altri',
            errorLoadingData: 'Errore nel caricamento dei dati: {error}',
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
            footerTab: 'Tab filtra',
            footerFav: 'Ctrl+F preferito',
            footerBBCode: 'Ctrl+B copia BBCode',
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
            shortcutsHelp: 'mostra questo aiuto',
            commandHelpTitle: 'Comandi',
            commandGotoHelp: '>goto 123:456 \u2014 vai a un\u2019isola',
            commandGhostHelp: '>ghost [minPts] \u2014 elenca citt\u00e0 fantasma',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 distanza di isole',
            commandHelpHint: '>help \u2014 mostra questo elenco',
            commandUnknown: 'Comando sconosciuto: {cmd}',
            ghostEmpty: 'Nessuna citt\u00e0 fantasma trovata.',
            distResult: 'Distanza di isole: {n}',
            distFromActive: 'dalla tua citt\u00e0 attiva',
            distNeedOrigin: 'Indica due coordinate, o una se la tua citt\u00e0 attiva pu\u00f2 essere rilevata.',
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
        },
        nl: {
            searchPlaceholder: 'Zoek spelers, allianties of steden...',
            footerNavigate: '\u2191 \u2193 selecteren',
            footerOpen: 'Enter openen',
            footerClose: 'Esc sluiten',
            emptyTitle: 'Zoeken in Grepolis',
            emptySubtitle: 'Spelers \u00b7 Allianties \u00b7 Steden',
            emptyHintCoords: 'Je kunt ook co\u00f6rdinaten invoeren: <strong>{example}</strong>',
            loadingWorldData: 'Wereldgegevens laden...',
            noResults: 'Geen resultaten gevonden.',
            resultsMore: '{shown} van {total} weergegeven \u2014 scroll voor meer',
            errorLoadingData: 'Fout bij het laden van gegevens: {error}',
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
            footerTab: 'Tab filteren',
            footerFav: 'Ctrl+F favoriet',
            footerBBCode: 'Ctrl+B BBCode kopi\u00ebren',
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
            shortcutsHelp: 'deze hulp tonen',
            commandHelpTitle: 'Opdrachten',
            commandGotoHelp: '>goto 123:456 \u2014 naar een eiland springen',
            commandGhostHelp: '>ghost [minPts] \u2014 spooksteden weergeven',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 eilandafstand',
            commandHelpHint: '>help \u2014 deze lijst tonen',
            commandUnknown: 'Onbekende opdracht: {cmd}',
            ghostEmpty: 'Geen spooksteden gevonden.',
            distResult: 'Eilandafstand: {n}',
            distFromActive: 'vanaf je actieve stad',
            distNeedOrigin: 'Geef twee co\u00f6rdinaten, of \u00e9\u00e9n als je actieve stad kan worden gedetecteerd.',
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
        },
        pl: {
            searchPlaceholder: 'Szukaj graczy, sojuszy lub miast...',
            footerNavigate: '\u2191 \u2193 wybierz',
            footerOpen: 'Enter otw\u00f3rz',
            footerClose: 'Esc zamknij',
            emptyTitle: 'Szukaj w Grepolis',
            emptySubtitle: 'Gracze \u00b7 Sojusze \u00b7 Miasta',
            emptyHintCoords: 'Mo\u017cesz te\u017c wpisa\u0107 wsp\u00f3\u0142rz\u0119dne: <strong>{example}</strong>',
            loadingWorldData: '\u0141adowanie danych \u015bwiata...',
            noResults: 'Nie znaleziono wynik\u00f3w.',
            resultsMore: 'Pokazano {shown} z {total} \u2014 przewi\u0144, aby zobaczy\u0107 wi\u0119cej',
            errorLoadingData: 'B\u0142\u0105d podczas \u0142adowania danych: {error}',
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
            footerTab: 'Tab filtr',
            footerFav: 'Ctrl+F ulubione',
            footerBBCode: 'Ctrl+B kopiuj BBCode',
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
            shortcutsHelp: 'poka\u017c t\u0119 pomoc',
            commandHelpTitle: 'Polecenia',
            commandGotoHelp: '>goto 123:456 \u2014 przeskocz na wysp\u0119',
            commandGhostHelp: '>ghost [minPts] \u2014 lista miast-widm',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 odleg\u0142o\u015b\u0107 wysp',
            commandHelpHint: '>help \u2014 poka\u017c t\u0119 list\u0119',
            commandUnknown: 'Nieznane polecenie: {cmd}',
            ghostEmpty: 'Nie znaleziono miast-widm.',
            distResult: 'Odleg\u0142o\u015b\u0107 wysp: {n}',
            distFromActive: 'od aktywnego miasta',
            distNeedOrigin: 'Podaj dwie wsp\u00f3\u0142rz\u0119dne lub jedn\u0105, je\u015bli mo\u017cna wykry\u0107 twoje aktywne miasto.',
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
        },
        pt: {
            searchPlaceholder: 'Pesquisar jogadores, alian\u00e7as ou cidades...',
            footerNavigate: '\u2191 \u2193 selecionar',
            footerOpen: 'Enter abrir',
            footerClose: 'Esc fechar',
            emptyTitle: 'Pesquisar no Grepolis',
            emptySubtitle: 'Jogadores \u00b7 Alian\u00e7as \u00b7 Cidades',
            emptyHintCoords: 'Tamb\u00e9m podes introduzir coordenadas: <strong>{example}</strong>',
            loadingWorldData: 'A carregar dados do mundo...',
            noResults: 'Nenhum resultado encontrado.',
            resultsMore: 'A mostrar {shown} de {total} \u2014 desloque para ver mais',
            errorLoadingData: 'Erro ao carregar dados: {error}',
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
            footerTab: 'Tab filtrar',
            footerFav: 'Ctrl+F favorito',
            footerBBCode: 'Ctrl+B copiar BBCode',
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
            shortcutsHelp: 'mostrar esta ajuda',
            commandGhostHelp: '>ghost [minPts] \u2014 listar cidades fantasma',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 dist\u00e2ncia de ilhas',
            commandHelpHint: '>help \u2014 mostrar esta lista',
            commandUnknown: 'Comando desconhecido: {cmd}',
            ghostEmpty: 'Nenhuma cidade fantasma encontrada.',
            distResult: 'Dist\u00e2ncia de ilhas: {n}',
            distFromActive: 'da sua cidade ativa',
            distNeedOrigin: 'Indique duas coordenadas, ou uma, se a sua cidade ativa puder ser detetada.',
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
        },
        br: {
            searchPlaceholder: 'Pesquisar jogadores, alian\u00e7as ou cidades...',
            footerNavigate: '\u2191 \u2193 selecionar',
            footerOpen: 'Enter abrir',
            footerClose: 'Esc fechar',
            emptyTitle: 'Pesquisar no Grepolis',
            emptySubtitle: 'Jogadores \u00b7 Alian\u00e7as \u00b7 Cidades',
            emptyHintCoords: 'Voc\u00ea tamb\u00e9m pode digitar coordenadas: <strong>{example}</strong>',
            loadingWorldData: 'Carregando dados do mundo...',
            noResults: 'Nenhum resultado encontrado.',
            resultsMore: 'Exibindo {shown} de {total} \u2014 role para ver mais',
            errorLoadingData: 'Erro ao carregar dados: {error}',
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
            footerTab: 'Tab filtrar',
            footerFav: 'Ctrl+F favorito',
            footerBBCode: 'Ctrl+B copiar BBCode',
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
            shortcutsHelp: 'mostrar esta ajuda',
            commandGhostHelp: '>ghost [minPts] \u2014 listar cidades fantasma',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 dist\u00e2ncia de ilhas',
            commandHelpHint: '>help \u2014 mostrar esta lista',
            commandUnknown: 'Comando desconhecido: {cmd}',
            ghostEmpty: 'Nenhuma cidade fantasma encontrada.',
            distResult: 'Dist\u00e2ncia de ilhas: {n}',
            distFromActive: 'da sua cidade ativa',
            distNeedOrigin: 'Informe duas coordenadas, ou uma, se sua cidade ativa puder ser detectada.',
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
        },
        tr: {
            searchPlaceholder: 'Oyuncu, ittifak veya \u015fehir ara...',
            footerNavigate: '\u2191 \u2193 se\u00e7',
            footerOpen: 'Enter a\u00e7',
            footerClose: 'Esc kapat',
            emptyTitle: "Grepolis'te ara",
            emptySubtitle: 'Oyuncular \u00b7 \u0130ttifaklar \u00b7 \u015eehirler',
            emptyHintCoords: 'Koordinat da girebilirsin: <strong>{example}</strong>',
            loadingWorldData: 'D\u00fcnya verileri y\u00fckleniyor...',
            noResults: 'Sonu\u00e7 bulunamad\u0131.',
            resultsMore: '{total} sonu\u00e7tan {shown} g\u00f6steriliyor \u2014 daha fazlas\u0131 i\u00e7in kayd\u0131r\u0131n',
            errorLoadingData: 'Veri y\u00fcklenirken hata olu\u015ftu: {error}',
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
            footerTab: 'Tab filtrele',
            footerFav: 'Ctrl+F favori',
            footerBBCode: 'Ctrl+B BBCode kopyala',
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
            shortcutsHelp: 'bu yard\u0131m\u0131 g\u00f6ster',
            commandHelpTitle: 'Komutlar',
            commandGotoHelp: '>goto 123:456 \u2014 bir adaya git',
            commandGhostHelp: '>ghost [minPts] \u2014 hayalet \u015fehirleri listele',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 ada mesafesi',
            commandHelpHint: '>help \u2014 bu listeyi g\u00f6ster',
            commandUnknown: 'Bilinmeyen komut: {cmd}',
            ghostEmpty: 'Hayalet \u015fehir bulunamad\u0131.',
            distResult: 'Ada mesafesi: {n}',
            distFromActive: 'aktif \u015fehrinden',
            distNeedOrigin: '\u0130ki koordinat ver veya aktif \u015fehrin alg\u0131lanabiliyorsa bir tane ver.',
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
        },
        ru: {
            searchPlaceholder: '\u041f\u043e\u0438\u0441\u043a \u0438\u0433\u0440\u043e\u043a\u043e\u0432, \u0430\u043b\u044c\u044f\u043d\u0441\u043e\u0432 \u0438\u043b\u0438 \u0433\u043e\u0440\u043e\u0434\u043e\u0432...',
            footerNavigate: '\u2191 \u2193 \u0432\u044b\u0431\u0440\u0430\u0442\u044c',
            footerOpen: 'Enter \u043e\u0442\u043a\u0440\u044b\u0442\u044c',
            footerClose: 'Esc \u0437\u0430\u043a\u0440\u044b\u0442\u044c',
            emptyTitle: '\u041f\u043e\u0438\u0441\u043a \u0432 Grepolis',
            emptySubtitle: '\u0418\u0433\u0440\u043e\u043a\u0438 \u00b7 \u0410\u043b\u044c\u044f\u043d\u0441\u044b \u00b7 \u0413\u043e\u0440\u043e\u0434\u0430',
            emptyHintCoords: '\u041c\u043e\u0436\u043d\u043e \u0442\u0430\u043a\u0436\u0435 \u0432\u0432\u0435\u0441\u0442\u0438 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b: <strong>{example}</strong>',
            loadingWorldData: '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0434\u0430\u043d\u043d\u044b\u0445 \u043c\u0438\u0440\u0430...',
            noResults: '\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u044b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.',
            resultsMore: '\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u043e {shown} \u0438\u0437 {total} \u2014 \u043f\u0440\u043e\u043a\u0440\u0443\u0442\u0438\u0442\u0435 \u0434\u043b\u044f \u0431\u043e\u043b\u044c\u0448\u0435\u0433\u043e',
            errorLoadingData: '\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0434\u0430\u043d\u043d\u044b\u0445: {error}',
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
            footerTab: 'Tab \u0444\u0438\u043b\u044c\u0442\u0440',
            footerFav: 'Ctrl+F \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435',
            footerBBCode: 'Ctrl+B \u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c BBCode',
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
            shortcutsHelp: '\u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u044d\u0442\u0443 \u0441\u043f\u0440\u0430\u0432\u043a\u0443',
            commandHelpTitle: '\u041a\u043e\u043c\u0430\u043d\u0434\u044b',
            commandGotoHelp: '>goto 123:456 \u2014 \u043f\u0435\u0440\u0435\u0439\u0442\u0438 \u043a \u043e\u0441\u0442\u0440\u043e\u0432\u0443',
            commandGhostHelp: '>ghost [\u043c\u0438\u043d.] \u2014 \u0441\u043f\u0438\u0441\u043e\u043a \u0433\u043e\u0440\u043e\u0434\u043e\u0432-\u043f\u0440\u0438\u0437\u0440\u0430\u043a\u043e\u0432',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 \u0440\u0430\u0441\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u043c\u0435\u0436\u0434\u0443 \u043e\u0441\u0442\u0440\u043e\u0432\u0430\u043c\u0438',
            commandHelpHint: '>help \u2014 \u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u044d\u0442\u043e\u0442 \u0441\u043f\u0438\u0441\u043e\u043a',
            commandUnknown: '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043a\u043e\u043c\u0430\u043d\u0434\u0430: {cmd}',
            ghostEmpty: '\u0413\u043e\u0440\u043e\u0434\u0430-\u043f\u0440\u0438\u0437\u0440\u0430\u043a\u0438 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.',
            distResult: '\u0420\u0430\u0441\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u043c\u0435\u0436\u0434\u0443 \u043e\u0441\u0442\u0440\u043e\u0432\u0430\u043c\u0438: {n}',
            distFromActive: '\u043e\u0442 \u0432\u0430\u0448\u0435\u0433\u043e \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0433\u043e \u0433\u043e\u0440\u043e\u0434\u0430',
            distNeedOrigin: '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0434\u0432\u0435 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b \u0438\u043b\u0438 \u043e\u0434\u043d\u0443, \u0435\u0441\u043b\u0438 \u0432\u0430\u0448 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0433\u043e\u0440\u043e\u0434 \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0451\u043d.',
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
        },
        el: {
            searchPlaceholder: '\u0391\u03bd\u03b1\u03b6\u03ae\u03c4\u03b7\u03c3\u03b7 \u03c0\u03b1\u03b9\u03ba\u03c4\u03ce\u03bd, \u03c3\u03c5\u03bc\u03bc\u03b1\u03c7\u03b9\u03ce\u03bd \u03ae \u03c0\u03cc\u03bb\u03b5\u03c9\u03bd...',
            footerNavigate: '\u2191 \u2193 \u03b5\u03c0\u03b9\u03bb\u03bf\u03b3\u03ae',
            footerOpen: 'Enter \u03ac\u03bd\u03bf\u03b9\u03b3\u03bc\u03b1',
            footerClose: 'Esc \u03ba\u03bb\u03b5\u03af\u03c3\u03b9\u03bc\u03bf',
            emptyTitle: '\u0391\u03bd\u03b1\u03b6\u03ae\u03c4\u03b7\u03c3\u03b7 \u03c3\u03c4\u03bf Grepolis',
            emptySubtitle: '\u03a0\u03b1\u03af\u03ba\u03c4\u03b5\u03c2 \u00b7 \u03a3\u03c5\u03bc\u03bc\u03b1\u03c7\u03af\u03b5\u03c2 \u00b7 \u03a0\u03cc\u03bb\u03b5\u03b9\u03c2',
            emptyHintCoords: '\u039c\u03c0\u03bf\u03c1\u03b5\u03af\u03c2 \u03b5\u03c0\u03af\u03c3\u03b7\u03c2 \u03bd\u03b1 \u03b5\u03b9\u03c3\u03b1\u03b3\u03ac\u03b3\u03b5\u03b9\u03c2 \u03c3\u03c5\u03bd\u03c4\u03b5\u03c4\u03b1\u03b3\u03bc\u03ad\u03bd\u03b5\u03c2: <strong>{example}</strong>',
            loadingWorldData: '\u03a6\u03cc\u03c1\u03c4\u03c9\u03c3\u03b7 \u03b4\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03c9\u03bd \u03ba\u03cc\u03c3\u03bc\u03bf\u03c5...',
            noResults: '\u0394\u03b5\u03bd \u03b2\u03c1\u03ad\u03b8\u03b7\u03ba\u03b1\u03bd \u03b1\u03c0\u03bf\u03c4\u03b5\u03bb\u03ad\u03c3\u03bc\u03b1\u03c4\u03b1.',
            resultsMore: '\u0395\u03bc\u03c6\u03ac\u03bd\u03b9\u03c3\u03b7 {shown} \u03b1\u03c0\u03cc {total} \u2014 \u03ba\u03c5\u03bb\u03af\u03c3\u03c4\u03b5 \u03b3\u03b9\u03b1 \u03c0\u03b5\u03c1\u03b9\u03c3\u03c3\u03cc\u03c4\u03b5\u03c1\u03b1',
            errorLoadingData: '\u03a3\u03c6\u03ac\u03bb\u03bc\u03b1 \u03c6\u03cc\u03c1\u03c4\u03c9\u03c3\u03b7\u03c2 \u03b4\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03c9\u03bd: {error}',
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
            footerTab: 'Tab \u03c6\u03af\u03bb\u03c4\u03c1\u03bf',
            footerFav: 'Ctrl+F \u03b1\u03b3\u03b1\u03c0\u03b7\u03bc\u03ad\u03bd\u03bf',
            footerBBCode: 'Ctrl+B \u03b1\u03bd\u03c4\u03b9\u03b3\u03c1\u03b1\u03c6\u03ae BBCode',
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
            shortcutsHelp: '\u03b5\u03bc\u03c6\u03ac\u03bd\u03b9\u03c3\u03b7 \u03b1\u03c5\u03c4\u03ae\u03c2 \u03c4\u03b7\u03c2 \u03b2\u03bf\u03ae\u03b8\u03b5\u03b9\u03b1\u03c2',
            commandHelpTitle: '\u0395\u03bd\u03c4\u03bf\u03bb\u03ad\u03c2',
            commandGotoHelp: '>goto 123:456 \u2014 \u03bc\u03b5\u03c4\u03ac\u03b2\u03b1\u03c3\u03b7 \u03c3\u03b5 \u03bd\u03b7\u03c3\u03af',
            commandGhostHelp: '>ghost [minPts] \u2014 \u03bb\u03af\u03c3\u03c4\u03b1 \u03c0\u03cc\u03bb\u03b5\u03c9\u03bd-\u03c6\u03b1\u03bd\u03c4\u03b1\u03c3\u03bc\u03ac\u03c4\u03c9\u03bd',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 \u03b1\u03c0\u03cc\u03c3\u03c4\u03b1\u03c3\u03b7 \u03bd\u03b7\u03c3\u03b9\u03ce\u03bd',
            commandHelpHint: '>help \u2014 \u03b5\u03bc\u03c6\u03ac\u03bd\u03b9\u03c3\u03b7 \u03b1\u03c5\u03c4\u03ae\u03c2 \u03c4\u03b7\u03c2 \u03bb\u03af\u03c3\u03c4\u03b1\u03c2',
            commandUnknown: '\u0386\u03b3\u03bd\u03c9\u03c3\u03c4\u03b7 \u03b5\u03bd\u03c4\u03bf\u03bb\u03ae: {cmd}',
            ghostEmpty: '\u0394\u03b5\u03bd \u03b2\u03c1\u03ad\u03b8\u03b7\u03ba\u03b1\u03bd \u03c0\u03cc\u03bb\u03b5\u03b9\u03c2-\u03c6\u03b1\u03bd\u03c4\u03ac\u03c3\u03bc\u03b1\u03c4\u03b1.',
            distResult: '\u0391\u03c0\u03cc\u03c3\u03c4\u03b1\u03c3\u03b7 \u03bd\u03b7\u03c3\u03b9\u03ce\u03bd: {n}',
            distFromActive: '\u03b1\u03c0\u03cc \u03c4\u03b7\u03bd \u03b5\u03bd\u03b5\u03c1\u03b3\u03ae \u03c0\u03cc\u03bb\u03b7 \u03c3\u03bf\u03c5',
            distNeedOrigin: '\u0394\u03ce\u03c3\u03b5 \u03b4\u03cd\u03bf \u03c3\u03c5\u03bd\u03c4\u03b5\u03c4\u03b1\u03b3\u03bc\u03ad\u03bd\u03b5\u03c2, \u03ae \u03bc\u03af\u03b1 \u03b1\u03bd \u03bc\u03c0\u03bf\u03c1\u03b5\u03af \u03bd\u03b1 \u03b1\u03bd\u03b9\u03c7\u03bd\u03b5\u03c5\u03b8\u03b5\u03af \u03b7 \u03b5\u03bd\u03b5\u03c1\u03b3\u03ae \u03c0\u03cc\u03bb\u03b7 \u03c3\u03bf\u03c5.',
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
        },
        hu: {
            searchPlaceholder: 'J\u00e1t\u00e9kosok, sz\u00f6vets\u00e9gek vagy v\u00e1rosok keres\u00e9se...',
            footerNavigate: '\u2191 \u2193 kiv\u00e1laszt\u00e1s',
            footerOpen: 'Enter megnyit\u00e1s',
            footerClose: 'Esc bez\u00e1r\u00e1s',
            emptyTitle: 'Keres\u00e9s a Grepolisban',
            emptySubtitle: 'J\u00e1t\u00e9kosok \u00b7 Sz\u00f6vets\u00e9gek \u00b7 V\u00e1rosok',
            emptyHintCoords: 'Koordin\u00e1t\u00e1kat is megadhatsz: <strong>{example}</strong>',
            loadingWorldData: 'Vil\u00e1gadatok bet\u00f6lt\u00e9se...',
            noResults: 'Nincs tal\u00e1lat.',
            resultsMore: '{shown}/{total} tal\u00e1lat megjelen\u0151\u2014 g\u00f6rgessen tov\u00e1bbiak\u00e9rt',
            errorLoadingData: 'Hiba az adatok bet\u00f6lt\u00e9sekor: {error}',
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
            footerTab: 'Tab sz\u0171r\u00e9s',
            footerFav: 'Ctrl+F kedvenc',
            footerBBCode: 'Ctrl+B BBCode m\u00e1sol\u00e1sa',
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
            shortcutsHelp: 's\u00fag\u00f3 megjelen\u00edt\u00e9se',
            commandHelpTitle: 'Parancsok',
            commandGotoHelp: '>goto 123:456 \u2014 ugr\u00e1s egy szigetre',
            commandGhostHelp: '>ghost [minPts] \u2014 szellemv\u00e1rosok list\u00e1ja',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 szigett\u00e1vols\u00e1g',
            commandHelpHint: '>help \u2014 lista megjelen\u00edt\u00e9se',
            commandUnknown: 'Ismeretlen parancs: {cmd}',
            ghostEmpty: 'Nincs szellemv\u00e1ros.',
            distResult: 'Szigett\u00e1vols\u00e1g: {n}',
            distFromActive: 'az akt\u00edv v\u00e1rosodb\u00f3l',
            distNeedOrigin: 'Adj meg k\u00e9t koordin\u00e1t\u00e1t, vagy egyet, ha az akt\u00edv v\u00e1rosod felismerhet\u0151.',
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
        },
        ro: {
            searchPlaceholder: 'Caut\u0103 juc\u0103tori, alian\u021be sau ora\u0219e...',
            footerNavigate: '\u2191 \u2193 selecteaz\u0103',
            footerOpen: 'Enter deschide',
            footerClose: 'Esc \u00eenchide',
            emptyTitle: 'Caut\u0103 \u00een Grepolis',
            emptySubtitle: 'Juc\u0103tori \u00b7 Alian\u021be \u00b7 Ora\u0219e',
            emptyHintCoords: 'Po\u021bi introduce \u0219i coordonate: <strong>{example}</strong>',
            loadingWorldData: 'Se \u00eencarc\u0103 datele lumii...',
            noResults: 'Niciun rezultat g\u0103sit.',
            resultsMore: 'Se afi\u0219eaz\u0103 {shown} din {total} \u2014 derula\u021bi pentru mai multe',
            errorLoadingData: 'Eroare la \u00eenc\u0103rcarea datelor: {error}',
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
            footerTab: 'Tab filtreaz\u0103',
            footerFav: 'Ctrl+F favorit',
            footerBBCode: 'Ctrl+B copiaz\u0103 BBCode',
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
            shortcutsHelp: 'afi\u0219eaz\u0103 acest ajutor',
            commandHelpTitle: 'Comenzi',
            commandGotoHelp: '>goto 123:456 \u2014 mergi la o insul\u0103',
            commandGhostHelp: '>ghost [minPts] \u2014 listeaz\u0103 ora\u0219ele fantom\u0103',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 distan\u021b\u0103 de insule',
            commandHelpHint: '>help \u2014 arat\u0103 aceast\u0103 list\u0103',
            commandUnknown: 'Comand\u0103 necunoscut\u0103: {cmd}',
            ghostEmpty: 'Nu s-au g\u0103sit ora\u0219e fantom\u0103.',
            distResult: 'Distan\u021b\u0103 de insule: {n}',
            distFromActive: 'din ora\u0219ul t\u0103u activ',
            distNeedOrigin: 'D\u0103 dou\u0103 coordonate, sau una dac\u0103 ora\u0219ul t\u0103u activ poate fi detectat.',
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
        },
        cs: {
            searchPlaceholder: 'Hledat hr\u00e1\u010de, aliance nebo m\u011bsta...',
            footerNavigate: '\u2191 \u2193 vybrat',
            footerOpen: 'Enter otev\u0159\u00edt',
            footerClose: 'Esc zav\u0159\u00edt',
            emptyTitle: 'Hledat v Grepolis',
            emptySubtitle: 'Hr\u00e1\u010di \u00b7 Aliance \u00b7 M\u011bsta',
            emptyHintCoords: 'M\u016f\u017ee\u0161 tak\u00e9 zadat sou\u0159adnice: <strong>{example}</strong>',
            loadingWorldData: 'Na\u010d\u00edt\u00e1n\u00ed dat sv\u011bta...',
            noResults: 'Nebyly nalezeny \u017e\u00e1dn\u00e9 v\u00fdsledky.',
            resultsMore: 'Zobrazeno {shown} z {total} \u2014 posunut\u00edm zobraz\u00edte dal\u0161\u00ed',
            errorLoadingData: 'Chyba p\u0159i na\u010d\u00edt\u00e1n\u00ed dat: {error}',
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
            footerTab: 'Tab filtr',
            footerFav: 'Ctrl+F obl\u00edben\u00e9',
            footerBBCode: 'Ctrl+B kop\u00edrovat BBCode',
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
            shortcutsHelp: 'zobrazit tuto n\u00e1pov\u011bdu',
            commandHelpTitle: 'P\u0159\u00edkazy',
            commandGotoHelp: '>goto 123:456 \u2014 p\u0159esko\u010dit na ostrov',
            commandGhostHelp: '>ghost [minPts] \u2014 m\u011bsta duch\u016f',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 vzd\u00e1lenost ostrov\u016f',
            commandHelpHint: '>help \u2014 zobrazit tento seznam',
            commandUnknown: 'Nezn\u00e1m\u00fd p\u0159\u00edkaz: {cmd}',
            ghostEmpty: 'Nebyla nalezena \u017e\u00e1dn\u00e1 m\u011bsta duch\u016f.',
            distResult: 'Vzd\u00e1lenost ostrov\u016f: {n}',
            distFromActive: 'z va\u0161eho aktivn\u00edho m\u011bsta',
            distNeedOrigin: 'Zadejte dv\u011b sou\u0159adnice, nebo jednu, pokud lze zjistit va\u0161e aktivn\u00ed m\u011bsto.',
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
        },
        sk: {
            searchPlaceholder: 'H\u013ead\u0165 hr\u00e1\u010dov, alianciu alebo mest\u00e1...',
            footerNavigate: '\u2191 \u2193 vybra\u0165',
            footerOpen: 'Enter otvori\u0165',
            footerClose: 'Esc zavrie\u0165',
            emptyTitle: 'H\u013eada\u0165 v Grepolis',
            emptySubtitle: 'Hr\u00e1\u010di \u00b7 Aliancie \u00b7 Mest\u00e1',
            emptyHintCoords: 'M\u00f4\u017ee\u0161 zada\u0165 aj s\u00faradnice: <strong>{example}</strong>',
            loadingWorldData: 'Na\u010d\u00edtavanie d\u00e1t sveta...',
            noResults: 'Neboli n\u00e1jden\u00e9 \u017eiadne v\u00fdsledky.',
            resultsMore: 'Zobrazen\u00fdch {shown} z {total} \u2014 posunut\u00edm zobraz\u00edte \u010fal\u0161ie',
            errorLoadingData: 'Chyba pri na\u010d\u00edtan\u00ed d\u00e1t: {error}',
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
            footerTab: 'Tab filter',
            footerFav: 'Ctrl+F ob\u013e\u00faben\u00e9',
            footerBBCode: 'Ctrl+B kop\u00edrova\u0165 BBCode',
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
            shortcutsHelp: 'zobrazi\u0165 t\u00fato pomoc',
            commandHelpTitle: 'Pr\u00edkazy',
            commandGotoHelp: '>goto 123:456 \u2014 sko\u010di\u0165 na ostrov',
            commandGhostHelp: '>ghost [minPts] \u2014 mest\u00e1 duchov',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 vzdialenos\u0165 ostrovov',
            commandHelpHint: '>help \u2014 zobrazi\u0165 tento zoznam',
            commandUnknown: 'Nezn\u00e1my pr\u00edkaz: {cmd}',
            ghostEmpty: 'Nena\u0161li sa \u017eiadne mest\u00e1 duchov.',
            distResult: 'Vzdialenos\u0165 ostrovov: {n}',
            distFromActive: 'z va\u0161eho akt\u00edvneho mesta',
            distNeedOrigin: 'Zadajte dve s\u00faradnice, alebo jednu, ak mo\u017eno zisti\u0165 va\u0161e akt\u00edvne mesto.',
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
        savedAt: 0,
        dataSource: null,
        // How many of state.results are currently rendered; grows as the
        // user scrolls down instead of rendering thousands of rows at once.
        visibleCount: CONFIG.RESULTS_PAGE_SIZE,
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
        islandIdByCoord: new Map(),
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
            favorites.unshift({ type: item.type, id: item.id, name: item.name, x: item.x, y: item.y });
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
     * Favorites first, then recent entries, deduplicated by type+id.
     * Each row gets a `section` marker ('favorite' | 'recent') that
     * the history renderer turns into group headers.
     */
    function buildHistoryResults() {
        const rows = [];
        const keys = new Set();

        for (const entry of loadFavorites()) {
            const item = hydrateHistoryItem(entry);
            if (item) {
                item.section = 'favorite';
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

        // Fuzzy subsequence: "pelu" -> "Peluriano".
        let position = 0;
        for (let i = 0; i < nameNorm.length; i++) {
            if (nameNorm[i] === queryNorm[position]) {
                position++;
                if (position === queryNorm.length) {
                    return 3000;
                }
            }
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

    function fetchText(path) {
        const url = `https://${WORLD}.grepolis.com${path}`;
        return fetch(url, { credentials: 'same-origin' }).then((response) => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} on ${path}`);
            }
            return response.text();
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

    function indexTowns(towns) {
        DATA.towns = towns;
        DATA.townById = new Map();
        DATA.townsByCoord = new Map();
        DATA.townsByPlayer = new Map();

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
        for (const island of islands) {
            DATA.islandIdByCoord.set(`${island.x}:${island.y}`, island.id);
        }
    }

    function parsePlayers(text) {
        const players = [];

        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;

            const parts = line.split(',');
            if (parts.length < 2) continue;

            const id = Number(parts[0]);
            if (!id) continue;

            const name = decodeName(parts[1]);

            players.push({
                id,
                name,
                nameNorm: normalize(name),
                allianceId: parts[2] ? Number(parts[2]) : null,
                points: Number(parts[3]) || 0,
                rank: Number(parts[4]) || 0,
                towns: Number(parts[5]) || 0,
            });
        }

        return players;
    }

    function parseAlliances(text) {
        const alliances = [];

        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;

            const parts = line.split(',');
            if (parts.length < 2) continue;

            const id = Number(parts[0]);
            if (!id) continue;

            const name = decodeName(parts[1]);

            alliances.push({
                id,
                name,
                nameNorm: normalize(name),
                points: Number(parts[2]) || 0,
                towns: Number(parts[3]) || 0,
                members: Number(parts[4]) || 0,
                rank: Number(parts[5]) || 0,
            });
        }

        return alliances;
    }

    function parseTowns(text) {
        const towns = [];

        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;

            const parts = line.split(',');
            if (parts.length < 7) continue;

            const id = Number(parts[0]);
            if (!id) continue;

            const playerId = Number(parts[1]);
            const name = decodeName(parts[2]);

            towns.push({
                id,
                playerId,
                name,
                nameNorm: normalize(name),
                islandX: Number(parts[3]),
                islandY: Number(parts[4]),
                numberOnIsland: Number(parts[5]),
                points: Number(parts[6]) || 0,
            });
        }

        return towns;
    }

    /*
     * islands.txt rows: id,x,y,type,phase,resource1,resource2. Only
     * id/x/y are needed here (see indexIslands above for why).
     */
    function parseIslands(text) {
        const islands = [];

        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;

            const parts = line.split(',');
            if (parts.length < 3) continue;

            const id = Number(parts[0]);
            if (!id) continue;

            islands.push({
                id,
                x: Number(parts[1]),
                y: Number(parts[2]),
            });
        }

        return islands;
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

    function cacheKey() {
        return `qfi:${WORLD}`;
    }

    function idbOpen() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore(DB_STORE, { keyPath: 'key' });
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

    async function loadAll(force) {
        if (state.loaded || state.loading) {
            return;
        }

        if (!WORLD) {
            state.loadError = 'Could not detect the current world.';
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

            const players = parsePlayers(playersText);
            const alliances = parseAlliances(alliancesText);
            const towns = parseTowns(townsText);
            const islands = parseIslands(islandsText);

            applyLoadedData('network', players, alliances, towns, islands, Date.now());
            cacheSet(players, alliances, towns, islands); // fire-and-forget; failures are ignored
            state.loading = false;
            finishLoad();
        } catch (error) {
            state.loadError = error && error.message ? error.message : String(error);
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
            allianceCount: alliances.size,
            ghostCount: ghosts,
            towns,
        };
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
            return islandRow(coords.x, coords.y);
        }

        return { type: 'coordinate', name: `${coords.x}:${coords.y}`, x: coords.x, y: coords.y, score: 15000 };
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
        } else {
            const active = activeTownCoords();
            if (active) {
                from = active;
                to = matched.length === 1 ? parsePair(matched[0]) : null;
                if (to) {
                    originLabel = ` (${translate('distFromActive')})`;
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
        const origin = near ? activeTownCoords() : null;
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
            origin = activeTownCoords();
            radius = parseRadius(tokens[0]);
        }

        if (!origin || radius === null) {
            return [{ type: 'info', name: translate('nearNeedOrigin') }];
        }

        const islands = [];
        for (const [key, towns] of DATA.townsByCoord) {
            const [x, y] = key.split(':').map(Number);
            const distance = islandDistance(origin, { x, y });
            if (distance <= radius) {
                islands.push({ x, y, distance, towns });
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
        const towns = [];
        for (const town of DATA.towns) {
            if (oceanOf(town.islandX, town.islandY) !== wanted) continue;
            if (allianceId) {
                const player = DATA.playerById.get(town.playerId);
                if (!player || player.allianceId !== allianceId) continue;
            }
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
        const origin = activeTownCoords();
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
        const knownCommands = ['goto', 'ghost', 'dist', 'island', 'near', 'ocean', 'settings', 'help'];

        if (!name || (tokens.length === 0 && !knownCommands.includes(name))) {
            const suggestions = [
                { type: 'command-suggestion', name: '>goto <x>:<y>', command: '>goto', helpText: translate('commandGotoHelp') },
                { type: 'command-suggestion', name: '>ghost [minPts] [near]', command: '>ghost', helpText: translate('commandGhostHelp') },
                { type: 'command-suggestion', name: '>dist X:Y [X:Y]', command: '>dist', helpText: translate('commandDistHelp') },
                { type: 'command-suggestion', name: '>island X:Y', command: '>island', helpText: translate('commandIslandHelp') },
                { type: 'command-suggestion', name: '>near [X:Y] [radius]', command: '>near', helpText: translate('commandNearHelp') },
                { type: 'command-suggestion', name: '>ocean M34 [alliance]', command: '>ocean', helpText: translate('commandOceanHelp') },
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
                const near = tokens.some((token) => token.toLowerCase() === 'near');
                const numeric = tokens.find((token) => token.toLowerCase() !== 'near' && Number.isFinite(Number(token)));
                return ghostRows(numeric !== undefined ? Number(numeric) : NaN, near);
            }

            case 'dist':
                return distRows(args);

            case 'island':
                return islandRows(args);

            case 'near':
                return nearRows(args);

            case 'ocean':
                return oceanRows(args);

            default:
                return [{ type: 'info', name: translate('commandUnknown', { cmd: nameRaw || '' }) }];
        }
    }

    function isCommand(query) {
        return query.startsWith(CONFIG.COMMAND_PREFIX);
    }

    function toggleFavoriteSelected() {
        const item = state.results[state.selected];
        if (!item || item.type === 'info') {
            return;
        }
        toggleFavorite(item);
        // In the history view the row set must be rebuilt so a just-
        // unfavorited item leaves the Favorites group.
        if (!state.query) {
            performSearch('', ++searchToken);
        } else {
            render();
        }
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
     * Copies the BBCode for the selected result and closes the
     * palette, mirroring Enter's "act on the selection, then close"
     * behavior. Silently no-ops for rows without a BBCode equivalent
     * instead of copying nothing useful or throwing.
     */
    function copySelectedBBCode() {
        const item = state.results[state.selected];
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
            // History/favorites view: skip heuristics and segmentation.
            state.query = '';
            state.segment = CONFIG.DEFAULT_SEGMENT;
            state.detail = false;
            state.fullResults = buildHistoryResults();
            state.segmentCounts = null;
            state.results = state.fullResults;
            state.selected = 0;
            state.visibleCount = CONFIG.RESULTS_PAGE_SIZE;
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

        if (segment === 'island') {
            if (coordinate && coordinate.type === 'island') {
                results = [coordinate, ...coordinate.towns.map((town) => townResult(town))];
                detail = true;
            } else {
                results = [];
            }
        } else if (coordinate && coordinate.type === 'island') {
            results = [coordinate, ...coordinate.towns.map((town) => townResult(town))];
            detail = true;
        } else if (coordinate && coordinate.type === 'town') {
            results = [coordinate];
        } else {
            if (segment === 'player') {
                const matches = searchPlayers(queryNorm);
                // An exact match reached through the explicit @p scope
                // drills straight into that player's own towns instead
                // of showing every fuzzy near-miss.
                if (matches.length && matches[0].score === 10000) {
                    results = playerDetailRows(matches[0].data);
                    detail = true;
                } else {
                    results = [...matches];
                }
            } else if (segment === 'alliance') {
                const matches = searchAlliances(queryNorm);
                if (matches.length && matches[0].score === 10000) {
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
                    <button type="button" id="qf-settings-btn" title="${escapeHTML(translate('settingsTitle'))}">${ICONS.gear}</button>
                    <kbd id="qf-esc-key">ESC</kbd>
                </div>
                <div id="qf-segments" hidden></div>
                <div id="qf-results"></div>
                <div id="qf-footer">
                    <div id="qf-footer-shortcuts">
                        <span id="qf-footer-tab">${escapeHTML(translate('footerTab'))}</span>
                        <span id="qf-footer-fav">${escapeHTML(translate('footerFav'))}</span>
                        <span id="qf-footer-bbcode">${escapeHTML(translate('footerBBCode'))}</span>
                        <span id="qf-footer-refresh">${escapeHTML(translate('footerRefresh'))}</span>
                        <span id="qf-footer-help">${escapeHTML(translate('footerHelp'))}</span>
                    </div>
                    <div id="qf-footer-meta">
                        <span id="qf-status"></span>
                        <span id="qf-version">v${VERSION}</span>
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
        resultsEl.addEventListener('mousedown', handleResultClick);
        resultsEl.addEventListener('scroll', () => {
            const nearBottom = resultsEl.scrollTop + resultsEl.clientHeight >= resultsEl.scrollHeight - 120;
            if (nearBottom) {
                loadMoreResults();
            }
        });
        overlay.querySelector('#qf-segments').addEventListener('mousedown', (event) => {
            const chip = event.target.closest('.qf-chip');
            if (!chip) return;
            event.preventDefault();
            setSegment(chip.dataset.segment);
        });

        overlay.querySelector('#qf-settings-btn').addEventListener('click', (event) => {
            event.preventDefault();
            openSettings();
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
        const input = document.getElementById('qf-input');
        const results = document.getElementById('qf-results');
        const segmentsEl = document.getElementById('qf-segments');

        if (!state.open) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'block';

        if (document.activeElement !== input) {
            requestAnimationFrame(() => input.focus());
        }

        // Segment chips only make sense while actively searching:
        // without a query the results are the history/favorites view,
        // and command output (ghost/dist/settings) is not segmentable.
        const showSegments = Boolean(state.query) && !state.showHelp && !state.showSettings && !isCommand(state.query) && state.segmentCounts && !state.loading;
        segmentsEl.hidden = !showSegments;
        if (showSegments) {
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
        }

        renderFooter();

        if (state.showSettings) {
            results.innerHTML = renderSettings();
            bindSettingsEvents(results);
            return;
        }

        if (state.showHelp) {
            results.innerHTML = renderHelp();
            return;
        }

        if (!state.query) {
            renderHistory(results);
            return;
        }

        if (state.loading) {
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

        if (!state.results.length) {
            if (state.loadError) {
                results.innerHTML = `
                    <div class="qf-empty qf-empty-error">
                        <div class="qf-empty-title">${escapeHTML(translate('dataError'))}</div>
                        <div class="qf-empty-hint">${escapeHTML(translate('errorLoadingData', { error: state.loadError }))}</div>
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
    }

    function renderHistory(container) {
        const rows = state.fullResults;
        if (!rows.length) {
            container.innerHTML = `
                <div class="qf-empty">
                    <div class="qf-empty-title">${escapeHTML(translate('emptyTitle'))}</div>
                    <div class="qf-empty-subtitle">${escapeHTML(translate('emptySubtitle'))}</div>
                    <div class="qf-empty-hint">
                        ${translate('emptyHintCoords', { example: '55:123' })}
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
                html += `<div class="qf-section">${
                    escapeHTML(translate(currentSection === 'favorite' ? 'favoritesTitle' : 'recentTitle'))
                }</div>`;
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
            ['Enter', translate('footerOpen')],
            ['Tab', translate('footerTab')],
            ['Home / End', translate('shortcutsFirstLast')],
            ['Ctrl+F', translate('footerFav')],
            ['Ctrl+B', translate('footerBBCode')],
            ['Ctrl+R', translate('footerRefresh')],
            ['Esc', translate('footerClose')],
            ['?', translate('shortcutsHelp')],
        ];

        const commands = [
            ['>goto 123:456', translate('commandGotoHelp')],
            ['>ghost [minPts] [near]', translate('commandGhostHelp')],
            ['>dist X:Y [X:Y]', translate('commandDistHelp')],
            ['>island X:Y', translate('commandIslandHelp')],
            ['>near [X:Y] [radius]', translate('commandNearHelp')],
            ['>ocean M34 [alliance]', translate('commandOceanHelp')],
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
                <div class="qf-settings-actions">
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
            const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(eventName, () => applySettingField(key, el.value));
            // Re-render the whole panel on blur so values normalized by
            // applySettingField (e.g. an out-of-range number clamped
            // back, or an invalid hotkey falling back to the default)
            // are reflected in the field instead of showing the raw
            // input the user typed.
            el.addEventListener('blur', () => render());
        });

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
    function isDetailHeader(item, index) {
        return index === 0 && state.detail && (item.type === 'player' || item.type === 'alliance' || item.type === 'island');
    }

    function renderResult(item, index) {
        const selected = index === state.selected ? ' qf-selected' : '';
        const favorite = item.type !== 'info' && isFavorite(item) ? ' qf-favorite' : '';
        const header = isDetailHeader(item, index) ? ' qf-result-header' : '';

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
                    const parts = [
                        `${player.towns.toLocaleString()} ${translate('townsSuffix')}`,
                        `${player.points.toLocaleString()} ${translate('ptsSuffix')}`,
                    ];
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
                    const parts = [
                        `${alliance.members.toLocaleString()} ${translate('membersSuffix')}`,
                        `${alliance.towns.toLocaleString()} ${translate('townsSuffix')}`,
                        `${alliance.points.toLocaleString()} ${translate('ptsSuffix')}`,
                    ];
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
                meta = `${item.x}:${item.y} &middot; ${sea}${pts}${owner}${alliance}${distance}`;

                const islandTowns = DATA.townsByCoord ? DATA.townsByCoord.get(`${item.x}:${item.y}`) : null;
                if (islandTowns && islandTowns.length > 1) {
                    title = ` title="${escapeHTML(translate('onIslandInfo', { n: islandTowns.length }))}"`;
                }
                break;
            }

            case 'island': {
                icon = ICONS.island;
                badge = translate('badgeIsland');
                badgeClass = 'qf-badge-coordinate';
                const distance = Number.isFinite(item.distance) ? `${item.distance} &middot; ` : '';
                const parts = [
                    translate('islandTowns', { n: item.townCount }),
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

            case 'info':
                icon = ICONS.info;
                info = true;
                break;
        }

        if (info) {
            return `
                <div class="qf-result-info" data-index="${index}">
                    <span class="qf-result-info-icon">${icon}</span>
                    <span class="qf-result-info-text">${escapeHTML(item.name)}</span>
                </div>
            `;
        }

        // Filled star (favorite) vs. outline star (not) — clicking is
        // handled in handleResultClick.
        const star = `<span class="qf-star" title="${escapeHTML(translate('favoritesTitle'))}">${isFavorite(item) ? ICONS.starFilled : ICONS.starOutline}</span>`;

        return `
            <div class="qf-result${selected}${favorite}${header}" data-index="${index}"${title}>
                <span class="qf-result-icon">${icon}</span>
                <div class="qf-result-body">
                    <div class="qf-result-line1">
                        <span class="qf-result-name">${escapeHTML(item.name)}</span>
                        ${star}
                        ${badge ? `<span class="qf-badge ${badgeClass}">${escapeHTML(badge)}</span>` : ''}
                    </div>
                    ${meta ? `<div class="qf-result-meta">${meta}</div>` : ''}
                </div>
            </div>
        `;
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

            if (key === CONFIG.BBCODE_KEY) {
                event.preventDefault();
                copySelectedBBCode();
                return;
            }
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (state.results.length) {
                    state.selected = (state.selected + 1) % state.results.length;
                    render();
                }
                break;

            case 'ArrowUp':
                event.preventDefault();
                if (state.results.length) {
                    state.selected = (state.selected - 1 + state.results.length) % state.results.length;
                    render();
                }
                break;

            case 'Tab':
                event.preventDefault();
                cycleSegment(event.shiftKey ? -1 : 1);
                break;

            case 'Home':
                event.preventDefault();
                if (state.results.length) {
                    state.selected = 0;
                    render();
                }
                break;

            case 'End':
                event.preventDefault();
                if (state.results.length) {
                    state.selected = state.results.length - 1;
                    render();
                }
                break;

            case 'Enter':
                event.preventDefault();
                openResult(state.results[state.selected]);
                break;

            case 'Escape':
                event.preventDefault();
                close();
                break;
        }
    }

    /*
     * ============================================================
     * CLICK
     * ============================================================
     */

    function handleResultClick(event) {
        const row = event.target.closest('.qf-result');
        if (!row) return;

        const index = Number(row.dataset.index);
        const item = state.results[index];

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

        state.selected = index;
        openResult(item);
    }

    /*
     * ============================================================
     * OPEN / CLOSE
     * ============================================================
     */

    function open() {
        createUI();

        state.open = true;

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
            state.results = state.fullResults;
            state.selected = 0;
            state.visibleCount = CONFIG.RESULTS_PAGE_SIZE;
            state.segment = CONFIG.DEFAULT_SEGMENT;
            state.segmentCounts = null;
            state.showHelp = false;
            state.showSettings = false;

            input.value = '';
            render();
            requestAnimationFrame(() => input.focus());
        }
    }

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

        const input = document.getElementById('qf-input');
        input.value = state.query || '';

        render();
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
                close();
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

        #qf-results {
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
            color: rgba(255, 255, 255, .14);
            font-size: 9px;
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
     * DEBUG API
     * ============================================================
     *
     * QF.debug() dumps the integration state to the console.
     * There is no per-keystroke logging in production; only initial
     * load messages, errors, and whatever is explicitly requested
     * here.
     */

    window.QF = {
        version: VERSION,
        world: WORLD,
        market: MARKET,
        state,
        data: DATA,
        gp: GP,
        get settings() {
            return settings;
        },

        search(query) {
            const queryNorm = normalize(query);
            return {
                players: searchPlayers(queryNorm),
                alliances: searchAlliances(queryNorm),
                towns: searchTowns(queryNorm),
                coordinate: searchCoordinates(query),
            };
        },

        /*
         * ========================================================
         * PROGRAMMATIC CONTROL (only for testing/automation from
         * the DevTools console). The UI doesn't use this under
         * normal conditions: the user interacts with keyboard/mouse
         * as usual. These methods simply call the same internal
         * functions already used by the keyboard/click handlers, so
         * behavior is identical to a real interaction.
         * ========================================================
         */

        openPalette() {
            open();
        },

        closePalette() {
            close();
        },

        openSettings() {
            openSettings();
        },

        setQuery(query) {
            open();
            const input = document.getElementById('qf-input');
            input.value = query;
            performSearch(query, ++searchToken);
            return state.results;
        },

        setSegment(name) {
            if (!state.query) return;
            setSegment(name);
            return state.results;
        },

        /*
         * Forces a network reload, dropping the IndexedDB cache.
         * Resolves when the fresh index is in place.
         */
        async refresh() {
            await refreshData();
        },

        async clearCache() {
            await cacheDelete();
        },

        selectIndex(index) {
            if (index < 0 || index >= state.results.length) {
                throw new Error(`Index out of range (0..${state.results.length - 1})`);
            }
            state.selected = index;
            render();
            return state.results[index];
        },

        openSelected() {
            return openResult(state.results[state.selected]);
        },

        openIndex(index) {
            this.selectIndex(index);
            return this.openSelected();
        },

        debug() {
            console.group(`[QF ${VERSION}]`);

            console.log('World:', WORLD);
            console.log('Market:', MARKET);
            console.log('GP context:', GP === window ? 'window (unsafeWindow not available)' : 'unsafeWindow');
            console.log('Settings:', settings);

            console.log('Index:', {
                loaded: state.loaded,
                loading: state.loading,
                error: state.loadError,
                players: DATA.players.length,
                alliances: DATA.alliances.length,
                towns: DATA.towns.length,
            });

            console.log('Game:', typeof GP.Game, GP.Game);
            console.log('Layout:', typeof GP.Layout, GP.Layout);
            console.log(
                'Layout.playerProfile.open:',
                GP.Layout && GP.Layout.playerProfile ? typeof GP.Layout.playerProfile.open : 'Layout.playerProfile not available'
            );
            console.log(
                'Layout.allianceProfile.open:',
                GP.Layout && GP.Layout.allianceProfile ? typeof GP.Layout.allianceProfile.open : 'Layout.allianceProfile not available'
            );
            console.log('WMap:', typeof GP.WMap, GP.WMap);
            console.log('WMap.mapJump:', GP.WMap ? typeof GP.WMap.mapJump : 'WMap not available');
            console.log('WMap.mapGotoPosition:', GP.WMap ? typeof GP.WMap.mapGotoPosition : 'WMap not available');
            console.log('ITowns.getTown:', GP.ITowns ? typeof GP.ITowns.getTown : 'ITowns not available');
            console.log('MM.getModels:', GP.MM ? typeof GP.MM.getModels : 'MM not available');

            if (GP.Layout) {
                const townKeys = Object.keys(GP.Layout).filter((k) => /town|info/i.test(k));
                console.log('Layout keys related to town/info:', townKeys);
            }

            const factories = Object.keys(GP).filter((k) => /WindowFactory$/i.test(k));
            console.log('WindowFactories found on GP:', factories);

            console.log('Last results:', state.results);

            console.groupEnd();
        },
    };

    /*
     * ============================================================
     * INIT
     * ============================================================
     */

    function init() {
        syncFavorites();
        createUI();
        injectMainMenuItem();
        setInterval(injectMainMenuItem, 1000);
        loadAll();

        console.info(`%c[Grepolis Quick Finder ${VERSION}] loaded`, 'color:#d6a342;font-weight:bold');
        console.info(`[QF] Detected world: ${WORLD} (market: ${MARKET})`);
        console.info(`[QF] ${hotkeyLabel()} to open.`);
        console.info('[QF] QF.debug() to inspect the integration.');
    }

    init();
})();
