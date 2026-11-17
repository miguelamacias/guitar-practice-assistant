// Fretboard Trainer (fixed section): markup, Identify/Locate modes, heatmap and stats.
(function (GPH) {
    'use strict';

    const FRETBOARD_HTML = `
        <div class="fb">
            <div class="fb-welcome">
                <div class="fb-welcome-title">Fretboard Trainer</div>
                <div class="fb-welcome-sub">Choose a mode and press Play</div>
                <div class="fb-mode-pick">
                    <button class="fb-mode-card active" data-mode="identify">
                        <span class="fb-mc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="3.5"></circle><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"></path></svg></span>
                        <span class="fb-mc-name">Identify</span>
                        <span class="fb-mc-desc">Name the highlighted note</span>
                    </button>
                    <button class="fb-mode-card" data-mode="locate">
                        <span class="fb-mc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5s6.5-6.2 6.5-11a6.5 6.5 0 1 0-13 0c0 4.8 6.5 11 6.5 11z"></path><circle cx="12" cy="10.2" r="2.6"></circle></svg></span>
                        <span class="fb-mc-name">Locate</span>
                        <span class="fb-mc-desc">Find the note on the neck</span>
                    </button>
                    <button class="fb-mode-card" data-mode="zone">
                        <span class="fb-mc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2.4"></rect><path d="M9.2 3.6v16.8M14.8 3.6v16.8M3.6 9.2h16.8M3.6 14.8h16.8"></path></svg></span>
                        <span class="fb-mc-name">Zone</span>
                        <span class="fb-mc-desc">Find it in the 3&times;3 box</span>
                    </button>
                    <button class="fb-mode-card" data-mode="stats">
                        <span class="fb-mc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><rect x="4.5" y="12" width="3.5" height="6" rx="1"></rect><rect x="10.25" y="7" width="3.5" height="11" rx="1"></rect><rect x="16" y="14.5" width="3.5" height="3.5" rx="1"></rect></svg></span>
                        <span class="fb-mc-name">Stats</span>
                        <span class="fb-mc-desc">View your heatmap &amp; stats</span>
                    </button>
                </div>
                <button class="fb-play metro-btn">&#9654; Play</button>
            </div>
            <div class="fb-game" hidden>
                <div class="fb-topbar">
                    <div class="fb-topbar-right">
                        <div class="fb-score">Score: <b class="fb-score-val">0</b></div>
                        <button class="fb-home metro-btn small" title="Back to mode selection">&#8962;</button>
                    </div>
                </div>
                <div class="fb-prompt"></div>
                <div class="fb-board-wrap"><div class="fb-board"></div></div>
                <div class="fb-note-palette"></div>
            </div>
            <div class="fb-results" hidden>
                <div class="fb-results-msg">Time's up!</div>
                <div class="fb-results-score"><b class="fb-res-band">0</b></div>
                <div class="fb-results-norm"><span class="fb-res-band-norm">0.0</span> pts/min <span class="fb-res-avg"></span></div>
                <div class="fb-results-actions">
                    <button class="fb-keep metro-btn">Keep Training</button>
                    <button class="fb-results-home metro-btn small" title="Back to mode selection">&#8962;</button>
                </div>
            </div>
            <div class="fb-stats" hidden>
                <div class="fb-topbar">
                    <div class="fb-stats-title">Statistics</div>
                    <button class="fb-stats-home metro-btn small" title="Back">&#8962;</button>
                </div>
                <div class="fb-stat-kpis"></div>
                <div class="fb-runs"></div>
                <div class="fb-heatmap">Loading&hellip;</div>
                <div class="fb-stat-tables"></div>
            </div>
        </div>`;

    // Derives rgba variants of the SECTION accent (--sec-color) so everything
    // the trainer uses its color instead of fixed colors. (toRgb lives in js/settings.js)
    function applySectionAccent(el) {
        if (!el || !el.style || !window.getComputedStyle) return;
        var toRgb = (GPH.util && GPH.util.toRgb) || function () { return null; };
        var cs = getComputedStyle(el);
        var rgb = toRgb(cs.getPropertyValue('--sec-color'))
            || toRgb(cs.getPropertyValue('--accent')) || toRgb(cs.getPropertyValue('--accent-pink'))
            || [96, 125, 139];
        var base = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
        var light = [];
        for (var i = 0; i < 3; i++) light.push(Math.round(rgb[i] + (255 - rgb[i]) * 0.45));
        light = light.join(',');
        el.style.setProperty('--fb-accent', 'rgb(' + base + ')');
        el.style.setProperty('--fb-light', 'rgb(' + light + ')');
        el.style.setProperty('--fb-a12', 'rgba(' + base + ',0.12)');
        el.style.setProperty('--fb-a20', 'rgba(' + base + ',0.20)');
        el.style.setProperty('--fb-a30', 'rgba(' + base + ',0.30)');
        el.style.setProperty('--fb-a40', 'rgba(' + base + ',0.40)');
        el.style.setProperty('--fb-a55', 'rgba(' + base + ',0.55)');
        el.style.setProperty('--fb-a70', 'rgba(' + base + ',0.70)');
    }

    function initFretboardWidget(content, it) {
        applySectionAccent(content);
        const meta = (it && it.meta) || {};
        const stringsUsed = 6; // all strings are always shown
        let maxFret = parseInt(meta.frets, 10);
        if (isNaN(maxFret) || maxFret < 1) maxFret = 12;
        if (maxFret > 24) maxFret = 24;
        let enabledStrings = [];
        if (meta.enabled && meta.enabled.length) {
            meta.enabled.forEach(function (n) { n = parseInt(n, 10); if (n >= 1 && n <= 6) enabledStrings.push(n); });
        }
        if (!enabledStrings.length) enabledStrings = [1, 2, 3, 4, 5, 6];
        const enabledRows = enabledStrings.map(function (no) { return no - 1; });

        const OPEN = [40, 45, 50, 55, 59, 64];
        const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const usedOpen = OPEN.slice(6 - stringsUsed, 6);
        function openForRow(r) { return usedOpen[stringsUsed - 1 - r]; }
        function nameForMidi(m) { return NAMES[m % 12]; }
        function freqForMidi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
        const DISPLAY = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
        const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
        function promptName(pc) {
            if ([0, 2, 4, 5, 7, 9, 11].indexOf(pc) >= 0) return NAMES[pc];
            return Math.random() < 0.5 ? NAMES[pc] : FLAT[pc];
        }

        const board = content.querySelector('.fb-board');
        const promptEl = content.querySelector('.fb-prompt');
        const paletteEl = content.querySelector('.fb-note-palette');
        const scoreEl = content.querySelector('.fb-score-val');
        const modeCards = content.querySelectorAll('.fb-mode-card');
        const playBtn = content.querySelector('.fb-play');
        const homeBtn = content.querySelector('.fb-home');
        const welcome = content.querySelector('.fb-welcome');
        const game = content.querySelector('.fb-game');
        const results = content.querySelector('.fb-results');
        const resBand = content.querySelector('.fb-res-band');
        const resBandNorm = content.querySelector('.fb-res-band-norm');
        const resAvg = content.querySelector('.fb-res-avg');
        const keepBtn = content.querySelector('.fb-keep');
        const statsPanel = content.querySelector('.fb-stats');
        const kpisEl = content.querySelector('.fb-stat-kpis');
        const runsEl = content.querySelector('.fb-runs');
        const heatEl = content.querySelector('.fb-heatmap');
        const tablesEl = content.querySelector('.fb-stat-tables');
        const statsHomeBtn = content.querySelector('.fb-stats-home');
        const resultsHomeBtn = content.querySelector('.fb-results-home');
        if (!board || !promptEl) return;

        let mode = 'identify';
        let selectedMode = 'identify';
        let question = null;
        let questionPrompt = '';
        let questionPromptNote = '';
        let locked = false;
        let score = 0;
        let correct = 0;
        let advTimer = null;
        let wrongTimer = null;
        let questionStart = 0;
        // Per-run telemetry: the aggregate cell table cannot answer "how did
        // this mode evolve" or "what was my best streak".
        let streak = 0;
        let bestStreak = 0;
        let misses = 0;
        let answerMs = 0;
        let runUid = '';
        var RUNS_PAGE_SIZE = 10;
        var runsPage = 0;
        var lastRunStats = null;
        const OPEN_BY_STR = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

        // Board shared with Fretboard Theory (js/fretboardBoard.js)
        const bd = GPH.board.create(board, { frets: maxFret, strings: stringsUsed, interactive: true });
        const nutFrac = bd.nutFrac, wireFrac = bd.wireFrac;
        const xFor = bd.xFor, yFor = bd.yFor, stepY = bd.stepY, pct = bd.pct;
        const dots = bd.dotsEl;
        const addDot = bd.addDot, clearDots = bd.clearDots;

        paletteEl.innerHTML = '';
        const isAcc = [1, 3, 6, 8, 10];
        NAMES.forEach(function (nm, i) {
            const b = document.createElement('button'); b.type = 'button';
            b.className = 'fb-palette-btn' + (isAcc.indexOf(i) >= 0 ? ' acc' : '');
            b.textContent = DISPLAY[i];
            b.addEventListener('click', function () { answerIdentify(nm); });
            paletteEl.appendChild(b);
        });

        function updateScore() { if (scoreEl) scoreEl.textContent = String(score); }
        function sound(f) {
            try {
                var ctx = GPH.audio.ensureAudio();
                if (ctx.state === 'suspended') {
                    ctx.resume().then(function () { GPH.audio.playPluck(f); }).catch(function () {});
                } else {
                    GPH.audio.playPluck(f);
                }
            } catch (err) { try { GPH.audio.playBeep(f, 0, 0.3); } catch (e2) {} }
        }
        function setMode(m) {
            if (advTimer) { clearTimeout(advTimer); advTimer = null; }
            if (m !== 'identify' && m !== 'locate' && m !== 'zone') m = 'identify';
            mode = m; selectedMode = m;
            modeCards.forEach(function (b) { b.classList.toggle('active', b.dataset.mode === m); });
            paletteEl.style.display = (m === 'identify') ? '' : 'none';
            newQuestion(true);
        }
        function resetRunMetrics() {
            score = 0;
            correct = 0;
            misses = 0;
            streak = 0;
            bestStreak = 0;
            answerMs = 0;
            runUid = (GPH.stats && GPH.stats.uid) ? GPH.stats.uid() : ('r' + Date.now());
        }
        function startGame() {
            resetRunMetrics(); updateScore();
            if (results) results.hidden = true;
            if (statsPanel) statsPanel.hidden = true;
            if (welcome) welcome.hidden = true;
            if (game) game.hidden = false;
            setMode(selectedMode);
        }
        function goHome() {
            if (advTimer) { clearTimeout(advTimer); advTimer = null; }
            if (wrongTimer) { clearTimeout(wrongTimer); wrongTimer = null; }
            locked = false;
            if (game) game.hidden = true;
            if (statsPanel) statsPanel.hidden = true;
            if (results) results.hidden = true;
            if (welcome) welcome.hidden = false;
        }
        // Expands every collapsed container between the page and the trainer
        // (the Theory card and the trainer subfolder) and brings it into view.
        function expandSelf() {
            if (GPH.ui && GPH.ui.revealInPage) { GPH.ui.revealInPage(content); return; }
            var card = content.closest ? content.closest('.section-card') : null;
            if (card) {
                var h = card.querySelector('.section-heading') || card.querySelector('h2');
                var ul = card.querySelector('.link-list');
                var body = card.querySelector('.fretboard-body');
                if (h) h.classList.remove('collapsed');
                if (ul) ul.classList.remove('collapsed');
                if (body) body.classList.remove('collapsed');
            }
            if (content.scrollIntoView) { try { content.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* noop */ } }
        }
        function startAuto() {
            expandSelf();
            resetRunMetrics(); updateScore();
            if (welcome) welcome.hidden = true;
            if (results) results.hidden = true;
            if (statsPanel) statsPanel.hidden = true;
            if (game) game.hidden = false;
            setMode(selectedMode);
        }
        function showResults(durationSec, avgPerMin) {
            if (advTimer) { clearTimeout(advTimer); advTimer = null; }
            if (wrongTimer) { clearTimeout(wrongTimer); wrongTimer = null; }
            locked = true;
            var perMin = (durationSec && durationSec > 0) ? (score / (durationSec / 60)) : score;
            if (resBand) resBand.textContent = String(score);
            if (resBandNorm) {
                resBandNorm.textContent = (Math.round(perMin * 10) / 10).toFixed(1);
                resBandNorm.className = 'fb-res-band-norm';
                if (avgPerMin != null) resBandNorm.classList.add(perMin >= avgPerMin ? 'ok' : 'bad');
            }
            if (resAvg) {
                if (avgPerMin != null) { resAvg.textContent = 'avg ' + (Math.round(avgPerMin * 10) / 10).toFixed(1) + '/min'; resAvg.style.display = ''; }
                else { resAvg.textContent = ''; resAvg.style.display = 'none'; }
            }
            if (game) game.hidden = true;
            if (welcome) welcome.hidden = true;
            if (results) { results.hidden = false; if (results.scrollIntoView) { try { results.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} } }
            return { duration: durationSec, normalized: perMin, score: score, attempts: (2 * correct - score), mode: mode, hits: correct, misses: misses, best_streak: bestStreak, avg_ms: correct ? Math.round(answerMs / correct) : 0, run_uid: runUid };
        }
        function hideResults() { if (results) results.hidden = true; }
        function recordCell(stringNo, fret, kind, timeMs) {
            try {
                fetch('/api/fretboard/cell', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ string_no: stringNo, fret: fret, kind: kind, time_ms: Math.round(timeMs || 0), mode: mode, run_uid: runUid })
                }).catch(function () {});
            } catch (e) {}
        }
        function updatePlayBtn() {
            if (playBtn) playBtn.textContent = (selectedMode === 'stats') ? '\u25B6 View' : '\u25B6 Play';
        }
        // Speed scale per mode (ms for grade 0 and grade 1 in the time component).
        // Zone scans 9 cells, so it is slower by nature and gets a wider window.
        var SPEED_MS = {
            identify: [1000, 4000],
            locate: [1000, 4000],
            zone: [2500, 8000],
            '': [1000, 4000]
        };
        function statAgg(items) {
            var h = 0, m = 0, tm = 0, byMode = {};
            items.forEach(function (c) {
                h += c.hits; m += c.misses; tm += c.timeSum;
                Object.keys(c.byMode || {}).forEach(function (k) {
                    var b = byMode[k] || (byMode[k] = { hits: 0, timeSum: 0 });
                    b.hits += c.byMode[k].hits;
                    b.timeSum += c.byMode[k].timeSum;
                });
            });
            return {
                hits: h, misses: m, timeSum: tm, byMode: byMode,
                acc: (h + m) > 0 ? h / (h + m) : null,
                avgT: h > 0 ? tm / h : null
            };
        }
        function fmtPct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + '%'; }
        function fmtSec(ms) { return (ms == null) ? '\u2014' : (Math.round(ms / 100) / 10).toFixed(1) + 's'; }
        function statTable(title, rows) {
            var s = '<div class="fb-stat-block"><h4>' + title + '</h4><table class="fb-stat-table"><thead><tr><th>Zone</th><th>Acc</th><th>Avg</th><th>\u2713</th><th>\u2717</th><th>Grade</th></tr></thead><tbody>';
            rows.forEach(function (r) {
                var g = r.grade;
                var gTxt = (g == null) ? '\u2014' : (((g % 1 === 0) ? String(g) : g.toFixed(1)) + '/10');
                var gCls = (g == null) ? '' : (g > 7.9 ? ' ok' : (g < 4.5 ? ' bad' : ''));
                s += '<tr><td>' + r.label + '</td><td>' + (r.agg.acc == null ? '\u2014' : fmtPct(r.agg.acc)) + '</td><td>' + fmtSec(r.agg.avgT) + '</td><td>' + r.agg.hits + '</td><td>' + r.agg.misses + '</td><td class="fb-grade' + gCls + '">' + gTxt + '</td></tr>';
            });
            return s + '</tbody></table></div>';
        }
        function renderStats(cells) {
            var map = {};
            (cells || []).forEach(function (c) {
                var k = c.string_no + '-' + c.fret;
                var e = map[k] || (map[k] = { hits: 0, misses: 0, timeSum: 0, byMode: {} });
                var h = c.hits || 0, m = c.misses || 0, t = c.time_sum_ms || 0;
                e.hits += h; e.misses += m; e.timeSum += t;
                var mk = c.mode || '';
                var b = e.byMode[mk] || (e.byMode[mk] = { hits: 0, timeSum: 0 });
                b.hits += h; b.timeSum += t;
            });
            var cfg = [];
            var minT = Infinity, maxT = -Infinity;
            for (var sNo = 1; sNo <= stringsUsed; sNo++) {
                for (var f = 0; f <= maxFret; f++) {
                    var cd = map[sNo + '-' + f];
                    if (!cd || (cd.hits + cd.misses) <= 0) continue;
                    var pc = ((OPEN_BY_STR[sNo] + f) % 12 + 12) % 12;
                    cfg.push({ sNo: sNo, f: f, hits: cd.hits, misses: cd.misses, timeSum: cd.timeSum, pc: pc, byMode: cd.byMode });
                    if (cd.hits > 0) { var av = cd.timeSum / cd.hits; if (av < minT) minT = av; if (av > maxT) maxT = av; }
                }
            }
            if (minT === Infinity) { minT = 0; maxT = 0; }
            function perfOf(cd) {
                var tot = cd.hits + cd.misses; if (tot <= 0) return null;
                var acc = cd.hits / tot;
                var avgT = cd.hits > 0 ? cd.timeSum / cd.hits : null;
                var tScore = (avgT == null) ? 0 : (maxT > minT ? (maxT - avgT) / (maxT - minT) : 1);
                return 0.65 * acc + 0.35 * tScore;
            }
            var PALETTE = ['#b71c1c', '#e53935', '#f4511e', '#fb8c00', '#fdd835', '#aed581', '#43a047', '#2e7d32', '#1b5e20'];
            var perfByKey = {};
            var minP = Infinity, maxP = -Infinity;
            cfg.forEach(function (c) {
                var pf = perfOf({ hits: c.hits, misses: c.misses, timeSum: c.timeSum });
                if (pf == null) return;
                perfByKey[c.sNo + '-' + c.f] = pf;
                if (pf < minP) minP = pf; if (pf > maxP) maxP = pf;
            });
            if (minP === Infinity) { minP = 0; maxP = 0; }
            function colorFor(pf) {
                var rel = (maxP > minP) ? (pf - minP) / (maxP - minP) : 0.5;
                var idx = Math.round(rel * (PALETTE.length - 1));
                if (idx < 0) idx = 0; if (idx > PALETTE.length - 1) idx = PALETTE.length - 1;
                return PALETTE[idx];
            }
            var cellFrac = []; cellFrac[0] = nutFrac; var totalFretFrac = nutFrac;
            for (var cf = 1; cf <= maxFret; cf++) { var cw = wireFrac[cf] - wireFrac[cf - 1]; cellFrac[cf] = cw; totalFretFrac += cw; }
            var labelPct = 3.5; var remPct = 100 - labelPct;
            var colgroup = '<colgroup><col style="width:' + labelPct + '%">';
            for (var cg = 0; cg <= maxFret; cg++) { colgroup += '<col style="width:' + ((cellFrac[cg] / totalFretFrac) * remPct).toFixed(3) + '%">'; }
            colgroup += '</colgroup>';
            var h = '<div class="fb-heat-legend"><span>worse</span><i class="fb-heat-bar"></i><span>better</span></div><table class="fb-heat">' + colgroup + '<thead><tr><th></th>';
            for (var ff = 0; ff <= maxFret; ff++) h += '<th>' + ff + '</th>';
            h += '</tr></thead><tbody>';
            for (var sr = 1; sr <= stringsUsed; sr++) {
                h += '<tr><th>' + sr + '</th>';
                for (var fr = 0; fr <= maxFret; fr++) {
                    var key = sr + '-' + fr;
                    var cd2 = map[key];
                    var pf2 = perfByKey[key];
                    var bg = (pf2 == null) ? '#1b1b1b' : colorFor(pf2);
                    var ttl = (cd2 && (cd2.hits + cd2.misses) > 0) ? ('Str ' + sr + ' fret ' + fr + ' \u00b7 ' + cd2.hits + '\u2713/' + cd2.misses + '\u2717') : ('Str ' + sr + ' fret ' + fr + ' \u00b7 no data');
                    h += '<td style="background:' + bg + '" title="' + ttl + '"></td>';
                }
                h += '</tr>';
            }
            h += '</tbody></table>';
            if (heatEl) heatEl.innerHTML = h;
            function gradeOf(agg) {
                if (agg.acc == null) return null;
                // Time score averaged per mode (weighted by hits): each mode has
                // its own scale, so Zone is not punished for being slower.
                var totH = 0, sum = 0;
                Object.keys(agg.byMode || {}).forEach(function (k) {
                    var b = agg.byMode[k];
                    if (!b || !b.hits) return;
                    var sc = SPEED_MS.hasOwnProperty(k) ? SPEED_MS[k] : SPEED_MS[''];
                    var avg = b.timeSum / b.hits;
                    var t = (sc[1] - avg) / (sc[1] - sc[0]);
                    if (t < 0) t = 0; if (t > 1) t = 1;
                    totH += b.hits; sum += t * b.hits;
                });
                var tScore = totH ? (sum / totH) : 0;
                return Math.round((0.6 * agg.acc + 0.4 * tScore) * 100) / 10;
            }
            function statRow(label, items) { var a = statAgg(items); return { label: label, agg: a, grade: gradeOf(a) }; }
            var natural = [], accidental = [];
            cfg.forEach(function (c) { if ([0, 2, 4, 5, 7, 9, 11].indexOf(c.pc) >= 0) natural.push(c); else accidental.push(c); });
            var groupRows = [ statRow('Natural', natural), statRow('Accidental', accidental) ];
            var noteRows = [];
            for (var pc2 = 0; pc2 < 12; pc2++) { var items = cfg.filter(function (c) { return c.pc === pc2; }); noteRows.push(statRow(NAMES[pc2], items)); }
            var stringRows = [];
            for (var s4 = 1; s4 <= stringsUsed; s4++) { var it4 = cfg.filter(function (c) { return c.sNo === s4; }); stringRows.push(statRow('String ' + s4, it4)); }
            var fretRows = [];
            for (var ft = 0; ft <= maxFret; ft++) { var itf = cfg.filter(function (c) { return c.f === ft; }); fretRows.push(statRow('Fret ' + ft, itf)); }
            if (tablesEl) tablesEl.innerHTML = statTable('Note group', groupRows) + statTable('By note', noteRows) + statTable('By string', stringRows) + statTable('By fret', fretRows);
        }
        var MODE_LABEL = { identify: 'Identify', locate: 'Locate', zone: 'Zone', '': 'Legacy' };
        function escHtml(value) {
            return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
        }
        function pctText(hits, misses) {
            var total = (hits || 0) + (misses || 0);
            return total ? Math.round((hits || 0) / total * 100) + '%' : '\u2014';
        }
        function msText(ms) {
            return (ms && ms > 0) ? (Math.round(ms / 100) / 10).toFixed(1) + 's' : '\u2014';
        }
        // Same normalized metric the assistant shows: points (hits minus misses)
        // divided by the minutes of the run.
        function perMinText(value) {
            var n = Number(value);
            return (value == null || isNaN(n)) ? '\u2014' : (Math.round(n * 10) / 10).toFixed(1) + '/min';
        }
        // Older server responses do not carry by-mode avg_norm yet; fall back to
        // the detailed runs already in the payload instead of showing a dash.
        function modePerMin(m, runs) {
            if (m && m.avg_norm != null) return m.avg_norm;
            var vals = (runs || []).filter(function (r) {
                return r.mode === (m && m.mode) && r.normalized != null;
            }).map(function (r) { return Number(r.normalized); });
            return vals.length
                ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length
                : null;
        }
        function whenText(iso) {
            if (!iso) return '\u2014';
            var d = new Date(iso);
            if (isNaN(d.getTime())) return '\u2014';
            return d.toLocaleString('en-GB', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            });
        }
        function renderRunKpis(data) {
            var s = data.summary || {};
            if (!kpisEl) return;
            kpisEl.innerHTML =
                '<div class="fb-stat-kpi"><b>' + (s.runs || 0) + '</b><span>Detailed runs</span></div>' +
                '<div class="fb-stat-kpi"><b>' + pctText(s.hits, s.misses) + '</b><span>Accuracy</span></div>' +
                '<div class="fb-stat-kpi"><b>' + (s.best_streak || 0) + '</b><span>Best streak</span></div>' +
                '<div class="fb-stat-kpi"><b>' + perMinText(data.avg) + '</b><span>Avg score</span></div>' +
                '<div class="fb-stat-kpi"><b>' + msText(s.avg_ms) + '</b><span>Avg response</span></div>';
        }
        function renderRunsBlock() {
            if (!runsEl) return;
            var data = lastRunStats || {};
            var modes = data.by_mode || [];
            var runs = data.runs || [];
            var pages = Math.max(1, Math.ceil(runs.length / RUNS_PAGE_SIZE));
            if (runsPage < 0) runsPage = 0;
            if (runsPage >= pages) runsPage = pages - 1;
            var html = '';
            if (modes.length) {
                html += '<div class="fb-stat-block"><h4>By mode</h4><table class="fb-stat-table">' +
                    '<thead><tr><th>Mode</th><th>Runs</th><th>Acc</th><th>Score/min</th><th>Avg</th><th>Streak</th></tr></thead><tbody>';
                modes.forEach(function (m) {
                    html += '<tr><td>' + escHtml(MODE_LABEL[m.mode] || m.mode || 'Legacy') + '</td>' +
                        '<td>' + (m.runs || 0) + '</td><td>' + pctText(m.hits, m.misses) + '</td>' +
                        '<td>' + perMinText(modePerMin(m, runs)) + '</td>' +
                        '<td>' + msText(m.avg_ms) + '</td><td>' + (m.best_streak || 0) + '</td></tr>';
                });
                html += '</tbody></table></div>';
            }
            if (runs.length) {
                var start = runsPage * RUNS_PAGE_SIZE;
                var pageRuns = runs.slice(start, start + RUNS_PAGE_SIZE);
                html += '<div class="fb-stat-block"><h4>Recent runs</h4><div class="fb-runs-scroll">' +
                    '<table class="fb-stat-table"><thead><tr><th>When</th><th>Mode</th><th>Score</th>' +
                    '<th>Score/min</th><th>Acc</th><th>Streak</th><th>Avg</th></tr></thead><tbody>';
                pageRuns.forEach(function (r) {
                    html += '<tr><td class="fb-run-when">' + escHtml(whenText(r.played_at)) + '</td>' +
                        '<td>' + escHtml(MODE_LABEL[r.mode] || r.mode || 'Legacy') + '</td>' +
                        '<td>' + (r.score || 0) + '</td><td>' + perMinText(r.normalized) + '</td>' +
                        '<td>' + pctText(r.hits, r.misses) + '</td>' +
                        '<td>' + (r.best_streak || 0) + '</td><td>' + msText(r.avg_ms) + '</td></tr>';
                });
                html += '</tbody></table></div>' +
                    '<div class="fb-runs-pager">' +
                    '<button type="button" class="metro-btn small" data-fb-runs="prev"' +
                    (runsPage === 0 ? ' disabled' : '') + '>\u2190 Prev</button>' +
                    '<span>' + (runsPage + 1) + ' / ' + pages + ' \u00b7 ' + runs.length + ' runs</span>' +
                    '<button type="button" class="metro-btn small" data-fb-runs="next"' +
                    (runsPage >= pages - 1 ? ' disabled' : '') + '>Next \u2192</button>' +
                    '</div></div>';
            } else {
                html += '<div class="fb-empty">No detailed runs yet. Play a run and its accuracy, ' +
                    'streak and response time will appear here.</div>';
            }
            runsEl.innerHTML = html;
        }
        function renderRunStats(data) {
            lastRunStats = data || {};
            runsPage = 0;
            renderRunKpis(lastRunStats);
            renderRunsBlock();
        }
        function showStats() {
            if (advTimer) { clearTimeout(advTimer); advTimer = null; }
            if (wrongTimer) { clearTimeout(wrongTimer); wrongTimer = null; }
            locked = false;
            if (welcome) welcome.hidden = true;
            if (game) game.hidden = true;
            if (results) results.hidden = true;
            if (statsPanel) { statsPanel.hidden = false; if (statsPanel.scrollIntoView) { try { statsPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} } }
            if (kpisEl) kpisEl.innerHTML = '';
            if (runsEl) runsEl.innerHTML = '<div class="fb-empty">Loading\u2026</div>';
            if (heatEl) heatEl.textContent = 'Loading\u2026';
            if (tablesEl) tablesEl.innerHTML = '';
            function getJson(url, fallback) {
                return fetch(url, { cache: 'no-store' })
                    .then(function (r) { return r.ok ? r.json() : fallback; })
                    .catch(function () { return fallback; });
            }
            Promise.all([
                getJson('/api/fretboard/cell-stats', []),
                getJson('/api/fretboard/stats', {})
            ]).then(function (res) {
                renderStats(res[0] || []);
                renderRunStats(res[1] || {});
            });
        }
        // Zone mode -------------------------------------------------------
        // Window = 3 consecutive strings x 3 consecutive frets (9 cells). Only
        // windows where the target note appears EXACTLY ONCE are used, so the
        // answer is always unambiguous.
        function zoneWindows() {
            const rows = enabledRows.slice().sort(function (a, b) { return a - b; });
            const starts = [];
            for (let i = 0; i + 2 < rows.length; i++) {
                if (rows[i + 1] === rows[i] + 1 && rows[i + 2] === rows[i] + 2) starts.push(rows[i]);
            }
            if (!starts.length) {
                for (let r0 = 0; r0 + 2 < stringsUsed; r0++) starts.push(r0);
            }
            const out = [];
            starts.forEach(function (r0) {
                for (let f0 = 1; f0 + 2 <= maxFret; f0++) {
                    const count = {};
                    for (let dr = 0; dr < 3; dr++) {
                        for (let df = 0; df < 3; df++) {
                            const pc = ((openForRow(r0 + dr) + f0 + df) % 12 + 12) % 12;
                            count[pc] = (count[pc] || 0) + 1;
                        }
                    }
                    const uniq = Object.keys(count).filter(function (k) { return count[k] === 1; });
                    if (!uniq.length) return;
                    const pc = parseInt(uniq[Math.floor(Math.random() * uniq.length)], 10);
                    let cell = null;
                    for (let dr = 0; dr < 3 && !cell; dr++) {
                        for (let df = 0; df < 3 && !cell; df++) {
                            const rr = r0 + dr, ff = f0 + df;
                            if ((((openForRow(rr) + ff) % 12) + 12) % 12 === pc) cell = { row: rr, fret: ff };
                        }
                    }
                    if (cell) out.push({ row0: r0, fret0: f0, notePc: pc, cell: cell });
                }
            });
            return out;
        }
        let lastZoneKey = '';
        function nextZone() {
            const cands = zoneWindows();
            if (!cands.length) return null;
            let pick = null;
            for (let i = 0; i < 24; i++) {
                const c = cands[Math.floor(Math.random() * cands.length)];
                const key = c.row0 + ':' + c.fret0 + ':' + c.notePc;
                if (key !== lastZoneKey) { pick = c; lastZoneKey = key; return pick; }
            }
            pick = cands[Math.floor(Math.random() * cands.length)];
            lastZoneKey = pick.row0 + ':' + pick.fret0 + ':' + pick.notePc;
            return pick;
        }
        function drawZone(z) {
            if (!z) return;
            const box = document.createElement('div');
            box.className = 'fb2-zonehl';
            const left = wireFrac[z.fret0 - 1];
            const right = wireFrac[z.fret0 + 2];
            // Clamp vertically with a small inset: the first/last string cells
            // extend half a step beyond the padded area, and the board has
            // rounded corners, so the box would touch/cross the edge.
            const edge = 2 / 180;
            const top = Math.max(edge, yFor(z.row0) - stepY / 2);
            const bottom = Math.min(1 - edge, yFor(z.row0 + 2) + stepY / 2);
            box.style.left = pct(left);
            box.style.width = pct(right - left);
            box.style.top = pct(top);
            box.style.height = pct(bottom - top);
            dots.appendChild(box);
        }

        function newQuestion(autoplay) {
            if (advTimer) { clearTimeout(advTimer); advTimer = null; }
            if (wrongTimer) { clearTimeout(wrongTimer); wrongTimer = null; }
            locked = false; clearDots();
            questionStart = performance.now();
            promptEl.className = 'fb-prompt';

            if (mode === 'zone') {
                const z = nextZone();
                if (z) {
                    const mz = openForRow(z.cell.row) + z.cell.fret;
                    question = { row: z.cell.row, fret: z.cell.fret, note: nameForMidi(mz), stringNo: z.cell.row + 1, zone: z };
                    questionPromptNote = promptName(z.notePc);
                    questionPrompt = 'Find ' + questionPromptNote + ' in the box';
                    drawZone(z);
                    if (autoplay) sound(freqForMidi(mz));
                    renderPrompt();
                    return;
                }
            }
            const r = enabledRows[Math.floor(Math.random() * enabledRows.length)];
            const f = Math.floor(Math.random() * (maxFret + 1));
            const midi = openForRow(r) + f;
            question = { row: r, fret: f, note: nameForMidi(midi), stringNo: r + 1 };
            if (mode === 'identify') {
                questionPrompt = 'Identify the highlighted note';
                addDot(r, f, 'fb2-glow');
                if (autoplay) sound(freqForMidi(midi));
            } else {
                questionPromptNote = promptName(midi % 12);
                questionPrompt = 'Locate ' + questionPromptNote;
                const band = document.createElement('div');
                band.className = 'fb2-rowhl';
                // Same clamp as the Zone box: keep the band inside the board
                // (with a small inset so it never touches the rounded corners).
                const edge = 2 / 180;
                const bTop = Math.max(edge, yFor(r) - stepY / 2);
                const bBottom = Math.min(1 - edge, yFor(r) + stepY / 2);
                band.style.top = pct(bTop);
                band.style.height = pct(bBottom - bTop);
                dots.appendChild(band);
            }
            renderPrompt();
        }
        // In Locate: small "LOCATE" + the big note (readable at a glance).
        function renderPrompt() {
            if ((mode === 'locate' || mode === 'zone') && questionPromptNote) {
                const label = (mode === 'zone') ? 'Zone' : 'Locate';
                promptEl.innerHTML = '<span class="fb-prompt-label">' + label + '</span><span class="fb-prompt-note">' + questionPromptNote + '</span>';
            } else {
                promptEl.textContent = questionPrompt;
            }
        }
        function onCorrect(r, f) {
            if (advTimer) { clearTimeout(advTimer); advTimer = null; }
            if (wrongTimer) { clearTimeout(wrongTimer); wrongTimer = null; }
            locked = true; score++; correct++; updateScore();
            streak++;
            if (streak > bestStreak) bestStreak = streak;
            answerMs += performance.now() - questionStart;
            recordCell(r + 1, f, 'hit', performance.now() - questionStart);
            promptEl.textContent = 'Correct!'; promptEl.className = 'fb-prompt ok';
            clearDots(); addDot(r, f, 'fb2-mark ok');
            const advDelay = (mode === 'identify') ? 230 : 350;
            advTimer = setTimeout(function () { advTimer = null; locked = false; newQuestion(true); }, advDelay);
        }
        function showWrong() {
            if (wrongTimer) { clearTimeout(wrongTimer); wrongTimer = null; }
            promptEl.textContent = 'Wrong'; promptEl.className = 'fb-prompt bad';
            wrongTimer = setTimeout(function () {
                wrongTimer = null;
                if (!locked) { promptEl.className = 'fb-prompt'; renderPrompt(); }
            }, 700);
        }
        function onWrongIdentify() {
            score--; misses++; streak = 0; updateScore(); showWrong();
            if (question) recordCell(question.row + 1, question.fret, 'miss', 0);
        }
        function onWrongLocate(r, f) {
            score--; misses++; streak = 0; updateScore(); showWrong();
            addDot(r, f, 'fb2-mark bad');
            if (question) recordCell(question.row + 1, question.fret, 'miss', 0);
        }
        function answerIdentify(nm) {
            if (locked || mode !== 'identify' || !question) return;
            if (nm === question.note) onCorrect(question.row, question.fret); else onWrongIdentify();
        }

        board.addEventListener('click', function (e) {
            const h = e.target.closest('.fb2-hot'); if (!h) return;
            const r = +h.dataset.row, f = +h.dataset.fret;
            const midi = openForRow(r) + f;
            sound(freqForMidi(midi));
            if (mode === 'zone' && !locked && question && question.zone) {
                const z = question.zone;
                const inside = (r >= z.row0 && r <= z.row0 + 2 && f >= z.fret0 && f <= z.fret0 + 2);
                if (!inside) return;                     // clicks outside the box are ignored
                if (nameForMidi(midi) === question.note) onCorrect(r, f); else onWrongLocate(r, f);
                return;
            }
            if (mode === 'locate' && !locked && question && r === question.row) {
                if (nameForMidi(midi) === question.note) onCorrect(r, f); else onWrongLocate(r, f);
            }
        });

        if (playBtn) playBtn.addEventListener('click', function () { if (selectedMode === 'stats') showStats(); else startGame(); });
        if (homeBtn) homeBtn.addEventListener('click', goHome);
        if (statsHomeBtn) statsHomeBtn.addEventListener('click', goHome);
        if (resultsHomeBtn) resultsHomeBtn.addEventListener('click', goHome);
        if (keepBtn) keepBtn.addEventListener('click', startGame);
        if (runsEl) {
            runsEl.addEventListener('click', function (e) {
                const btn = e.target && e.target.closest
                    ? e.target.closest('[data-fb-runs]') : null;
                if (!btn || btn.disabled) return;
                const runs = (lastRunStats && lastRunStats.runs) || [];
                const pages = Math.max(1, Math.ceil(runs.length / RUNS_PAGE_SIZE));
                if (btn.getAttribute('data-fb-runs') === 'prev') {
                    runsPage = Math.max(0, runsPage - 1);
                } else {
                    runsPage = Math.min(pages - 1, runsPage + 1);
                }
                renderRunsBlock();
            });
        }
        modeCards.forEach(function (c) {
            c.addEventListener('click', function () {
                selectedMode = c.dataset.mode;
                modeCards.forEach(function (x) { x.classList.toggle('active', x.dataset.mode === selectedMode); });
                updatePlayBtn();
            });
        });

        paletteEl.style.display = 'none';
        updateScore();
        updatePlayBtn();

        GPH.fretboard = GPH.fretboard || {};
        GPH.fretboard.startAuto = startAuto;
        GPH.fretboard.showResults = showResults;
        GPH.fretboard.hideResults = hideResults;
    }

    function mountFretboard(el, meta) {
        if (!el) return;
        el.innerHTML = FRETBOARD_HTML;
        initFretboardWidget(el, { meta: meta || {} });
    }

    // API publica (mount sobrevive a la reasignacion de GPH.fretboard en initFretboardWidget)
    GPH.fretboard = GPH.fretboard || {};
    GPH.fretboard.mount = mountFretboard;
})(window.GPH = window.GPH || {});
