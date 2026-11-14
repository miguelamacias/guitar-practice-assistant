// Chords by Key: scale and mode harmonization computed in code.
// No chord tables: triads/sevenths come from stacking thirds inside
// the scale, and the quality is derived by measuring the resulting intervals.
// GPH.chords.byKey(root, mode, seventh) -> { root, mode, modeLabel, scale, chords: [...] }
(function (GPH) {
    'use strict';

    const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

    // Modes and minor scales: just the 7 intervals from the tonic
    const MODES = {
        ionian: { label: 'Major (Ionian)', ivals: [0, 2, 4, 5, 7, 9, 11] },
        dorian: { label: 'Dorian', ivals: [0, 2, 3, 5, 7, 9, 10] },
        phrygian: { label: 'Phrygian', ivals: [0, 1, 3, 5, 7, 8, 10] },
        lydian: { label: 'Lydian', ivals: [0, 2, 4, 6, 7, 9, 11] },
        mixolydian: { label: 'Mixolydian', ivals: [0, 2, 4, 5, 7, 9, 10] },
        aeolian: { label: 'Natural minor (Aeolian)', ivals: [0, 2, 3, 5, 7, 8, 10] },
        locrian: { label: 'Locrian', ivals: [0, 1, 3, 5, 6, 8, 10] },
        harmonic: { label: 'Harmonic minor', ivals: [0, 2, 3, 5, 7, 8, 11] },
        melodic: { label: 'Melodic minor', ivals: [0, 2, 3, 5, 7, 9, 11] }
    };

    // "Friendly" roots (no double accidentals in most modes)
    const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

    // Quality from the intervals between consecutive chord notes
    const TRIADS = {
        '4,3': ['', 'major'],
        '3,4': ['m', 'minor'],
        '3,3': ['\u00b0', 'diminished'],
        '4,4': ['+', 'augmented']
    };
    const SEVENTHS = {
        '4,3,4': ['maj7', 'major 7th'],
        '4,3,3': ['7', 'dominant 7th'],
        '3,4,3': ['m7', 'minor 7th'],
        '3,3,4': ['m7b5', 'half-diminished'],
        '3,3,3': ['dim7', 'diminished 7th'],
        '3,4,4': ['mM7', 'minor-major 7th'],
        '4,4,3': ['maj7#5', 'augmented major 7th']
    };
    const MINORISH = { minor: 1, diminished: 1, 'minor 7th': 1, 'half-diminished': 1, 'diminished 7th': 1, 'minor-major 7th': 1 };
    const ROMAN_SUFFIX = {
        diminished: '\u00b0', 'diminished 7th': '\u00b0', 'half-diminished': '\u00f8',
        augmented: '+', 'augmented major 7th': '+'
    };

    // Degrees to highlight: I-IV-V makes sense in major/minor; in the other modes
    // only the tonic, because there are no equivalent tonal functions.
    const PRIMARY_DEGREES = {
        ionian: [0, 3, 4], aeolian: [0, 3, 4], harmonic: [0, 3, 4], melodic: [0, 3, 4],
        dorian: [0], phrygian: [0], lydian: [0], mixolydian: [0], locrian: [0]
    };

    function pcOf(name) {
        const letter = String(name).charAt(0).toUpperCase();
        const rest = String(name).slice(1);
        let pc = NATURAL[letter] || 0;
        for (let i = 0; i < rest.length; i++) {
            if (rest.charAt(i) === '#') pc += 1;
            else if (rest.charAt(i) === 'b') pc -= 1;
        }
        return ((pc % 12) + 12) % 12;
    }

    // Enharmonic spelling: diatonic letter + accidental needed to reach the pitch class
    function spell(letter, pc) {
        let diff = ((pc - NATURAL[letter]) % 12 + 12) % 12;
        if (diff > 6) diff -= 12;                     // -6..+6
        if (diff > 2 || diff < -2) return SHARP_NAMES[pc];   // pathological case: practical name
        return letter + ({ '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' }[diff] || '');
    }

    function byKey(root, modeKey, seventh) {
        const mode = MODES[modeKey] || MODES.ionian;
        const ivals = mode.ivals;
        const rootName = ROOTS.indexOf(root) >= 0 ? root : 'C';
        const rootPc = pcOf(rootName);
        const rootLetter = LETTERS.indexOf(rootName.charAt(0));
        const steps = seventh ? [0, 2, 4, 6] : [0, 2, 4];
        const table = seventh ? SEVENTHS : TRIADS;
        const chords = [];

        for (let d = 0; d < 7; d++) {
            // Chord notes: diatonic thirds (consecutive letters C-D-E-F-G-A-B)
            const tones = steps.map(function (step) {
                const deg = d + step;
                const pc = (rootPc + ivals[deg % 7] + 12 * Math.floor(deg / 7)) % 12;
                return { letter: LETTERS[(rootLetter + deg) % 7], pc: pc };
            });
            const semis = [];
            for (let i = 1; i < tones.length; i++) {
                semis.push(((tones[i].pc - tones[i - 1].pc) % 12 + 12) % 12);
            }
            const hit = table[semis.join(',')] || ['?', 'unknown'];
            const symbol = hit[0];
            const quality = hit[1];
            const roman = (MINORISH[quality] ? ROMAN[d].toLowerCase() : ROMAN[d]) + (ROMAN_SUFFIX[quality] || '');
            const spelled = tones.map(function (t) { return spell(t.letter, t.pc); });

            chords.push({
                degree: d + 1,
                roman: roman,
                name: spelled[0] + symbol,
                symbol: symbol,
                quality: quality,
                tones: spelled,
                pcs: tones.map(function (t) { return t.pc; }),
                primary: (PRIMARY_DEGREES[modeKey] || [0]).indexOf(d) >= 0
            });
        }

        const scale = ivals.map(function (semi) {
            return spell(LETTERS[(rootLetter + ivals.indexOf(semi)) % 7], (rootPc + semi) % 12);
        });

        return { root: rootName, mode: modeKey, modeLabel: mode.label, seventh: !!seventh, scale: scale, chords: chords };
    }

    // ---------- Panel (UI) ----------
    // The markup lives in index.html (#chordsPanel); here it is only filled and played.
    const SETTINGS_KEY = 'chords_by_key';
    let chordTimers = [];

    function addOption(sel, value, text) {
        const o = document.createElement('option');
        o.value = value; o.textContent = text; sel.appendChild(o);
    }

    // Strum: quick arpeggio with the audio kit pluck.
    // Root-position voicing: the root goes in the bass (octave 3) and the rest of
    // the notes are stacked by their real interval. That way two different chords
    // do not land on the same notes (avoids inversions that sound almost the same).
    function playChordArp(pcs) {
        try {
            const audio = GPH.audio;
            if (!audio || !audio.playPluck || !pcs || !pcs.length) return;
            audio.ensureAudio();
            const rootPc = ((pcs[0] % 12) + 12) % 12;   // pcs[0] is the chord root
            const bass = 48 + rootPc;                   // C3..B3
            const midis = pcs.map(function (pc) {
                const interval = (((pc - rootPc) % 12) + 12) % 12;   // 3-4, 6-8, 10-11
                return bass + interval;
            });
            chordTimers.forEach(clearTimeout);          // corta el strum anterior
            chordTimers = [];
            midis.forEach(function (m, i) {
                chordTimers.push(setTimeout(function () {
                    try { GPH.audio.playPluck(440 * Math.pow(2, (m - 69) / 12)); } catch (e) { /* noop */ }
                }, i * 55));
            });
        } catch (e) { /* silent if audio is not available */ }
    }

    function mountPanel(rootEl) {
        if (!rootEl) return;
        const panel = (rootEl.id === 'chordsPanel') ? rootEl : rootEl.querySelector('#chordsPanel');
        if (!panel || panel.dataset.chordsReady === '1') return;
        const rootSel = panel.querySelector('.chords-root');
        const modeSel = panel.querySelector('.chords-mode');
        const sevBox = panel.querySelector('.chords-seventh');
        const scaleEl = panel.querySelector('.chords-scale');
        const grid = panel.querySelector('.chords-grid');
        if (!rootSel || !modeSel || !sevBox || !scaleEl || !grid) return;
        panel.dataset.chordsReady = '1';

        ROOTS.forEach(function (r) { addOption(rootSel, r, r); });
        Object.keys(MODES).forEach(function (k) { addOption(modeSel, k, MODES[k].label); });

        function persist() {
            const st = { root: rootSel.value, mode: modeSel.value, seventh: sevBox.checked };
            try { localStorage.setItem('gph_chords_by_key', JSON.stringify(st)); } catch (e) {}
            if (GPH.settings) GPH.settings.set(SETTINGS_KEY, st).catch(function () {});
        }

        function apply(st) {
            if (!st || typeof st !== 'object') return;
            if (st.root && ROOTS.indexOf(st.root) >= 0) rootSel.value = st.root;
            if (st.mode && MODES[st.mode]) modeSel.value = st.mode;
            sevBox.checked = !!st.seventh;
        }

        function render() {
            const data = byKey(rootSel.value, modeSel.value, sevBox.checked);
            scaleEl.textContent = data.modeLabel + ': ' + data.scale.join(' \u00b7 ');
            grid.innerHTML = '';
            data.chords.forEach(function (c) {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'chord-card' + (c.primary ? ' is-primary' : '');
                card.dataset.degree = String(c.degree);
                card.title = c.name + ' \u2014 ' + c.quality + ' (' + c.tones.join(' ') + ')';
                const rn = document.createElement('span');
                rn.className = 'chord-roman'; rn.textContent = c.roman;
                const nm = document.createElement('span');
                nm.className = 'chord-name'; nm.textContent = c.name;
                const tn = document.createElement('span');
                tn.className = 'chord-tones'; tn.textContent = c.tones.join(' ');
                card.appendChild(rn); card.appendChild(nm); card.appendChild(tn);
                card.addEventListener('click', function () { playChordArp(c.pcs); });
                grid.appendChild(card);
            });
        }

        rootSel.addEventListener('change', function () { render(); persist(); });
        modeSel.addEventListener('change', function () { render(); persist(); });
        sevBox.addEventListener('change', function () { render(); persist(); });

        // Initial state: localStorage (instantaneous) then the DB
        let localState = null;
        try { localState = JSON.parse(localStorage.getItem('gph_chords_by_key') || 'null'); } catch (e) {}
        apply(localState);
        render();
        if (GPH.settings) {
            GPH.settings.get(SETTINGS_KEY).then(function (dbVal) {
                if (dbVal && typeof dbVal === 'object') { apply(dbVal); render(); }
            }).catch(function () {});
        }

        // Exposed so an exercise resource can drive the panel.
        panelApi = { apply: apply, render: render, persist: persist };
        if (pendingState) { panelApi.apply(pendingState); panelApi.render(); pendingState = null; }
    }

    // Programmatic control before/after mounting (used by exercise resources).
    let panelApi = null;
    let pendingState = null;
    function setState(st) {
        if (!st || typeof st !== 'object') return;
        if (!panelApi) { pendingState = Object.assign({}, pendingState || {}, st); return; }
        panelApi.apply(st);
        panelApi.render();
        panelApi.persist();
    }

    GPH.chords = {
        MODES: MODES,
        ROOTS: ROOTS,
        byKey: byKey,
        spell: spell,
        pcOf: pcOf,
        mount: mountPanel,
        play: playChordArp,
        apply: setState
    };
})(window.GPH = window.GPH || {});
