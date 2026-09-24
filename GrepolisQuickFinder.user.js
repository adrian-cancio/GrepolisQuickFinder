// ==UserScript==
// @name         Grepolis Quick Finder
// @namespace    https://grepolis.com/
// @version      2.1.0
// @description  Quick palette (Ctrl+Shift+F) to search players, alliances and towns in Grepolis, with real in-game navigation. Automatically localized based on the current world/market.
// @author       Cancio
// @match        https://*.grepolis.com/game/*
// @match        http://*.grepolis.com/game/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '2.1.0';

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

    function parsePlayers(text) {
        const players = [];
        const byId = new Map();

        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;

            const parts = line.split(',');
            if (parts.length < 2) continue;

            const id = Number(parts[0]);
            if (!id) continue;

            const name = decodeName(parts[1]);

            const player = {
                id,
                name,
                nameNorm: normalize(name),
                allianceId: parts[2] ? Number(parts[2]) : null,
                points: Number(parts[3]) || 0,
                rank: Number(parts[4]) || 0,
                towns: Number(parts[5]) || 0,
            };

            players.push(player);
            byId.set(id, player);
        }

        DATA.players = players;
        DATA.playerById = byId;
    }

    function parseAlliances(text) {
        const alliances = [];
        const byId = new Map();

        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;

            const parts = line.split(',');
            if (parts.length < 2) continue;

            const id = Number(parts[0]);
            if (!id) continue;

            const name = decodeName(parts[1]);

            const alliance = {
                id,
                name,
                nameNorm: normalize(name),
                points: Number(parts[2]) || 0,
                towns: Number(parts[3]) || 0,
                members: Number(parts[4]) || 0,
                rank: Number(parts[5]) || 0,
            };

            alliances.push(alliance);
            byId.set(id, alliance);
        }

        DATA.alliances = alliances;
        DATA.allianceById = byId;
    }

    function parseTowns(text) {
        const towns = [];
        const byId = new Map();
        const byCoord = new Map();
        const byPlayer = new Map();

        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;

            const parts = line.split(',');
            if (parts.length < 7) continue;

            const id = Number(parts[0]);
            if (!id) continue;

            const playerId = Number(parts[1]);
            const name = decodeName(parts[2]);
            const islandX = Number(parts[3]);
            const islandY = Number(parts[4]);

            const town = {
                id,
                playerId,
                name,
                nameNorm: normalize(name),
                islandX,
                islandY,
                numberOnIsland: Number(parts[5]),
                points: Number(parts[6]) || 0,
            };

            towns.push(town);
            byId.set(id, town);

            // islandX:islandY is the ISLAND coordinate, not the town's
            // exact position: a single island can host up to 20 towns,
            // so several towns share the same key. We keep a list per
            // island; a lone town on its island is then the only case
            // where coordinates resolve to a single, unambiguous town.
            if (!byCoord.has(`${islandX}:${islandY}`)) {
                byCoord.set(`${islandX}:${islandY}`, []);
            }
            byCoord.get(`${islandX}:${islandY}`).push(town);

            if (!byPlayer.has(playerId)) {
                byPlayer.set(playerId, []);
            }
            byPlayer.get(playerId).push(town);
        }

        DATA.towns = towns;
        DATA.townById = byId;
        DATA.townsByCoord = byCoord;
        DATA.townsByPlayer = byPlayer;
    }

    async function loadAll() {
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
            const [playersText, alliancesText, townsText] = await Promise.all([
                fetchText('/data/players.txt'),
                fetchText('/data/alliances.txt'),
                fetchText('/data/towns.txt'),
            ]);

            parsePlayers(playersText);
            parseAlliances(alliancesText);
            parseTowns(townsText);

            state.loaded = true;
            state.loadError = null;

            console.info(
                `[QF] Data loaded: ${DATA.players.length} players, ` +
                `${DATA.alliances.length} alliances, ${DATA.towns.length} towns.`
            );
        } catch (error) {
            state.loadError = error && error.message ? error.message : String(error);
            console.error('[QF] Error loading world data:', error);
        } finally {
            state.loading = false;

            // A query typed while the index was still loading was
            // discarded by performSearch() (it had nothing to search
            // against yet). Re-run it now that the index is ready, so
            // the user doesn't see a spurious "No results found."
            if (state.query && !state.loadError) {
                performSearch(state.query, ++searchToken);
            } else {
                render();
            }
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

        if (!query) {
            state.results = [];
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

        const queryNorm = normalize(query);
        const coordinate = searchCoordinates(query);

        let results;

        if (coordinate && coordinate.type === 'town') {
            results = [coordinate];
        } else {
            results = [...searchPlayers(queryNorm), ...searchAlliances(queryNorm)];

            if (query.length >= CONFIG.MIN_TOWN_QUERY_LENGTH) {
                results.push(...searchTowns(queryNorm));
            }

            if (coordinate) {
                results.unshift(coordinate);
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

        state.results = results.slice(0, CONFIG.MAX_RESULTS);
        state.selected = 0;
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
        if (GP.WMap && typeof GP.WMap.mapGotoPosition === 'function') {
            try {
                GP.WMap.mapGotoPosition(item.x, item.y);
                close();
                return true;
            } catch (error) {
                console.error('[QF] WMap.mapGotoPosition() failed:', error);
            }
        }

        console.info('[QF] Coordinates with no known town in the index:', item.x, item.y);
        return false;
    }

    function openResult(item) {
        if (!item) return false;

        switch (item.type) {
            case 'player':
                return openPlayer(item);
            case 'alliance':
                return openAlliance(item);
            case 'town':
                return openTown(item);
            case 'coordinate':
                return openCoordinate(item);
            default:
                return false;
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
                <div id="qf-results"></div>
                <div id="qf-footer">
                    <span>${escapeHTML(translate('footerNavigate'))}</span>
                    <span>${escapeHTML(translate('footerOpen'))}</span>
                    <span>${escapeHTML(translate('footerClose'))}</span>
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

        if (!state.open) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'block';

        if (document.activeElement !== input) {
            requestAnimationFrame(() => input.focus());
        }

        if (!state.query) {
            results.innerHTML = `
                <div class="qf-empty">
                    <div class="qf-empty-title">${escapeHTML(translate('emptyTitle'))}</div>
                    <div class="qf-empty-subtitle">${escapeHTML(translate('emptySubtitle'))}</div>
                    <div class="qf-empty-hint">
                        ${translate('emptyHintCoords', { example: '55:123' })}
                    </div>
                    ${
                        state.loading
                            ? `<div class="qf-empty-hint">${escapeHTML(translate('loadingWorldData'))}</div>`
                            : ''
                    }
                </div>
            `;
            return;
        }

        if (state.loading) {
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
     * ============================================================
     * RESULT ROW
     * ============================================================
     */

    function renderResult(item, index) {
        const selected = index === state.selected ? ' qf-selected' : '';

        let icon = '&bull;';
        let badge = '';
        let badgeClass = '';
        let meta = '';

        switch (item.type) {
            case 'player': {
                icon = '&#128100;'; // 👤
                badge = translate('badgePlayer');
                badgeClass = 'qf-badge-player';
                const player = item.data;
                if (player) {
                    const alliance = player.allianceId ? DATA.allianceById.get(player.allianceId) : null;
                    const parts = [`${player.points.toLocaleString()} ${translate('ptsSuffix')}`];
                    if (alliance) parts.push(escapeHTML(alliance.name));
                    meta = parts.join(' &middot; ');
                }
                break;
            }

            case 'alliance': {
                icon = '&#128737;'; // 🛡️
                badge = translate('badgeAlliance');
                badgeClass = 'qf-badge-alliance';
                const alliance = item.data;
                if (alliance) {
                    meta = `${alliance.members.toLocaleString()} ${translate('membersSuffix')}`;
                }
                break;
            }

            case 'town': {
                icon = '&#127961;'; // 🏙️
                badge = translate('badgeTown');
                badgeClass = 'qf-badge-town';
                const player = item.playerName ? ` &middot; ${escapeHTML(item.playerName)}` : '';
                meta = `${item.x}:${item.y}${player}`;
                break;
            }

            case 'coordinate': {
                icon = '&#128205;'; // 📍
                badge = translate('badgeCoordinate');
                badgeClass = 'qf-badge-coordinate';
                meta = `${item.x}:${item.y}`;
                break;
            }
        }

        return `
            <div class="qf-result${selected}" data-index="${index}">
                <span class="qf-result-icon">${icon}</span>
                <span class="qf-result-name">${escapeHTML(item.name)}</span>
                ${meta ? `<span class="qf-result-meta">${meta}</span>` : ''}
                <span class="qf-badge ${badgeClass}">${escapeHTML(badge)}</span>
            </div>
        `;
    }

    /*
     * ============================================================
     * KEYBOARD (inside the palette)
     * ============================================================
     */

    function handleInputKeydown(event) {
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
        state.selected = index;
        openResult(state.results[index]);
    }

    /*
     * ============================================================
     * OPEN / CLOSE
     * ============================================================
     */

    function open() {
        createUI();

        state.open = true;
        state.query = '';
        state.results = [];
        state.selected = 0;

        const input = document.getElementById('qf-input');
        input.value = '';

        render();
        requestAnimationFrame(() => input.focus());
    }

    function close() {
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
            flex: 0 1 auto;
            min-width: 40px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 13px;
            font-weight: 500;
        }

        .qf-result-meta {
            flex: 1 1 auto;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: rgba(255, 255, 255, .4);
            font-size: 11px;
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

        #qf-version {
            margin-left: auto;
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
        createUI();
        loadAll();

        console.info(`%c[Grepolis Quick Finder ${VERSION}] loaded`, 'color:#d6a342;font-weight:bold');
        console.info(`[QF] Detected world: ${WORLD} (market: ${MARKET})`);
        console.info('[QF] Ctrl+Shift+F to open.');
        console.info('[QF] QF.debug() to inspect the integration.');
    }

    init();
})();
