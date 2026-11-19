// Reproductor MP3 flotante + modal incrustado de YouTube.
(function (GPH) {
    'use strict';

    // Tracks shorter than two minutes are practice loops: loop is ON by default.
    const SHORT_TRACK_SECONDS = 120;
    let loopOverride = false;

    // ---- Pitch / speed controls ------------------------------------------
    // Speed is native playbackRate with preservesPitch; pitch goes through the
    // vendored Signalsmith Stretch live-input worklet.
    const PITCH_MIN = -6;
    const PITCH_MAX = 6;
    const SPEED_MIN = 25;
    const SPEED_MAX = 150;
    const SPEED_STEP = 5;
    let pitchSemitones = 0;
    let speedPercent = 100;
    let pitchGraph = null;
    let pitchGraphPromise = null;
    let pitchGraphFailed = false;
    const FX_STORE_PREFIX = 'gph.audioFx:';
    let currentFallbackTitle = '';
    let id3EditorPath = '';
    let id3EditorUrl = '';
    let id3CoverData = null;

    // ---- Practice telemetry (transparent, no UI) ---------------------------
    // One record per playback, sent at the end. `measured=0` means the time is
    // a wall-clock approximation (YouTube: its iframe has no playback API).
    let playContext = { session_id: null, item_position: null, catalog_exercise_id: null };
    let media = null;
    let playWallSince = 0;
    let abLoops = 0;
    let lastMediaTime = 0;
    let mediaSeeked = false;
    let trackTitleToken = 0;

    function setContext(ctx) {
        playContext = {
            session_id: (ctx && ctx.session_id != null) ? ctx.session_id : null,
            item_position: (ctx && ctx.item_position != null) ? ctx.item_position : null,
            catalog_exercise_id: (ctx && ctx.catalog_exercise_id != null)
                ? ctx.catalog_exercise_id : null
        };
    }

    function nowIso() { return new Date().toISOString(); }

    function trackStart(kind, ref, label, measured) {
        finalizeMedia('switch');
        media = {
            play_uid: (GPH.stats && GPH.stats.uid) ? GPH.stats.uid() : ('p' + Date.now()),
            session_id: playContext.session_id,
            item_position: playContext.item_position,
            kind: kind,
            ref: ref || '',
            label: label || '',
            duration_seconds: 0,
            played_seconds: 0,
            loops: 0,
            ab_start: 0,
            ab_end: 0,
            completed: 0,
            measured: measured ? 1 : 0,
            started_at: nowIso()
        };
        playWallSince = 0;
        abLoops = 0;
        lastMediaTime = 0;
        mediaSeeked = false;
        if (GPH.stats && GPH.stats.event) {
            GPH.stats.event('media_start', playContext, {
                value_text: label || '',
                payload: { kind: kind, ref: ref || '' }
            });
        }
    }

    function mediaClock(on) {
        if (!media || !media.measured) return;
        if (on) {
            if (!playWallSince) playWallSince = Date.now();
        } else if (playWallSince) {
            media.played_seconds += Math.max(0, (Date.now() - playWallSince) / 1000);
            playWallSince = 0;
        }
    }

    function finalizeMedia(reason, completed) {
        if (!media) return;
        mediaClock(false);
        const player = getAudioEl();
        if (player && isFinite(player.duration) && player.duration > 0) {
            media.duration_seconds = Math.round(player.duration);
        }
        if (media.kind === 'audio') {
            media.ab_start = markA != null ? markA : 0;
            media.ab_end = markB != null ? markB : 0;
            media.loops = Math.max(media.loops || 0, abLoops);
            if (completed == null) {
                media.completed = !!(player && isFinite(player.duration) && player.duration > 0 &&
                    player.currentTime >= player.duration - 1 && !player.loop && !abActive());
            } else {
                media.completed = completed ? 1 : 0;
            }
        } else {
            // YouTube: wall time while the modal was open, explicitly unmeasured.
            media.played_seconds = Math.max(0,
                Math.round((Date.now() - new Date(media.started_at).getTime()) / 1000));
            media.completed = 0;
        }
        media.ended_at = nowIso();
        media.played_seconds = Math.round(media.played_seconds || 0);
        media.loops = Math.round(media.loops || 0);
        if (GPH.stats && GPH.stats.mediaPlay) GPH.stats.mediaPlay(media);
        if (GPH.stats && GPH.stats.event) {
            GPH.stats.event('media_stop', playContext, {
                value_num: media.played_seconds,
                value_text: reason || '',
                payload: { kind: media.kind }
            });
        }
        media = null;
        playWallSince = 0;
        abLoops = 0;
    }

    function getAudioEl() { return document.getElementById('audioPlayer'); }
    function getTitleEl() { return document.getElementById('current-playing'); }

    function setPlayerTitle(text) {
        const span = getTitleEl();
        if (!span) return;
        span.textContent = text;
        if (typeof updateMarquee === 'function') updateMarquee();
    }

    function titleFromTags(tags, fallback) {
        const title = String((tags && tags.title) || '').trim();
        const artist = String((tags && tags.artist) || '').trim();
        if (title && artist) return title + ' - ' + artist;
        if (title || artist) return title || artist;
        return fallback;
    }

    function loadTrackTags(url, fallback) {
        const token = ++trackTitleToken;
        const path = localMediaPath(url);
        if (!path) return;
        fetch('/api/media/tags?path=' + encodeURIComponent(path), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (tags) {
                if (token !== trackTitleToken || !tags || !tags.ok) return;
                const title = String(tags.title || '').trim();
                const artist = String(tags.artist || '').trim();
                if (!title && !artist) return;
                setPlayerTitle(titleFromTags(tags, fallback));
            })
            .catch(function () { /* no ID3 or no server: keep the element name */ });
    }

    // ---- Album art ---------------------------------------------------------
    // The cover is read from the MP3's ID3 APIC/PIC frame by the local server.
    // Keep a token so a slow image for track A can never paint over track B.
    let coverToken = 0;

    function localMediaPath(url) {
        if (!url) return '';
        try {
            const u = new URL(url, window.location.href);
            if (u.origin !== window.location.origin) return '';
            if (u.pathname !== '/api/media' && !u.pathname.endsWith('/api/media')) return '';
            return u.searchParams.get('path') || '';
        } catch (e) { return ''; }
    }

    function clearCover() {
        coverToken++;
        const panel = document.getElementById('audioPanel');
        const cover = document.getElementById('apCover');
        if (panel) panel.classList.remove('has-cover');
        if (cover) cover.style.backgroundImage = '';
    }

    function applyCover(url) {
        clearCover();
        const path = localMediaPath(url);
        if (!path || !/\.mp3$/i.test(path)) return;
        const panel = document.getElementById('audioPanel');
        const cover = document.getElementById('apCover');
        if (!panel || !cover) return;
        const token = coverToken;
        const coverUrl = '/api/cover?path=' + encodeURIComponent(path) + '&v=' + Date.now();
        const probe = new Image();
        probe.onload = function () {
            if (token !== coverToken) return;
            cover.style.backgroundImage = 'url("' + coverUrl + '")';
            panel.classList.add('has-cover');
        };
        probe.onerror = function () { /* no embedded cover: keep the black card */ };
        probe.src = coverUrl;
    }

    function id3Available() {
        const player = getAudioEl();
        const path = player ? localMediaPath(player.src) : '';
        return !!path && /\.mp3$/i.test(path);
    }

    function syncId3Button() {
        const btn = document.getElementById('apCoverEdit');
        if (!btn) return;
        const ok = id3Available();
        btn.disabled = !ok;
        btn.title = ok ? 'Edit ID3 tags' : 'ID3 editing is available for local MP3 files only';
    }

    function closeId3Editor() {
        const panel = document.getElementById('id3Editor');
        if (panel) panel.hidden = true;
        id3EditorPath = '';
        id3EditorUrl = '';
        id3CoverData = null;
        const file = document.getElementById('id3CoverFile');
        if (file) file.value = '';
        const err = document.getElementById('id3Error');
        if (err) { err.hidden = true; err.textContent = ''; }
    }

    function setId3Error(message) {
        const err = document.getElementById('id3Error');
        if (!err) return;
        err.textContent = message;
        err.hidden = !message;
    }

    function setCoverPreview(dataUrl) {
        const preview = document.getElementById('id3CoverPreview');
        if (!preview) return;
        if (dataUrl) {
            preview.style.backgroundImage = 'url("' + dataUrl + '")';
            preview.textContent = '';
        } else {
            preview.style.backgroundImage = '';
            preview.textContent = 'No cover';
        }
    }

    function openId3Editor() {
        const player = getAudioEl();
        const path = player ? localMediaPath(player.src) : '';
        if (!path || !/\.mp3$/i.test(path)) return;
        id3EditorPath = path;
        id3EditorUrl = player.src;
        id3CoverData = null;
        const panel = document.getElementById('id3Editor');
        const save = document.getElementById('id3Save');
        const title = document.getElementById('id3Title');
        const artist = document.getElementById('id3Artist');
        const album = document.getElementById('id3Album');
        const track = document.getElementById('id3Track');
        const file = document.getElementById('id3CoverFile');
        if (!panel || !save || !title || !artist || !album) return;
        title.value = '';
        artist.value = '';
        album.value = '';
        if (file) file.value = '';
        setId3Error('');
        if (track) {
            track.textContent = path.split(/[\\/]/).pop() || path;
            track.title = path;
        }
        const cover = document.getElementById('apCover');
        const hasCover = cover && getComputedStyle(cover).backgroundImage !== 'none';
        setCoverPreview(hasCover ? getComputedStyle(cover).backgroundImage.slice(5, -2) : '');
        panel.hidden = false;
        save.disabled = true;
        save.textContent = 'Save tags';
        fetch('/api/media/tags?path=' + encodeURIComponent(path), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (tags) {
                if (!tags || !tags.ok) {
                    setId3Error('Could not read ID3 tags for this file.');
                    return;
                }
                title.value = tags.title || '';
                artist.value = tags.artist || '';
                album.value = tags.album || '';
                save.disabled = false;
                title.focus();
            })
            .catch(function () {
                setId3Error('Could not read ID3 tags. Restart the local server and try again.');
            });
    }

    function suspendAudioForId3Write() {
        const player = getAudioEl();
        if (!player) return null;
        const state = {
            url: id3EditorUrl,
            time: player.currentTime || 0,
            paused: player.paused,
            loop: !!player.loop
        };
        player.pause();
        player.removeAttribute('src');
        player.load();
        return state;
    }

    function resumeAudioAfterId3Write(state) {
        const player = getAudioEl();
        if (!player || !state || !state.url) return;
        player.src = state.url;
        applySpeed();
        player.loop = state.loop;
        const restore = function () {
            try {
                player.currentTime = Math.max(0, Math.min(state.time,
                    isFinite(player.duration) ? player.duration : state.time));
            } catch (e) { /* metadata may still be settling */ }
            syncLoopButton();
            syncAB();
            syncEffectControls();
            syncId3Button();
            if (!state.paused) {
                const started = player.play();
                if (started && typeof started.catch === 'function') started.catch(function () {});
            }
        };
        if (player.readyState >= 1) restore();
        else player.addEventListener('loadedmetadata', restore, { once: true });
    }

    function saveId3Editor(event) {
        event.preventDefault();
        if (!id3EditorPath) return;
        const save = document.getElementById('id3Save');
        const title = document.getElementById('id3Title');
        const artist = document.getElementById('id3Artist');
        const album = document.getElementById('id3Album');
        if (!save || !title || !artist || !album) return;
        if (save.disabled) return;
        const path = id3EditorPath;
        const url = id3EditorUrl;
        const payload = {
            path: path,
            title: title.value,
            artist: artist.value,
            album: album.value
        };
        if (id3CoverData) {
            payload.cover_base64 = id3CoverData.dataUrl;
            payload.cover_mime = id3CoverData.mime;
        }
        save.disabled = true;
        save.textContent = 'Saving…';
        setId3Error('');
        // Windows refuses to replace an MP3 while the browser still has the
        // media stream open. Detach it briefly, then restore the same position.
        const suspended = suspendAudioForId3Write();
        setTimeout(function () {
            fetch('/api/media/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (data) {
                    if (!r.ok || !data.ok) throw new Error(data.reason || data.error || 'save_failed');
                    return data;
                });
            }).then(function (data) {
                setPlayerTitle(titleFromTags(data, currentFallbackTitle));
                if (url) applyCover(url);
                resumeAudioAfterId3Write(suspended);
                closeId3Editor();
            }).catch(function (err) {
                resumeAudioAfterId3Write(suspended);
                save.disabled = false;
                save.textContent = 'Save tags';
                setId3Error('Could not save ID3 tags: ' + (err.message || 'unknown error'));
            });
        }, 180);
    }

    function setId3CoverFile(file) {
        if (!file) {
            id3CoverData = null;
            return;
        }
        if (!/^image\/(jpeg|png|webp)$/i.test(file.type || '')) {
            setId3Error('Choose a JPEG, PNG or WebP image.');
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            setId3Error('The cover image must be smaller than 8 MB.');
            return;
        }
        const reader = new FileReader();
        reader.onload = function () {
            id3CoverData = { dataUrl: reader.result, mime: file.type };
            setCoverPreview(reader.result);
            setId3Error('');
        };
        reader.onerror = function () { setId3Error('Could not read the selected image.'); };
        reader.readAsDataURL(file);
    }

    function initId3Editor() {
        const edit = document.getElementById('apCoverEdit');
        const form = document.getElementById('id3Form');
        const save = document.getElementById('id3Save');
        const close = document.getElementById('id3Close');
        const cancel = document.getElementById('id3Cancel');
        const file = document.getElementById('id3CoverFile');
        if (edit) edit.addEventListener('click', openId3Editor);
        if (form) form.addEventListener('submit', saveId3Editor);
        if (save) save.addEventListener('click', saveId3Editor);
        if (close) close.addEventListener('click', closeId3Editor);
        if (cancel) cancel.addEventListener('click', closeId3Editor);
        if (file) file.addEventListener('change', function () {
            setId3CoverFile(file.files && file.files[0]);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeId3Editor();
        });
        syncId3Button();
    }

    function syncLoopButton() {
        const player = getAudioEl();
        const btn = document.getElementById('apLoop');
        if (!player || !btn) return;
        const on = !!player.loop;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.disabled = !player.getAttribute('src');
        btn.title = 'Loop: ' + (on ? 'on' : 'off');
    }

    function syncEffectControls() {
        const player = getAudioEl();
        const hasTrack = !!(player && player.getAttribute('src'));
        const pitchReady = hasTrack && !pitchGraphFailed &&
            typeof window.SignalsmithStretch === 'function';
        const ids = ['apPitchDown', 'apPitchUp', 'apSpeedDown', 'apSpeedUp'];
        ids.forEach(function (id) {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.disabled = !hasTrack || (id.indexOf('apPitch') === 0 && !pitchReady);
        });
        const pv = document.getElementById('apPitchVal');
        if (pv) pv.textContent = (pitchSemitones > 0 ? '+' : '') + pitchSemitones + ' st';
        const sv = document.getElementById('apSpeedVal');
        if (sv) sv.textContent = Math.round(speedPercent) + '%';
        const pd = document.getElementById('apPitchDown');
        const pu = document.getElementById('apPitchUp');
        const sd = document.getElementById('apSpeedDown');
        const su = document.getElementById('apSpeedUp');
        if (pd) pd.title = 'Pitch down one semitone (' + PITCH_MIN + ' to ' + PITCH_MAX + ' st)';
        if (pu) pu.title = 'Pitch up one semitone (' + PITCH_MIN + ' to ' + PITCH_MAX + ' st)';
        if (sd) sd.title = 'Slow down 5 percent (min ' + SPEED_MIN + '%)';
        if (su) su.title = 'Speed up 5 percent (max ' + SPEED_MAX + '%)';
    }

    function applySpeed() {
        const player = getAudioEl();
        if (!player) return;
        player.playbackRate = speedPercent / 100;
        // The pitch must stay put while the tempo changes.
        try { player.preservesPitch = true; } catch (e) { /* old browser */ }
        try { player.webkitPreservesPitch = true; } catch (e) { /* old WebKit */ }
    }

    function changeSpeed(delta) {
        const player = getAudioEl();
        if (!player || !player.getAttribute('src')) return;
        const next = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speedPercent + delta));
        if (next === speedPercent) return;
        speedPercent = next;
        applySpeed();
        syncEffectControls();
        saveAudioFx();
    }

    function applyPitch(value) {
        if (!pitchGraph) return;
        const now = pitchGraph.ctx.currentTime;
        const target = Math.max(PITCH_MIN, Math.min(PITCH_MAX, value));
        pitchGraph.stretch.schedule({ semitones: target });
        const dryTarget = target === 0 ? 1 : 0;
        const wetTarget = target === 0 ? 0 : 1;
        [ [pitchGraph.dry, dryTarget], [pitchGraph.wet, wetTarget] ].forEach(function (pair) {
            const gain = pair[0];
            const to = pair[1];
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(to, now + 0.06);
        });
    }

    function ensurePitchGraph() {
        if (pitchGraph) return Promise.resolve(pitchGraph);
        if (pitchGraphPromise) return pitchGraphPromise;
        if (pitchGraphFailed) return Promise.reject(new Error('pitch_unavailable'));
        const player = getAudioEl();
        if (!player || !GPH.audio || typeof GPH.audio.getCtx !== 'function' ||
            typeof window.SignalsmithStretch !== 'function') {
            pitchGraphFailed = true;
            syncEffectControls();
            return Promise.reject(new Error('pitch_unavailable'));
        }
        pitchGraphPromise = (async function () {
            const ctx = GPH.audio.getCtx();
            if (ctx.state === 'suspended') await ctx.resume();
            // Keep the dry path alive while the worklet loads: if anything fails,
            // the native player must never become silent.
            const source = ctx.createMediaElementSource(player);
            const dry = ctx.createGain();
            const wet = ctx.createGain();
            dry.gain.value = 1;
            wet.gain.value = 0;
            source.connect(dry);
            dry.connect(ctx.destination);
            const stretch = await window.SignalsmithStretch(ctx);
            source.connect(stretch);
            stretch.connect(wet);
            wet.connect(ctx.destination);
            pitchGraph = { ctx: ctx, source: source, dry: dry, wet: wet, stretch: stretch };
            stretch.schedule({ semitones: pitchSemitones });
            await stretch.start();
            applyPitch(pitchSemitones);
            return pitchGraph;
        })().catch(function (err) {
            pitchGraphFailed = true;
            syncEffectControls();
            if (window.console && console.warn) console.warn('Pitch shift unavailable:', err);
            throw err;
        });
        return pitchGraphPromise;
    }

    function changePitch(delta) {
        const player = getAudioEl();
        if (!player || !player.getAttribute('src') || pitchGraphFailed) return;
        const next = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitchSemitones + delta));
        if (next === pitchSemitones) return;
        pitchSemitones = next;
        syncEffectControls();
        saveAudioFx();
        if (pitchSemitones === 0 && !pitchGraph) return;
        ensurePitchGraph().then(function () {
            if (pitchGraph) applyPitch(pitchSemitones);
        }).catch(function () { /* buttons are disabled in syncEffectControls */ });
    }

    function resetAudioEffects() {
        pitchSemitones = 0;
        speedPercent = 100;
        const player = getAudioEl();
        if (player) {
            player.playbackRate = 1;
            try { player.preservesPitch = true; } catch (e) { /* noop */ }
        }
        if (pitchGraph) applyPitch(0);
        syncEffectControls();
    }

    function loadAudioFx(path) {
        if (!path) return { pitch: 0, speed: 100 };
        try {
            const raw = localStorage.getItem(FX_STORE_PREFIX + path);
            if (!raw) return { pitch: 0, speed: 100 };
            const o = JSON.parse(raw);
            let pitch = Number(o && o.pitch);
            let speed = Number(o && o.speed);
            if (!isFinite(pitch)) pitch = 0;
            if (!isFinite(speed)) speed = 100;
            pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.round(pitch)));
            speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX,
                Math.round(speed / SPEED_STEP) * SPEED_STEP));
            return { pitch: pitch, speed: speed };
        } catch (e) {
            return { pitch: 0, speed: 100 };
        }
    }

    function saveAudioFx() {
        if (!trackKey) return;
        try {
            if (pitchSemitones === 0 && speedPercent === 100) {
                localStorage.removeItem(FX_STORE_PREFIX + trackKey);
            } else {
                localStorage.setItem(FX_STORE_PREFIX + trackKey, JSON.stringify({
                    pitch: pitchSemitones,
                    speed: speedPercent
                }));
            }
        } catch (e) { /* storage blocked/full: playback still works */ }
    }

    function restoreAudioFx() {
        applySpeed();
        syncEffectControls();
        if (pitchSemitones !== 0 && !pitchGraphFailed) {
            ensurePitchGraph().then(function () {
                if (pitchGraph) applyPitch(pitchSemitones);
            }).catch(function () { /* controls are disabled */ });
        }
    }

    // ---- A-B practice loop -------------------------------------------------
    // The marks belong to the track and are kept in localStorage, so coming back
    // to a resource restores them - disabled, you decide when to loop. The jump
    // back to A only fires when playback reaches B from below with a small step,
    // so dragging the seek bar never yanks the playhead back.
    const AB_MIN_SPAN = 1;       // s: shorter selections are rejected
    const AB_NATURAL_DELTA = 2;  // s: a bigger jump means a scrub, not playback
    const AB_STORE_PREFIX = 'gph.abMarks:';
    let markA = null;
    let markB = null;
    let abEnabled = false;       // marks stored != loop running
    let trackKey = '';           // media path of the loaded track (storage key)
    let loopBeforeAB = null;     // player.loop value to restore when A-B stops
    let prevHead = 0;            // last observed playhead
    let abRaf = 0;

    function abHasMarks() { return markA != null && markB != null; }
    function abActive() { return abEnabled && abHasMarks(); }

    function loadMarks(path) {
        if (!path) return null;
        try {
            const raw = localStorage.getItem(AB_STORE_PREFIX + path);
            if (!raw) return null;
            const o = JSON.parse(raw);
            if (!o || typeof o.a !== 'number' || typeof o.b !== 'number') return null;
            if (!(o.b - o.a >= AB_MIN_SPAN)) return null;
            return o;
        } catch (e) { return null; }
    }

    function saveMarks() {
        if (!trackKey) return;
        try {
            if (!abHasMarks()) {
                localStorage.removeItem(AB_STORE_PREFIX + trackKey);
            } else {
                localStorage.setItem(AB_STORE_PREFIX + trackKey,
                    JSON.stringify({ a: markA, b: markB }));
            }
        } catch (e) { /* storage blocked or full: the loop still works in memory */ }
    }

    function stopABLoop() {
        if (abRaf) { cancelAnimationFrame(abRaf); abRaf = 0; }
    }

    function startABLoop() {
        const player = getAudioEl();
        if (abRaf || !player || player.paused || !abActive()) return;
        // Resuming exactly at (or a hair past) B must count as a crossing, but a
        // scrub far outside the range must not (the delta guard rejects it).
        prevHead = Math.min(player.currentTime, markB - 0.01);
        abRaf = requestAnimationFrame(abTick);
    }

    // Single check, called by the rAF loop (frame accuracy while the tab is
    // visible) and by `timeupdate` (backstop when rAF stops in a hidden tab).
    function abCheck() {
        const player = getAudioEl();
        if (!player || !abActive()) return;
        const now = player.currentTime;
        if (now >= markB && prevHead < markB && (now - prevHead) <= AB_NATURAL_DELTA) {
            player.currentTime = markA;
            prevHead = markA;
            abLoops++;
            if (media) media.loops = (media.loops || 0) + 1;
        } else {
            prevHead = now;
        }
    }

    function abTick() {
        const player = getAudioEl();
        if (!player || player.paused || !abActive()) { abRaf = 0; return; }
        abCheck();
        abRaf = requestAnimationFrame(abTick);
    }

    // A/B ticks drawn over the seek bar (visual only).
    function paintMark(el, seconds) {
        if (!el) return;
        const player = getAudioEl();
        const dur = player && isFinite(player.duration) ? player.duration : 0;
        if (seconds == null || !dur) { el.hidden = true; return; }
        el.hidden = false;
        el.style.setProperty('--p', String(Math.max(0, Math.min(1, seconds / dur))));
    }

    function syncAB() {
        const player = getAudioEl();
        const btnA = document.getElementById('apMarkA');
        const btnB = document.getElementById('apMarkB');
        const tag = document.getElementById('apRange');
        const loopBtn = document.getElementById('apLoop');
        const active = abActive();
        const hasTrack = !!(player && player.getAttribute('src'));

        if (btnA) {
            btnA.classList.toggle('is-set', markA != null);
            btnA.setAttribute('aria-pressed', markA != null ? 'true' : 'false');
            btnA.disabled = !hasTrack;
            btnA.title = markA != null ? 'A at ' + fmtTime(markA) + ' (click to clear)' : 'Set loop start (A)';
        }
        if (btnB) {
            btnB.classList.toggle('is-set', markB != null);
            btnB.setAttribute('aria-pressed', markB != null ? 'true' : 'false');
            btnB.disabled = !hasTrack;
            btnB.title = markB != null ? 'B at ' + fmtTime(markB) + ' (click to clear)' : 'Set loop end (B)';
        }
        if (tag) {
            // The tag keeps its slot in the row even when there is no range yet:
            // appearing must not push the other controls around.
            if (abHasMarks()) {
                tag.classList.remove('is-off');
                tag.disabled = false;
                tag.removeAttribute('aria-hidden');
                tag.textContent = fmtTime(markA) + ' \u2013 ' + fmtTime(markB);
                tag.classList.toggle('is-on', abEnabled);
                tag.setAttribute('aria-pressed', abEnabled ? 'true' : 'false');
                tag.title = abEnabled ? 'A-B loop: on (click to disable)'
                                      : 'A-B loop: off (click to enable)';
            } else {
                tag.classList.add('is-off');
                tag.disabled = true;
                tag.setAttribute('aria-hidden', 'true');
                tag.classList.remove('is-on');
                tag.setAttribute('aria-pressed', 'false');
            }
        }
        paintMark(document.getElementById('apMarkAView'), markA);
        paintMark(document.getElementById('apMarkBView'), markB);
        if (player) {
            if (active) {
                if (loopBeforeAB == null) loopBeforeAB = player.loop;
                player.loop = false;
            } else if (loopBeforeAB != null) {
                player.loop = loopBeforeAB;
                loopBeforeAB = null;
            }
        }
        syncLoopButton();
        if (loopBtn && active) {
            loopBtn.disabled = true;
            loopBtn.title = 'Loop: unavailable while A-B is active';
        }
        if (active && player && !player.paused) startABLoop(); else stopABLoop();
    }

    function setMark(which) {
        const player = getAudioEl();
        if (!player || !player.getAttribute('src')) return;
        const t = player.currentTime;
        if (which === 'A') {
            if (markA != null) {
                markA = null;
                markB = null;             // B alone would be meaningless
            } else {
                markA = t;
                if (markB != null && markB - markA < AB_MIN_SPAN) markB = null;
            }
        } else if (markB != null) {
            markB = null;
        } else {
            const start = markA == null ? 0 : markA;  // "loop from the start"
            if (t - start < AB_MIN_SPAN) return;      // reject, nothing changes
            markA = start;
            markB = t;
        }
        abEnabled = abHasMarks();   // a freshly completed range starts looping
        saveMarks();
        syncAB();
        if (abHasMarks() && GPH.stats && GPH.stats.event) {
            GPH.stats.event('ab_loop_set', playContext, {
                value_num: Math.round((markB - markA) * 10) / 10,
                payload: { a: markA, b: markB }
            });
        }
        // Setting B at the playhead should start looping right away: pretend the
        // playhead is a hair before B so the next frame counts as a crossing.
        if (which === 'B' && markB != null) prevHead = markB - 0.01;
    }

    // The chip toggles the stored range on/off; removing it is the A/B job.
    function toggleAB() {
        if (!abHasMarks()) return;
        abEnabled = !abEnabled;
        syncAB();
    }

    // Forget the UI state without touching storage (track change / close).
    function resetABState() {
        markA = null;
        markB = null;
        abEnabled = false;
        loopBeforeAB = null;
        stopABLoop();
        syncAB();
    }

    function playAudio(url, title) {
        finalizeMedia('switch');
        closeYouTube();
        closeId3Editor();

        const player = getAudioEl();
        resetAudioEffects();

        loopOverride = false;
        loopBeforeAB = null;
        // Restore this track's saved range (idle: you enable it with the chip).
        // Local files use the inner path (stable, short); web audio uses its URL
        // so every track has a key for A-B marks and playback stats.
        trackKey = localMediaPath(url) || String(url || '');
        const savedFx = loadAudioFx(trackKey);
        pitchSemitones = savedFx.pitch;
        speedPercent = savedFx.speed;
        const saved = loadMarks(trackKey);
        markA = saved ? saved.a : null;
        markB = saved ? saved.b : null;
        abEnabled = false;
        stopABLoop();
        player.loop = false;
        player.src = url;
        applySpeed();
        currentFallbackTitle = title || '';
        setPlayerTitle(currentFallbackTitle);
        loadTrackTags(url, currentFallbackTitle);
        trackStart('audio', trackKey, title, true);
        syncId3Button();
        applyCover(url);
        const panel = document.getElementById('audioPanel');
        if (panel) panel.classList.add('is-open');
        // The bar is fixed at the bottom: the page, the clock and the video
        // panel make room for it while a track is loaded.
        document.body.classList.add('has-player');
        if (GPH.scrobbler && GPH.scrobbler.start) GPH.scrobbler.start(url, title);
        player.play();
        syncLoopButton();
        syncAB();      // A/B buttons enable once the track is loaded
        restoreAudioFx();
        setTimeout(updateMarquee, 30);
    }

    function openYouTube(videoId, title, originalUrl) {
        finalizeMedia('switch');
        trackTitleToken++;
        closeId3Editor();
        const audioPlayer = getAudioEl();
        if (audioPlayer) audioPlayer.pause();
        clearCover();
        const apanel = document.getElementById('audioPanel');
        if (apanel) apanel.classList.remove('is-open');
        document.body.classList.remove('has-player');

        const modal = document.getElementById('youtubeModal');
        const iframe = document.getElementById('ytIframe');
        const titleSpan = document.getElementById('ytModalTitle');
        const externalLink = document.getElementById('ytExternalLink');

        externalLink.href = originalUrl || ('https://www.youtube.com/watch?v=' + videoId);
        iframe.src = 'https://www.youtube.com/embed/' + videoId + '?autoplay=1';
        titleSpan.textContent = title;
        modal.classList.add('is-open');
        trackStart('youtube', videoId, title, false);
    }

    function closeYouTube() {
        if (media && media.kind === 'youtube') finalizeMedia('close');
        const modal = document.getElementById('youtubeModal');
        const iframe = document.getElementById('ytIframe');
        // An empty `src` resolves to the current page and can reload the app
        // inside the iframe; removing it unloads the video for real.
        if (iframe) iframe.removeAttribute('src');
        if (modal) modal.classList.remove('is-open');
    }

    function getYouTubeId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    function closeAudio() {
        finalizeMedia('close');
        trackTitleToken++;
        closeId3Editor();
        currentFallbackTitle = '';
        resetAudioEffects();
        const player = getAudioEl();
        if (player) {
            player.pause();
            player.removeAttribute('src');
            player.load();
            player.loop = false;
        }
        loopOverride = false;
        resetABState();
        trackKey = '';
        clearCover();
        syncLoopButton();
        if (GPH.scrobbler && GPH.scrobbler.stop) GPH.scrobbler.stop();
        const titleSpan = getTitleEl();
        if (titleSpan) { titleSpan.textContent = 'No audio selected'; titleSpan.classList.remove('scrolling'); titleSpan.style.removeProperty('--shift'); }
        const panel = document.getElementById('audioPanel');
        if (panel) panel.classList.remove('is-open');
        document.body.classList.remove('has-player');
        const seek = document.getElementById('apSeek'); if (seek) seek.value = 0;
        const time = document.getElementById('apTime'); if (time) time.textContent = '0:00';
        const cur = document.getElementById('apCurrent'); if (cur) cur.textContent = '0:00';
        const pb = document.getElementById('apPlay'); if (pb) pb.classList.remove('is-playing');
        syncEffectControls();
        syncId3Button();
    }

    // ---- Keyboard seek ------------------------------------------------------
    // Left / Right behave like a desktop player (10 s). Ignored while typing,
    // Keys: ← → seek 10 s and Space plays/pauses, the way you would expect from
    // a player. Ignored with modifiers, from a text field, while a control has
    // focus (Space would press it), with the Manager overlay or the YouTube
    // modal open, and when no track is loaded or the bar is closed.
    const SEEK_STEP = 10;

    function seekBy(delta) {
        const player = getAudioEl();
        if (!player || !player.getAttribute('src')) return false;
        if (!isFinite(player.duration) || player.duration <= 0) return false;
        player.currentTime = Math.min(player.duration, Math.max(0, player.currentTime + delta));
        return true;
    }

    function togglePlayback() {
        const player = getAudioEl();
        if (!player || !player.getAttribute('src')) return false;
        // Space after a finished track must start it again from 0, even when
        // the UI/countdown has already been reset and the element is paused.
        if (player.ended || (isFinite(player.duration) && player.duration > 0 &&
            player.currentTime >= player.duration - 0.01)) {
            player.currentTime = 0;
            const started = player.play();
            if (started && typeof started.catch === 'function') started.catch(function () {});
            return true;
        }
        if (player.paused) {
            const started = player.play();
            if (started && typeof started.catch === 'function') started.catch(function () {});
        } else {
            player.pause();
        }
        return true;
    }

    document.addEventListener('keydown', function (e) {
        const isSeek = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        const isPlay = e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space';
        if (!isSeek && !isPlay) return;
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                  t.tagName === 'SELECT' || t.isContentEditable)) return;
        // Space also activates whatever has focus: never steal it from a control.
        if (isPlay && t && (t.tagName === 'BUTTON' || t.tagName === 'A' ||
                            t.getAttribute('role') === 'button')) return;
        const ov = document.getElementById('managerOverlay');
        if (ov && ov.classList.contains('is-open')) return;
        const yt = document.getElementById('youtubeModal');
        if (yt && yt.classList.contains('is-open')) return;
        const panel = document.getElementById('audioPanel');
        if (!panel || !panel.classList.contains('is-open')) return;
        if (isSeek) {
            if (seekBy(e.key === 'ArrowRight' ? SEEK_STEP : -SEEK_STEP)) e.preventDefault();
            return;
        }
        if (togglePlayback()) e.preventDefault();      // no page scroll on Space
    });

    function fmtTime(s) {
        if (!isFinite(s) || s < 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + String(sec).padStart(2, '0');
    }

    function updateMarquee() {
        const wrap = document.querySelector('.audio-title-wrap');
        const text = getTitleEl();
        if (!wrap || !text) return;
        text.classList.remove('scrolling');
        text.style.removeProperty('--shift');
        text.style.removeProperty('--dur');
        const cw = wrap.clientWidth;
        const tw = text.scrollWidth;
        if (cw > 0 && tw > cw + 2) {
            const dist = tw - cw;
            text.style.setProperty('--shift', '-' + dist + 'px');
            text.style.setProperty('--dur', Math.max(6, dist / 30 + 4) + 's');
            text.classList.add('scrolling');
        }
    }

    function initAudioControls() {
        const player = getAudioEl();
        const playBtn = document.getElementById('apPlay');
        const seek = document.getElementById('apSeek');
        const time = document.getElementById('apTime');
        const current = document.getElementById('apCurrent');
        if (!player || !playBtn || !seek) return;
        playBtn.addEventListener('click', function () {
            if (player.paused) { player.play(); } else { player.pause(); }
        });
        const loopBtn = document.getElementById('apLoop');
        if (loopBtn) {
            loopBtn.addEventListener('click', function () {
                if (!player.getAttribute('src')) return;
                player.loop = !player.loop;
                loopOverride = true;
                syncLoopButton();
            });
        }
        // Pitch / speed steppers
        const pitchDown = document.getElementById('apPitchDown');
        const pitchUp = document.getElementById('apPitchUp');
        const speedDown = document.getElementById('apSpeedDown');
        const speedUp = document.getElementById('apSpeedUp');
        if (pitchDown) pitchDown.addEventListener('click', function () { changePitch(-1); });
        if (pitchUp) pitchUp.addEventListener('click', function () { changePitch(1); });
        if (speedDown) speedDown.addEventListener('click', function () { changeSpeed(-SPEED_STEP); });
        if (speedUp) speedUp.addEventListener('click', function () { changeSpeed(SPEED_STEP); });
        const pitchVal = document.getElementById('apPitchVal');
        const speedVal = document.getElementById('apSpeedVal');
        if (pitchVal) {
            pitchVal.addEventListener('dblclick', function () {
                if (pitchSemitones !== 0) changePitch(-pitchSemitones);
            });
        }
        if (speedVal) {
            speedVal.addEventListener('dblclick', function () {
                if (speedPercent !== 100) changeSpeed(100 - speedPercent);
            });
        }
        try { player.preservesPitch = true; } catch (e) { /* old browser */ }
        // A-B marks
        const btnA = document.getElementById('apMarkA');
        const btnB = document.getElementById('apMarkB');
        const rangeTag = document.getElementById('apRange');
        if (btnA) btnA.addEventListener('click', function () { setMark('A'); });
        if (btnB) btnB.addEventListener('click', function () { setMark('B'); });
        if (rangeTag) rangeTag.addEventListener('click', toggleAB);
        player.addEventListener('play', function () {
            playBtn.classList.add('is-playing');
            mediaClock(true);
            startABLoop();
        });
        player.addEventListener('pause', function () {
            playBtn.classList.remove('is-playing');
            mediaClock(false);
            stopABLoop();
        });
        // B at the very end of the track: the loop jump happens before `ended`.
        player.addEventListener('ended', function () {
            if (abActive()) {
                player.currentTime = markA;
                prevHead = markA;
                player.play();
                return;
            }
            if (player.loop) return;
            finalizeMedia('ended', true);
        });
        player.addEventListener('seeking', function () { mediaSeeked = true; });
        player.addEventListener('timeupdate', function () {
            const t = player.currentTime || 0;
            // A native loop restarts the playhead; a manual seek also does it,
            // so `seeking` masks the next one. A-B wraps have their own counter.
            if (media && media.kind === 'audio' && !mediaSeeked && player.loop &&
                !abActive() && t + 1 < lastMediaTime) {
                media.loops = (media.loops || 0) + 1;
            }
            mediaSeeked = false;
            lastMediaTime = t;
            if (player.duration) {
                seek.value = Math.floor((player.currentTime / player.duration) * 1000);
                if (current) current.textContent = fmtTime(player.currentTime);
                time.textContent = fmtTime(player.duration);
            }
            abCheck();   // backstop for rAF when the tab is hidden
        });
        player.addEventListener('loadedmetadata', function () {
            seek.value = 0;
            if (current) current.textContent = '0:00';
            time.textContent = fmtTime(player.duration);
            if (!loopOverride && isFinite(player.duration) && player.duration > 0) {
                player.loop = player.duration < SHORT_TRACK_SECONDS;
            }
            // A stored range must fit the real duration of this file.
            if (abHasMarks() && isFinite(player.duration) && player.duration > 0) {
                if (markB > player.duration) markB = player.duration;
                if (markB - markA < AB_MIN_SPAN) { markA = null; markB = null; abEnabled = false; }
            }
            syncLoopButton();
            syncAB();   // ticks need the real duration to place themselves
            syncEffectControls();
        });
        player.addEventListener('emptied', syncLoopButton);
        player.addEventListener('emptied', syncEffectControls);
        seek.addEventListener('input', function () {
            if (!player.duration) return;
            player.currentTime = (seek.value / 1000) * player.duration;
            prevHead = player.currentTime;   // a drag is not playback: no loop jump
        });
        syncLoopButton();
        syncAB();
        syncEffectControls();
        syncId3Button();
        initId3Editor();
    }

    document.addEventListener('DOMContentLoaded', initAudioControls);
    // A tab closed while a track is playing still leaves its record.
    window.addEventListener('pagehide', function () { finalizeMedia('pagehide'); });

    GPH.players = { playAudio, openYouTube, closeYouTube, getYouTubeId, closeAudio, setContext };
})(window.GPH = window.GPH || {});
