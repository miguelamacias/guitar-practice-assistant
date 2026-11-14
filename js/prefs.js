// UI preferences: the database is the source of truth and localStorage is just
// a fast cache. If the browser storage is wiped, the values come back from the
// `settings` table (keys prefixed with `ui_`).
//
// The modules keep reading/writing localStorage as usual; this file only
// mirrors those keys: hydrate() restores what is missing, snapshot() pushes
// whatever changed.
(function (GPH) {
    'use strict';

    // localStorage key -> settings key
    const MAP = {
        'gph_metro_bpm': 'ui_metro_bpm',
        'gph_drum_bpm': 'ui_drum_bpm',
        'gph_drum_state': 'ui_drum_state',
        'gph_delay_bpm': 'ui_delay_bpm',
        'gph_chords_by_key': 'ui_chords_by_key',
        'gph_theory_state': 'ui_theory_state',
        'gph_chord_diagrams_state': 'ui_chord_diagrams_state',
        'gph_subfolder_collapsed': 'ui_subfolder_collapsed',
        'gph_section_collapsed': 'ui_section_collapsed'
    };

    const RESTORED_FLAG = 'gphPrefsRestored';
    const cache = {};

    function localGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function localSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }

    // Restores the keys the browser no longer has. One silent reload applies
    // them, because the modules read their settings once at start-up.
    function hydrate() {
        return fetch('/api/prefs', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (db) {
                if (!db) return;
                let restored = 0;
                Object.keys(MAP).forEach(function (localKey) {
                    const dbVal = db[MAP[localKey]];
                    if (dbVal === undefined || dbVal === null || dbVal === '') return;
                    cache[localKey] = dbVal;
                    if (localGet(localKey) === null) {
                        localSet(localKey, dbVal);
                        restored++;
                    }
                });
                let seen = false;
                try { seen = sessionStorage.getItem(RESTORED_FLAG) === '1'; } catch (e) {}
                if (restored && !seen) {
                    try { sessionStorage.setItem(RESTORED_FLAG, '1'); } catch (e) {}
                    location.reload();
                }
            })
            .catch(function () {});
    }

    // Pushes the keys whose local value changed since the last snapshot.
    function snapshot() {
        Object.keys(MAP).forEach(function (localKey) {
            const value = localGet(localKey);
            if (value === null || value === cache[localKey]) return;
            cache[localKey] = value;
            try {
                GPH.settings.set(MAP[localKey], value).catch(function () {
                    delete cache[localKey];
                });
            } catch (e) { delete cache[localKey]; }
        });
    }

    let started = false;

    function start() {
        if (started) return;
        started = true;
        hydrate();
        setInterval(snapshot, 4000);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') snapshot();
        });
        window.addEventListener('pagehide', snapshot);
    }

    GPH.prefs = { start: start, hydrate: hydrate, snapshot: snapshot, MAP: MAP };
})(window.GPH = window.GPH || {});
