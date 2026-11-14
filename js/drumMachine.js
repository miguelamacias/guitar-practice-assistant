// Drum Machine: interactive grid, 4/4, 3/4 and 6/8 signatures, 8th/16th
// resolution, style presets, swing and drum synthesis.
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
    const SIGNATURES = ['4/4', '3/4', '6/8'];

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
        },
        '3/4': {
            kick:  [1, 0, 0,  0, 1, 0],
            snare: [0, 0, 1,  0, 0, 0],
            hihat: [1, 1, 1,  1, 1, 1],
            ride:  [0, 0, 0,  0, 0, 0],
            tom:   [0, 0, 0,  0, 0, 0],
            splash:[1, 0, 0,  0, 0, 0]
        }
    };

    // ---- Style presets ------------------------------------------------------
    // Each pattern is a string of 16 (4/4), 12 (3/4 or 6/8) characters, one per
    // sixteenth ("1" = hit). One definition feeds both resolutions: in 8th mode
    // the pairs are collapsed, so the 8th grid and the 16th grid stay in sync.
    // Every preset belongs to ONE signature (`sig`); the selector shows all of
    // them and selecting one loads its signature automatically.
    //
    //   4/4 :  1 e & a | 2 e & a | 3 e & a | 4 e & a
    //   3/4 :  1 e & a | 2 e & a | 3 e & a
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

        // --- 3/4 family ---------------------------------------------------------
        waltz: {
            name: 'Waltz', sig: '3/4', swing: false,
            '3/4': {
                kick:  '1...........',
                snare: '....1...1...',
                ride:  '1.1.1.1.1.1.',
                splash:'1...........'
            }
        },
        sevillana: {
            name: 'Sevillana', sig: '3/4', swing: false,
            '3/4': {
                kick:  '1.......1...',
                snare: '....1...1...',
                hihat: '1.1.1.1.1.1.',
                ride:  '..1...1...1.',
                splash:'1...........'
            }
        },
        jazzwaltz: {
            name: 'Jazz waltz', sig: '3/4', swing: true,
            '3/4': {
                kick:  '1...........',
                snare: '....1...1...',
                ride:  '1.....1...1.',
                hihat: '....1...1...',
                splash:'1...........'
            }
        },
        countrywaltz: {
            name: 'Country waltz', sig: '3/4', swing: false,
            '3/4': {
                kick:  '1...........',
                snare: '....1...1...',
                hihat: '1.1.1.1.1.1.',
                splash:'1...........'
            }
        },
        mazurka: {
            name: 'Mazurka', sig: '3/4', swing: false,
            '3/4': {
                kick:  '1...........',
                snare: '....1...1...',
                hihat: '1.1.1.1.1.1.',
                splash:'....1.......'
            }
        },
        valscriollo: {
            name: 'Vals criollo', sig: '3/4', swing: false,
            '3/4': {
                kick:  '1...........',
                snare: '....1...1...',
                tom:   '..1...1...1.',
                ride:  '1.1.1.1.1.1.',
                splash:'1...........'
            }
        },
        fandango: {
            name: 'Fandango', sig: '3/4', swing: false,
            '3/4': {
                kick:  '1.....1.....',
                snare: '....1...1...',
                hihat: '1.1.1.1.1.1.',
                ride:  '..1...1...1.',
                splash:'1...........'
            }
        },

        // --- 6/8 family ---------------------------------------------------------
        ballad68: {
            name: 'Ballad', sig: '6/8', swing: false,
            '6/8': {
                kick:  '1.....1.....',
                snare: '......1.....',
                hihat: '1.1.1.1.1.1.',
                splash:'1...........'
            }
        },
        slowblues68: {
            name: 'Slow blues', sig: '6/8', swing: true,
            '6/8': {
                kick:  '1.....1.....',
                snare: '......1.....',
                ride:  '1.1.1.1.1.1.',
                tom:   '..........1.'
            }
        },
        rock68: {
            name: 'Rock', sig: '6/8', swing: false,
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

    // Custom is per signature: "Custom" = 4/4, "Custom (3/4)" and
    // "Custom (6/8)" keep their own patterns instead of overwriting each other.
    const CUSTOM_STYLE_IDS = { '4/4': 'custom', '3/4': 'custom34', '6/8': 'custom68' };
    const CUSTOM_STYLE_SIGS = { custom: '4/4', custom34: '3/4', custom68: '6/8' };

    function isCustomStyle(id) { return !!CUSTOM_STYLE_SIGS[id]; }
    function customStyleId(sig) { return CUSTOM_STYLE_IDS[sig] || 'custom'; }
    function customStyleSig(id) { return CUSTOM_STYLE_SIGS[id] || '4/4'; }
    function customStyleLabel(sig) {
        return sig === '4/4' ? 'Custom' : 'Custom (' + sig + ')';
    }
    function styleLabel(id) {
        if (isCustomStyle(id)) return customStyleLabel(customStyleSig(id));
        const style = DRUM_STYLES[id];
        if (!style) return id;
        return style.sig === '4/4' ? style.name : style.name + ' (' + style.sig + ')';
    }
    function styleSig(id) {
        if (isCustomStyle(id)) return customStyleSig(id);
        return DRUM_STYLES[id] ? DRUM_STYLES[id].sig : '';
    }
    function styleOptions() {
        const out = [];
        SIGNATURES.forEach(function (sig) {
            out.push({ value: customStyleId(sig), label: customStyleLabel(sig) });
            Object.keys(DRUM_STYLES).forEach(function (id) {
                if (DRUM_STYLES[id].sig !== sig) return;
                out.push({ value: id, label: styleLabel(id) });
            });
        });
        return out;
    }

    let drumPattern = JSON.parse(JSON.stringify(drumPatterns['4/4']));
    let customPatterns = {};           // sig -> canonical 16th-grid pattern
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
    function stepsFor(sig, res) { return baseSteps(sig) * (res === 16 ? 2 : 1); }
    function beatCount(sig) { return sig === '4/4' ? 4 : (sig === '3/4' ? 3 : 6); }
    function accentBeats(sig) { return sig === '4/4' ? 4 : (sig === '3/4' ? 3 : 2); }

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
    function normalizePattern(p, steps) {
        const out = {};
        drumInstruments.forEach(function (inst) {
            const arr = p && p[inst.id];
            out[inst.id] = (Array.isArray(arr) && arr.length === steps)
                ? arr.map(function (v) { return v ? 1 : 0; })
                : new Array(steps).fill(0);
        });
        return out;
    }
    function convertTo(p, fromSteps, toSteps) {
        if (fromSteps === toSteps) return normalizePattern(p, toSteps);
        const conv = toSteps > fromSteps ? expand : collapse;
        const out = {};
        drumInstruments.forEach(function (inst) {
            out[inst.id] = conv((p && p[inst.id]) || []);
        });
        return out;
    }
    function convertPattern(p, fromSteps) {
        return convertTo(p, fromSteps, totalSteps());
    }
    function defaultPattern(sig, res) {
        const target = res || currentRes;
        return convertTo(drumPatterns[sig] || drumPatterns['4/4'],
            baseSteps(sig), stepsFor(sig, target));
    }
    // Pattern of a preset, on the requested grid.
    function stylePattern(id, res) {
        const style = DRUM_STYLES[id];
        if (!style || !style[style.sig]) return null;
        const sig = style.sig;
        const raw = style[sig];
        const base = baseSteps(sig) * 2;
        const target = stepsFor(sig, res || currentRes);
        const out = {};
        drumInstruments.forEach(function (inst) {
            let arr = toArray(raw[inst.id], base);
            if (target < base) arr = collapse(arr);
            out[inst.id] = arr;
        });
        return out;
    }
    // Custom patterns are stored in the 16th grid of their own signature, so
    // switching grid resolution never loses sixteenth-note detail.
    function canonicalPattern(p, sig) {
        const base = baseSteps(sig) * 2;
        const src = p && p.kick;
        if (!Array.isArray(src)) return null;
        if (src.length === base) return normalizePattern(p, base);
        if (src.length === base / 2) return convertTo(p, base / 2, base);
        return null;
    }
    function customPatternFor(sig, res) {
        const canonical = customPatterns[sig];
        if (!canonical) return defaultPattern(sig, res);
        return convertTo(canonical, baseSteps(sig) * 2, stepsFor(sig, res || currentRes));
    }
    function rememberCustom() {
        const canonical = canonicalPattern(drumPattern, currentSig);
        if (canonical) customPatterns[currentSig] = canonical;
    }

    // --- Persistencia (BPM, compas, rejilla, estilo y patron) ----------------
    const LS_BPM = 'gph_drum_bpm';
    const LS_STATE = 'gph_drum_state';
    (function loadDrumState() {
        try { const b = parseInt(localStorage.getItem(LS_BPM), 10); if (b >= 40 && b <= 240) drumBpm = b; } catch (e) {}
        try {
            const st = JSON.parse(localStorage.getItem(LS_STATE) || 'null');
            if (!st || SIGNATURES.indexOf(st.sig) < 0) return;
            currentSig = st.sig;
            currentRes = st.res === 16 ? 16 : 8;
            let loaded = null;
            const first = st.pattern && st.pattern.kick;
            if (Array.isArray(first) && first.length === totalSteps()) {
                loaded = normalizePattern(st.pattern, totalSteps());
            } else if (Array.isArray(first)) {   // older state / grid changed
                currentRes = 8;
                if (first.length === totalSteps()) loaded = normalizePattern(st.pattern, totalSteps());
            }
            if (st.customPatterns && typeof st.customPatterns === 'object') {
                SIGNATURES.forEach(function (sig) {
                    const cp = st.customPatterns[sig];
                    const canonical = cp && canonicalPattern(cp, sig);
                    if (canonical) customPatterns[sig] = canonical;
                });
            }
            let style = st.style;
            // "custom" was the single 4/4 custom in older state; when the saved
            // signature was 6/8, migrate it to the 6/8 custom variant.
            if (style === 'custom' && currentSig !== '4/4') style = customStyleId(currentSig);
            if (!isCustomStyle(style) && !DRUM_STYLES[style]) style = customStyleId(currentSig);
            const targetSig = styleSig(style);
            if (targetSig && targetSig !== currentSig) {
                // A style now owns another meter (Waltz moved from 6/8 to 3/4):
                // the style wins over the old saved signature.
                currentSig = targetSig;
                currentStyle = style;
                if (DRUM_STYLES[style]) {
                    currentRes = styleUsesSixteenths(style) ? 16 : 8;
                    drumPattern = stylePattern(style, currentRes) || defaultPattern(currentSig, currentRes);
                } else {
                    drumPattern = customPatternFor(currentSig, currentRes);
                }
            } else {
                currentStyle = style;
                if (loaded) {
                    drumPattern = loaded;
                } else if (isCustomStyle(currentStyle)) {
                    drumPattern = customPatternFor(currentSig, currentRes);
                } else {
                    drumPattern = stylePattern(currentStyle, currentRes) || defaultPattern(currentSig, currentRes);
                }
                if (isCustomStyle(currentStyle) && !customPatterns[currentSig]) rememberCustom();
            }
            if (typeof st.swing === 'boolean') swingPending = st.swing;
        } catch (e) {}
    })();
    function saveDrumState() {
        try {
            const custom = {};
            SIGNATURES.forEach(function (sig) {
                if (customPatterns[sig]) custom[sig] = customPatterns[sig];
            });
            localStorage.setItem(LS_STATE, JSON.stringify({
                sig: currentSig, res: currentRes, style: currentStyle,
                swing: isSwingActive, pattern: drumPattern,
                customPatterns: custom
            }));
        } catch (e) {}
    }

    // --- Style / resolution controls ----------------------------------------
    function styleSelect() { return document.getElementById('drumStyleSel'); }

    // The selector shows the complete catalog; the meter is part of each
    // preset, so choosing a style loads its signature too.
    function fillStyleOptions() {
        const sel = styleSelect();
        if (!sel) return;
        sel.innerHTML = '';
        styleOptions().forEach(function (opt) {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            sel.appendChild(o);
        });
        if (!sel.querySelector('option[value="' + currentStyle + '"]')) {
            currentStyle = customStyleId(currentSig);
        }
        sel.value = currentStyle;
    }

    function syncControls() {
        const sel = styleSelect();
        if (sel && !sel.querySelector('option[value="' + currentStyle + '"]')) {
            currentStyle = customStyleId(currentSig);
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

    // Any manual edit stops being "the preset" and is remembered as the custom
    // pattern of the signature that is currently open.
    function markCustom() {
        currentStyle = customStyleId(currentSig);
        rememberCustom();
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
        const perBeat = steps / beatCount(currentSig);
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
        const custom = isCustomStyle(currentStyle);
        const p = custom ? null : stylePattern(currentStyle, currentRes);
        drumPattern = p || defaultPattern(currentSig, currentRes);
        if (custom) rememberCustom();
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
        const beats = accentBeats(currentSig);
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
        const idx = SIGNATURES.indexOf(currentSig);
        setDrumSig(SIGNATURES[(idx + 1) % SIGNATURES.length]);
    }

    function setDrumSig(sig) {
        if (SIGNATURES.indexOf(sig) < 0 || sig === currentSig) return;
        currentSig = sig;
        // A preset belongs to one meter; changing meter manually returns to
        // that meter's own Custom pattern.
        currentStyle = customStyleId(sig);
        drumPattern = customPatternFor(sig, currentRes);
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
        const styleP = isCustomStyle(currentStyle) ? null : stylePattern(currentStyle, res);
        drumPattern = styleP || convertPattern(drumPattern, from);
        if (isCustomStyle(currentStyle)) rememberCustom();
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
        if (!style || !style[style.sig]) return false;
        const pad = style[style.sig];
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
        if (isCustomStyle(id)) {
            currentSig = customStyleSig(id);
            currentStyle = id;
            drumPattern = customPatternFor(currentSig, currentRes);
            currentDrumStep = 0;
            saveDrumState();
            initDrumMachineGrid();
            return;
        }
        const style = DRUM_STYLES[id];
        if (!style) {
            currentStyle = customStyleId(currentSig);
            syncControls();
            saveDrumState();
            return;
        }
        // The preset owns its meter and picks the grid it needs.
        currentSig = style.sig;
        currentStyle = id;
        currentRes = styleUsesSixteenths(id) ? 16 : 8;
        const p = stylePattern(id, currentRes);
        if (!p) return;
        drumPattern = p;
        if (typeof style.swing === 'boolean') setSwing(style.swing);
        currentDrumStep = 0;
        saveDrumState();
        initDrumMachineGrid();
    }

    function getConfig() {
        return { sig: currentSig, style: currentStyle, res: currentRes, swing: isSwingActive };
    }

    // Per-exercise settings of a drums resource, applied when the exercise opens.
    // Order matters: signature first, then the preset (which brings its own
    // meter, grid and swing), then the saved grid and swing.
    function applyConfig(cfg) {
        if (!cfg || typeof cfg !== 'object') return;
        if (SIGNATURES.indexOf(cfg.sig) >= 0) setDrumSig(cfg.sig);
        let style = cfg.style;
        // Legacy "custom" belongs to 4/4; recover a 6/8/3/4 legacy state.
        if (style === 'custom' && cfg.sig && cfg.sig !== '4/4') style = customStyleId(cfg.sig);
        if (typeof style === 'string' && style !== currentStyle &&
            (isCustomStyle(style) || DRUM_STYLES[style])) {
            setDrumStyle(style);
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
        setSig: setDrumSig,
        setResolution,
        toggleResolution,
        stepVelocity,
        styles: DRUM_STYLES,
        signatures: SIGNATURES,
        styleOptions: styleOptions,
        styleLabel: styleLabel,
        styleSig: styleSig,
        customStyleId: customStyleId,
        isCustomStyle: isCustomStyle
    };
})(window.GPH = window.GPH || {});
