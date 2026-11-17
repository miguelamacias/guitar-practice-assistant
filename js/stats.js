// Transparent practice instrumentation: ids, best-effort POSTs and a tiny
// localStorage retry queue. It never asks the user for anything and never
// paints UI. The authoritative counters live in the session rows; the event
// log is supplementary and may lose a row if the tab is killed mid-flight.
(function (GPH) {
    'use strict';

    const QUEUE_KEY = 'gphStatsQueue';
    const MAX_QUEUE = 100;

    function uid() {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                return window.crypto.randomUUID();
            }
        } catch (e) { /* fall through */ }
        return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    function readQueue() {
        try {
            const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
            return Array.isArray(raw) ? raw : [];
        } catch (e) { return []; }
    }

    function writeQueue(items) {
        try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE))); } catch (e) {}
    }

    function post(path, body) {
        return fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true
        }).then(function (r) {
            // 409 means "the session is closed": the event is no longer useful.
            if (!r.ok && r.status !== 409) throw new Error('http');
            return r;
        });
    }

    function send(path, body) {
        post(path, body).catch(function () {
            const q = readQueue();
            q.push({ path: path, body: body });
            writeQueue(q);
        });
    }

    function flush() {
        const q = readQueue();
        if (!q.length) return;
        const entry = q[0];
        post(entry.path, entry.body).then(function () {
            writeQueue(q.slice(1));
            flush();
        }).catch(function () { /* keep it for the next attempt */ });
    }

    // type is short snake_case (session_start, item_pause, media_start...).
    function event(type, ctx, extra) {
        const e = extra || {};
        send('/api/practice/events', {
            event_uid: uid(),
            session_id: (ctx && ctx.session_id) || null,
            item_position: (ctx && ctx.item_position != null) ? ctx.item_position : null,
            at: new Date().toISOString(),
            type: type,
            value_num: e.value_num || 0,
            value_text: e.value_text || '',
            payload: e.payload || ''
        });
    }

    function mediaPlay(record) {
        send('/api/media/plays', record);
    }

    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') flush();
    });
    window.addEventListener('pagehide', flush);

    GPH.stats = { uid: uid, event: event, mediaPlay: mediaPlay, flush: flush };
    flush();
})(window.GPH = window.GPH || {});
