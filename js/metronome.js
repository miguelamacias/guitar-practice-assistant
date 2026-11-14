// Metronome (Web Audio API): BPM, time signature, click patterns (quarters /
// 8ths / 16ths / triplets / shuffle), optional accent on beat 1, beat indicator,
// tap tempo and keys.
(function (GPH) {
    'use strict';

    const SIGS = { '2/4': 2, '3/4': 3, '4/4': 4, '6/8': 6 };
    const LS_BPM = 'gph_metro_bpm';
    const LS_SIG = 'gph_metro_sig';
    const LS_SUB = 'gph_metro_subdiv';
    const LS_ACCENT = 'gph_metro_accent';

    let isMetroRunning = false;
    let bpm = 120;
    let metroSig = '4/4';
    let metroSubdiv = 1;      // steps per beat: 1 beats, 2 eighths, 3 triplets, 4 sixteenths
    let metroShuffle = false; // shuffle: two clicks per beat, the second one late (2:1 swing)
    let metroAccent = true;   // different (higher) click on beat 1; off = all pulses equal
    let metroStep = 0;        // position inside the bar, in steps
    let nextNoteTime = 0.0;
    let timerID = null;

    (function loadState() {
        try { const b = parseInt(localStorage.getItem(LS_BPM), 10); if (b >= 40 && b <= 240) bpm = b; } catch (e) {}
        try { const s = localStorage.getItem(LS_SIG); if (s && SIGS[s]) metroSig = s; } catch (e) {}
        try {
            const raw = localStorage.getItem(LS_SUB);
            if (raw === 'flat') {
                // Legacy flat pattern: one pulse per beat, no accent.
                metroAccent = false;
                metroSubdiv = 1;
            } else if (raw === 'shuffle') {
                metroShuffle = true;
                metroSubdiv = 2;
            } else {
                const d = parseInt(raw, 10);
                if ([1, 2, 3, 4].indexOf(d) >= 0) metroSubdiv = d;
            }
        } catch (e) {}
        try {
            const acc = localStorage.getItem(LS_ACCENT);
            if (acc === '0') metroAccent = false;
            else if (acc === '1') metroAccent = true;
        } catch (e) {}
    })();

    function stepsPerBar() { return SIGS[metroSig] * metroSubdiv; }

    // x/4: a beat is a quarter note. 6/8 counts eighths, the same clock the drum
    // machine uses, so both widgets can play together at the same BPM.
    function beatSeconds() { return (metroSig === '6/8' ? 30 : 60) / bpm; }

    // Pattern id as stored with an exercise and in localStorage.
    function activePattern() {
        return metroShuffle ? 'shuffle' : String(metroSubdiv);
    }

    // Shuffle is a pair of uneven clicks inside each beat: the first one lasts
    // 2/3 of the beat and the second one 1/3 (the classic swing feel). Every
    // other pattern splits the beat evenly.
    function stepDuration(step) {
        const beat = beatSeconds();
        if (metroShuffle) return beat * (step % 2 === 0 ? 2 / 3 : 1 / 3);
        return beat / metroSubdiv;
    }

    // 'accent' on the first beat (and on the second group of a 6/8), 'beat' on
    // the rest of the pulses, 'sub' on any subdivision. With the accent toggle
    // off every pulse uses the same 'beat' click.
    function stepKind(step) {
        if (step % metroSubdiv !== 0) return 'sub';
        if (!metroAccent) return 'beat';
        const beat = step / metroSubdiv;
        if (beat === 0) return 'accent';
        if (metroSig === '6/8' && beat === 3) return 'accent';
        return 'beat';
    }

    function renderBeats() {
        const box = document.getElementById('metroBeats');
        if (!box) return;
        box.innerHTML = '';
        const beats = SIGS[metroSig];
        for (let i = 0; i < beats; i++) {
            const dot = document.createElement('span');
            dot.className = 'metro-beat-dot' + (metroAccent && i === 0 ? ' is-first' : '');
            box.appendChild(dot);
        }
    }

    function highlightBeat(index) {
        const dots = document.querySelectorAll('#metroBeats .metro-beat-dot');
        dots.forEach(function (dot, i) { dot.classList.toggle('is-on', i === index); });
    }
    function clearBeats() { highlightBeat(-1); }

    function syncControls() {
        const sig = document.getElementById('metroSig');
        if (sig && sig.value !== metroSig) sig.value = metroSig;
        const pattern = activePattern();
        document.querySelectorAll('#metroPattern [data-pattern]').forEach(function (btn) {
            const on = btn.dataset.pattern === pattern;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        const accBtn = document.getElementById('metroAccentBtn');
        if (accBtn) {
            accBtn.classList.toggle('is-active', metroAccent);
            accBtn.setAttribute('aria-pressed', metroAccent ? 'true' : 'false');
            accBtn.title = 'Accent on beat 1: ' + (metroAccent ? 'on' : 'off');
        }
    }

    function updateBpm(val) {
        bpm = parseInt(val, 10);
        const v = document.getElementById('bpmVal');
        if (v) v.textContent = bpm;
        const s = document.getElementById('bpmSlider');
        if (s) s.value = bpm;
        try { localStorage.setItem(LS_BPM, String(bpm)); } catch (e) {}
    }

    function adjustBpm(delta) {
        const newBpm = bpm + delta;
        if (newBpm >= 40 && newBpm <= 240) updateBpm(newBpm);
    }

    function setSig(sig) {
        if (!SIGS[sig]) return;
        metroSig = sig;
        metroStep = 0;
        renderBeats();
        syncControls();
        try { localStorage.setItem(LS_SIG, metroSig); } catch (e) {}
    }

    function setSubdiv(value) {
        // Pattern ids used by the buttons and by saved exercises:
        // '1' | '2' | '3' | '4' | 'shuffle'. Legacy 'flat' values fall back to '1'.
        let pattern;
        if (value === 'shuffle') pattern = 'shuffle';
        else {
            const n = parseInt(value, 10);
            pattern = String([1, 2, 3, 4].indexOf(n) >= 0 ? n : 1);
        }
        if (pattern === activePattern()) { syncControls(); return; }
        metroShuffle = pattern === 'shuffle';
        metroSubdiv = metroShuffle ? 2 : parseInt(pattern, 10);
        metroStep = 0;
        renderBeats();
        syncControls();
        try { localStorage.setItem(LS_SUB, pattern); } catch (e) {}
    }

    // Accent on beat 1 on/off. It only changes the click on the pulse, never the
    // pattern or the timing, so it can be toggled while the metronome is running.
    function setAccent(on) {
        const next = !!on;
        if (next === metroAccent) { syncControls(); return; }
        metroAccent = next;
        const first = document.querySelector('#metroBeats .metro-beat-dot');
        if (first) first.classList.toggle('is-first', metroAccent);
        syncControls();
        try { localStorage.setItem(LS_ACCENT, metroAccent ? '1' : '0'); } catch (e) {}
    }

    function toggleAccent() {
        setAccent(!metroAccent);
    }

    function scheduler() {
        const ctx = GPH.audio.getCtx();
        while (nextNoteTime < ctx.currentTime + 0.1) {
            const kind = stepKind(metroStep);
            const when = nextNoteTime;
            const beatIndex = Math.round(metroStep / metroSubdiv);
            GPH.audio.playMetronomeClick(when, kind);
            if (kind !== 'sub') {
                setTimeout(function () {
                    highlightBeat(beatIndex);
                }, Math.max(0, (when - ctx.currentTime) * 1000));
            }
            const wait = stepDuration(metroStep);
            metroStep = (metroStep + 1) % stepsPerBar();
            nextNoteTime += wait;
        }
        timerID = setTimeout(scheduler, 25);
    }

    function toggleMetronome() {
        GPH.audio.ensureAudio();
        const btn = document.getElementById('metroPlayBtn');
        isMetroRunning = !isMetroRunning;

        if (isMetroRunning) {
            renderBeats();
            syncControls();
            nextNoteTime = GPH.audio.getCtx().currentTime;
            metroStep = 0;
            scheduler();
            btn.innerHTML = GPH.icons.get('stop') + ' Stop';
            btn.classList.add('playing');
        } else {
            clearTimeout(timerID);
            btn.innerHTML = GPH.icons.get('play') + ' Play';
            btn.classList.remove('playing');
            clearBeats();
        }
    }

    function handleMetroKeyboard(event) {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            adjustBpm(-1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            adjustBpm(1);
        } else if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') {
            if (event.target.closest && event.target.closest('button, input, select, textarea')) return;
            event.preventDefault();
            event.stopPropagation();
            tap();
        }
    }

    let metroTapTimes = [];
    function tap() {
        const now = (window.performance && performance.now) ? performance.now() : Date.now();
        if (metroTapTimes.length && (now - metroTapTimes[metroTapTimes.length - 1]) > 2000) metroTapTimes = [];
        metroTapTimes.push(now);
        if (metroTapTimes.length > 8) metroTapTimes.shift();
        const fromTap = GPH.util.tapBpm(metroTapTimes);
        if (fromTap) updateBpm(fromTap);
    }

    function init() {
        renderBeats();
        syncControls();
    }

    function getBpm() { return bpm; }

    // Current settings, as stored with an exercise's metronome resource.
    function getConfig() {
        return { sig: metroSig, pattern: activePattern(), accent: metroAccent };
    }

    // Per-exercise settings: applied when an exercise is opened. setSig /
    // setSubdiv / setAccent already persist them to localStorage, so the widget follows.
    function applyConfig(cfg) {
        if (!cfg || typeof cfg !== 'object') return;
        if (cfg.sig && SIGS[cfg.sig]) setSig(cfg.sig);
        if (cfg.pattern === 'flat') {
            // Legacy pattern: quarter pulse with the accent removed.
            setSubdiv('1');
            setAccent(false);
        } else if (cfg.pattern !== undefined && cfg.pattern !== null && cfg.pattern !== '') {
            setSubdiv(cfg.pattern);
        }
        if (cfg.accent === false) setAccent(false);
        else if (cfg.accent === true) setAccent(true);
    }

    GPH.metronome = {
        init,
        updateBpm,
        adjustBpm,
        toggleMetronome,
        handleMetroKeyboard,
        tap,
        getBpm,
        setSig,
        setSubdiv,
        setAccent,
        toggleAccent,
        getConfig,
        applyConfig,
        stepKind,
        stepsPerBar
    };
})(window.GPH = window.GPH || {});
