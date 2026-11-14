// Last.fm scrobble detector for the integrated <audio> player.
// It only reports local MP3s served through /api/media; the server validates
// the ID3 tags and the final rules again.
(function (GPH) {
    'use strict';

    const FALLBACK_MIN_DURATION = 120;
    const MAX_THRESHOLD = 240;

    let audio = null;
    let statusEl = null;
    let status = null;
    let current = null;
    let seeking = false;
    let statusTimer = null;

    function fmtTime(sec) {
        const s = Math.max(0, Math.round(sec || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return m + ':' + String(r).padStart(2, '0');
    }

    function pathFromUrl(url) {
        try {
            const u = new URL(url, window.location.href);
            if (u.pathname !== '/api/media' && !u.pathname.endsWith('/api/media')) return '';
            return u.searchParams.get('path') || '';
        } catch (e) {
            return '';
        }
    }

    function newId() {
        try {
            if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        } catch (e) { /* noop */ }
        return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function setIcon(state, text) {
        if (!statusEl) return;
        statusEl.className = 'ap-scrobble is-' + state;
        statusEl.title = text;
        statusEl.setAttribute('aria-label', text);
    }

    function label() {
        if (!current || !current.meta) return '';
        return current.meta.artist + ' \u2013 ' + current.meta.title;
    }

    function refreshStatus() {
        return fetch('/api/lastfm/status', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (s) { status = s || null; return status; })
            .catch(function () { status = null; return null; });
    }

    function minDuration() {
        return (status && status.min_duration) || FALLBACK_MIN_DURATION;
    }

    function stopStatusPoll() {
        if (statusTimer) clearInterval(statusTimer);
        statusTimer = null;
    }

    function startStatusPoll() {
        stopStatusPoll();
        statusTimer = setInterval(function () {
            if (!current) { stopStatusPoll(); return; }
            refreshStatus().then(function () {
                if (current) preflight();
            });
        }, 10000);
    }

    function applyMeta(meta) {
        if (!current) return;
        current.meta = meta;
        if (!meta || !meta.ok) {
            current.eligible = false;
            const missing = (meta && meta.missing) || [];
            setIcon('off', 'Last.fm: not scrobbling \u2014 missing ID3 ' +
                (missing.length ? missing.join(', ') : 'artist/title/album'));
            return;
        }
        current.eligible = true;
        evaluate();
    }

    function preflight() {
        if (!current) return;
        if (!current.path) {
            current.eligible = false;
            setIcon('off', 'Last.fm: not scrobbling \u2014 not a local MP3');
            return;
        }
        if (!status) {
            setIcon('pending', 'Last.fm: checking connection\u2026');
            return;
        }
        if (!status.configured) {
            current.eligible = false;
            setIcon('off', 'Last.fm: not configured (Manager \u2192 Settings)');
            return;
        }
        if (!status.enabled) {
            current.eligible = false;
            setIcon('off', 'Last.fm: scrobbling is disabled');
            return;
        }
        if (!status.authenticated) {
            current.eligible = false;
            setIcon('off', status.auth_pending
                ? 'Last.fm: waiting for authorization'
                : 'Last.fm: not connected');
            return;
        }
        if (!current.duration) {
            setIcon('pending', 'Last.fm: waiting for duration\u2026');
            return;
        }
        if (current.duration < minDuration()) {
            current.eligible = false;
            setIcon('off', 'Last.fm: not scrobbling \u2014 track under ' +
                fmtTime(minDuration()) + ' (practice loop)');
            return;
        }
        if (current.meta) {
            applyMeta(current.meta);
            return;
        }
        setIcon('pending', 'Last.fm: checking ID3 tags\u2026');
        const target = current;
        fetch('/api/lastfm/track-meta?path=' + encodeURIComponent(current.path), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (meta) { if (current === target) applyMeta(meta); })
            .catch(function () {
                if (current === target) {
                    current.eligible = false;
                    setIcon('error', 'Last.fm: could not read track metadata');
                }
            });
    }

    function start(url, title) {
        stop();
        current = {
            url: url,
            title: title || '',
            path: pathFromUrl(url),
            baseId: newId(),
            loopIndex: 0,
            playId: '',
            startedAt: Math.floor(Date.now() / 1000),
            duration: 0,
            played: 0,
            lastTime: 0,
            scrobbled: false,
            sending: false,
            ended: false,
            eligible: false,
            meta: null
        };
        current.playId = current.baseId + ':0';
        seeking = false;
        if (!current.path) {
            setIcon('off', 'Last.fm: not scrobbling \u2014 not a local MP3');
            return;
        }
        setIcon('pending', 'Last.fm: checking connection\u2026');
        refreshStatus().then(function () {
            if (!current) return;
            startStatusPoll();
            preflight();
        });
    }

    function stop() {
        current = null;
        seeking = false;
        stopStatusPoll();
        setIcon('off', 'Last.fm: no local track');
    }

    function evaluate() {
        if (!current) return;
        if (!current.eligible) return;
        if (current.duration < minDuration()) {
            current.eligible = false;
            setIcon('off', 'Last.fm: not scrobbling \u2014 track under ' +
                fmtTime(minDuration()) + ' (practice loop)');
            return;
        }
        if (current.scrobbled) {
            setIcon('on', 'Last.fm: scrobble queued \u2014 ' + label());
            return;
        }
        const threshold = Math.min(current.duration * 0.5, MAX_THRESHOLD);
        if (current.played >= threshold) {
            sendScrobble();
            return;
        }
        setIcon('on', 'Last.fm: active \u2014 "' + label() +
            '" will scrobble after ' + fmtTime(threshold));
    }

    function sendScrobble() {
        if (!current || current.sending || current.scrobbled) return;
        const s = current;
        s.sending = true;
        s.scrobbled = true;
        setIcon('pending', 'Last.fm: sending scrobble\u2026');
        fetch('/api/lastfm/scrobble', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                play_id: s.playId,
                url: s.url,
                duration: s.duration,
                played_seconds: s.played,
                started_at: s.startedAt
            })
        }).then(function (r) { return r.json(); }).then(function (d) {
            s.sending = false;
            if (s !== current) return;
            if (d && (d.queued || d.duplicate)) {
                setIcon('on', 'Last.fm: scrobble queued \u2014 ' + label());
            } else if (d && d.reason === 'missing_tags') {
                s.eligible = false;
                const missing = d.missing || [];
                setIcon('off', 'Last.fm: not scrobbling \u2014 missing ID3 ' +
                    (missing.length ? missing.join(', ') : 'artist/title/album'));
            } else if (d && d.reason === 'duration_lt_min') {
                s.eligible = false;
                setIcon('off', 'Last.fm: not scrobbling \u2014 track under ' +
                    fmtTime(minDuration()));
            } else {
                setIcon('error', 'Last.fm: scrobble not accepted' +
                    (d && d.reason ? ' (' + d.reason + ')' : ''));
            }
        }).catch(function () {
            s.sending = false;
            if (s === current) setIcon('error', 'Last.fm: local server unreachable');
        });
    }

    function startIteration() {
        if (!current) return;
        current.loopIndex += 1;
        current.playId = current.baseId + ':' + current.loopIndex;
        current.startedAt = Math.floor(Date.now() / 1000);
        current.played = 0;
        current.lastTime = 0;
        current.scrobbled = false;
        current.sending = false;
        current.ended = false;
        evaluate();
    }

    function endIteration() {
        if (!current) return;
        evaluate();
        if (!current.scrobbled && current.eligible) {
            // The iteration ended before the threshold; discard it.
            setIcon('off', 'Last.fm: loop restarted before the scrobble threshold');
        }
    }

    function onLoadedMetadata() {
        if (!current) return;
        current.duration = isFinite(audio.duration) ? audio.duration : 0;
        current.lastTime = audio.currentTime || 0;
        preflight();
        evaluate();
    }

    function onPlay() {
        if (!current) return;
        if (current.ended) startIteration();
        if (!current.startedAt) current.startedAt = Math.floor(Date.now() / 1000);
        current.lastTime = audio.currentTime || 0;
        evaluate();
    }

    function onTimeUpdate() {
        if (!current || audio.paused) return;
        const t = audio.currentTime || 0;
        const dur = current.duration || 0;
        if (audio.loop && dur && current.lastTime > dur - 1.5 && t < 1.5 && t < current.lastTime - 1) {
            endIteration();
            startIteration();
            return;
        }
        if (seeking || audio.seeking) {
            current.lastTime = t;
            return;
        }
        if (t < current.lastTime) {
            current.lastTime = t;
            return;
        }
        const delta = t - current.lastTime;
        if (delta > 0) current.played += delta;
        current.lastTime = t;
        evaluate();
    }

    function onSeeking() {
        seeking = true;
        if (current) current.lastTime = audio.currentTime || 0;
    }

    function onSeeked() {
        seeking = false;
        if (current) current.lastTime = audio.currentTime || 0;
    }

    function onEnded() {
        if (!current || audio.loop) return;
        current.ended = true;
        if (!current.eligible) return;
        if (current.scrobbled) {
            setIcon('on', 'Last.fm: scrobble queued \u2014 ' + label());
        } else {
            setIcon('off', 'Last.fm: not scrobbling \u2014 track ended before the threshold');
        }
    }

    function init() {
        audio = document.getElementById('audioPlayer');
        statusEl = document.getElementById('apScrobble');
        if (!audio || !statusEl) return;
        setIcon('off', 'Last.fm: no local track');
        audio.addEventListener('loadedmetadata', onLoadedMetadata);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('seeking', onSeeking);
        audio.addEventListener('seeked', onSeeked);
        audio.addEventListener('ended', onEnded);
        refreshStatus();
    }

    document.addEventListener('DOMContentLoaded', init);

    GPH.scrobbler = {
        start: start,
        stop: stop,
        refreshStatus: refreshStatus
    };
})(window.GPH = window.GPH || {});
