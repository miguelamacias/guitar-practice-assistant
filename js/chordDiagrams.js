// Chord Diagrams Library: shows JPG chord diagrams from the /chords folder
(function (GPH) {
    'use strict';

    const ROOTS = [
        { label: 'C', value: 'C' },
        { label: 'C# / Db', value: 'Cs', alt: 'Db' },
        { label: 'D', value: 'D' },
        { label: 'D# / Eb', value: 'Ds', alt: 'Eb' },
        { label: 'E', value: 'E' },
        { label: 'F', value: 'F' },
        { label: 'F# / Gb', value: 'Fs', alt: 'Gb' },
        { label: 'G', value: 'G' },
        { label: 'G# / Ab', value: 'Gs', alt: 'Ab' },
        { label: 'A', value: 'A' },
        { label: 'A# / Bb', value: 'As', alt: 'Bb' },
        { label: 'B', value: 'B' }
    ];

    const QUALITIES = [
        { code: 'c00', label: 'Major', suffix: '_' },
        { code: 'c01', label: 'Minor', suffix: '_m' },
        { code: 'c02', label: 'Flat 5 (b5)', suffix: '_b5' },
        { code: 'c03', label: 'Add 9', suffix: '_add_9' },
        { code: 'c04', label: 'Power Chord (5)', suffix: '_5' },
        { code: 'c05', label: 'Sus4', suffix: '_sus' },
        { code: 'c06', label: 'Augmented (Aug)', suffix: '_aug' },
        { code: 'c07', label: 'Diminished (°)', suffix: '_o' },
        { code: 'c08', label: '6th', suffix: '_6' },
        { code: 'c09', label: '6/9', suffix: '_6_9' },
        { code: 'c10', label: 'Minor 6/9', suffix: '_m6_9' },
        { code: 'c11', label: 'Minor 6', suffix: '_m6' },
        { code: 'c12', label: 'Dominant 7 (7)', suffix: '_7' },
        { code: 'c13', label: '7 Sus', suffix: '_7sus' },
        { code: 'c14', label: 'Minor 7 (m7)', suffix: '_m7' },
        { code: 'c15', label: 'Half-diminished (m7b5)', suffix: '_m7b5' },
        { code: 'c16', label: '7 Augmented (7aug)', suffix: '_7aug' },
        { code: 'c17', label: '7 Flat 5 (7b5)', suffix: '_7b5' },
        { code: 'c18', label: 'Major 7 (maj7)', suffix: '_maj7' },
        { code: 'c19', label: 'Major 7 b5 (maj7b5)', suffix: '_maj7b5' },
        { code: 'c20', label: 'Minor-Major 7 (mmaj7)', suffix: '_mmaj7' },
        { code: 'c21', label: '7 Flat 9 (7b9)', suffix: '_7b9' },
        { code: 'c22', label: '7 Sharp 9 (7#9)', suffix: '_7s9' },
        { code: 'c23', label: '7 Aug b9 (7augb9)', suffix: '_7augb9' },
        { code: 'c24', label: 'Minor 9 (m9)', suffix: '_m9' },
        { code: 'c25', label: 'Dominant 9 (9)', suffix: '_9' },
        { code: 'c26', label: '9 Augmented (9aug)', suffix: '_9aug' },
        { code: 'c27', label: '9 Flat 5 (9b5)', suffix: '_9b5' },
        { code: 'c28', label: 'Major 9 (maj9)', suffix: '_maj9' },
        { code: 'c29', label: '9 Sharp 11 (9#11)', suffix: '_9s11' },
        { code: 'c30', label: 'Minor 9 Major 7 (m9maj7)', suffix: '_m9maj7' },
        { code: 'c31', label: '11th (11)', suffix: '_11' },
        { code: 'c32', label: 'Minor 11 (m11)', suffix: '_m11' },
        { code: 'c33', label: '13th (13)', suffix: '_13' },
        { code: 'c34', label: '13 Flat 9 (13b9)', suffix: '_13b9' }
    ];

    function addOpt(sel, val, text) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = text;
        sel.appendChild(opt);
    }

    function mount(rootEl) {
        if (!rootEl) return;
        const panel = (rootEl.id === 'chordDiagramsPanel') ? rootEl : rootEl.querySelector('#chordDiagramsPanel');
        if (!panel || panel.dataset.ready === '1') return;
        
        const rootSel = panel.querySelector('.diag-root');
        const qualSel = panel.querySelector('.diag-quality');
        const imgEl = panel.querySelector('.chord-diag-img');
        const msgEl = panel.querySelector('.chord-diag-msg');
        if (!rootSel || !qualSel || !imgEl || !msgEl) return;
        
        panel.dataset.ready = '1';

        ROOTS.forEach(r => addOpt(rootSel, r.value, r.label));
        QUALITIES.forEach(q => addOpt(qualSel, q.code, q.label));

        const SAVED_KEY = 'gph_chord_diagrams_state';
        try {
            const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
            if (saved.root) rootSel.value = saved.root;
            if (saved.quality) qualSel.value = saved.quality;
        } catch (e) {}

        function updateDiagram() {
            const root = rootSel.value;
            const qualCode = qualSel.value;
            const qualObj = QUALITIES.find(q => q.code === qualCode) || QUALITIES[0];
            const rObj = ROOTS.find(r => r.value === root) || ROOTS[0];
            
            const filenames = [
                `./chords/${qualCode}_${rObj.value}${qualObj.suffix}.jpg`
            ];
            if (rObj.alt) {
                filenames.push(`./chords/${qualCode}_${rObj.alt}_${qualObj.suffix}.jpg`);
            }

            try {
                localStorage.setItem(SAVED_KEY, JSON.stringify({ root: root, quality: qualCode }));
            } catch (e) {}

            let idx = 0;
            function tryLoad() {
                if (idx >= filenames.length) {
                    imgEl.hidden = true;
                    msgEl.hidden = false;
                    msgEl.textContent = `Diagram not found for ${rObj.label} ${qualObj.label}`;
                    return;
                }
                const url = filenames[idx];
                imgEl.onload = function() {
                    imgEl.hidden = false;
                    msgEl.hidden = true;
                };
                imgEl.onerror = function() {
                    idx++;
                    tryLoad();
                };
                imgEl.src = url;
            }
            tryLoad();
        }

        rootSel.addEventListener('change', updateDiagram);
        qualSel.addEventListener('change', updateDiagram);

        updateDiagram();

        // Exposed so an exercise resource can drive the panel.
        api = function (st) {
            if (!st) return;
            if (st.root != null && ROOTS.some(function (r) { return r.value === String(st.root); })) rootSel.value = String(st.root);
            if (st.quality && QUALITIES.some(function (q) { return q.code === String(st.quality); })) qualSel.value = String(st.quality);
            updateDiagram();
        };
        if (pendingState) { api(pendingState); pendingState = null; }
    }

    // Programmatic control before/after mounting (used by exercise resources).
    let api = null;
    let pendingState = null;
    function setState(st) {
        if (!st || typeof st !== 'object') return;
        if (!api) { pendingState = Object.assign({}, pendingState || {}, st); return; }
        api(st);
    }

    GPH.chordDiagrams = {
        mount: mount,
        apply: setState,
        ROOTS: ROOTS,
        QUALITIES: QUALITIES
    };
})(window.GPH = window.GPH || {});
