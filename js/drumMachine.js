// Drum Machine: interactive grid, 4/4-6/8 time signatures, 8th/16th resolution,
// style presets, swing and drum synthesis.
(function (GPH) {
    'use strict';

    const drumInstruments = [
        { id: 'kick', name: 'Kick' },
        { id: 'snare', name: 'Snare' },
        { id: 'hihat', name: 'Hi-Hat' },
        { id: 'ride', name: 'Ride' },
        { id: 'tom', name: 'Tom' },
        { id: 'splash', name: 'Splash' }
    ];

    let currentSig = '4/4';
    let currentRes = 8;              // 8 = eighths per bar, 16 = sixteenths
    let currentStyle = 'custom';
    let swingPending = null;        // swing saved in the state, applied once the DOM exists

    // Factory patterns, on the base grid of each signature (8 / 6 steps).
    const drumPatterns = {
        '4/4': {
            kick:  [1, 0, 0, 0,  1, 1, 0, 0],
            snare: [0, 0, 1, 0,  0, 0, 1, 0],
            hihat: [1, 1, 1, 1,  1, 1, 1, 1],
            ride:  [0, 0, 0, 0,  0, 0, 0, 0],
            tom:   [0, 0, 0, 0,  0, 0, 0, 0],
            splash:[1, 0, 0, 0,  0, 0, 0, 0]
        },
        '6/8': {
            kick:  [1, 0, 0,  0, 0, 0],
            snare: [0, 0, 0,  1, 0, 0],
            hihat: [1, 1, 1,  1, 1, 1],
            ride:  [0, 0, 0,  0, 0, 0],
            tom:   [0, 0, 0,  0, 0, 0],
            splash:[0, 0, 0,  0, 0, 0]
        }
    };

    // ---- Style presets ------------------------------------------------------
    // Each pattern is a string of 16 (4/4) or 12 (6/8) characters, one per
    // sixteenth ("1" = hit). One definition feeds both resolutions: in 8th mode
    // the pairs are collapsed, so the 8th grid and the 16th grid stay in sync.
    // Every preset belongs to ONE signature (`sig`): the 4/4 list and the 6/8
    // list are different families, they are never mixed.
    //
    //   4/4 :  1 e & a | 2 e & a | 3 e & a | 4 e & a
    //   6/8 :  1 e 2 e 3 e 4 e 5 e 6 e
    const DRUM_STYLES = {
        rock: {
            name: 'Rock', sig: '4/4', swing: false,
            '4/4': {
                kick:  '1.......1.......',
                snare: '....1.......1...',
                hihat: '1.1.1.1.1.1.1.1.',
                splash:'1...............'
            }
        },
        rockdrive: {
            name: 'Rock drive', sig: '4/4', swing: false,
            '4/4': {
                kick:  '1.......1.1.....',
                snare: '....1.......1...',
                hihat: '1.1.1.1.1.1.1.1.',
                splash:'1...............'
            }
        },
        pop: {
            name: 'Pop', sig: '4/4', swing: false,
            '4/4': {
                kick:  '1.......1.....1.',
                snare: '....1.......1...',
                hihat: '1.1.1.1.1.1.1.1.',
                splash:'1...............'
            }
        },
        funk: {
            name: 'Funk', sig: '4/4', swing: false,
            '4/4': {
                kick:  '1.......1..1..1.',
                snare: '....1.......1...',
                hihat: '1111111111111111',
                splash:'1...............'
            }
        },
        disco: {
            name: 'Disco', sig: '4/4', swing: false,
            '4/4': {
                kick:  '1...1...1...1...',
                snare: '....1.......1...',
                hihat: '1111111111111111',
                splash:'1...............'
            }
        },
        reggae: {
            name: 'Reggae (one drop)', sig: '4/4', swing: false,
            '4/4': {
                kick:  '........1.......',
                snare: '........1.......',
                hihat: '..1...1...1...1.',
                splash:'........1.......'
            }
        },
        halftime: {
            name: 'Half-time', sig: '4/4', swing: false,
            '4/4': {
                kick:  '1...............',
                snare: '........1.......',
                hihat: '1.1.1.1.1.1.1.1.',
                splash:'1...............'
            }
        },
        metal: {
            name: 'Metal', sig: '4/4', swing: false,
            '4/4': {
                kick:  '1111....1111....',
                snare: '....1.......1...',
                hihat: '1.1.1.1.1.1.1.1.',
                splash:'1...............'
            }
        },
        blues: {
            name: 'Blues shuffle', sig: '4/4', swing: true,
            '4/4': {
                kick:  '1.......1.......',
                snare: '....1.......1...',
                ride:  '1.1.1.1.1.1.1.1.'
            }
        },
        ballad: {
            name: 'Ballad', sig: '4/4', swing: false,
            '4/4': {
                kick:  '1.........1.....',
                snare: '....1.......1...',
                ride:  '1.1.1.1.1.1.1.1.',
                tom:   '..............1.',
                splash:'1...............'
            }
        },

        // --- 6/8 only (own family: nothing borrowed from the 4/4 list) --------
        ballad68: {
            name: 'Ballad 6/8', sig: '6/8', swing: false,
            '6/8': {
                kick:  '1.....1.....',
                snare: '......1.....',
                hihat: '1.1.1.1.1.1.',
                splash:'1...........'
            }
        },
        waltz: {
            name: 'Waltz', sig: '6/8', swing: false,
            '6/8': {
                kick:  '1...........',
                snare: '....1...1...',
                ride:  '....1...1...',
                splash:'1...........'
            }
        },
        slowblues68: {
            name: 'Slow blues 6/8', sig: '6/8', swing: true,
            '6/8': {
                kick:  '1.....1.....',
                snare: '......1.....',
                ride:  '1.1.1.1.1.1.',
                tom:   '..........1.'
            }
        },
        rock68: {
            name: 'Rock 6/8', sig: '6/8', swing: false,
            '6/8': {
                kick:  '1.....1.1...',
                snare: '......1.....',
                hihat: '1.1.1.1.1.1.',
                splash:'1...........'
            }
        },
        jig: {
            name: 'Jig', sig: '6/8', swing: false,
            '6/8': {
                kick:  '1.....1.....',
                snare: '..1.....1...',
                hihat: '1.1.1.1.1.1.',
                splash:'1...........'
            }
        }
    };

    let drumPattern = JSON.parse(JSON.stringify(drumPatterns['4/4']));
    let isDrumRunning = false;
    let drumBpm = 120;
    let currentDrumStep = 0;
    let nextDrumTime = 0.0;
    let drumTimerID = null;
    let isSwingActive = false;
    let swingAmount = 0;

    // --- Grid geometry -------------------------------------------------------
    function eighthsPerBar() { return currentSig === '4/4' ? 8 : 6; }
    function stepsPerEighth() { return currentRes === 16 ? 2 : 1; }
    function totalSteps() { return eighthsPerBar() * stepsPerEighth(); }
    function baseSteps(sig) { return sig === '4/4' ? 8 : 6; }

    function toArray(str, n) {
        const out = new Array(n).fill(0);
        for (let i = 0; i < Math.min(n, (str || '').length); i++) out[i] = str[i] === '1' ? 1 : 0;
        return out;
    }
    // 16 -> 8 (or 12 -> 6): a pair becomes a hit if either half had one.
    function collapse(arr) {
        const out = [];
        for (let i = 0; i < arr.length; i += 2) out.push((arr[i] || arr[i + 1]) ? 1 : 0);
        return out;
    }
    // 8 -> 16 (or 6 -> 12): keep the hit on the first half of each pair.
    function expand(arr) {
        const out = [];
        arr.forEach(function (v) { out.push(v ? 1 : 0, 0); });
        return out;
    }
    function convertPattern(p, fromSteps) {
        const to = totalSteps();
        if (fromSteps === to) return JSON.parse(JSON.stringify(p));
        const conv = to > fromSteps ? expand : collapse;
        const out = {};
        drumInstruments.forEach(function (inst) {
            out[inst.id] = conv((p && p[inst.id]) || []);
        });
        return out;
    }
    function defaultPattern(sig) {
        const base = JSON.parse(JSON.stringify(drumPatterns[sig]));
        return convertPattern(base, baseSteps(sig));
    }
    // Pattern of a preset, on the grid being used right now.
    function stylePattern(id) {
        const style = DRUM_STYLES[id];
        if (!style || !style[currentSig]) return null;
        const raw = style[currentSig];
        const base = baseSteps(currentSig) * 2;
        const out = {};
        drumInstruments.forEach(function (inst) {
            let arr = toArray(raw[inst.id], base);
            if (totalSteps() < base) arr = collapse(arr);
            out[inst.id] = arr;
        });
        return out;
    }

    // --- Persistencia (BPM, compas, rejilla, estilo y patron) ----------------
    const LS_BPM = 'gph_drum_bpm';
    const LS_STATE = 'gph_drum_state';
    (function loadDrumState() {
        try { const b = parseInt(localStorage.getItem(LS_BPM), 10); if (b >= 40 && b <= 240) drumBpm = b; } catch (e) {}
        try {
            const st = JSON.parse(localStorage.getItem(LS_STATE) || 'null');
            if (!st || !drumPatterns[st.sig]) return;
            currentSig = st.sig;
            currentRes = st.res === 16 ? 16 : 8;
            let steps = totalSteps();
            const first = st.pattern && st.pattern.kick;
            if (!Array.isArray(first) || first.length !== steps) {   // older state
                currentRes = 8;
                steps = totalSteps();
            }
            if (st.pattern) {
                const out = {};
                drumInstruments.forEach(function (inst) {
                    const arr = st.pattern[inst.id];
                    out[inst.id] = (Array.isArray(arr) && arr.length === steps)
                        ? arr.map(function (v) { return v ? 1 : 0; })
                        : new Array(steps).fill(0);                  // new instrument
                });
                drumPattern = out;
            }
            if (st.style === 'custom' || DRUM_STYLES[st.style]) currentStyle = st.style;
            if (typeof st.swing === 'boolean') swingPending = st.swing;
        } catch (e) {}
    })();
    function saveDrumState() {
        try {
            localStorage.setItem(LS_STATE, JSON.stringify({
                sig: currentSig, res: currentRes, style: currentStyle,
                swing: isSwingActive, pattern: drumPattern
            }));
        } catch (e) {}
    }

    // --- Style / resolution controls ----------------------------------------
    function styleSelect() { return document.getElementById('drumStyleSel'); }

    // Which presets belong to the current signature: 4/4 and 6/8 have their own
    // families (a 6/8 waltz makes sense, a 6/8 disco does not).
    function styleList(sig) {
        return Object.keys(DRUM_STYLES).filter(function (id) {
            return DRUM_STYLES[id].sig === sig;
        });
    }

    function fillStyleOptions() {
        const sel = styleSelect();
        if (!sel) return;
        const keep = sel.value;
        sel.innerHTML = '';
        const custom = document.createElement('option');
        custom.value = 'custom';
        custom.textContent = 'Custom';
        sel.appendChild(custom);
        styleList(currentSig).forEach(function (id) {
            const o = document.createElement('option');
            o.value = id;
            o.textContent = DRUM_STYLES[id].name;
            sel.appendChild(o);
        });
        if (keep && sel.querySelector('option[value="' + keep + '"]')) sel.value = keep;
    }

    function syncControls() {
        const sel = styleSelect();
        // A preset that does not exist in this signature falls back to Custom
        if (sel && !sel.querySelector('option[value="' + currentStyle + '"]')) {
            currentStyle = 'custom';
        }
        if (sel && sel.value !== currentStyle) sel.value = currentStyle;
        const btn = document.getElementById('drumResBtn');
        if (btn) {
            btn.textContent = currentRes === 16 ? '16ths' : '8ths';
            btn.classList.toggle('is-on', currentRes === 16);
        }
    }

    function setSwing(on) {
        isSwingActive = !!on;
        swingAmount = isSwingActive ? 0.33 : 0;          // classic triplet feel
        const btn = document.getElementById('swingToggleBtn');
        if (!btn) return;
        btn.textContent = isSwingActive ? 'ON' : 'OFF';
        btn.classList.toggle('is-on', isSwingActive);
    }

    // Any manual edit stops being "the preset".
    function markCustom() {
        if (currentStyle === 'custom') return;
        currentStyle = 'custom';
        syncControls();
    }

    function initDrumMachineGrid() {
        const container = document.getElementById('drumGridContainer');
        if (!container) return;

        const sigBtn = document.getElementById('timeSigBtn');
        if (sigBtn) sigBtn.textContent = 'Time Signature: ' + currentSig;
        fillStyleOptions();
        if (swingPending !== null) {         // restore the saved swing once the button exists
            setSwing(swingPending);
            swingPending = null;
        }
        syncControls();

        container.innerHTML = '';
        const steps = totalSteps();
        const perBeat = steps / (currentSig === '4/4' ? 4 : 6);
        container.classList.toggle('is-dense', steps >= 12);

        // Beats header adapted to signature and resolution
        const headRow = document.createElement('div');
        headRow.className = 'drum-row drum-beat-row';

        const headLabel = document.createElement('div');
        headLabel.className = 'drum-label drum-beat-head';
        headLabel.textContent = 'Beat';
        headRow.appendChild(headLabel);

        const headSteps = document.createElement('div');
        headSteps.className = 'drum-steps';
        for (let step = 0; step < steps; step++) {
            const cell = document.createElement('div');
            if (step % perBeat === 0) {
                cell.className = 'drum-beat';
                cell.textContent = String((step / perBeat) + 1);
            } else {
                cell.className = 'drum-beat-sub';
                cell.textContent = '·';
            }
            headSteps.appendChild(cell);
        }
        headRow.appendChild(headSteps);
        container.appendChild(headRow);

        // Instrument rows
        drumInstruments.forEach(inst => {
            const row = document.createElement('div');
            row.className = 'drum-row';

            const label = document.createElement('div');
            label.className = 'drum-label';
            label.textContent = inst.name;
            label.dataset.inst = inst.id;
            label.title = 'Click to preview';
            row.appendChild(label);

            const stepsWrap = document.createElement('div');
            stepsWrap.className = 'drum-steps';
            for (let step = 0; step < steps; step++) {
                const btn = document.createElement('button');
                btn.className = 'drum-step-btn drum-col-' + step;
                if (drumPattern[inst.id][step] === 1) btn.classList.add('active');
                btn.dataset.inst = inst.id;
                btn.dataset.step = String(step);
                stepsWrap.appendChild(btn);
            }
            row.appendChild(stepsWrap);
            container.appendChild(row);
        });
    }

    function toggleDrumStep(instId, step, btnElement) {
        drumPattern[instId][step] = drumPattern[instId][step] === 1 ? 0 : 1;
        btnElement.classList.toggle('active');
        markCustom();               // a manual edit is no longer the preset...
        saveDrumState();            // ...and it is written to storage right away
    }

    // Event delegation for the grid steps
    function onGridClick(event) {
        const label = event.target.closest('.drum-label[data-inst]');
        if (label) {
            GPH.audio.playSynthDrum(label.dataset.inst, GPH.audio.getCtx().currentTime);
            return;
        }
        const btn = event.target.closest('.drum-step-btn');
        if (!btn || !btn.dataset.inst) return;
        toggleDrumStep(btn.dataset.inst, parseInt(btn.dataset.step, 10), btn);
    }

    function updateDrumBpm(val) {
        let v = parseInt(val, 10);
        if (isNaN(v)) v = drumBpm;
        v = Math.max(40, Math.min(240, v));
        drumBpm = v;
        document.getElementById('drumBpmVal').textContent = drumBpm;
        document.getElementById('drumBpmSlider').value = drumBpm;
        try { localStorage.setItem(LS_BPM, String(drumBpm)); } catch (e) {}
    }

    function adjustDrumBpm(delta) {
        const newBpm = drumBpm + delta;
        if (newBpm >= 40 && newBpm <= 240) updateDrumBpm(newBpm);
    }

    function handleDrumKeyboard(event) {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            adjustDrumBpm(-1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            adjustDrumBpm(1);
        } else if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') {
            if (event.target.closest && event.target.closest('button, input, select, textarea')) return;
            event.preventDefault();
            event.stopPropagation();
            tap();
        }
    }

    let drumTapTimes = [];
    function tap() {
        const now = (window.performance && performance.now) ? performance.now() : Date.now();
        if (drumTapTimes.length && (now - drumTapTimes[drumTapTimes.length - 1]) > 2000) drumTapTimes = [];
        drumTapTimes.push(now);
        if (drumTapTimes.length > 8) drumTapTimes.shift();
        const fromTap = GPH.util.tapBpm(drumTapTimes);
        if (fromTap) updateDrumBpm(fromTap);
    }
    function getBpm() { return drumBpm; }

    // Reset: back to the selected preset (or to the factory pattern when custom)
    function resetDrumPattern() {
        const p = currentStyle === 'custom' ? null : stylePattern(currentStyle);
        drumPattern = p || defaultPattern(currentSig);
        if (p && typeof DRUM_STYLES[currentStyle].swing === 'boolean') {
            setSwing(DRUM_STYLES[currentStyle].swing);
        }
        currentDrumStep = 0;
        saveDrumState();
        initDrumMachineGrid();
    }

    function clearDrumPattern() {
        const steps = totalSteps();
        drumInstruments.forEach(inst => {
            drumPattern[inst.id] = new Array(steps).fill(0);
        });
        markCustom();
        saveDrumState();
        initDrumMachineGrid();
    }

    function toggleDrumMachine() {
        GPH.audio.ensureAudio();
        const btn = document.getElementById('drumPlayBtn');
        isDrumRunning = !isDrumRunning;

        if (isDrumRunning) {
            nextDrumTime = GPH.audio.getCtx().currentTime;
            currentDrumStep = 0;
            drumScheduler();
            btn.innerHTML = GPH.icons.get('stop') + ' Stop';
            btn.classList.add('playing');
        } else {
            clearTimeout(drumTimerID);
            btn.innerHTML = GPH.icons.get('play') + ' Play';
            btn.classList.remove('playing');
            clearDrumStepHighlights();
        }
    }

    function drumScheduler() {
        const ctx = GPH.audio.getCtx();
        const steps = totalSteps();
        const perEighth = stepsPerEighth();
        const stepTime = (30.0 / drumBpm) / perEighth;      // seconds per grid step
        while (nextDrumTime < ctx.currentTime + 0.1) {
            triggerDrumStep(currentDrumStep, nextDrumTime);

            let stepInterval = stepTime;
            // Swing delays the second eighth of every pair, whatever the grid is
            if (swingAmount > 0) {
                const offbeat = (Math.floor(currentDrumStep / perEighth) % 2) === 1;
                stepInterval = stepTime * (offbeat ? (1 - swingAmount) : (1 + swingAmount));
            }

            currentDrumStep = (currentDrumStep + 1) % steps;
            nextDrumTime += stepInterval;
        }
        drumTimerID = setTimeout(drumScheduler, 25);
    }

    function triggerDrumStep(step, time) {
        const ctx = GPH.audio.getCtx();
        setTimeout(() => {
            highlightDrumColumn(step);
        }, Math.max(0, (time - ctx.currentTime) * 1000));

        const vel = stepVelocity(step);
        drumInstruments.forEach(inst => {
            if (drumPattern[inst.id][step] === 1) {
                GPH.audio.playSynthDrum(inst.id, time, vel);
            }
        });
    }

    // Downbeats louder than the rest: the grid already knows where the beat
    // starts, so no velocity lane is needed. 6/8 counts as two groups of three.
    function stepVelocity(step) {
        const steps = totalSteps();
        const beats = currentSig === '4/4' ? 4 : 2;
        const perBeat = steps / beats;
        return (step % perBeat) === 0 ? 1 : 0.75;
    }

    function highlightDrumColumn(step) {
        clearDrumStepHighlights();
        const colButtons = document.querySelectorAll('.drum-col-' + step);
        colButtons.forEach(btn => btn.classList.add('playing-step'));
    }

    function clearDrumStepHighlights() {
        const allBtns = document.querySelectorAll('.drum-step-btn');
        allBtns.forEach(btn => btn.classList.remove('playing-step'));
    }

    function toggleTimeSignature() {
        currentSig = currentSig === '4/4' ? '6/8' : '4/4';
        const p = currentStyle === 'custom' ? null : stylePattern(currentStyle);
        if (p) {
            drumPattern = p;
            if (typeof DRUM_STYLES[currentStyle].swing === 'boolean') {
                setSwing(DRUM_STYLES[currentStyle].swing);
            }
        } else {
            drumPattern = defaultPattern(currentSig);
            markCustom();
        }
        currentDrumStep = 0;
        saveDrumState();
        initDrumMachineGrid();
    }

    function toggleSwing() { setSwing(!isSwingActive); saveDrumState(); }

    // 8th <-> 16th grid. The pattern is converted, never lost: pairs collapse
    // to eighths and are spread back to sixteenths.
    function setResolution(res) {
        res = res === 16 ? 16 : 8;
        if (res === currentRes) return;
        const from = totalSteps();
        currentRes = res;
        const styleP = currentStyle === 'custom' ? null : stylePattern(currentStyle);
        drumPattern = styleP || convertPattern(drumPattern, from);
        currentDrumStep = 0;
        saveDrumState();
        initDrumMachineGrid();
    }
    function toggleResolution() { setResolution(currentRes === 16 ? 8 : 16); }

    // A preset is played on the 16th grid only if it actually uses 16th
    // positions (odd indices); otherwise eighths are enough. This is what makes
    // the grid follow the genre on its own.
    function styleUsesSixteenths(id) {
        const style = DRUM_STYLES[id];
        if (!style || !style[currentSig]) return false;
        const pad = style[currentSig];
        return Object.keys(pad).some(function (key) {
            const str = pad[key];
            if (typeof str !== 'string') return false;
            for (let i = 1; i < str.length; i += 2) {
                if (str[i] === '1') return true;
            }
            return false;
        });
    }

    function setDrumStyle(id) {
        if (!DRUM_STYLES[id] || DRUM_STYLES[id].sig !== currentSig) {   // "custom" or not for this signature
            currentStyle = 'custom';
            syncControls();
            saveDrumState();
            return;
        }
        // The preset picks the grid: 16ths if it needs them, eighths if not
        currentRes = styleUsesSixteenths(id) ? 16 : 8;
        const p = stylePattern(id);
        if (!p) return;                              // no variant for this signature
        drumPattern = p;
        currentStyle = id;
        if (typeof DRUM_STYLES[id].swing === 'boolean') setSwing(DRUM_STYLES[id].swing);
        currentDrumStep = 0;
        saveDrumState();
        initDrumMachineGrid();
    }

    function getConfig() {
        return { sig: currentSig, style: currentStyle, res: currentRes, swing: isSwingActive };
    }

    function setDrumSig(sig) {
        if ((sig !== '4/4' && sig !== '6/8') || sig === currentSig) return;
        toggleTimeSignature();
    }

    // Per-exercise settings of a drums resource, applied when the exercise opens.
    // Order matters: signature first (a preset is bound to one), then the preset
    // (which may bring its own grid and swing), then the saved grid and swing.
    function applyConfig(cfg) {
        if (!cfg || typeof cfg !== 'object') return;
        if (cfg.sig === '4/4' || cfg.sig === '6/8') setDrumSig(cfg.sig);
        if (typeof cfg.style === 'string' && cfg.style !== currentStyle &&
            (cfg.style === 'custom' || DRUM_STYLES[cfg.style])) {
            setDrumStyle(cfg.style);
        }
        if (cfg.res === 8 || cfg.res === 16) setResolution(cfg.res);
        if (typeof cfg.swing === 'boolean' && cfg.swing !== isSwingActive) {
            setSwing(cfg.swing);
            saveDrumState();
        }
    }

    GPH.drumMachine = {
        init: initDrumMachineGrid,
        initDrumMachineGrid,
        onGridClick,
        updateDrumBpm,
        adjustDrumBpm,
        toggleDrumMachine,
        toggleTimeSignature,
        toggleSwing,
        getConfig,
        applyConfig,
        resetDrumPattern,
        clearDrumPattern,
        handleDrumKeyboard,
        tap,
        getBpm,
        setStyle: setDrumStyle,
        setResolution,
        toggleResolution,
        stepVelocity,
        styles: DRUM_STYLES
    };
})(window.GPH = window.GPH || {});
