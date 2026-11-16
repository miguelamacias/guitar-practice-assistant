// Reproductor MP3 flotante + modal incrustado de YouTube.
(function (GPH) {
    'use strict';

    // Tracks shorter than two minutes are practice loops: loop is ON by default.
    const SHORT_TRACK_SECONDS = 120;
    let loopOverride = false;

    function getAudioEl() { return document.getElementById('audioPlayer'); }
    function getTitleEl() { return document.getElementById('current-playing'); }

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
        const coverUrl = '/api/cover?path=' + encodeURIComponent(path);
        const probe = new Image();
        probe.onload = function () {
            if (token !== coverToken) return;
            cover.style.backgroundImage = 'url("' + coverUrl + '")';
            panel.classList.add('has-cover');
        };
        probe.onerror = function () { /* no embedded cover: keep the black card */ };
        probe.src = coverUrl;
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
        closeYouTube();

        const player = getAudioEl();
        const titleSpan = getTitleEl();

        loopOverride = false;
        loopBeforeAB = null;
        // Restore this track's saved range (idle: you enable it with the chip).
        trackKey = localMediaPath(url);
        const saved = loadMarks(trackKey);
        markA = saved ? saved.a : null;
        markB = saved ? saved.b : null;
        abEnabled = false;
        stopABLoop();
        player.loop = false;
        player.src = url;
        titleSpan.textContent = title;
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
        setTimeout(updateMarquee, 30);
    }

    function openYouTube(videoId, title, originalUrl) {
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
    }

    function closeYouTube() {
        const modal = document.getElementById('youtubeModal');
        const iframe = document.getElementById('ytIframe');
        if (iframe) iframe.src = '';
        if (modal) modal.classList.remove('is-open');
    }

    function getYouTubeId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    function closeAudio() {
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
        if (player.paused) { player.play(); } else { player.pause(); }
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
        // A-B marks
        const btnA = document.getElementById('apMarkA');
        const btnB = document.getElementById('apMarkB');
        const rangeTag = document.getElementById('apRange');
        if (btnA) btnA.addEventListener('click', function () { setMark('A'); });
        if (btnB) btnB.addEventListener('click', function () { setMark('B'); });
        if (rangeTag) rangeTag.addEventListener('click', toggleAB);
        player.addEventListener('play', function () { playBtn.classList.add('is-playing'); startABLoop(); });
        player.addEventListener('pause', function () { playBtn.classList.remove('is-playing'); stopABLoop(); });
        // B at the very end of the track: the loop jump happens before `ended`.
        player.addEventListener('ended', function () {
            if (!abActive()) return;
            player.currentTime = markA;
            prevHead = markA;
            player.play();
        });
        player.addEventListener('timeupdate', function () {
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
        });
        player.addEventListener('emptied', syncLoopButton);
        seek.addEventListener('input', function () {
            if (!player.duration) return;
            player.currentTime = (seek.value / 1000) * player.duration;
            prevHead = player.currentTime;   // a drag is not playback: no loop jump
        });
        syncLoopButton();
        syncAB();
    }

    document.addEventListener('DOMContentLoaded', initAudioControls);

    GPH.players = { playAudio, openYouTube, closeYouTube, getYouTubeId, closeAudio };
})(window.GPH = window.GPH || {});
