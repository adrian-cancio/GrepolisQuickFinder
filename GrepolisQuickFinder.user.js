// ==UserScript==
// @name         Grepolis Quick Finder
// @namespace    https://grepolis.com/
// @version      2.2.0
// @description  Quick palette (Ctrl+Shift+F) to search players, alliances and towns in Grepolis, with real in-game navigation, segments, commands, history/favorites and a local cache. Automatically localized based on the current world/market.
// @author       Cancio
// @match        https://*.grepolis.com/game/*
// @match        http://*.grepolis.com/game/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '2.2.0';

    /*
     * ============================================================
     * CONFIG
     * ============================================================
     */

    const CONFIG = {
        HOTKEY: 'f',              // Ctrl+Shift+<HOTKEY>
        MAX_RESULTS: 30,
        MIN_TOWN_QUERY_LENGTH: 2, // avoids listing half an island with 1 letter
        SEARCH_DELAY: 150,        // debounce in ms
        FAV_KEY: 'f',             // Ctrl+<FAV_KEY> inside the palette: toggle favorite
        REFRESH_KEY: 'r',         // Ctrl+<REFRESH_KEY> inside the palette: reload data
        HELP_CHAR: '?',           // typing this alone shows the shortcuts/commands panel
        COMMAND_PREFIX: '>',      // commands: >goto, >ghost, >dist, >help
        SEGMENTS: ['all', 'player', 'alliance', 'town', 'coordinate'],
        DEFAULT_SEGMENT: 'all',
        SCOPE_ALIASES: { t: 'town', p: 'player', a: 'alliance', c: 'coordinate' },
        HISTORY_MAX: 12,
        FAVORITES_MAX: 30,
        CACHE_TTL: 6 * 60 * 60 * 1000, // reuse world data for at most this long
        GHOST_MIN_POINTS: 0,
    };

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
            footerRefresh: 'Ctrl+R refresh',
            footerHelp: '? help',
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
            commandGhostHelp: '>ghost [minPts] \u2014 list ghost towns',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 island distance',
            commandHelpHint: '>help \u2014 show this list',
            commandUnknown: 'Unknown command: {cmd}',
            ghostEmpty: 'No ghost towns found.',
            distResult: 'Island distance: {n}',
            distFromActive: 'from your active city',
            distNeedOrigin: 'Give two coordinates, or one if your active city can be detected.',
            scopeHelpTitle: 'Scopes',
            scopeHelpDesc: '@p players \u00b7 @a alliances \u00b7 @t towns \u00b7 @c coordinates',
            externalStats: 'Open in GrepoLife',
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
            footerRefresh: 'Ctrl+R recargar',
            footerHelp: '? ayuda',
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
            commandGhostHelp: '>ghost [minPts] \u2014 listar ciudades fantasma',
            commandDistHelp: '>dist X:Y [X:Y] \u2014 distancia de islas',
            commandHelpHint: '>help \u2014 mostrar esta lista',
            commandUnknown: 'Comando desconocido: {cmd}',
            ghostEmpty: 'No se encontraron ciudades fantasma.',
            distResult: 'Distancia de islas: {n}',
            distFromActive: 'desde tu ciudad activa',
            distNeedOrigin: 'Da dos coordenadas, o una si se puede detectar tu ciudad activa.',
            scopeHelpTitle: 'Ambitos',
            scopeHelpDesc: '@p jugadores \u00b7 @a alianzas \u00b7 @t ciudades \u00b7 @c coordenadas',
            externalStats: 'Abrir en GrepoLife',
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
            footerRefresh: 'Strg+R aktualisieren',
            footerHelp: '? Hilfe',
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
            externalStats: 'In GrepoLife \u00f6ffnen',
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
            footerRefresh: 'Ctrl+R actualiser',
            footerHelp: '? aide',
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
            externalStats: 'Ouvrir dans GrepoLife',
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
            footerRefresh: 'Ctrl+R aggiorna',
            footerHelp: '? aiuto',
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
            externalStats: 'Apri in GrepoLife',
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
            footerRefresh: 'Ctrl+R verversen',
            footerHelp: '? help',
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
            externalStats: 'Openen in GrepoLife',
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
            footerRefresh: 'Ctrl+R od\u015bwie\u017c',
            footerHelp: '? pomoc',
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
            externalStats: 'Otw\u00f3rz w GrepoLife',
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
            footerRefresh: 'Ctrl+R atualizar',
            footerHelp: '? ajuda',
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
            externalStats: 'Abrir no GrepoLife',
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
            footerRefresh: 'Ctrl+R atualizar',
            footerHelp: '? ajuda',
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
            externalStats: 'Abrir no GrepoLife',
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
            footerRefresh: 'Ctrl+R yenile',
            footerHelp: '? yard\u0131m',
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
            externalStats: 'GrepoLife\u2019da a\u00e7',
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
            footerRefresh: 'Ctrl+R \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c',
            footerHelp: '? \u0441\u043f\u0440\u0430\u0432\u043a\u0430',
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
            externalStats: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0432 GrepoLife',
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
            footerRefresh: 'Ctrl+R \u03b1\u03bd\u03ac\u03ba\u03c4\u03b7\u03c3\u03b7',
            footerHelp: '? \u03b2\u03bf\u03ae\u03b8\u03b5\u03b9\u03b1',
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
            externalStats: '\u0386\u03bd\u03bf\u03b9\u03b3\u03bc\u03b1 \u03c3\u03c4\u03bf GrepoLife',
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
            footerRefresh: 'Ctrl+R friss\u00edt\u00e9s',
            footerHelp: '? s\u00fag\u00f3',
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
            externalStats: 'Megnyit\u00e1s a GrepoLife-ban',
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
            footerRefresh: 'Ctrl+R re\u00eencarc\u0103',
            footerHelp: '? ajutor',
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
            externalStats: 'Deschide \u00een GrepoLife',
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
            footerRefresh: 'Ctrl+R obnovit',
            footerHelp: '? n\u00e1pov\u011bda',
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
            externalStats: 'Otev\u0159\u00edt v GrepoLife',
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
            footerRefresh: 'Ctrl+R obnovi\u0165',
            footerHelp: '? pomoc',
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
            externalStats: 'Otvori\u0165 v GrepoLife',
        },
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

    function resolveLocale(world) {
        const market = getMarket(world);
        const languageKey = market && MARKET_TO_LANGUAGE[market];
        return LOCALES[languageKey] || LOCALES.en;
    }

    const WORLD = getWorld();
    const MARKET = getMarket(WORLD);

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
        showHelp: false,
        savedAt: 0,
        dataSource: null,
    };

    /*
     * ============================================================
     * DATA (in-memory index built from Grepolis' public data
     * dumps: /data/players.txt, /data/alliances.txt and
     * /data/towns.txt). These are same-origin, plain-text files
     * that the game client itself exposes for rankings/exports.
     * This is not a made-up endpoint: they are loaded once on
     * startup and cached in memory, so subsequent searches are
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
        coordinate: 'segmentCoords',
    };

    let favoriteSet = new Set();
    let lastClosedByEnter = false;

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
        const list = loadHistory().filter((entry) => !(entry.type === item.type && entry.id === item.id));
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
        const index = favorites.findIndex((entry) => entry.type === item.type && entry.id === item.id);
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
                    const player = DATA.playerById.get(town.playerId);
                    return {
                        type: 'town',
                        id: town.id,
                        name: town.name,
                        x: town.islandX,
                        y: town.islandY,
                        playerId: town.playerId,
                        playerName: player ? player.name : '',
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
     * EXTERNAL STATS (GrepoLife)
     * ============================================================
     *
     * GrepoLife organizes worlds by language directory + numeric
     * world: https://grepolife.com/{market}/{world}/{player|alliance}/{id}
     * (e.g. fr/178/player/4290280). The world number is the trailing
     * digits of the world subdomain (en37 -> 37). Test/kitchen worlds
     * ('zz') have no GrepoLife catalog, so the link is disabled there.
     */

    function externalStatsUrl(type, id) {
        if (!WORLD || MARKET === 'zz') {
            return null;
        }
        const pathByType = { player: 'player', alliance: 'alliance' };
        if (!pathByType[type]) {
            return null;
        }
        const worldNumber = WORLD.match(/\d+$/);
        if (!worldNumber) {
            return null;
        }
        const url = `https://grepolife.com/${MARKET}/${worldNumber[0]}/${pathByType[type]}/${id}`;
        return id === undefined || id === null || id === '' ? null : url;
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
     * /data/players.txt, /data/alliances.txt and /data/towns.txt are
     * same-origin (same world subdomain as /game/index), so a plain
     * `fetch` is enough: no need for GM_xmlhttpRequest or @connect,
     * and we avoid the complexity of manually decompressing gzip.
     * All three are loaded in parallel once on startup.
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

    function cacheSet(players, alliances, towns) {
        return idbOpen()
            .then((db) => new Promise((resolve, reject) => {
                const tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).put({
                    key: cacheKey(),
                    savedAt: Date.now(),
                    players,
                    alliances,
                    towns,
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

    function applyLoadedData(source, players, alliances, towns, savedAt) {
        indexPlayers(players);
        indexAlliances(alliances);
        indexTowns(towns);
        state.savedAt = savedAt || Date.now();
        state.dataSource = source;
        state.loaded = true;
        state.loadError = null;

        console.info(
            `[QF] Data loaded (${source}): ${players.length} players, ` +
            `${alliances.length} alliances, ${towns.length} towns.`
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
                if (cached && cached.savedAt && Date.now() - cached.savedAt < CONFIG.CACHE_TTL) {
                    applyLoadedData('cache', cached.players || [], cached.alliances || [], cached.towns || [], cached.savedAt);
                    state.loading = false;
                    finishLoad();
                    return;
                }
            }

            const [playersText, alliancesText, townsText] = await Promise.all([
                fetchText('/data/players.txt'),
                fetchText('/data/alliances.txt'),
                fetchText('/data/towns.txt'),
            ]);

            const players = parsePlayers(playersText);
            const alliances = parseAlliances(alliancesText);
            const towns = parseTowns(townsText);

            applyLoadedData('network', players, alliances, towns, Date.now());
            cacheSet(players, alliances, towns); // fire-and-forget; failures are ignored
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
                const player = DATA.playerById.get(town.playerId);
                out.push({
                    type: 'town',
                    id: town.id,
                    name: town.name,
                    score,
                    x: town.islandX,
                    y: town.islandY,
                    playerId: town.playerId,
                    playerName: player ? player.name : '',
                    data: town,
                });
            }
        }
        return out;
    }

    function searchCoordinates(rawQuery) {
        const coords = parseCoordinates(rawQuery);
        if (!coords) {
            return null;
        }

        const matching = DATA.townsByCoord.get(`${coords.x}:${coords.y}`);
        const unique = matching && matching.length === 1;

        // Only a lone town on its island can be resolved unambiguously.
        // Islands with several towns would pick one at random, so those
        // fall through to a plain coordinate result that jumps the map.
        if (unique) {
            const town = matching[0];
            const player = DATA.playerById.get(town.playerId);
            return {
                type: 'town',
                id: town.id,
                name: town.name,
                score: 20000,
                x: town.islandX,
                y: town.islandY,
                playerId: town.playerId,
                playerName: player ? player.name : '',
                data: town,
            };
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
        if (state.segment === CONFIG.DEFAULT_SEGMENT) {
            state.results = state.fullResults;
        } else {
            state.results = state.fullResults.filter((item) => item.type === state.segment);
        }
        state.selected = 0;
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
        return [{ type: 'info', name: translate('distResult', { n: distance }) + originLabel }];
    }

    /*
     * Ghost towns are towns with playerId 0: abandoned by their
     * player and reclaimable. They are sorted by points (biggest
     * first, mirroring the in-game ghost listings).
     */
    function ghostRows(minPoints) {
        const minimum = Number.isFinite(minPoints) ? minPoints : CONFIG.GHOST_MIN_POINTS;
        const towns = DATA.towns
            .filter((town) => town.playerId === 0 && town.points >= minimum)
            .sort((a, b) => b.points - a.points)
            .slice(0, CONFIG.MAX_RESULTS);

        if (!towns.length) {
            return [{ type: 'info', name: translate('ghostEmpty') }];
        }

        return towns.map((town) => ({
            type: 'town',
            id: town.id,
            name: town.name,
            x: town.islandX,
            y: town.islandY,
            playerId: town.playerId,
            playerName: '',
            data: town,
        }));
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

        if (!name || (tokens.length === 0 && !['goto', 'ghost', 'dist', 'help'].includes(name))) {
            const suggestions = [
                { type: 'command-suggestion', name: '>goto <x>:<y>', command: '>goto', helpText: translate('commandGotoHelp') },
                { type: 'command-suggestion', name: '>ghost [minPts]', command: '>ghost', helpText: translate('commandGhostHelp') },
                { type: 'command-suggestion', name: '>dist X:Y [X:Y]', command: '>dist', helpText: translate('commandDistHelp') },
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

            case 'goto': {
                const coords = parseCoordinates(args);
                if (!coords) {
                    return [{ type: 'info', name: translate('commandGotoHelp') }];
                }
                openCoordinate(coords);
                return null;
            }

            case 'ghost':
                return ghostRows(args ? Number(args) : NaN);

            case 'dist':
                return distRows(args);

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

        // '?' and '>help' shortcuts render the help panel even while
        // the index is still loading, so those are handled first.
        if (query === CONFIG.HELP_CHAR) {
            state.showHelp = true;
            render();
            return;
        }

        if (isCommand(query)) {
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
                applySegment();
            }
            render();
            return;
        }

        if (!query) {
            // History/favorites view: skip heuristics and segmentation.
            state.query = '';
            state.segment = CONFIG.DEFAULT_SEGMENT;
            state.fullResults = buildHistoryResults();
            state.segmentCounts = null;
            state.results = state.fullResults;
            state.selected = 0;
            render();
            return;
        }

        if (!state.loaded) {
            // loadAll() was already triggered in init(); it just hasn't finished yet.
            state.results = [];
            render();
            return;
        }

        // Optional "@scope" prefix pins the search to one segment,
        // e.g. "@t Naxos" or "@alliance Donners". The prefix is
        // stripped before the actual query.
        let segment = state.segment;
        let searchQuery = query;
        const scopeMatch = query.match(/^@([tpaoc])\s+(.+)/);
        if (scopeMatch) {
            segment = CONFIG.SCOPE_ALIASES[scopeMatch[1]];
            state.segment = segment;
            searchQuery = scopeMatch[2];
        }

        const queryNorm = normalize(searchQuery);
        const coordinate = searchCoordinates(searchQuery);

        let results;

        if (coordinate && coordinate.type === 'town') {
            results = [coordinate];
        } else {
            if (segment === 'player') {
                results = [...searchPlayers(queryNorm)];
            } else if (segment === 'alliance') {
                results = [...searchAlliances(queryNorm)];
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

        results.sort((a, b) => b.score - a.score);

        const seen = new Set();
        results = results.filter((item) => {
            const key = `${item.type}:${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        if (token !== searchToken) {
            return; // in case something more recent already fired in the meantime.
        }

        state.segmentCounts = computeCounts(results);
        state.fullResults = results.slice(0, CONFIG.MAX_RESULTS);
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
                    lastClosedByEnter = true;
                }
                return ok;
            case 'coordinate':
                ok = openCoordinate(item);
                break;
            default:
                return false;
        }

        if (ok) {
            addHistory(item);
            lastClosedByEnter = true;
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
                    <span id="qf-search-icon">&#8981;</span>
                    <input
                        id="qf-input"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="${escapeHTML(translate('searchPlaceholder'))}"
                    >
                    <kbd>ESC</kbd>
                </div>
                <div id="qf-segments" hidden></div>
                <div id="qf-results"></div>
                <div id="qf-footer">
                    <span>${escapeHTML(translate('footerTab'))}</span>
                    <span id="qf-footer-fav">${escapeHTML(translate('footerFav'))}</span>
                    <span id="qf-footer-refresh">${escapeHTML(translate('footerRefresh'))}</span>
                    <span id="qf-footer-help">${escapeHTML(translate('footerHelp'))}</span>
                    <span id="qf-status"></span>
                    <span id="qf-version">v${VERSION}</span>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('#qf-backdrop').addEventListener('mousedown', close);

        const input = overlay.querySelector('#qf-input');
        input.addEventListener('input', (event) => scheduleSearch(event.target.value));
        input.addEventListener('keydown', handleInputKeydown);

        overlay.querySelector('#qf-results').addEventListener('mousedown', handleResultClick);
        overlay.querySelector('#qf-segments').addEventListener('mousedown', (event) => {
            const chip = event.target.closest('.qf-chip');
            if (!chip) return;
            event.preventDefault();
            setSegment(chip.dataset.segment);
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
        // and command output (ghost/dist) is not segmentable.
        const showSegments = Boolean(state.query) && !state.showHelp && !isCommand(state.query) && state.segmentCounts && !state.loading;
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
            results.innerHTML = `
                <div class="qf-loading">
                    <div class="qf-spinner"></div>
                    ${escapeHTML(translate('loadingWorldData'))}
                </div>
            `;
            return;
        }

        if (!state.results.length) {
            results.innerHTML = `
                <div class="qf-empty">
                    ${escapeHTML(translate('noResults'))}
                    ${
                        state.loadError
                            ? `<div class="qf-empty-hint">${escapeHTML(translate('errorLoadingData', { error: state.loadError }))}</div>`
                            : ''
                    }
                </div>
            `;
            return;
        }

        results.innerHTML = state.results.map((item, index) => renderResult(item, index)).join('');

        const selectedEl = results.querySelector('.qf-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
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
            ['\u2191 \u2193', translate('footerNavigate')],
            ['Enter', translate('footerOpen')],
            ['Tab', translate('footerTab')],
            ['Home / End', translate('shortcutsFirstLast')],
            ['Ctrl+F', translate('footerFav')],
            ['Ctrl+R', translate('footerRefresh')],
            ['Esc', translate('footerClose')],
            ['?', translate('shortcutsHelp')],
        ];

        const commands = [
            ['>goto 123:456', translate('commandGotoHelp')],
            ['>ghost [minPts]', translate('commandGhostHelp')],
            ['>dist X:Y [X:Y]', translate('commandDistHelp')],
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
     * RESULT ROW
     * ============================================================
     */

    function renderResult(item, index) {
        const selected = index === state.selected ? ' qf-selected' : '';
        const favorite = item.type !== 'info' && isFavorite(item) ? ' qf-favorite' : '';

        let icon = '&bull;';
        let badge = '';
        let badgeClass = '';
        let meta = '';
        let external = '';
        let title = '';
        let info = false;

        switch (item.type) {
            case 'player': {
                icon = '&#128100;'; // 👤
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
                const url = externalStatsUrl('player', item.id);
                if (url) {
                    external = `<a class="qf-external" href="${url}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(translate('externalStats'))}">&#128279;</a>`;
                }
                break;
            }

            case 'alliance': {
                icon = '&#128737;'; // 🛡️
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
                const url = externalStatsUrl('alliance', item.id);
                if (url) {
                    external = `<a class="qf-external" href="${url}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(translate('externalStats'))}">&#128279;</a>`;
                }
                break;
            }

            case 'town': {
                icon = '&#127961;'; // 🏙️
                badge = translate('badgeTown');
                badgeClass = 'qf-badge-town';
                const player = item.playerName ? ` &middot; ${escapeHTML(item.playerName)}` : '';
                const points = item.data ? item.data.points : (item.points || 0);
                const pts = points ? ` &middot; ${points.toLocaleString()} ${translate('ptsSuffix')}` : '';
                const sea = getSea(item.x, item.y);
                meta = `${sea}${pts}${player}`;

                const islandTowns = DATA.townsByCoord ? DATA.townsByCoord.get(`${item.x}:${item.y}`) : null;
                if (islandTowns && islandTowns.length > 1) {
                    title = ` title="${escapeHTML(translate('onIslandInfo', { n: islandTowns.length }))}"`;
                }
                break;
            }

            case 'command-suggestion': {
                icon = '&#128187;'; // 💻
                badge = 'Command';
                badgeClass = 'qf-badge-coordinate';
                meta = escapeHTML(item.helpText);
                info = true;
                break;
            }

            case 'coordinate': {
                icon = '&#128205;'; // 📍
                badge = translate('badgeCoordinate');
                badgeClass = 'qf-badge-coordinate';
                meta = `${item.x}:${item.y}`;
                break;
            }

            case 'info':
                icon = '&#8505;'; // ℹ️
                info = true;
                break;
        }

        // Star toggles between ★ (favorite) and ☆ (not) — clicking is handled in handleResultClick.
        const star = !info
            ? `<span class="qf-star" title="${escapeHTML(translate('favoritesTitle'))}">${isFavorite(item) ? '&#9733;' : '&#9734;'}</span>`
            : '';

        return `
            <div class="qf-result${selected}${favorite}${info ? ' qf-result-info' : ''}" data-index="${index}"${title}>
                <span class="qf-result-icon">${icon}</span>
                <span class="qf-result-name">${escapeHTML(item.name)}${star}</span>
                ${meta ? `<span class="qf-result-meta">${meta}</span>` : ''}
                ${external}
                ${badge ? `<span class="qf-badge ${badgeClass}">${escapeHTML(badge)}</span>` : ''}
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
        // External-stats links must not bubble into row opening.
        if (event.target.closest('.qf-external')) {
            return;
        }

        const row = event.target.closest('.qf-result');
        if (!row) return;

        const index = Number(row.dataset.index);
        const item = state.results[index];

        if (event.target.closest('.qf-star')) {
            event.stopPropagation();
            if (item && item.type !== 'info') {
                toggleFavorite(item);
                performSearch(state.query);
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

        if (lastClosedByEnter && state.query) {
            input.value = state.query;
            render();
            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
            lastClosedByEnter = false;
        } else {
            state.query = '';
            state.fullResults = buildHistoryResults();
            state.results = state.fullResults;
            state.selected = 0;
            state.segment = CONFIG.DEFAULT_SEGMENT;
            state.segmentCounts = null;
            state.showHelp = false;
            lastClosedByEnter = false;

            input.value = '';
            render();
            requestAnimationFrame(() => input.focus());
        }
    }

    function close(resetState = false) {
        if (resetState) {
            lastClosedByEnter = false;
        }
        state.open = false;

        const overlay = document.getElementById('qf-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    function toggle() {
        if (state.open) {
            close();
        } else {
            open();
        }
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

        #qf-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, .43);
            backdrop-filter: blur(2px);
        }

        #qf-window {
            position: absolute;
            top: 12%;
            left: 50%;
            transform: translateX(-50%);
            width: min(720px, calc(100vw - 30px));
            overflow: hidden;
            color: #eee;
            background: linear-gradient(180deg, #292929, #191919);
            border: 1px solid rgba(255, 255, 255, .14);
            border-radius: 9px;
            box-shadow: 0 25px 90px rgba(0, 0, 0, .72);
        }

        #qf-input-row {
            display: flex;
            align-items: center;
            height: 60px;
            padding: 0 14px;
            border-bottom: 1px solid rgba(255, 255, 255, .1);
        }

        #qf-search-icon {
            width: 30px;
            font-size: 25px;
            opacity: .6;
            text-align: center;
        }

        #qf-input {
            flex: 1;
            min-width: 0;
            height: 100%;
            padding: 0 10px;
            border: 0;
            outline: 0;
            background: transparent;
            color: #fff;
            font-size: 18px;
        }

        #qf-input::placeholder {
            color: rgba(255, 255, 255, .35);
        }

        #qf-input-row kbd {
            padding: 3px 7px;
            border: 1px solid rgba(255, 255, 255, .15);
            border-radius: 4px;
            color: rgba(255, 255, 255, .4);
            font-size: 10px;
        }

        #qf-results {
            max-height: 480px;
            overflow-y: auto;
        }

        #qf-segments {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            padding: 6px 14px;
            border-bottom: 1px solid rgba(255, 255, 255, .08);
        }

        #qf-segments[hidden] {
            display: none;
        }

        .qf-chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 2px 9px;
            border: 1px solid rgba(255, 255, 255, .14);
            border-radius: 11px;
            color: rgba(255, 255, 255, .6);
            font-size: 10px;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
        }

        .qf-chip:hover {
            color: rgba(255, 255, 255, .85);
            border-color: rgba(255, 255, 255, .3);
        }

        .qf-chip-active {
            color: #1c1c1c;
            background: #d7a33f;
            border-color: #d7a33f;
        }

        .qf-chip-count {
            opacity: .6;
            font-weight: 600;
        }

        .qf-chip-active .qf-chip-count {
            opacity: .75;
        }

        .qf-result {
            display: flex;
            align-items: center;
            gap: 8px;
            height: 27px;
            padding: 0 12px;
            border-left: 2px solid transparent;
            cursor: pointer;
        }

        .qf-result:hover,
        .qf-selected {
            background: rgba(255, 255, 255, .08);
            border-left-color: #d7a33f;
        }

        .qf-result-icon {
            flex: 0 0 auto;
            width: 16px;
            font-size: 12px;
            text-align: center;
            opacity: .9;
        }

        .qf-result-name {
            flex: 0 0 210px;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 13px;
            font-weight: 500;
            text-align: left;
        }

        .qf-result-meta {
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: rgba(255, 255, 255, .45);
            font-size: 11px;
            text-align: center;
        }

        .qf-badge {
            flex: 0 0 auto;
            padding: 1px 6px;
            border-radius: 3px;
            color: rgba(255, 255, 255, .8);
            background: rgba(255, 255, 255, .08);
            font-size: 9px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .4px;
        }

        .qf-badge-player { background: rgba(90, 160, 255, .18); color: #9cc4ff; }
        .qf-badge-alliance { background: rgba(215, 163, 63, .2); color: #e6bd6c; }
        .qf-badge-town { background: rgba(100, 200, 140, .18); color: #8fdba9; }
        .qf-badge-coordinate { background: rgba(200, 120, 220, .18); color: #dda6ea; }

        .qf-star {
            margin-left: 4px;
            color: #d7a33f;
            font-size: 10px;
        }

        .qf-external {
            flex: 0 0 auto;
            margin-left: 2px;
            color: rgba(255, 255, 255, .4);
            font-size: 13px;
            text-decoration: none;
        }

        .qf-external:hover {
            color: #d7a33f;
        }

        .qf-result-info {
            font-style: italic;
            color: rgba(255, 255, 255, .55);
        }

        .qf-section {
            padding: 8px 14px 3px;
            color: rgba(255, 255, 255, .38);
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .8px;
        }

        .qf-empty,
        .qf-loading {
            padding: 40px 20px;
            text-align: center;
            color: rgba(255, 255, 255, .5);
        }

        .qf-empty-title {
            margin-bottom: 7px;
            color: rgba(255, 255, 255, .75);
            font-size: 15px;
        }

        .qf-empty-subtitle {
            font-size: 12px;
        }

        .qf-empty-hint {
            margin-top: 12px;
            font-size: 10px;
            opacity: .65;
        }

        .qf-loading {
            font-size: 12px;
        }

        .qf-spinner {
            width: 22px;
            height: 22px;
            margin: 0 auto 10px;
            border: 2px solid rgba(255, 255, 255, .18);
            border-top-color: rgba(255, 255, 255, .65);
            border-radius: 50%;
            animation: qf-spin .7s linear infinite;
        }

        @keyframes qf-spin {
            to { transform: rotate(360deg); }
        }

        #qf-footer {
            display: flex;
            gap: 18px;
            padding: 8px 14px;
            background: rgba(0, 0, 0, .15);
            border-top: 1px solid rgba(255, 255, 255, .08);
            color: rgba(255, 255, 255, .32);
            font-size: 10px;
        }

        #qf-status {
            margin-left: auto;
            color: rgba(255, 255, 255, .28);
            font-size: 10px;
        }

        #qf-version {
            color: rgba(255, 255, 255, .18);
        }

        .qf-help {
            padding: 18px 20px;
        }

        .qf-help-title {
            margin: 14px 0 6px;
            color: rgba(255, 255, 255, .6);
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: .6px;
        }

        .qf-help-title:first-child {
            margin-top: 0;
        }

        .qf-help-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }

        .qf-help-table td {
            padding: 3px 8px 3px 0;
            vertical-align: top;
        }

        .qf-help-table td:first-child {
            width: 38%;
        }

        .qf-help-table kbd {
            padding: 1px 6px;
            border: 1px solid rgba(255, 255, 255, .18);
            border-radius: 4px;
            background: rgba(255, 255, 255, .06);
            color: rgba(255, 255, 255, .8);
            font-size: 10px;
        }

        .qf-help-text {
            font-size: 11px;
            line-height: 1.5;
            color: rgba(255, 255, 255, .5);
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

        statsUrl(type, id) {
            return externalStatsUrl(type, id);
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
        loadAll();

        console.info(`%c[Grepolis Quick Finder ${VERSION}] loaded`, 'color:#d6a342;font-weight:bold');
        console.info(`[QF] Detected world: ${WORLD} (market: ${MARKET})`);
        console.info('[QF] Ctrl+Shift+F to open.');
        console.info('[QF] QF.debug() to inspect the integration.');
    }

    init();
})();
