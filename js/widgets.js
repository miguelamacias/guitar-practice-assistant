// HTML widgets (metronome, drums, notes, delay, song info, chord transposer) + initializers.
(function (GPH) {
    'use strict';

    // Icons are optional here: the widget still renders if icons.js is missing.
    function icon(name) {
        return (GPH.icons && GPH.icons.get) ? GPH.icons.get(name) : '';
    }

    const METRONOME_HTML = `
        <div class="metronome-box" tabindex="0" id="metronomeBox">
            <div class="metro-bpm-display" title="Click to tap tempo - arrow keys change BPM"><span id="bpmVal">120</span> <small class="bpm-unit">BPM</small></div>
            <div id="metroBeats" class="metro-beats"></div>
            <input type="range" id="bpmSlider" class="metro-slider" min="40" max="240" value="120">
            <div class="metro-flags">
                <select id="metroSig" class="metro-select" title="Time signature: the first beat is accented">
                    <option value="4/4">4/4</option>
                    <option value="3/4">3/4</option>
                    <option value="2/4">2/4</option>
                    <option value="6/8">6/8</option>
                </select>
                <div id="metroPattern" class="metro-patterns" role="group" aria-label="Click pattern">
                    <button type="button" class="metro-pattern-btn" data-pattern="1" title="Quarter notes" aria-label="Quarter notes" aria-pressed="false">${icon('note-quarter')}</button>
                    <button type="button" class="metro-pattern-btn" data-pattern="2" title="Eighth notes" aria-label="Eighth notes" aria-pressed="false">${icon('note-eighths')}</button>
                    <button type="button" class="metro-pattern-btn" data-pattern="4" title="Sixteenth notes" aria-label="Sixteenth notes" aria-pressed="false">${icon('note-sixteenths')}</button>
                    <button type="button" class="metro-pattern-btn" data-pattern="3" title="Eighth-note triplets" aria-label="Eighth-note triplets" aria-pressed="false">${icon('note-triplets')}</button>
                    <button type="button" class="metro-pattern-btn" data-pattern="shuffle" title="Shuffle (swing eighths)" aria-label="Shuffle, swing eighths" aria-pressed="false">${icon('note-shuffle')}</button>
                </div>
                <span class="metro-flag-sep" aria-hidden="true"></span>
                <button type="button" id="metroAccentBtn" class="metro-pattern-btn metro-accent-btn" title="Accent on beat 1: on" aria-label="Accent on beat 1" aria-pressed="true">${icon('accent-one')}</button>
            </div>
            <div class="metro-controls">
                <button class="metro-btn" data-metro-adjust="-5">-5</button>
                <button class="metro-btn" data-metro-adjust="-1">-1</button>
                <button id="metroPlayBtn" class="metro-play-btn">\u25B6 Play</button>
                <button class="metro-btn" data-metro-adjust="1">+1</button>
                <button class="metro-btn" data-metro-adjust="5">+5</button>
            </div>
        </div>`;

    const DRUM_HTML = `
        <div class="metronome-box" tabindex="0" id="drumMachineBox">
            <div class="drum-topbar">
                <div class="metro-bpm-display drum-bpm" title="Click to tap tempo - arrow keys change BPM"><span id="drumBpmVal">120</span> <small class="bpm-unit">BPM</small></div>
                <div class="drum-style-group">
                    <select id="drumStyleSel" class="drum-style-sel" title="Pattern preset">
                        <option value="custom">Custom</option>
                    </select>
                    <button id="drumResBtn" class="metro-btn drum-res-btn" title="Grid resolution: eighth / sixteenth notes">8ths</button>
                </div>
                <div class="drum-adjust-group">
                    <button class="metro-btn drum-adjust--wide" data-drum-adjust="-5">-5</button>
                    <button class="metro-btn drum-adjust" data-drum-adjust="-1">-1</button>
                    <button id="drumPlayBtn" class="metro-play-btn drum-play">\u25B6 Play</button>
                    <button class="metro-btn drum-adjust" data-drum-adjust="1">+1</button>
                    <button class="metro-btn drum-adjust--wide" data-drum-adjust="5">+5</button>
                </div>
            </div>
            <input type="range" id="drumBpmSlider" class="metro-slider" min="40" max="240" value="120">
            <div id="drumGridContainer" class="drum-grid-container"></div>
            <div class="drum-bottombar">
                <button class="metro-btn drum-sig-btn" id="timeSigBtn">Time Signature: 4/4</button>
                <div class="drum-swing">
                    <span class="drum-swing-label">Swing:</span>
                    <button id="swingToggleBtn" class="metro-btn drum-swing-btn">OFF</button>
                </div>
                <div class="drum-act-group">
                    <button class="metro-btn drum-reset-btn" id="drumResetBtn" title="Reset">\uD83D\uDD04</button>
                    <button class="metro-btn drum-clear-btn" id="drumClearBtn" title="Clear">\uD83D\uDDD1</button>
                </div>
            </div>
        </div>`;

    const NOTES_HTML = `
        <div class="notes-widget">
            <textarea class="notes-textarea" placeholder="Quick notes..."></textarea>
            <div class="notes-hint">Auto-saved</div>
        </div>`;

    const DELAY_HTML = `
        <div class="delay-widget">
            <div class="delay-controls">
                <label>BPM</label>
                <input type="number" class="delay-bpm" min="20" max="300" step="1" value="120">
            </div>
            <div class="delay-table-wrap">
                <table class="delay-table">
                    <thead><tr><th>Note</th><th>Straight</th><th>Dotted</th><th>Triplet</th></tr></thead>
                    <tbody class="delay-rows"></tbody>
                </table>
            </div>
        </div>`;

    const NOTES_SETTINGS_KEY = 'quick_notes';
    function initNotesWidget(content) {
        const ta = content.querySelector('.notes-textarea');
        if (!ta) return;

        // Loads from the DB (localStorage as instant fallback)
        GPH.settings.get(NOTES_SETTINGS_KEY)
            .then(function (dbVal) {
                const v = (typeof dbVal === 'string') ? dbVal : '';
                let localVal = '';
                try { localVal = localStorage.getItem('gph_quick_notes') || ''; } catch (e) {}
                if (!ta.value) ta.value = v || localVal;
                // Migration: if the DB was empty but there were local notes, upload them
                if (!v && localVal) GPH.settings.set(NOTES_SETTINGS_KEY, localVal).catch(function () {});
            })
            .catch(function () {
                if (!ta.value) { try { ta.value = localStorage.getItem('gph_quick_notes') || ''; } catch (e) {} }
            });

        let saveTimer = null;
        ta.addEventListener('input', function () {
            try { localStorage.setItem('gph_quick_notes', ta.value); } catch (e) {}
            clearTimeout(saveTimer);
            saveTimer = setTimeout(function () {
                GPH.settings.set(NOTES_SETTINGS_KEY, ta.value).catch(function () {});
            }, 400);
        });
    }

    function noteIcon(filled, flags, hasStem) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('class', 'note-icon');
        svg.setAttribute('aria-hidden', 'true');
        const head = document.createElementNS(svgNS, 'ellipse');
        head.setAttribute('cx', '8'); head.setAttribute('cy', '18.6');
        head.setAttribute('rx', '5'); head.setAttribute('ry', '3.5');
        head.setAttribute('transform', 'rotate(-22 8 18.6)');
        if (filled) {
            head.setAttribute('fill', 'currentColor');
        } else {
            head.setAttribute('fill', 'none');
            head.setAttribute('stroke', 'currentColor');
            head.setAttribute('stroke-width', '1.8');
        }
        svg.appendChild(head);
        if (hasStem) {
            const stem = document.createElementNS(svgNS, 'rect');
            stem.setAttribute('x', '12'); stem.setAttribute('y', '3');
            stem.setAttribute('width', '1.7'); stem.setAttribute('height', '15.6');
            stem.setAttribute('fill', 'currentColor');
            svg.appendChild(stem);
            for (let i = 0; i < flags; i++) {
                const y0 = 3 + i * 4.3;
                const p = document.createElementNS(svgNS, 'path');
                p.setAttribute('d', 'M13.7 ' + y0 + ' q 5.4 1.7 4.3 6.6 q -0.7 -3.4 -4.3 -4.4 z');
                p.setAttribute('fill', 'currentColor');
                svg.appendChild(p);
            }
        }
        return svg;
    }

    function initDelayWidget(content) {
        const input = content.querySelector('.delay-bpm');
        const tbody = content.querySelector('.delay-rows');
        if (!input || !tbody) return;
        const notes = [
            { label: '1/1', units: 4, filled: false, flags: 0, stem: false },
            { label: '1/2', units: 2, filled: false, flags: 0, stem: true },
            { label: '1/4', units: 1, filled: true, flags: 0, stem: true },
            { label: '1/8', units: 0.5, filled: true, flags: 1, stem: true },
            { label: '1/16', units: 0.25, filled: true, flags: 2, stem: true },
            { label: '1/32', units: 0.125, filled: true, flags: 3, stem: true }
        ];
        function render() {
            let bpm = parseInt(input.value, 10);
            if (!bpm || bpm < 20) bpm = 20;
            if (bpm > 300) bpm = 300;
            const quarter = 60000 / bpm;
            tbody.innerHTML = '';
            notes.forEach(function (n) {
                const base = quarter * n.units;
                const tr = document.createElement('tr');
                const tdN = document.createElement('td'); tdN.className = 'delay-note';
                tdN.appendChild(noteIcon(n.filled, n.flags, n.stem));
                tdN.appendChild(document.createTextNode(' ' + n.label));
                const tdS = document.createElement('td'); tdS.textContent = Math.round(base) + ' ms';
                const tdD = document.createElement('td'); tdD.textContent = Math.round(base * 1.5) + ' ms';
                const tdT = document.createElement('td'); tdT.textContent = Math.round(base * 2 / 3) + ' ms';
                tr.appendChild(tdN); tr.appendChild(tdS); tr.appendChild(tdD); tr.appendChild(tdT);
                tbody.appendChild(tr);
            });
        }
        try { const saved = parseInt(localStorage.getItem('gph_delay_bpm'), 10); if (saved >= 20 && saved <= 300) input.value = saved; } catch (e) {}
        input.addEventListener('input', function () {
            render();
            try { localStorage.setItem('gph_delay_bpm', String(input.value)); } catch (e) {}
        });
        render();
    }

    // ---- Song Info (BPM/Key) — proxy local /api/song/* (FreqBlog) ----
    function initSongWidget(content) {
        const input = content.querySelector('.song-input');
        const goBtn = content.querySelector('.song-go');
        const candsEl = content.querySelector('.song-candidates');
        const resEl = content.querySelector('.song-result');
        const matchedEl = content.querySelector('.song-matched');
        const bpmEl = content.querySelector('.song-bpm');
        const keyEl = content.querySelector('.song-key');
        const halfBtn = content.querySelector('.song-half');
        const doubleBtn = content.querySelector('.song-double');
        const applyBtn = content.querySelector('.song-apply');
        const msgEl = content.querySelector('.song-msg');
        if (!input || !goBtn || !resEl) return;

        // "Title - Artist" -> {track, artist}. Prefers the dash with spaces.
        function splitTitleArtist(q) {
            const s = String(q || '').trim();
            let m = s.split(/\s+[-\u2013\u2014]\s+/);
            if (m.length >= 2) {
                return { track: m[0].trim(), artist: m.slice(1).join(' ').trim() };
            }
            const i = s.indexOf('-');
            if (i > 1 && i < s.length - 1) {
                return { track: s.slice(0, i).trim(), artist: s.slice(i + 1).trim() };
            }
            return null;
        }

        let shownBpm = null;
        let pollTimer = null;
        let busy = false;

        function msg(text, isErr) {
            if (!msgEl) return;
            msgEl.textContent = text || '';
            msgEl.className = 'song-msg' + (isErr ? ' err' : '');
        }
        function setBpm(v) {
            shownBpm = (v == null || isNaN(v)) ? null : Math.round(v);
            if (bpmEl) bpmEl.textContent = (shownBpm == null) ? '--' : String(shownBpm);
        }
        function setKey(d) {
            if (!keyEl) return;
            const k = (d && d.key) || '';
            const conf = d && d.key_confidence;
            const hasConf = (typeof conf === 'number' && isFinite(conf));
            const low = hasConf && conf < 0.8;
            keyEl.textContent = k || '\u2014';
            keyEl.classList.toggle('is-low', !!low);
            // Tooltip: only when there is a key, so the help cursor is never a lie.
            if (!k) {
                keyEl.removeAttribute('title');
            } else if (low) {
                keyEl.title = 'Low confidence (' + Math.round(conf * 100) + '%) \u2014 may be another key; check it by ear';
            } else if (hasConf) {
                keyEl.title = 'Key detected from the audio \u00b7 confidence ' + Math.round(conf * 100) + '%';
            } else {
                keyEl.title = 'Key detected from the audio analysis (FreqBlog)';
            }
        }
        function showResult(d) {
            resEl.hidden = false;
            const m = d.matched || {};
            const bits = [];
            if (m.track) bits.push(m.track);
            if (m.artist) bits.push(m.artist);
            if (m.album) bits.push(m.album);
            if (matchedEl) matchedEl.textContent = bits.join(' — ') + (d.cached ? '  ·  cached' : '');
            setBpm(d.bpm);
            setKey(d);
            msg('');
        }
        function renderCandidates(list) {
            if (!candsEl) return;
            candsEl.innerHTML = '';
            if (!list.length) {
                candsEl.hidden = true;
                const parts = splitTitleArtist(input.value);
                if (parts && parts.track && parts.artist) {
                    msg('Not in the catalogue — analysing “' + parts.track + '” by “' + parts.artist + '” (~15 s)…');
                    loadInfo({ track: parts.track, artist: parts.artist, isrc: '' }, 0);
                } else {
                    msg('Song not found — search as “Title - Artist” to analyse it', true);
                }
                return;
            }
            candsEl.hidden = false;
            list.forEach(function (c) {
                const b = document.createElement('button');
                b.className = 'metro-btn song-cand';
                b.textContent = c.track + (c.artist ? ' — ' + c.artist : '') + (c.album ? '  ·  ' + c.album : '');
                b.addEventListener('click', function () { loadInfo(c, 0); });
                candsEl.appendChild(b);
            });
        }
        function fail(res, what) {
            const d = res.d || {};
            if (res.status === 400 && d.error === 'no_api_key') return msg('Set your FreqBlog API key in Manager → Settings', true);
            if (res.status === 401) return msg('Invalid API key (check Manager → Settings)', true);
            if (res.status === 429) return msg('Rate limit — retry in ' + (d.retry_after || 2) + ' s', true);
            if (res.status === 404) return msg('Not available: no streaming audio to analyse', true);
            msg((what || 'Error') + ': ' + (d.detail || d.error || d.status || res.status), true);
        }
        function search() {
            const q = input.value.trim();
            if (!q || busy) return;
            busy = true;
            clearTimeout(pollTimer);
            if (candsEl) candsEl.hidden = true;
            resEl.hidden = true;
            msg('Searching…');
            try { localStorage.setItem('gph_song_query', q); } catch (e) {}
            fetch('/api/song/search?q=' + encodeURIComponent(q))
                .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
                .then(function (res) {
                    busy = false;
                    if (res.status !== 200) return fail(res, 'Search failed');
                    const list = (res.d && res.d.candidates) || [];
                    renderCandidates(list);
                    if (list.length === 1) loadInfo(list[0], 0);
                    else if (list.length > 1) msg('Pick the right song:');
                })
                .catch(function () { busy = false; msg('No connection (offline?)', true); });
        }
        function loadInfo(c, attempt) {
            clearTimeout(pollTimer);
            if (candsEl) candsEl.hidden = true;
            resEl.hidden = true;
            msg(attempt ? 'Analysing… (~15 s, retrying)' : 'Loading…');
            const qs = [];
            if (c.isrc) qs.push('isrc=' + encodeURIComponent(c.isrc));
            if (c.track) qs.push('track=' + encodeURIComponent(c.track));
            if (c.artist) qs.push('artist=' + encodeURIComponent(c.artist));
            fetch('/api/song/info?' + qs.join('&'))
                .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
                .then(function (res) {
                    const d = res.d || {};
                    if (res.status === 200 && d.status === 'ok') return showResult(d);
                    if (res.status === 202 || d.status === 'pending') {
                        if (attempt < 4) {
                            msg('Analysing… retrying in a few seconds');
                            pollTimer = setTimeout(function () { loadInfo(c, attempt + 1); }, (d.retry_after || 3) * 1000);
                        } else {
                            msg('Still analysing — try again in a minute', true);
                        }
                        return;
                    }
                    fail(res, 'Lookup failed');
                })
                .catch(function () { msg('No connection (offline?)', true); });
        }
        function applyBpm() {
            if (shownBpm == null) return;
            const v = Math.max(40, Math.min(240, Math.round(shownBpm)));
            const done = [];
            const missing = [];
            if (document.getElementById('metronomeBox') && GPH.metronome && GPH.metronome.updateBpm) {
                GPH.metronome.updateBpm(v);
                done.push('metronome');
            } else { missing.push('metronome'); }
            if (document.getElementById('drumMachineBox') && GPH.drumMachine && GPH.drumMachine.updateDrumBpm) {
                GPH.drumMachine.updateDrumBpm(v);
                done.push('drums');
            } else { missing.push('drums'); }
            if (!done.length) { msg('Neither the metronome nor the drums are on this page', true); return; }
            let text = 'BPM ' + v + ' applied to ' + done.join(' & ');
            if (v !== Math.round(shownBpm)) text += ' (clamped to 40–240)';
            if (missing.length) text += ' · ' + missing.join(' & ') + ' not on this page';
            msg(text);
        }

        goBtn.addEventListener('click', search);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); search(); }
        });
        if (doubleBtn) doubleBtn.addEventListener('click', function () { if (shownBpm) setBpm(Math.min(480, shownBpm * 2)); });
        if (halfBtn) halfBtn.addEventListener('click', function () { if (shownBpm) setBpm(Math.max(20, shownBpm / 2)); });
        if (applyBtn) applyBtn.addEventListener('click', applyBpm);
        try {
            const last = localStorage.getItem('gph_song_query');
            if (last && !input.value) input.value = last;
        } catch (e) {}
    }

    const SONG_HTML = `
        <div class="song-widget">
            <div class="song-search">
                <input type="text" class="song-input" placeholder="Song name, artist… (whatever you like)">
                <button class="metro-btn song-go">Search</button>
            </div>
            <div class="song-msg"></div>
            <div class="song-candidates" hidden></div>
            <div class="song-result" hidden>
                <div class="song-matched"></div>
                <div class="song-numbers">
                    <div class="song-bpm-box">
                        <span class="song-bpm">--</span><span class="song-bpm-unit">BPM</span>
                        <div class="song-tools">
                            <button class="metro-btn song-half" title="Halve the BPM (half-time feel)">&divide;2</button>
                            <button class="metro-btn song-double" title="Double the BPM (double-time feel)">&times;2</button>
                        </div>
                    </div>
                    <div class="song-key-box">
                        <span class="song-key">--</span><span class="song-key-unit">key</span>
                    </div>
                </div>
                <button class="metro-btn song-apply">Apply to metronome &amp; drums</button>
            </div>
            <div class="song-foot">Audio analysis by FreqBlog</div>
        </div>`;

    const TRANSPOSER_HTML = `
        <div class="transposer-widget">
            <div class="transposer-top">
                <div class="transposer-controls" role="group" aria-label="Transpose semitones">
                    <button type="button" class="metro-btn transpose-step" data-transpose="-12" title="Down an octave">&minus;12</button>
                    <button type="button" class="metro-btn transpose-step" data-transpose="-1" title="Down one semitone">&minus;1</button>
                    <span id="transposeVal" class="transpose-val" aria-live="polite">0</span>
                    <button type="button" class="metro-btn transpose-step" data-transpose="1" title="Up one semitone">+1</button>
                    <button type="button" class="metro-btn transpose-step" data-transpose="12" title="Up an octave">+12</button>
                </div>
                <button type="button" id="transposeReset" class="metro-btn transpose-reset" title="Back to the original chords">Reset</button>
            </div>
            <div class="transposer-panes">
                <label class="transposer-pane" for="transposeInput">
                    <span class="transposer-label">Chords</span>
                    <textarea id="transposeInput" class="transpose-input" rows="4" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="G# C#m D#7"></textarea>
                </label>
                <label class="transposer-pane" for="transposeOutput">
                    <span class="transposer-label">Transposed</span>
                    <textarea id="transposeOutput" class="transpose-output" rows="4" readonly spellcheck="false" placeholder="—"></textarea>
                </label>
            </div>
            <div class="transposer-hint">Tip: one line per section (Verse, Chorus…) is fine.</div>
            <div id="transposeCapo" class="transposer-capo" aria-live="polite">Enter chords to transpose.</div>
            <div id="transposeBest" class="transposer-best" aria-live="polite" hidden></div>
        </div>`;

    // ---- Chord transposer ---------------------------------------------------
    const NOTE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const NOTE_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const NOTE_INDEX = {};
    NOTE_SHARP.forEach(function (n, i) { NOTE_INDEX[n] = i; });
    NOTE_FLAT.forEach(function (n, i) { NOTE_INDEX[n] = i; });
    NOTE_INDEX.Cb = 11;
    NOTE_INDEX['B#'] = 0;
    NOTE_INDEX['E#'] = 5;
    NOTE_INDEX.Fb = 4;
    const CHORD_RE = /^([A-Ga-g])([#b]?)(.*?)(?:\/([A-Ga-g])([#b]?))?$/;
    // Accept real chord qualities (maj7, m7b5, 7(b9), add9, 6/9...) but reject
    // section labels such as "Chorus" or "Bridge" that happen to start with A-G.
    const QUALITY_RE = /^(?:(?:maj(?:or)?|min(?:or)?|mi|m|M|dim|aug|sus|add|no|dom|°|º|ø|\+|-)?(?:[0-9]|1[0-3])*(?:[#b][0-9]+)*(?:sus[24]|add[0-9]+|no[0-9]+)?(?:\([^)]*\))?(?:\/[0-9]+)?)?$/i;
    const FLAT_KEY_PCS = [1, 3, 5, 8, 10];      // Db, Eb, F, Ab, Bb
    const SHARP_KEY_PCS = [2, 4, 6, 7, 9, 11];   // D, E, F#, G, A, B

    function noteIndex(name) {
        return Object.prototype.hasOwnProperty.call(NOTE_INDEX, name) ? NOTE_INDEX[name] : -1;
    }

    function noteName(index, flats) {
        return (flats ? NOTE_FLAT : NOTE_SHARP)[(index % 12 + 12) % 12];
    }

    function parseChord(token) {
        const text = String(token || '').replace(/\u266f/g, '#').replace(/\u266d/g, 'b');
        const m = CHORD_RE.exec(text);
        if (!m) return null;
        const root = m[1].toUpperCase() + m[2];
        const bass = m[4] ? m[4].toUpperCase() + m[5] : '';
        if (!QUALITY_RE.test(m[3] || '')) return null;
        if (noteIndex(root) < 0 || (bass && noteIndex(bass) < 0)) return null;
        return { root: root, suffix: m[3] || '', bass: bass };
    }

    // The first chord usually carries the key context. Use it to choose
    // between sharp and flat spellings for the transposed root; when it is
    // ambiguous, preserve the accidental style already present in the input.
    function preferFlats(text, firstRootPc, semitones) {
        if (firstRootPc >= 0) {
            const pc = ((firstRootPc + semitones) % 12 + 12) % 12;
            if (FLAT_KEY_PCS.indexOf(pc) >= 0) return true;
            if (SHARP_KEY_PCS.indexOf(pc) >= 0) return false;
        }
        const flats = (text.match(/[A-Ga-g]b/g) || []).length;
        const sharps = (text.match(/[A-Ga-g]#/g) || []).length;
        return flats > sharps;
    }

    function transposeChord(chord, semitones, flats) {
        const root = noteName(noteIndex(chord.root) + semitones, flats);
        const bass = chord.bass ? '/' + noteName(noteIndex(chord.bass) + semitones, flats) : '';
        return root + chord.suffix + bass;
    }

    function transposeText(text, semitones) {
        const src = String(text || '');
        if (!src || semitones === 0) return src;
        const parts = src.split(/(\s+|[|,;])/);
        const parsed = parts.map(parseChord);
        let firstRoot = -1;
        for (let i = 0; i < parsed.length; i++) {
            if (parsed[i]) { firstRoot = noteIndex(parsed[i].root); break; }
        }
        const flats = preferFlats(src, firstRoot, semitones);
        return parts.map(function (part, i) {
            return parsed[i] ? transposeChord(parsed[i], semitones, flats) : part;
        }).join('');
    }

    function transposeLabel(n) {
        return n > 0 ? '+' + n : String(n);
    }

    // Common open-position chords in standard tuning. Only exact open shapes
    // count; the goal is to find a capo that removes barre chords, not one that
    // merely lowers the fret number of a barre.
    const OPEN_CHORDS = {};
    [
        'C', 'D', 'E', 'G', 'A',
        'Am', 'Dm', 'Em',
        'A7', 'B7', 'C7', 'D7', 'E7', 'G7',
        'Am7', 'Dm7', 'Em7',
        'Cmaj7', 'Emaj7', 'Gmaj7', 'Amaj7',
        'Asus2', 'Asus4', 'Dsus2', 'Dsus4', 'Esus4', 'Gsus4',
        'Cadd9', 'Gadd9',
        'C6', 'D6', 'E6', 'G6'
    ].forEach(function (name) { OPEN_CHORDS[name] = true; });

    function chordKey(shape) {
        const chord = parseChord(shape);
        if (!chord) return '';
        let q = chord.suffix;
        if (q === 'M' || q === 'maj' || q === 'major' || !q) q = '';
        else if (q === 'M7' || q === 'maj7' || q === 'Δ7') q = 'maj7';
        else if (q === 'm' || q === 'min' || q === 'mi' || q === '-') q = 'm';
        else if (q === 'm7' || q === 'min7' || q === 'mi7' || q === '-7') q = 'm7';
        else q = q.toLowerCase();
        return chord.root + q;
    }

    // 1.0 = open, 0.6 = gateway barre (F/Bm), 0.7 = easy substitute,
    // 0.25 = other common barre. Everything else is 0.
    const FRIENDLY_WEIGHTS = {
        'F': 0.6, 'Bm': 0.6,
        'Fmaj7': 0.7, 'Bm7': 0.7,
        'B': 0.25, 'Bb': 0.25, 'F#': 0.25,
        'F#m': 0.25, 'C#m': 0.25, 'Gm': 0.25
    };

    function chordWeight(key) {
        if (!key) return 0;
        return OPEN_CHORDS[key] ? 1 : (FRIENDLY_WEIGHTS[key] || 0);
    }

    function findBestCapo(text) {
        const src = String(text || '');
        const parts = src.split(/(\s+|[|,;])/);
        const chords = parts.map(parseChord).filter(Boolean);
        if (!chords.length) return null;
        const firstRoot = noteIndex(chords[0].root);
        let best = null;
        // Common capo range; 0 means "no capo". A tiny capo penalty prefers a
        // lower, more comfortable fret when the chord scores are very close.
        for (let capo = 0; capo <= 7; capo++) {
            const flats = preferFlats(src, firstRoot, -capo);
            let score = 0;
            let openCount = 0;
            const openChords = [];
            const easyChords = [];
            chords.forEach(function (chord) {
                const shape = transposeChord(chord, -capo, flats);
                const key = chordKey(shape);
                const weight = chordWeight(key);
                if (!weight) return;
                score += weight;
                if (weight >= 1) {
                    openCount++;
                    if (openChords.indexOf(shape) < 0) openChords.push(shape);
                } else if (easyChords.indexOf(shape) < 0) {
                    easyChords.push(shape);
                }
            });
            const adjusted = score - capo * 0.03;
            if (!best || adjusted > best.adjusted + 1e-9 ||
                (Math.abs(adjusted - best.adjusted) < 1e-9 && capo < best.capo)) {
                best = {
                    capo: capo, score: Math.round(score * 10) / 10,
                    adjusted: adjusted, openCount: openCount, total: chords.length,
                    openChords: openChords, easyChords: easyChords
                };
            }
        }
        return best;
    }

    function initTransposerWidget(content) {
        const input = content.querySelector('.transpose-input');
        const output = content.querySelector('.transpose-output');
        const value = content.querySelector('#transposeVal');
        const capoEl = content.querySelector('#transposeCapo');
        const bestEl = content.querySelector('#transposeBest');
        const reset = content.querySelector('#transposeReset');
        const stepBtns = content.querySelectorAll('[data-transpose]');
        if (!input || !output || !value || !capoEl) return;

        let semitones = 0;
        try {
            const saved = parseInt(localStorage.getItem('gph_transpose_semitones'), 10);
            if (saved >= -12 && saved <= 12) semitones = saved;
            const savedText = localStorage.getItem('gph_transpose_input');
            if (savedText) input.value = savedText;
        } catch (e) {}

        function updateButtons() {
            stepBtns.forEach(function (btn) {
                const delta = parseInt(btn.dataset.transpose, 10);
                btn.disabled = semitones + delta < -12 || semitones + delta > 12;
            });
        }

        function renderCapo() {
            if (!input.value.trim()) {
                capoEl.textContent = 'Enter chords to transpose.';
                capoEl.classList.add('is-neutral');
                return;
            }
            capoEl.classList.remove('is-neutral');
            if (semitones === 0) {
                capoEl.textContent = 'No capo — these are the original chords.';
                return;
            }
            if (semitones < 0) {
                const fret = Math.abs(semitones) % 12 || 12;
                capoEl.textContent = 'Capo ' + fret + ' — put the capo on fret ' + fret +
                    ' and play these shapes to sound in the original key.';
            } else {
                const fret = (12 - (semitones % 12)) % 12;
                if (!fret) {
                    capoEl.textContent = 'No capo — these shapes sound an octave higher.';
                } else {
                    capoEl.textContent = 'Capo ' + fret + ' — these shapes are ' + semitones +
                        ' semitone' + (semitones === 1 ? '' : 's') +
                        ' higher; use capo ' + fret + ' to return to the original key.';
                }
            }
        }

        function renderBest() {
            if (!bestEl) return;
            const best = findBestCapo(input.value);
            if (!best) {
                bestEl.hidden = true;
                bestEl.textContent = '';
                return;
            }
            bestEl.hidden = false;
            bestEl.innerHTML = '';
            const title = document.createElement('strong');
            title.textContent = best.capo
                ? 'Best friendly capo: ' + best.capo
                : 'Best friendly position: no capo';
            bestEl.appendChild(title);
            const detail = document.createElement('span');
            if (!best.score) {
                detail.textContent = ' — no friendly chords found in this progression.';
            } else {
                let text = best.openCount + '/' + best.total + ' open';
                if (best.openChords.length) text += ': ' + best.openChords.join(' · ');
                if (best.easyChords.length) text += ' + ' + best.easyChords.join(' + ');
                if (best.score < best.total) text += ' (score ' + best.score + '/' + best.total + ')';
                detail.textContent = ' — ' + text;
            }
            bestEl.appendChild(detail);
            bestEl.classList.toggle('is-neutral', !best.score);
            if (best.capo > 0 && best.score > 0) {
                bestEl.appendChild(document.createTextNode(' '));
                const use = document.createElement('button');
                use.type = 'button';
                use.className = 'metro-btn transposer-use-best';
                const applied = semitones === -best.capo;
                use.textContent = applied ? 'Applied' : 'Use capo ' + best.capo;
                use.disabled = applied;
                use.addEventListener('click', function () {
                    semitones = -best.capo;
                    render();
                });
                bestEl.appendChild(use);
            }
        }

        function render() {
            value.textContent = transposeLabel(semitones);
            output.value = transposeText(input.value, semitones);
            renderCapo();
            renderBest();
            updateButtons();
            try {
                localStorage.setItem('gph_transpose_semitones', String(semitones));
                localStorage.setItem('gph_transpose_input', input.value);
            } catch (e) {}
        }

        stepBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                semitones = Math.max(-12, Math.min(12, semitones + parseInt(btn.dataset.transpose, 10)));
                render();
            });
        });
        if (reset) reset.addEventListener('click', function () { semitones = 0; render(); });
        input.addEventListener('input', render);
        render();
    }

    GPH.widgets = {
        METRONOME_HTML: METRONOME_HTML, DRUM_HTML: DRUM_HTML,
        NOTES_HTML: NOTES_HTML, DELAY_HTML: DELAY_HTML, SONG_HTML: SONG_HTML,
        TRANSPOSER_HTML: TRANSPOSER_HTML,
        initNotes: initNotesWidget, initDelay: initDelayWidget, initSong: initSongWidget,
        initTransposer: initTransposerWidget
    };
})(window.GPH = window.GPH || {});
