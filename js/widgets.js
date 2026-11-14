// HTML widgets (metronome, drums, notes and delay calculator) + initializers.
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

    GPH.widgets = {
        METRONOME_HTML: METRONOME_HTML, DRUM_HTML: DRUM_HTML,
        NOTES_HTML: NOTES_HTML, DELAY_HTML: DELAY_HTML, SONG_HTML: SONG_HTML,
        initNotes: initNotesWidget, initDelay: initDelayWidget, initSong: initSongWidget
    };
})(window.GPH = window.GPH || {});
