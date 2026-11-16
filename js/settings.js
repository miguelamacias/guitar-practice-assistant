// Ajustes compartidos (app + gestor): /api/settings + utilidades comunes.
// Expone: GPH.settings { DEFAULTS, get, getOr, set, isOn, applyAccent, loadAccent }
//         GPH.util     { toRgb, normalizeHex, parseCsvInts }
(function (GPH) {
    'use strict';

    // Factory defaults (the values the DB had when they were set).
    const DEFAULTS = {
        accent_color: '#ff8040',
        assistant_enabled: '1',
        fretboard_enabled: '1',
        fretboard_trainer_enabled: '1',
        fretboard_theory_enabled: '1',
        fretboard_chords_enabled: '1',
        fretboard_chord_diagrams_enabled: '1',
        fretboard_color: '#607d8b',
        fretboard_strings: '1,2,3,4,5,6',
        fretboard_frets: '12',
        // The real defaults live in db.DEFAULT_AREAS; this copy is only a
        // fallback when the settings endpoint cannot be reached.
        practice_areas: '[{"id":"knowledge","label":"Knowledge","position":0},' +
            '{"id":"technique","label":"Technique","position":1},' +
            '{"id":"repertoire","label":"Repertoire","position":2},' +
            '{"id":"rhythm","label":"Rhythm","position":3},' +
            '{"id":"improvisation","label":"Improvisation","position":4},' +
            '{"id":"ear_training","label":"Ear Training","position":5}]'
    };

    function get(key) {
        return fetch('/api/settings/' + key, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { return (d && d.value !== undefined) ? d.value : null; })
            .catch(function () { return null; });
    }

    // Like get() but returns the default when there is no stored value.
    function getOr(key) {
        return get(key).then(function (v) {
            if (v === null || v === undefined || v === '') {
                return (DEFAULTS[key] !== undefined) ? DEFAULTS[key] : null;
            }
            return v;
        });
    }

    function set(key, value) {
        return fetch('/api/settings/' + key, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: value })
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    // Parses the '1'/'0'/'true'/'false' flags.
    function isOn(v) {
        return v === '1' || v === 'true' || v === 1 || v === true;
    }

    // The accent can be customised, so it is remembered here: the tiny script in
    // the <head> of index.html and manager.html reads this key and paints the
    // colour before the first frame (the CSS default is only the shipped one).
    const ACCENT_KEY = 'gphAccent';

    function applyAccent(color) {
        if (!color) return;
        document.documentElement.style.setProperty('--accent', color);
        try { localStorage.setItem(ACCENT_KEY, String(color)); } catch (e) { /* private mode */ }
    }
    // Applies the stored accent (if any) and returns it.
    function loadAccent() {
        return get('accent_color').then(function (v) {
            if (v) applyAccent(v);
            return v;
        });
    }

    // ---- Utilidades ----

    // '#abc' | '#aabbcc' | 'rgb(r,g,b)' | 'rgba(r,g,b,a)' -> [r, g, b] | null
    function toRgb(c) {
        if (!c) return null;
        const s = String(c).trim();
        let m = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
        if (m) {
            let h = m[1];
            if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
            return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        }
        m = s.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
        if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
        return null;
    }

    // Normalizes to '#rrggbb' (or null if it is not a valid color).
    function normalizeHex(val) {
        if (!val) return null;
        const rgb = toRgb(val);
        if (!rgb) return null;
        let out = '#';
        for (let i = 0; i < 3; i++) {
            let h = Math.max(0, Math.min(255, rgb[i])).toString(16);
            if (h.length === 1) h = '0' + h;
            out += h;
        }
        return out;
    }

    // '1,3,5' -> [1,3,5] filtering by range; returns fallback if nothing is left.
    function parseCsvInts(val, min, max, fallback) {
        const fb = (fallback || []).slice();
        if (val === null || val === undefined || val === '') return fb;
        const parts = String(val).split(',');
        const out = [];
        for (let i = 0; i < parts.length; i++) {
            const n = parseInt(parts[i], 10);
            if (!isNaN(n) && n >= min && n <= max) out.push(n);
        }
        if (!out.length) return fb;
        out.sort(function (a, b) { return a - b; });
        return out;
    }

    // Tap tempo: median of the intervals throws the slips away, then the mean of
    // what is left so the number still moves smoothly. Returns BPM or null.
    function tapBpm(times) {
        if (!times || times.length < 2) return null;
        const gaps = [];
        for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
        if (!gaps.length) return null;
        const sorted = gaps.slice().sort(function (a, b) { return a - b; });
        const mid = sorted.length >> 1;
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        if (!median) return null;
        const keep = gaps.filter(function (g) { return Math.abs(g - median) <= median * 0.25; });
        const avg = keep.reduce(function (a, b) { return a + b; }, 0) / (keep.length || 1);
        if (!avg) return null;
        return Math.max(40, Math.min(240, Math.round(60000 / avg)));
    }

    GPH.settings = { DEFAULTS: DEFAULTS, get: get, getOr: getOr, set: set, isOn: isOn, applyAccent: applyAccent, loadAccent: loadAccent };
    GPH.util = { toRgb: toRgb, normalizeHex: normalizeHex, parseCsvInts: parseCsvInts, tapBpm: tapBpm };
})(window.GPH = window.GPH || {});
