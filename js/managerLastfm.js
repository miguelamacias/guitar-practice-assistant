// Manager → Settings → Last.fm card: credentials, auth and queue status.
(function (GPH) {
    'use strict';

    let pollTimer = null;
    let authUrl = '';

    function $(id) { return document.getElementById(id); }
    function setStatus(text, cls) {
        const el = $('lastfmStatus');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'api-key-status' + (cls ? ' ' + cls : '');
    }
    function api(path, opts) {
        return fetch(path, opts || {}).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
                if (!r.ok) throw new Error(d.detail || d.error || ('HTTP ' + r.status));
                return d;
            });
        });
    }

    function queueText(q) {
        if (!q) return '';
        const parts = [];
        if (q.pending) parts.push(q.pending + ' pending');
        if (q.needs_auth) parts.push(q.needs_auth + ' need reconnect');
        if (q.failed) parts.push(q.failed + ' failed');
        return parts.join(' · ');
    }

    function renderStatus(s) {
        if (!s) { setStatus('Could not read Last.fm status', 'err'); return; }
        const key = $('lastfmApiKey');
        const secret = $('lastfmApiSecret');
        const enabled = $('lastfmEnabled');
        const connect = $('lastfmConnectBtn');
        const disconnect = $('lastfmDisconnectBtn');
        if (key) key.value = s.api_key || '';
        if (secret) {
            secret.value = '';
            secret.placeholder = s.api_secret_set
                ? 'Configured — leave blank to keep'
                : 'Last.fm API secret';
        }
        if (enabled) enabled.checked = !!s.enabled;
        if (connect) connect.disabled = !s.configured;
        if (disconnect) disconnect.disabled = !s.authenticated;
        let text = s.configured
            ? (s.authenticated ? 'Connected as ' + (s.username || 'Last.fm user') : 'Configured, not connected')
            : 'Not configured. Add the API key and secret.';
        const q = queueText(s.queue);
        if (q) text += ' · Queue: ' + q;
        if (s.last_error) text += ' · ' + s.last_error;
        setStatus(text, s.authenticated ? 'ok' : (s.configured ? '' : 'err'));
    }

    function loadStatus() {
        return api('/api/lastfm/status').then(renderStatus).catch(function (e) {
            setStatus('Error: ' + e.message, 'err');
        });
    }

    function saveConfig() {
        const key = ($('lastfmApiKey') || {}).value || '';
        const secret = ($('lastfmApiSecret') || {}).value || '';
        const enabled = !!($('lastfmEnabled') && $('lastfmEnabled').checked);
        setStatus('Saving…');
        return api('/api/lastfm/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: key.trim(), api_secret: secret.trim(), enabled: enabled })
        }).then(function (s) {
            renderStatus(s);
            setStatus(s.configured
                ? (s.authenticated ? 'Saved. Connected as ' + (s.username || 'Last.fm user') : 'Saved. Now connect Last.fm.')
                : 'Saved. API key and secret are required.', s.configured ? 'ok' : 'err');
            return s;
        }).catch(function (e) {
            setStatus('Error saving: ' + e.message, 'err');
            throw e;
        });
    }

    function stopPolling() {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
    }

    function pollAuth(attempt) {
        if (attempt > 100) {
            stopPolling();
            setStatus('Authorization timed out. Press Connect Last.fm again.', 'err');
            return;
        }
        api('/api/lastfm/auth/status').then(function (s) {
            if (s.auth_state === 'connected') {
                stopPolling();
                renderStatus(s);
                setStatus('Connected as ' + (s.username || 'Last.fm user'), 'ok');
                return;
            }
            if (s.auth_state === 'expired') {
                stopPolling();
                setStatus('Authorization expired. Press Connect Last.fm again.', 'err');
                return;
            }
            if (s.auth_state === 'error') {
                stopPolling();
                setStatus(s.detail || 'Last.fm authorization failed', 'err');
                return;
            }
            setStatus('Waiting for authorization…');
            pollTimer = setTimeout(function () { pollAuth(attempt + 1); }, 3000);
        }).catch(function (e) {
            stopPolling();
            setStatus('Could not check authorization: ' + e.message, 'err');
        });
    }

    function connect() {
        saveConfig().then(function () {
            return api('/api/lastfm/auth/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
            });
        }).then(function (r) {
            authUrl = r.auth_url || '';
            if (!authUrl) throw new Error('No authorization URL');
            const w = window.open(authUrl, '_blank', 'noopener');
            if (!w) {
                const el = $('lastfmStatus');
                if (el) {
                    el.textContent = 'Open this URL to authorize: ';
                    const a = document.createElement('a');
                    a.href = authUrl; a.target = '_blank'; a.rel = 'noopener';
                    a.textContent = authUrl;
                    el.appendChild(a);
                }
            } else {
                setStatus('Waiting for authorization…');
            }
            stopPolling();
            pollAuth(0);
        }).catch(function (e) {
            setStatus('Could not start Last.fm authorization: ' + e.message, 'err');
        });
    }

    function disconnect() {
        stopPolling();
        api('/api/lastfm/disconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        }).then(function (s) {
            renderStatus(s);
            setStatus('Disconnected from Last.fm');
        }).catch(function (e) {
            setStatus('Error: ' + e.message, 'err');
        });
    }

    function init() {
        if (!$('lastfmApiKey')) return;
        const show = $('lastfmSecretShow');
        if (show) show.addEventListener('click', function () {
            const i = $('lastfmApiSecret');
            if (!i) return;
            i.type = i.type === 'password' ? 'text' : 'password';
            show.textContent = i.type === 'password' ? 'Show' : 'Hide';
        });
        const save = $('lastfmSaveBtn');
        if (save) save.addEventListener('click', function () { saveConfig().catch(function () {}); });
        const connectBtn = $('lastfmConnectBtn');
        if (connectBtn) connectBtn.addEventListener('click', connect);
        const disconnectBtn = $('lastfmDisconnectBtn');
        if (disconnectBtn) disconnectBtn.addEventListener('click', disconnect);
        const enabled = $('lastfmEnabled');
        if (enabled) enabled.addEventListener('change', function () { saveConfig().catch(function () {}); });
        loadStatus();
    }

    document.addEventListener('DOMContentLoaded', init);
})(window.GPH = window.GPH || {});
