// Fretboard Theory: scales and chords (CAGED) on the shared fretboard.
// GPH.theory.init() · GPH.theory.render()
// The theory board always uses 15 frets (independent of the trainer setting):
// so positions starting at fret 12 are not lost.
(function (GPH) {
    'use strict';

    const OPEN = [40, 45, 50, 55, 59, 64];          // E2 A2 D3 G3 B3 E4 (row 0 = string 1)
    const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const DEG = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

    // Scales: the 7 modes of the major scale first (in order), then the rest.
    const SCALES = {
        'Ionian (major)': [0, 2, 4, 5, 7, 9, 11],
        'Dorian': [0, 2, 3, 5, 7, 9, 10],
        'Phrygian': [0, 1, 3, 5, 7, 8, 10],
        'Lydian': [0, 2, 4, 6, 7, 9, 11],
        'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
        'Aeolian (minor)': [0, 2, 3, 5, 7, 8, 10],
        'Locrian': [0, 1, 3, 5, 6, 8, 10],
        'Harmonic minor': [0, 2, 3, 5, 7, 8, 11],
        'Melodic minor': [0, 2, 3, 5, 7, 9, 11],
        'Major pentatonic': [0, 2, 4, 7, 9],
        'Minor pentatonic': [0, 3, 5, 7, 10],
        'Blues': [0, 3, 5, 6, 7, 10]
    };

    const CHORDS = {
        'maj': { label: 'Major', ivals: [0, 4, 7] },
        'm': { label: 'Minor', ivals: [0, 3, 7] },
        '7': { label: 'Dominant 7', ivals: [0, 4, 7, 10] },
        'm7': { label: 'Minor 7', ivals: [0, 3, 7, 10] },
        'maj7': { label: 'Major 7', ivals: [0, 4, 7, 11] },
        'm7b5': { label: 'm7b5', ivals: [0, 3, 6, 10] },
        'dim': { label: 'Diminished', ivals: [0, 3, 6] },
        'sus2': { label: 'Sus2', ivals: [0, 2, 7] },
        'sus4': { label: 'Sus4', ivals: [0, 5, 7] }
    };

    // CAGED shapes: `base` = root fret in the shape's natural position;
    // `frets` ordered string 6 -> 1 ('x' = muted string).
    const CAGED = {
        'maj': [
            { name: 'E', root: 6, base: 0, frets: [0, 2, 2, 1, 0, 0] },
            { name: 'A', root: 5, base: 0, frets: ['x', 0, 2, 2, 2, 0] },
            { name: 'D', root: 4, base: 0, frets: ['x', 'x', 0, 2, 3, 2] },
            { name: 'C', root: 5, base: 3, frets: ['x', 3, 2, 0, 1, 0] },
            { name: 'G', root: 6, base: 3, frets: [3, 2, 0, 0, 0, 3] }
        ],
        'm': [
            { name: 'E', root: 6, base: 0, frets: [0, 2, 2, 0, 0, 0] },
            { name: 'A', root: 5, base: 0, frets: ['x', 0, 2, 2, 1, 0] },
            { name: 'D', root: 4, base: 0, frets: ['x', 'x', 0, 2, 3, 1] },
            { name: 'C', root: 5, base: 3, frets: ['x', 3, 1, 0, 1, 'x'] },
            { name: 'G', root: 6, base: 3, frets: [3, 5, 5, 3, 3, 3] }
        ],
        '7': [
            { name: 'E', root: 6, base: 0, frets: [0, 2, 0, 1, 0, 0] },
            { name: 'A', root: 5, base: 0, frets: ['x', 0, 2, 0, 2, 0] },
            { name: 'D', root: 4, base: 0, frets: ['x', 'x', 0, 2, 1, 2] },
            { name: 'C', root: 5, base: 3, frets: ['x', 3, 2, 3, 1, 0] },
            { name: 'G', root: 6, base: 3, frets: [3, 2, 0, 0, 0, 1] }
        ],
        'm7': [
            { name: 'E', root: 6, base: 0, frets: [0, 2, 0, 0, 0, 0] },
            { name: 'A', root: 5, base: 0, frets: ['x', 0, 2, 0, 1, 0] },
            { name: 'D', root: 4, base: 0, frets: ['x', 'x', 0, 2, 1, 1] },
            { name: 'C', root: 5, base: 3, frets: ['x', 3, 1, 3, 1, 'x'] },
            { name: 'G', root: 6, base: 3, frets: [3, 5, 3, 3, 3, 3] }
        ],
        'maj7': [
            { name: 'E', root: 6, base: 0, frets: [0, 2, 1, 1, 0, 0] },
            { name: 'A', root: 5, base: 0, frets: ['x', 0, 2, 1, 2, 0] },
            { name: 'D', root: 4, base: 0, frets: ['x', 'x', 0, 2, 2, 2] },
            { name: 'C', root: 5, base: 3, frets: ['x', 3, 2, 0, 0, 0] },
            { name: 'G', root: 6, base: 3, frets: [3, 2, 0, 0, 0, 2] }
        ],
        'm7b5': [
            { name: 'E', root: 6, base: 0, frets: [0, 1, 2, 0, 3, 'x'] },
            { name: 'A', root: 5, base: 0, frets: ['x', 0, 1, 0, 1, 'x'] }
        ],
        'dim': [
            { name: 'E', root: 6, base: 0, frets: [0, 1, 2, 0, 'x', 'x'] },
            { name: 'A', root: 5, base: 0, frets: ['x', 0, 1, 2, 1, 'x'] }
        ],
        'sus2': [
            { name: 'E', root: 6, base: 0, frets: [0, 2, 4, 4, 0, 0] },
            { name: 'A', root: 5, base: 0, frets: ['x', 0, 2, 2, 0, 0] }
        ],
        'sus4': [
            { name: 'E', root: 6, base: 0, frets: [0, 2, 2, 2, 0, 0] },
            { name: 'A', root: 5, base: 0, frets: ['x', 0, 2, 2, 3, 0] }
        ]
    };

    // CAGED shapes valid for each chord type (avoids shapes that do not exist naturally,
    // e.g. G minor has no shape of its own in CAGED and would duplicate the E minor one).
    const CAGED_VALID = {
        'maj':   ['E', 'A', 'D', 'C', 'G'],
        'm':     ['E', 'A', 'D', 'C'],
        '7':     ['E', 'A', 'D', 'C', 'G'],
        'm7':    ['E', 'A', 'D', 'C'],
        'maj7':  ['E', 'A', 'D', 'C', 'G'],
        'm7b5':  ['E', 'A'],
        'dim':   ['E', 'A'],
        'sus2':  ['E', 'A'],
        'sus4':  ['E', 'A']
    };

    const LS_KEY = 'gph_theory_state';

    // The 7 modes are rotations of the same scale: the "parent" major tonic is
    // `offset` semitones below the mode root (D Dorian -> C major).
    // The 5 CAGED shapes are ALWAYS the parent major's, so each shape is placed
    // on that tonic: changing the mode only changes which note is the root (degree 1),
    // not the shape or the frets it covers.
    const MODE_PARENT_OFFSET = {
        'Ionian (major)': 0,
        'Dorian': 2,
        'Phrygian': 4,
        'Lydian': 5,
        'Mixolydian': 7,
        'Aeolian (minor)': 9,
        'Locrian': 11
    };

    // Is this scale one of the 7 major modes? Those use the 5 major shapes with
    // all their notes (pentatonics and blues use them too, with other notes: see
    // DERIVED_PARENT_OFFSET).
    function isMajorMode(typeName) {
        return Object.prototype.hasOwnProperty.call(MODE_PARENT_OFFSET, typeName);
    }

    // Scales that reuse the 5 major shapes with other notes (no new tables):
    //   major pentatonic = major without 4 and 7 (C pent = C major without F and B)
    //   minor pentatonic = Aeolian without 2 and b6 (A minor pent = C major without F and B)
    //   blues = minor pentatonic + b5: the blue note joins the shape when inside its window
    //   harmonic minor = Aeolian with a raised 7th: the leading tone joins when inside the window
    //   melodic minor = Aeolian with raised 6th and 7th: both join when inside the window
    const DERIVED_PARENT_OFFSET = {
        'Major pentatonic': 0,
        'Minor pentatonic': 9,
        'Blues': 9,
        'Harmonic minor': 9,
        'Melodic minor': 9
    };

    // Arpeggios: parent major that contains the chord tones (used to place the 5 shapes).
    //   maj / maj7 / sus2 / sus4 -> Ionian (same tonic)
    //   7                        -> Mixolydian
    //   m / m7                   -> Aeolian (relative major)
    //   m7b5 / dim               -> Locrian
    const CHORD_PARENT_OFFSET = {
        'maj': 0, 'maj7': 0, 'sus2': 0, 'sus4': 0,
        '7': 7,
        'm': 9, 'm7': 9,
        'm7b5': 11, 'dim': 11
    };

    // Old -> current names (for state already saved in localStorage).
    const SCALE_ALIASES = {
        'Major (Ionian)': 'Ionian (major)',
        'Natural minor': 'Aeolian (minor)'
    };

    // Anchors of the 5 CAGED shapes (the major scale ones, always the same).
    // `row` = string where the shape root sits (row 0 = string 1 ... row 5 = string 6).
    // `col` = column the root occupies inside the shape's 5-fret window.
    // The shape is placed on the parent major tonic (see MODE_PARENT_OFFSET), so
    // modes reuse exactly the same 5 shapes and only the root note changes.
    // Inside the window everything belonging to the scale is highlighted (for a mode those
    // are the parent major's notes), except the 2nd/3rd string unison (see inScaleShape).
    const SCALE_SHAPES = {
        'C': { row: 4, col: 4 },
        'A': { row: 4, col: 1 },
        'G': { row: 5, col: 4 },
        'E': { row: 5, col: 2 },
        'D': { row: 3, col: 1 }
    };

    const SCALE_SHAPES_ORDER = ['all', 'C', 'A', 'G', 'E', 'D'];
    const THEORY_FRETS = 17;        // fixed: 3NPS can reach fret 17 in some keys
    const DEFAULTS = { kind: 'scale', type: 'Ionian (major)', bg: 'Minor pentatonic', root: 0, labels: 'degrees', overlay: false, shape: 0, allNotes: false, scaleShape: 'all', shapeSystem: 'caged', npsPattern: 1 };

    let state = Object.assign({}, DEFAULTS);
    let built = false, bd = null;
    let boardEl = null, rootSel = null, typeSel = null, notesChk = null;
    let overlayChk = null, bgSel = null, shapesEl = null, legendEl = null, msgEl = null, allChk = null, systemSel = null;

    function loadState() {
        try {
            const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
            if (s && typeof s === 'object') state = Object.assign({}, DEFAULTS, s);
        } catch (e) { /* noop */ }
        // State saved with the old scale names ('Major (Ionian)', 'Natural minor')
        if (SCALE_ALIASES[state.type]) state.type = SCALE_ALIASES[state.type];
        if (SCALE_ALIASES[state.bg]) state.bg = SCALE_ALIASES[state.bg];
        // Removed scales ('Whole tone', 'Diminished (W-H)') or corrupt state:
        // fall back to the default so the selects are never left empty.
        function hasScale(k) { return Object.prototype.hasOwnProperty.call(SCALES, k); }
        if (state.kind === 'scale' && !hasScale(state.type)) state.type = DEFAULTS.type;
        if (!hasScale(state.bg)) state.bg = DEFAULTS.bg;
        if (state.shapeSystem !== '3nps') state.shapeSystem = 'caged';
        if (!(state.npsPattern >= 1 && state.npsPattern <= 7)) state.npsPattern = 1;
    }
    function saveState() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* noop */ }
    }

    // row 0 = string 1 (E4) ... row 5 = string 6 (E2) -> same convention as the trainer
    function openMidi(row) { return OPEN[5 - row]; }
    function pcAt(row, fret) { return ((openMidi(row) + fret) % 12 + 12) % 12; }
    function freqFor(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
    function rootFretOn(rootPc, stringNo) {
        const open = OPEN[6 - stringNo];
        return ((rootPc - open) % 12 + 12) % 12;
    }
    function degLabel(semis, pc) {
        return (state.labels === 'notes') ? NOTE[pc] : DEG[semis];
    }

    // ---------- 3NPS (major scale only) ----------
    // A 3NPS pattern is a continuous run of the major scale with exactly
    // three notes on each string. P1 starts on degree 1 on low E, P2 on
    // degree 2, etc. Following MIDI pitches (instead of fret offsets) makes
    // the G -> B string shift automatic.
    function nextScaleMidi(from, rootPc) {
        let midi = Math.max(0, from);
        const major = SCALES['Ionian (major)'];
        while (major.indexOf((midi - rootPc + 12) % 12) < 0) midi++;
        return midi;
    }

    function npsPatternSet(rootPc, pattern) {
        const set = {};
        const degree = Math.max(0, Math.min(6, (pattern || 1) - 1));
        const degreePc = (rootPc + SCALES['Ionian (major)'][degree]) % 12;
        let startFret = 0;
        for (let f = 0; f <= 11; f++) {
            if ((OPEN[0] + f) % 12 === degreePc) { startFret = f; break; }
        }
        let cursor = OPEN[0] + startFret - 1;   // OPEN is low E -> high e
        for (let s = 0; s < 6; s++) {
            for (let n = 0; n < 3; n++) {
                let midi = nextScaleMidi(cursor + 1, rootPc);
                while (midi < OPEN[s]) midi += 12;
                const fret = midi - OPEN[s];
                const row = 5 - s;
                set[row + '|' + fret] = true;
                cursor = midi;
            }
        }
        return set;
    }

    function isMajorScale() {
        return state.kind === 'scale' && state.type === 'Ionian (major)';
    }

    function npsAvailable() {
        return !state.allNotes && isMajorScale();
    }
    function playNote(midi) {
        try {
            const ctx = GPH.audio.ensureAudio();
            if (ctx.state === 'suspended') ctx.resume().then(function () { GPH.audio.playPluck(freqFor(midi)); }).catch(function () {});
            else GPH.audio.playPluck(freqFor(midi));
        } catch (e) { try { GPH.audio.playBeep(freqFor(midi), 0, 0.25); } catch (e2) { /* noop */ } }
    }

    // ---------- shape computation ----------

    function shapesFor(rootPc) {
        const list = CAGED[state.type] || [];
        const valid = CAGED_VALID[state.type] || list.map(function (s) { return s.name; });
        const out = [];
        list.forEach(function (sh, idx) {
            if (valid.indexOf(sh.name) < 0) return;
            const baseRoot = rootFretOn(rootPc, sh.root);
            const candidates = [baseRoot, baseRoot + 12].filter(function (c) {
                return c >= 0 && c <= bd.frets + 12;
            });

            let best = null;
            candidates.forEach(function (cand) {
                const delta = cand - sh.base;
                const abs = [];
                let ok = true;
                sh.frets.forEach(function (ft) {
                    if (ft === 'x') { abs.push('x'); return; }
                    const v = ft + delta;
                    if (v < 0 || v > bd.frets) { ok = false; return; }
                    abs.push(v);
                });
                if (ok) {
                    // Keep the lowest valid rootFret (closest to the nut)
                    if (!best || cand < best.rootFret) {
                        best = { idx: idx, name: sh.name, rootFret: sh.base + delta, abs: abs };
                    }
                }
            });
            if (best) out.push(best);
        });
        out.sort(function (a, b) { return a.rootFret - b.rootFret; });
        return out;
    }

    // ---------- painting ----------

    const ACCIDENTALS = [1, 3, 6, 8, 10];

    // Reference mode: ALL notes on the fretboard, unrelated to scale/chord.
    function paintAllNotes() {
        for (let row = 0; row < 6; row++) {
            for (let f = 0; f <= bd.frets; f++) {
                const pc = pcAt(row, f);
                const acc = ACCIDENTALS.indexOf(pc) >= 0;
                const d = bd.addDot(row, f, 'th-dot th-all ' + (acc ? 'th-acc' : 'th-nat'));
                const b = document.createElement('b');
                b.textContent = NOTE[pc];
                d.appendChild(b);
            }
        }
    }

    // Fret where the shape's 5-fret window starts, so that the
    // root falls on its reference column. If the natural position would start below the
    // nut, the same position is used one octave higher (so the 5 windows stay
    // spread along the neck). It does not depend on the scale: only on root and shape.
    function scaleShapeStart(shapeName, rootPc) {
        const shape = SCALE_SHAPES[shapeName];
        if (!shape) return null;
        // row 0 = string 1 (E4) ... row 5 = string 6 (E2), same as openMidi/pcAt
        const open = OPEN[5 - shape.row];
        const rootFretOnString = ((rootPc - open) % 12 + 12) % 12;
        let start = rootFretOnString - shape.col;
        if (start < 0 || start + 4 > bd.frets) {
            start = rootFretOnString + 12 - shape.col;
        }
        if (start < 0 || start + 4 > bd.frets) return null;
        return start;
    }

    // Does the note (row, fret) fall inside the CAGED shape starting at `startFret`?
    // Inside the 5-fret window everything belonging to the scale is highlighted, except
    // the unison of the 2nd string (B) with the 3rd (G): fret f on the 2nd sounds the same as
    // f+4 on the 3rd, so the CAGED pattern does not repeat it (otherwise that string would
    // show 3 notes where the shape has 2). For C major shape E that is the F on string 2, fret 6.
    function inScaleShape(row, fret, startFret, ivals, rootPc) {
        const relF = fret - startFret;
        if (relF < 0 || relF >= 5) return false;
        if (row === 1 && relF + 4 < 5) {          // 2nd string and its unison falls inside the window
            const gPc = pcAt(2, fret + 4);       // same note on the 3rd string
            if (ivals.indexOf((gPc - rootPc + 12) % 12) >= 0) return false;
        }
        return true;
    }

    // Parent major tonic the 5 CAGED shapes of the selected type are placed on.
    // Returns null when that type does not use the 5 shapes (chords have their own fingering).
    function shapeAnchorPc(rootPc, kind, typeName) {
        let off = null;
        if (kind === 'arp') {
            if (Object.prototype.hasOwnProperty.call(CHORD_PARENT_OFFSET, typeName)) off = CHORD_PARENT_OFFSET[typeName];
        } else if (kind !== 'chord') {
            if (isMajorMode(typeName)) off = MODE_PARENT_OFFSET[typeName];
            else if (Object.prototype.hasOwnProperty.call(DERIVED_PARENT_OFFSET, typeName)) off = DERIVED_PARENT_OFFSET[typeName];
            else off = 0;   // scale without its own shapes: anchor on its own root
        }
        if (off === null) return null;
        return ((rootPc - off) % 12 + 12) % 12;
    }

    function paintScale(ivals, rootPc, cls, small, shapeName, anchorPc, npsPattern) {
        const shapeRoot = (typeof anchorPc === 'number') ? anchorPc : rootPc;
        const npsSet = npsPattern ? npsPatternSet(shapeRoot, npsPattern) : null;
        const startFret = (!npsSet && shapeName && shapeName !== 'all') ? scaleShapeStart(shapeName, shapeRoot) : null;

        for (let row = 0; row < 6; row++) {
            for (let f = 0; f <= bd.frets; f++) {
                const pc = pcAt(row, f);
                const semis = (pc - rootPc + 12) % 12;
                if (ivals.indexOf(semis) < 0) continue;

                let dotCls = cls + ' d' + semis;

                // CAGED uses a 5-fret window; 3NPS lights exactly its 18 notes.
                if (npsSet) {
                    dotCls += npsSet[row + '|' + f] ? ' shape-on' : ' shape-off';
                } else if (startFret !== null) {
                    dotCls += inScaleShape(row, f, startFret, ivals, rootPc) ? ' shape-on' : ' shape-off';
                }

                const d = bd.addDot(row, f, dotCls);
                if (!small) {
                    const b = document.createElement('b');
                    b.textContent = degLabel(semis, pc);
                    d.appendChild(b);
                }
            }
        }
    }

    function drawBarre(abs, fret) {
        const rows = [];
        abs.forEach(function (v, i) { if (v === fret) rows.push(5 - i); });
        if (rows.length < 3) return;
        const top = bd.yFor(Math.max.apply(null, rows));
        const bot = bd.yFor(Math.min.apply(null, rows));
        const bar = document.createElement('div');
        bar.className = 'th-barre';
        bar.style.left = bd.pct(bd.xFor(fret));
        bar.style.top = bd.pct(top);
        bar.style.height = bd.pct(bot - top);
        bd.dotsEl.appendChild(bar);
    }

    function paintChord(rootPc) {
        const list = shapesFor(rootPc);
        if (!list.length) {
            if (msgEl) msgEl.textContent = 'That shape does not fit with the configured frets.';
            return;
        }
        if (state.shape >= list.length) state.shape = 0;
        const sh = list[state.shape];
        if (msgEl) msgEl.textContent = '';
        // barre first (behind the dots)
        const fretted = sh.abs.filter(function (v) { return typeof v === 'number' && v > 0; });
        if (fretted.length) drawBarre(sh.abs, Math.min.apply(null, fretted));
        sh.abs.forEach(function (v, i) {
            const row = 5 - i;                      // i=0 -> string 6
            if (v === 'x') {
                const m = bd.addDot(row, 0, 'th-mute');
                m.textContent = '×';
                return;
            }
            const pc = pcAt(row, v);
            const semis = (pc - rootPc + 12) % 12;
            const d = bd.addDot(row, v, 'th-dot d' + semis);
            const b = document.createElement('b');
            b.textContent = degLabel(semis, pc);
            d.appendChild(b);
        });
    }

    function renderLegend(ivals, rootPc, isChord) {
        if (!legendEl) return;
        legendEl.innerHTML = '';
        ivals.forEach(function (semi) {
            const sp = document.createElement('span'); sp.className = 'th-leg';
            const sw = document.createElement('i'); sw.className = 'th-sw';
            sw.style.background = 'var(--deg-' + semi + ')';
            const tx = document.createElement('span');
            tx.textContent = (state.labels === 'notes') ? NOTE[(rootPc + semi) % 12] : DEG[semi];
            sp.appendChild(sw); sp.appendChild(tx); legendEl.appendChild(sp);
        });
        if (isChord) {
            const a = document.createElement('span'); a.className = 'th-leg th-leg-note';
            a.textContent = '× muted string';
            legendEl.appendChild(a);
        }
    }

    // ---------- render + controls ----------

    function renderShapes(rootPc) {
        if (!shapesEl) return;
        shapesEl.innerHTML = '';
        const isChord = (state.kind === 'chord');
        const nps = npsAvailable();
        if (systemSel) {
            systemSel.hidden = !nps;
            if (nps) systemSel.value = state.shapeSystem;
        }
        // CAGED chips: chords with their own fingering; scales and arpeggios with the 5
        // major shapes (an arpeggio only lights up the chord degrees).
        const hasShapes = isChord || shapeAnchorPc(rootPc, state.kind, state.type) !== null;
        if (state.allNotes || !hasShapes) {
            shapesEl.hidden = true;
            return;
        }
        shapesEl.hidden = false;

        if (isChord) {
            const list = shapesFor(rootPc);
            if (state.shape >= list.length) state.shape = 0;
            if (!list.length) { shapesEl.hidden = true; return; }
            list.forEach(function (sh, i) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'th-chip' + (i === state.shape ? ' active' : '');
                b.textContent = sh.name + ' · fret ' + sh.rootFret;
                b.addEventListener('click', function () {
                    state.shape = i; saveState(); render();
                });
                shapesEl.appendChild(b);
            });
        } else if (nps && state.shapeSystem === '3nps') {
            for (let p = 1; p <= 7; p++) {
                const b = document.createElement('button');
                b.type = 'button';
                const active = (state.npsPattern === p);
                b.className = 'th-chip' + (active ? ' active' : '');
                b.textContent = 'P' + p;
                b.title = '3 notes per string · starts on degree ' + p;
                b.addEventListener('click', function () {
                    state.npsPattern = p; saveState(); render();
                });
                shapesEl.appendChild(b);
            }
        } else {
            SCALE_SHAPES_ORDER.forEach(function (name) {
                const b = document.createElement('button');
                b.type = 'button';
                const active = (state.scaleShape === name);
                b.className = 'th-chip' + (active ? ' active' : '');
                b.textContent = name === 'all' ? 'All' : name;
                b.addEventListener('click', function () {
                    state.scaleShape = name; saveState(); render();
                });
                shapesEl.appendChild(b);
            });
        }
    }

    function renderAllLegend() {
        if (!legendEl) return;
        legendEl.innerHTML = '';
        [['Natural', 'th-nat'], ['Sharp / flat', 'th-acc']].forEach(function (pair) {
            const sp = document.createElement('span'); sp.className = 'th-leg';
            const sw = document.createElement('i'); sw.className = 'th-sw ' + pair[1];
            const tx = document.createElement('span'); tx.textContent = pair[0];
            sp.appendChild(sw); sp.appendChild(tx); legendEl.appendChild(sp);
        });
    }

    function render() {
        if (!bd) return;
        bd.clearDots();
        if (msgEl) msgEl.textContent = '';
        const rootPc = state.root;
        const kind = state.kind;
        const isChord = (kind === 'chord');
        const isArp = (kind === 'arp');
        const isChordLike = isChord || isArp;
        const ivals = isChordLike
            ? (CHORDS[state.type] || CHORDS.maj).ivals
            : (SCALES[state.type] || SCALES['Ionian (major)']);
        const all = !!state.allNotes;
        // CAGED shapes: scales derived from the major and arpeggios (an arpeggio only
        // lights up the chord degrees inside the shape). null = not applicable (chords).
        const shapeAnchor = shapeAnchorPc(rootPc, kind, state.type);
        const shapeName = (shapeAnchor !== null) ? (state.scaleShape || 'all') : 'all';
        const useNps = npsAvailable() && state.shapeSystem === '3nps';
        const npsPattern = useNps ? state.npsPattern : null;

        if (all) {
            paintAllNotes();
            renderAllLegend();
        } else {
            if (isChordLike && state.overlay) {
                const bgIvals = SCALES[state.bg] || SCALES['Minor pentatonic'];
                paintScale(bgIvals, rootPc, 'th-dot small', true);
            }
            if (isChord) paintChord(rootPc);
            // scale or arpeggio: all positions. CAGED uses a 5-fret window; 3NPS
            // lights exactly the 18 notes of the selected pattern.
            else paintScale(ivals, rootPc, 'th-dot', false,
                useNps ? null : shapeName, shapeAnchor, npsPattern);
            renderLegend(ivals, rootPc, isChord);
        }
        renderShapes(rootPc);

        if (allChk) allChk.checked = all;
        if (rootSel) rootSel.disabled = all;
        if (typeSel) typeSel.disabled = all;
        if (notesChk) {
            notesChk.closest('.theory-opt').hidden = all;
            notesChk.checked = (state.labels === 'notes');
        }
        if (overlayChk) overlayChk.closest('.theory-opt').hidden = all || !isChordLike;
        if (bgSel) bgSel.hidden = all || !(isChordLike && state.overlay);
    }

    function chordLabel(k, isArp) {
        return (isArp ? 'Arp · ' : '') + NOTE[state.root] + ' ' + CHORDS[k].label;
    }

    function refreshChordLabels() {
        if (!typeSel) return;
        Object.keys(CHORDS).forEach(function (k) {
            const a = typeSel.querySelector('option[value="chord|' + k + '"]');
            if (a) a.textContent = chordLabel(k, false);
            const b = typeSel.querySelector('option[value="arp|' + k + '"]');
            if (b) b.textContent = chordLabel(k, true);
        });
    }

    function fillControls() {
        // root
        rootSel.innerHTML = '';
        NOTE.forEach(function (n, i) {
            const o = document.createElement('option');
            o.value = String(i); o.textContent = n;
            rootSel.appendChild(o);
        });
        rootSel.value = String(state.root);

        // type: scales / chords / arpeggios
        typeSel.innerHTML = '';
        const g1 = document.createElement('optgroup'); g1.label = 'Scales';
        Object.keys(SCALES).forEach(function (k) {
            const o = document.createElement('option'); o.value = 'scale|' + k; o.textContent = k; g1.appendChild(o);
        });
        const g2 = document.createElement('optgroup'); g2.label = 'Chords (CAGED)';
        Object.keys(CHORDS).forEach(function (k) {
            const o = document.createElement('option'); o.value = 'chord|' + k;
            o.textContent = chordLabel(k, false); g2.appendChild(o);
        });
        const g3 = document.createElement('optgroup'); g3.label = 'Arpeggios';
        Object.keys(CHORDS).forEach(function (k) {
            const o = document.createElement('option'); o.value = 'arp|' + k;
            o.textContent = chordLabel(k, true); g3.appendChild(o);
        });
        typeSel.appendChild(g1); typeSel.appendChild(g2); typeSel.appendChild(g3);
        typeSel.value = state.kind + '|' + state.type;
        if (systemSel) systemSel.value = state.shapeSystem;

        // background scale
        bgSel.innerHTML = '';
        ['Ionian (major)', 'Dorian', 'Mixolydian', 'Aeolian (minor)', 'Major pentatonic', 'Minor pentatonic', 'Blues'].forEach(function (k) {
            const o = document.createElement('option'); o.value = k; o.textContent = k;
            if (k === state.bg) o.selected = true;
            bgSel.appendChild(o);
        });

        rootSel.addEventListener('change', function () {
            state.root = parseInt(this.value, 10) || 0;
            state.shape = 0;
            refreshChordLabels();
            saveState(); render();
        });
        typeSel.addEventListener('change', function () {
            const parts = String(this.value).split('|');
            const k = parts[0];
            state.kind = (k === 'chord' || k === 'arp') ? k : 'scale';
            state.type = parts[1] || '';
            state.shape = 0;
            saveState(); render();
        });
        if (systemSel) {
            systemSel.addEventListener('change', function () {
                state.shapeSystem = (this.value === '3nps') ? '3nps' : 'caged';
                saveState(); render();
            });
        }
        notesChk.addEventListener('change', function () {
            state.labels = this.checked ? 'notes' : 'degrees';
            saveState(); render();
        });
        overlayChk.addEventListener('change', function () {
            state.overlay = !!this.checked;
            saveState(); render();
        });
        bgSel.addEventListener('change', function () {
            state.bg = this.value;
            saveState(); render();
        });
    }

    function build() {
        if (built) return true;
        const wrap = document.querySelector('.theory-card');
        if (!wrap) return false;
        boardEl = wrap.querySelector('.theory-board');
        rootSel = wrap.querySelector('.theory-root');
        typeSel = wrap.querySelector('.theory-type');
        notesChk = wrap.querySelector('.theory-notes');
        overlayChk = wrap.querySelector('.theory-overlay');
        bgSel = wrap.querySelector('.theory-bg');
        shapesEl = wrap.querySelector('.theory-shapes');
        systemSel = wrap.querySelector('.theory-system');
        legendEl = wrap.querySelector('.theory-legend');
        msgEl = wrap.querySelector('.theory-msg');
        allChk = wrap.querySelector('.theory-all');
        if (!boardEl || !rootSel || !typeSel) return false;
        loadState();
        fillControls();
        if (notesChk) notesChk.checked = (state.labels === 'notes');
        if (overlayChk) overlayChk.checked = !!state.overlay;
        if (allChk) {
            allChk.checked = !!state.allNotes;
            allChk.addEventListener('change', function () {
                state.allNotes = !!this.checked;
                saveState(); render();
            });
        }
        built = true;
        return true;
    }

    function makeBoard() {
        bd = GPH.board.create(boardEl, { frets: THEORY_FRETS, strings: 6, interactive: true, points: false, nut: 0.028, pad: 0.09 });
        bd.el.addEventListener('click', function (e) {
            const h = e.target.closest ? e.target.closest('.fb2-hot') : null;
            if (!h) return;
            const row = parseInt(h.dataset.row, 10);
            const f = parseInt(h.dataset.fret, 10);
            if (isNaN(row) || isNaN(f)) return;
            playNote(openMidi(row) + f);
        });
    }

    // Idempotent: builds the DOM once, then just re-renders.
    function init() {
        if (!build()) return;
        if (!bd) makeBoard();
        render();
    }

    // ---------- public lists + programmatic control ----------

    // The manager reuses these lists, so both sides always agree.
    const OPTIONS = {
        roots: NOTE.map(function (n, i) { return { value: String(i), label: n }; }),
        groups: [
            { label: 'Scales', items: Object.keys(SCALES).map(function (k) { return { value: 'scale|' + k, label: k }; }) },
            { label: 'Chords (CAGED)', items: Object.keys(CHORDS).map(function (k) { return { value: 'chord|' + k, label: CHORDS[k].label }; }) },
            { label: 'Arpeggios', items: Object.keys(CHORDS).map(function (k) { return { value: 'arp|' + k, label: 'Arp \u00b7 ' + CHORDS[k].label }; }) }
        ]
    };

    function typeExists(kind, type) {
        return (kind === 'scale')
            ? Object.prototype.hasOwnProperty.call(SCALES, type)
            : Object.prototype.hasOwnProperty.call(CHORDS, type);
    }

    // Applies { kind, type, root } programmatically (exercise resources).
    function apply(cfg) {
        if (!cfg) return;
        const kind = (cfg.kind === 'chord' || cfg.kind === 'arp' || cfg.kind === 'scale') ? cfg.kind : state.kind;
        let type = state.type;
        if (cfg.type && typeExists(kind, cfg.type)) type = cfg.type;
        else if (!typeExists(kind, type)) type = (kind === 'scale') ? Object.keys(SCALES)[0] : Object.keys(CHORDS)[0];
        const n = parseInt(cfg.root, 10);

        state.kind = kind;
        state.type = type;
        if (!isNaN(n)) state.root = Math.max(0, Math.min(NOTE.length - 1, n));
        state.shape = 0;
        saveState();
        if (!built) return;

        if (rootSel) rootSel.value = String(state.root);
        if (typeSel) typeSel.value = state.kind + '|' + state.type;
        refreshChordLabels();
        render();
    }

    GPH.theory = { init: init, render: render, apply: apply, OPTIONS: OPTIONS, FRETS: THEORY_FRETS };
})(window.GPH = window.GPH || {});


