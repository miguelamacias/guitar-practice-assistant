// API client (SQLite through server.py).
// The app works against the local DB: if /api/state fails there is nothing to show.
(function (GPH) {
    'use strict';

    GPH.data = GPH.data || {};

    async function loadState() {
        try {
            const res = await fetch('/api/state', { cache: 'no-store' });
            if (!res.ok) throw new Error('api ' + res.status);
            const state = await res.json();
            GPH.data.activeRoutine = (state && state.activeRoutine) || null;
            GPH.data.songSources = (state && state.songSources) || {};
            return true;
        } catch (err) {
            GPH.data.activeRoutine = GPH.data.activeRoutine || null;
            GPH.data.songSources = GPH.data.songSources || {};
            return false;
        }
    }

    async function getSections() {
        const r = await fetch('/api/sections', { cache: 'no-store' });
        if (!r.ok) throw new Error('sections ' + r.status);
        return r.json();
    }

    GPH.api = { loadState, getSections };

})(window.GPH = window.GPH || {});
