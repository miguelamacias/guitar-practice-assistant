// Debug helpers shared by the app (index.html) and the manager (manager.html).
//
//   ?debug=1   -> dry-run: every write (any non-GET fetch) is blocked and logged.
//   ?debug=0   -> back to normal logging.
//
// The flag lives in localStorage, so it applies to the manager iframe too and
// survives reloads until it is switched off.
//
// It also paints two amber badges (bottom-right, self-styled so no stylesheet
// has to know about them):
//   DEBUG   - the client is not sending any write to the server.
//   SANDBOX - the server is running against practice_sandbox.db (`--sandbox`).
(function (GPH) {
    'use strict';

    const KEY = 'gphDebug';
    // Everything the practice assistant keeps between sessions.
    const SESSION_KEYS = [
        'routineSessionActive', 'currentExerciseIndex', 'practiceStartTimeVal',
        'routineStates', 'routineCompleted', 'lastRoutineStartedAt', 'lastRoutineFinishedAt'
    ];

    // ?debug=1 / ?debug=0 wins over the stored flag (and persists it).
    // Switching the flag also wipes the assistant's session keys: a test run
    // must not leave anything behind, and a real session must not leak into
    // the dry run either (the DB-side session is recovered by the app).
    try {
        const q = new URLSearchParams(location.search);
        if (q.has('debug')) {
            const v = String(q.get('debug') || '').toLowerCase();
            const wasOn = localStorage.getItem(KEY) === '1';
            if (v === '0' || v === 'off' || v === 'false') localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, '1');
            const nowOn = localStorage.getItem(KEY) === '1';
            if (wasOn !== nowOn) {
                SESSION_KEYS.forEach(function (k) {
                    try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
                });
            }
        }
    } catch (e) { /* private mode: stay off */ }

    let enabled = false;
    try { enabled = localStorage.getItem(KEY) === '1'; } catch (e) { enabled = false; }

    const outbox = [];

    // ---- Dry run -----------------------------------------------------------
    // Only writes are intercepted: reads (GET/HEAD) still hit the server so the
    // UI keeps loading real data while nothing is ever persisted.
    if (enabled && typeof window.fetch === 'function') {
        const realFetch = window.fetch.bind(window);
        window.fetch = function (input, init) {
            const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            if (method === 'GET' || method === 'HEAD') return realFetch(input, init);
            const url = typeof input === 'string' ? input : ((input && input.url) || '');
            const entry = { at: new Date().toISOString(), method: method, url: url, body: (init && init.body) || null };
            outbox.push(entry);
            if (outbox.length > 200) outbox.shift();
            if (window.console && console.info) console.info('[debug] blocked ' + method + ' ' + url);
            return Promise.resolve(new Response(
                JSON.stringify({ ok: true, debug: true, blocked: method + ' ' + url }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            ));
        };
    }

    function dump() {
        if (!outbox.length) {
            if (window.console) console.info('[debug] outbox is empty');
            return outbox;
        }
        outbox.slice(-20).forEach(function (e, i) {
            if (!window.console) return;
            console.info('#' + (i + 1) + ' ' + e.method + ' ' + e.url);
            if (e.body) {
                try { console.info(JSON.parse(e.body)); } catch (err) { console.info(e.body); }
            }
        });
        return outbox;
    }

    // Clears the browser-side session so a dry run leaves nothing behind.
    function resetLocal() {
        SESSION_KEYS.forEach(function (k) {
            try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
        });
        outbox.length = 0;
        if (window.console) console.info('[debug] local session keys cleared');
    }

    // ---- Badges ------------------------------------------------------------
    const COLORS = {
        debug: { bg: '#f0b429', fg: '#1a1a1a', border: '#8a6413' },
        sandbox: { bg: '#b45309', fg: '#fff', border: '#f0b429' }
    };
    let badgeBox = null;

    function addBadge(text, title, kind) {
        if (!document.body) return;
        if (!badgeBox) {
            badgeBox = document.createElement('div');
            badgeBox.id = 'gphDebugBadges';
            badgeBox.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147483000;' +
                'display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:none;';
            document.body.appendChild(badgeBox);
        }
        const c = COLORS[kind] || COLORS.debug;
        const el = document.createElement('div');
        el.textContent = text;
        el.title = title || '';
        el.style.cssText = 'pointer-events:auto;cursor:help;padding:4px 10px;border-radius:12px;' +
            'font:700 11px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.5px;' +
            'background:' + c.bg + ';color:' + c.fg + ';border:1px solid ' + c.border + ';' +
            'box-shadow:0 2px 10px rgba(0,0,0,.5);white-space:nowrap;';
        badgeBox.appendChild(el);
    }

    function paint() {
        if (enabled) {
            addBadge('DEBUG \u00b7 no log', 'Dry run: writes are blocked. ?debug=0 to disable. (GPH.debug.dump() to inspect)', 'debug');
            if (document.title.indexOf('DEBUG') < 0) document.title += ' \u00b7 DEBUG';
        }
        // Server-side sandbox: detected from /api/health (a GET, never blocked).
        fetch('/api/health', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (h) {
                if (!h || !h.sandbox) return;
                addBadge('SANDBOX \u00b7 ' + (h.db || ''), 'The server is using a throw-away database (' + (h.db || '') + '). Real data is untouched.', 'sandbox');
                if (document.title.indexOf('SANDBOX') < 0) document.title += ' \u00b7 SANDBOX';
            })
            .catch(function () { /* server down or old version */ });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
    else paint();

    GPH.debug = {
        on: enabled,
        outbox: outbox,
        dump: dump,
        clear: function () { outbox.length = 0; },
        resetLocal: resetLocal
    };

    if (enabled && window.console) console.info('[debug] dry run on - writes are blocked (?debug=0 to stop)');
})(window.GPH = window.GPH || {});
