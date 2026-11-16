// Practice History tab: KPIs, charts and the session log, all built from
// /api/sessions and /api/sessions/stats (no chart library, plain SVG/CSS).
(function (GPH) {
    'use strict';

    const RANGES = [30, 90, 365];
    const PAGE_SIZE = 20;
    let days = 30;
    let page = 0;              // session log page (0 based)
    let totalSessions = 0;
    let groupBy = 'day';       // day | area | exercise | slot
    let filterArea = '';
    let filterRoutine = '';
    let filtersReady = false;

    const $ = id => document.getElementById(id);

    function api(path) {
        return fetch(path, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
    }

    function esc(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Area id -> label; the empty id is the group of the pre-catalog history.
    function areaLabel(id) {
        if (!id) return 'Unassigned';
        if (GPH.mgr && GPH.mgr.areaLabel) return GPH.mgr.areaLabel(id) || id;
        return id;
    }

    // Stats URL with the optional filters; "_unassigned" is what the select
    // sends for the empty area.
    function statsUrl() {
        let url = '/api/sessions/stats?days=' + days;
        if (filterArea !== '') url += '&area_id=' + encodeURIComponent(filterArea);
        if (filterRoutine !== '') url += '&routine_id=' + encodeURIComponent(filterRoutine);
        return url;
    }

    // Area and routine selects, filled once with what the server knows.
    function fillFilters() {
        const areaSel = $('histAreaFilter');
        const routineSel = $('histRoutineFilter');
        if (!areaSel || !routineSel || filtersReady) return Promise.resolve();
        filtersReady = true;
        return Promise.all([
            fetch('/api/settings/practice_areas', { cache: 'no-store' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; }),
            api('/api/routines')
        ]).then(function (res) {
            let areas = [];
            try { areas = JSON.parse((res[0] && res[0].value) || '[]'); } catch (e) { areas = []; }
            areaSel.innerHTML = '<option value="">All areas</option>';
            (areas || []).forEach(function (a) {
                const o = document.createElement('option');
                o.value = a.id;
                o.textContent = a.label;
                areaSel.appendChild(o);
            });
            const unassigned = document.createElement('option');
            unassigned.value = '_unassigned';
            unassigned.textContent = 'Unassigned';
            areaSel.appendChild(unassigned);
            areaSel.value = filterArea;

            routineSel.innerHTML = '<option value="">All routines</option>';
            (res[1] || []).forEach(function (r) {
                const o = document.createElement('option');
                o.value = String(r.id);
                o.textContent = r.name;
                routineSel.appendChild(o);
            });
            routineSel.value = filterRoutine;
        }).catch(function () { filtersReady = false; });
    }

    function fmtDur(seconds) {
        const total = Math.max(0, Math.round(seconds || 0));
        const h = Math.floor(total / 3600);
        const m = Math.round((total % 3600) / 60);
        if (!h) return m + ' min';
        return h + ' h' + (m ? ' ' + m + ' min' : '');
    }

    function toDate(iso) {
        const d = iso ? new Date(iso) : null;
        return (d && !isNaN(d.getTime())) ? d : null;
    }

    function fmtDay(iso) {
        const d = toDate(iso);
        return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
    }

    function fmtTime(iso) {
        const d = toDate(iso);
        if (!d) return '—';
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function dayKey(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
            '-' + String(d.getDate()).padStart(2, '0');
    }

    // Consecutive days with a finished session (today counts only if done).
    function currentStreak(daily) {
        const done = {};
        (daily || []).forEach(function (d) { done[d.date] = true; });
        let streak = 0;
        const cursor = new Date();
        cursor.setHours(12, 0, 0, 0);
        if (!done[dayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
        while (done[dayKey(cursor)]) {
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }
        return streak;
    }

    // Longest run of consecutive days inside the selected window, with its
    // dates, so the "current streak" card cannot look like a record that never
    // happened.
    function bestStreak(daily) {
        const keys = (daily || []).map(function (d) { return d.date; }).sort();
        let best = { count: 0, start: '', end: '' };
        let run = 0, start = '', prev = null;
        keys.forEach(function (key) {
            const d = new Date(key + 'T12:00:00');
            if (prev && Math.round((d - prev) / 86400000) === 1) run += 1;
            else { run = 1; start = key; }
            if (run > best.count) best = { count: run, start: start, end: key };
            prev = d;
        });
        return best;
    }

    // YYYY-MM-DD -> DD/MM/YY (the label above is already narrow)
    function fmtDMY(key) {
        const p = String(key || '').split('-');
        return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0].slice(2) : '';
    }

    function streakNote(best) {
        if (!best || !best.count) return 'no streak yet';
        // "~...~" marks a fragment that must not break (the date range), so on a
        // narrow card it wraps before the "(" instead of in the middle of a date.
        if (best.count === 1) return 'best: 1 day ~(' + fmtDMY(best.start) + ')~';
        return 'best: ' + best.count + ' days ~(' + fmtDMY(best.start) + ' - ' + fmtDMY(best.end) + ')~';
    }

    function kpiCards(stats) {
        const t = stats.totals || {};
        const st = stats.states || {};
        const real = t.real_seconds || 0;
        const planned = t.planned_seconds || 0;
        const wall = t.wall_seconds || 0;
        const ratio = planned ? Math.round(real / planned * 100) : 0;
        const done = st.done || 0;
        const closed = (st.done || 0) + (st.skipped || 0);
        const streak = currentStreak(stats.daily);
        const best = bestStreak(stats.daily);
        // Same ratio as Sessions (finished / started) shown as a %, the
        // adherence % stays in Practised, and the fourth card counts the days.
        const completion = t.sessions ? Math.round((t.finished || 0) / t.sessions * 100) : 0;
        const dp = t.days_practised || 0;
        const dt = t.days_total || 0;
        const dayPct = dt ? Math.round(dp / dt * 100) : 0;
        const cards = [
            ['Sessions', t.finished + ' / ' + t.sessions, 'finished of started · ' + completion + '%'],
            ['Practised', fmtDur(real), planned ? 'vs ' + fmtDur(planned) + ' planned · ' + ratio + '%' : 'real time'],
            ['Wall clock', fmtDur(wall), 'sitting time, pauses included'],
            ['Days practised', dp + ' / ' + dt, 'of the calendar days · ' + dayPct + '%'],
            ['Done exercises', closed ? Math.round(done / closed * 100) + '%' : '—', done + ' of ' + closed],
            ['Partial exercises', String(st.partial || 0), 'skipped, but with time inside'],
            ['Current streak', streak + (streak === 1 ? ' day' : ' days'), streakNote(best)]
        ];
        // Area cards come from the same by_area block the breakdown uses, so
        // the panel never needs an extra request for them.
        const areaRows = stats.by_area || [];
        const withTime = areaRows.filter(function (a) { return (a.seconds || 0) > 0; });
        const most = withTime.slice().sort(function (a, b) { return b.seconds - a.seconds; })[0] || null;
        const least = withTime.length
            ? areaRows.slice().sort(function (a, b) { return (a.seconds || 0) - (b.seconds || 0); })[0]
            : null;
        cards.push(['Most practised area', most ? areaLabel(most.area_id) : '\u2014',
                    most ? fmtDur(most.seconds) : 'no practice yet']);
        cards.push(['Least practised area', least ? areaLabel(least.area_id) : '\u2014',
                    least ? fmtDur(least.seconds) : 'no areas yet']);
        return '<div class="hist-kpis">' + cards.map(function (c) {
            // A note may carry "\n" (each line is its own row below the label)
            // and "~...~" (a fragment that must stay on one piece, e.g. a date
            // range, so it wraps before the "(" and never mid-date).
            const note = String(c[2] == null ? '' : c[2]).split('\n').map(function (line) {
                return '<span class="hist-kpi-note">' + line.split('~').map(function (part, i) {
                    return i % 2 ? '<span class="hist-kpi-frag">' + esc(part) + '</span>' : esc(part);
                }).join('') + '</span>';
            }).join('');
            return '<div class="hist-kpi"><span class="hist-kpi-value">' + esc(c[1]) + '</span>' +
                '<span class="hist-kpi-label">' + esc(c[0]) + '</span>' + note + '</div>';
        }).join('') + '</div>';
    }

    // ---------------------------- Activity calendar ----------------------------
    // Two shapes, both covering exactly the selected window:
    //  - 30 / 90 days: one strip of day chips, so the card width is used.
    //  - 1 year: GitHub style grid (rows Mon..Sun, one column per week).
    // Colour comes from real seconds, so a lit cell means "days practised".
    const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function actLabel(d) {
        return d.toLocaleDateString('en-GB',
            { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    }

    // "0 min" looks like a bug for a 40 s session, so say what it is.
    function actDur(seconds) {
        const s = Math.round(seconds || 0);
        if (s > 0 && s < 60) return 'under 1 min';
        return fmtDur(s);
    }

    function actLevel(seconds, max) {
        if (!seconds) return 0;
        const ratio = max ? seconds / max : 1;
        if (ratio >= 0.75) return 4;
        if (ratio >= 0.45) return 3;
        if (ratio >= 0.2) return 2;
        return 1;
    }

    // Grey when idle, accent in 5 steps when practised.
    function actStyle(seconds, max) {
        const level = actLevel(seconds, max);
        return level
            ? ' style="background:var(--accent);opacity:' + (0.3 + 0.17 * level).toFixed(2) + '"'
            : '';
    }

    function actTip(entry) {
        const n = entry.day.sessions || 0;
        return actLabel(entry.d) + ' · ' + (n
            ? actDur(entry.day.seconds) + ' · ' + n + (n === 1 ? ' session' : ' sessions')
            : 'no practice');
    }

    function isToday(d) {
        return dayKey(d) === dayKey(new Date());
    }

    // 1 year: the grid the panel already had, now sized from the available
    // width (--cols) with a 26px ceiling, so a wide card is not half empty.
    function activityGrid(list, max) {
        const byKey = {};
        list.forEach(function (e) { byKey[dayKey(e.d)] = e; });
        const first = new Date(list[0].d);
        first.setDate(first.getDate() - ((first.getDay() + 6) % 7));     // Monday
        const last = new Date(list[list.length - 1].d);
        last.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));  // Sunday

        const weeks = [];
        const cursor = new Date(first);
        while (cursor <= last) {
            const cells = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(cursor);
                d.setDate(d.getDate() + i);
                cells.push(byKey[dayKey(d)] || null);
            }
            weeks.push(cells);
            cursor.setDate(cursor.getDate() + 7);
        }

        // Month label over the first column of every month.
        let months = '<div class="hist-act-row hist-act-months"><span class="hist-act-label"></span>';
        let prev = -1;
        weeks.forEach(function (week) {
            let ref = null;
            for (let i = 0; i < 7 && !ref; i++) ref = week[i];
            const m = ref ? ref.d.getMonth() : prev;
            months += '<span class="hist-act-month">' + (ref && m !== prev ? MONTH_SHORT[m] : '') +
                '</span>';
            if (ref) prev = m;
        });
        months += '</div>';

        // Labels only on Mon / Thu / Sun, like a compact calendar axis.
        const rowLabels = ['Mon', '', '', 'Thu', '', '', 'Sun'];
        let rows = '';
        rowLabels.forEach(function (label, i) {
            rows += '<div class="hist-act-row"><span class="hist-act-label">' + label + '</span>' +
                weeks.map(function (week) {
                    const e = week[i];
                    if (!e) return '<i class="hist-act-cell is-out"></i>';
                    return '<i class="hist-act-cell' + (isToday(e.d) ? ' is-today' : '') + '"' +
                        ' title="' + esc(actTip(e)) + '"' + actStyle(e.day.seconds, max) + '></i>';
                }).join('') + '</div>';
        });
        return '<div class="hist-act" style="--cols:' + weeks.length + '">' + months + rows + '</div>';
    }

    // 30 / 90 days: one strip, oldest on the left, a wider gap on Mondays and
    // the day number when the chips are big enough to hold it.
    function activityStrip(list, max) {
        // Week groups depend on the weekday the window starts on, not only on
        // its length: the CSS subtracts one --act-week gap per group after the
        // first.
        const offset = (list[0].d.getDay() + 6) % 7;      // 0 = Monday
        const weeks = Math.ceil((offset + list.length) / 7);
        const numbered = list.length <= 45;
        const weekStart = i => i > 0 && list[i].d.getDay() === 1;   // Monday

        let labels = '';
        if (numbered) {
            let prev = -1;
            labels = '<div class="hist-act-strip hist-act-months">' +
                list.map(function (e, i) {
                    const m = e.d.getMonth();
                    const show = m !== prev;
                    prev = m;
                    return '<span class="hist-act-slot' + (weekStart(i) ? ' is-week' : '') + '">' +
                        (show ? MONTH_SHORT[m] : '') + '</span>';
                }).join('') + '</div>';
        }

        const chips = list.map(function (e, i) {
            return '<i class="hist-act-slot' + (weekStart(i) ? ' is-week' : '') +
                (numbered ? ' is-numbered' : '') + (isToday(e.d) ? ' is-today' : '') +
                '" title="' + esc(actTip(e)) + '"' + actStyle(e.day.seconds, max) + '>' +
                (numbered ? '<span>' + e.d.getDate() + '</span>' : '') + '</i>';
        }).join('');
        return '<div class="hist-act-strip-wrap" style="--n:' + list.length +
            ';--w:' + weeks + '">' + labels +
            '<div class="hist-act-strip">' + chips + '</div></div>';
    }

    function activityChart(activity, totals) {
        const byDay = {};
        (activity || []).forEach(function (a) {
            const key = String(a.date == null ? '' : a.date).slice(0, 10);
            if (!key) return;
            const day = byDay[key] || (byDay[key] = { sessions: 0, seconds: 0 });
            day.sessions += a.sessions || 0;
            day.seconds += a.seconds || 0;
        });
        const end = new Date();
        end.setHours(12, 0, 0, 0);
        const start = new Date(end);
        start.setDate(start.getDate() - (days - 1));

        // Every day of the window, oldest first, with the busiest day as the
        // 100% of the colour scale.
        const list = [];
        let max = 0;
        for (let i = 0; i < days; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            const day = byDay[dayKey(d)] || { sessions: 0, seconds: 0 };
            if (day.seconds > max) max = day.seconds;
            list.push({ d: d, day: day });
        }

        const practised = (totals && totals.days_practised) || 0;
        const total = (totals && totals.days_total) || days;
        const swatches = [0, 1, 2, 3, 4].map(function (level) {
            return '<i class="hist-act-swatch"' + (level
                ? ' style="background:var(--accent);opacity:' + (0.3 + 0.17 * level).toFixed(2) + '"'
                : '') + '></i>';
        }).join('');
        return '<div class="hist-act-scroll">' +
            (days <= 90 ? activityStrip(list, max) : activityGrid(list, max)) + '</div>' +
            '<div class="hist-act-foot">' +
            '<span>' + esc(fmtDay(start.toISOString())) + ' → ' + esc(fmtDay(end.toISOString())) + ' ' +
            end.getFullYear() + ' · ' + practised + ' of ' + total + ' days</span>' +
            '<span class="hist-act-legend">Less<span class="hist-act-swatches">' + swatches +
            '</span>More</span></div>';
    }

    function dailyChart(daily) {
        const byDay = {};
        (daily || []).forEach(function (d) { byDay[d.date] = d.seconds || 0; });
        const end = new Date();
        end.setHours(12, 0, 0, 0);
        const buckets = [];
        if (days <= 60) {
            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(end);
                d.setDate(d.getDate() - i);
                const key = dayKey(d);
                buckets.push({ label: fmtDay(d.toISOString()), minutes: Math.round((byDay[key] || 0) / 60) });
            }
        } else {
            const weeks = Math.ceil(days / 7);
            for (let w = weeks - 1; w >= 0; w--) {
                let secs = 0;
                for (let i = 0; i < 7; i++) {
                    const d = new Date(end);
                    d.setDate(d.getDate() - (w * 7 + i));
                    secs += byDay[dayKey(d)] || 0;
                }
                const from = new Date(end);
                from.setDate(from.getDate() - (w * 7 + 6));
                buckets.push({ label: 'from ' + fmtDay(from.toISOString()), minutes: Math.round(secs / 60) });
            }
        }
        const max = Math.max.apply(null, buckets.map(function (b) { return b.minutes; }).concat([1]));
        const cols = buckets.map(function (b) {
            const h = b.minutes ? Math.max(4, Math.round(b.minutes / max * 100)) : 0;
            return '<span class="hist-bar-col" title="' + esc(b.label) + ': ' + b.minutes + ' min">' +
                '<span class="hist-bar" style="height:' + h + '%"></span></span>';
        }).join('');
        return '<div class="hist-bars">' + cols + '</div>' +
            '<div class="hist-axis"><span>' + esc(buckets.length ? buckets[0].label : '') + '</span>' +
            '<span>' + (days <= 60 ? 'Minutes per day' : 'Minutes per week') + '</span>' +
            '<span>' + esc(buckets.length ? buckets[buckets.length - 1].label : '') + '</span></div>';
    }
    function donutChart(states) {
        const partial = states.partial || 0;
        const parts = [
            { label: 'Done', value: states.done || 0, color: 'var(--accent, #e91e63)' },
            { label: 'Partial', value: partial, color: '#f0b429' },
            { label: 'Skipped', value: Math.max(0, (states.skipped || 0) - partial), color: '#8f8f8f' }
        ];
        const total = parts.reduce(function (s, p) { return s + p.value; }, 0) || 1;
        // r + stroke/2 must stay inside the 120 viewBox (half = 60) or the SVG
        // clips the ring and the circle looks squared off: 50 + 9 = 59.
        const R = 50, C = 2 * Math.PI * R;
        let offset = 0;
        const arcs = parts.map(function (p) {
            const len = (p.value / total) * C;
            const arc = '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="' + p.color +
                '" stroke-width="18" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) +
                '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 60 60)"></circle>';
            offset += len;
            return arc;
        }).join('');
        const legend = parts.map(function (p) {
            return '<span class="hist-legend-item"><i style="background:' + p.color + '"></i>' +
                esc(p.label) + ' · ' + p.value + ' (' + Math.round(p.value / total * 100) + '%)</span>';
        }).join('');
        return '<div class="hist-donut-wrap">' +
            '<svg viewBox="0 0 120 120" class="hist-donut">' + arcs +
            '<text x="60" y="57" text-anchor="middle" class="hist-donut-big">' +
            Math.round((parts[0].value / total) * 100) + '%</text>' +
            '<text x="60" y="76" text-anchor="middle" class="hist-donut-small">Done</text></svg>' +
            '<div class="hist-legend">' + legend + '</div></div>';
    }

    function heatmapChart(cells) {
        const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const grid = {};
        let max = 1;
        (cells || []).forEach(function (c) {
            grid[c.weekday + ':' + c.hour] = c.sessions;
            if (c.sessions > max) max = c.sessions;
        });
        let html = '<div class="hist-heat">';
        for (let d = 1; d <= 7; d++) {
            const wd = d % 7;                       // SQLite: 0 = Sunday
            html += '<div class="hist-heat-row"><span class="hist-heat-label">' + names[d - 1] + '</span>';
            for (let h = 0; h < 24; h++) {
                const n = grid[wd + ':' + h] || 0;
                const opacity = n ? (0.25 + 0.75 * (n / max)) : 0;
                html += '<i class="hist-heat-cell" style="opacity:' + opacity.toFixed(2) + '" title="' +
                    names[d - 1] + ' ' + h + ':00 · ' + n + ' session' + (n === 1 ? '' : 's') + '"></i>';
            }
            html += '</div>';
        }
        // Hour ruler under the grid: same flex geometry, so each label sits
        // exactly under its column and nothing has to be hovered.
        let ruler = '<div class="hist-heat-row hist-heat-hours"><span class="hist-heat-label">Hour</span>';
        for (let h = 0; h < 24; h++) {
            ruler += '<span class="hist-heat-hour' + (h % 2 ? ' is-odd' : '') + '">' +
                (h < 10 ? '0' + h : h) + '</span>';
        }
        html += ruler + '</div></div>';
        return html;
    }

    function sessionsTable(sessions) {
        if (!sessions.length) return '<div class="hist-empty">No sessions in this period yet.</div>';
        const rows = sessions.map(function (s) {
            const real = s.real_seconds || 0;
            const planned = s.planned_seconds || 0;
            const wall = s.wall_seconds || 0;
            const ratio = planned ? Math.min(100, Math.round(real / planned * 100)) : 0;
            const declared = wall > 0 && real > wall;
            const partial = s.n_partial || 0;
            return '<tr class="hist-row" data-id="' + s.id + '">' +
                '<td>' + esc(fmtDay(s.started_at)) + '</td>' +
                '<td>' + esc(s.routine_name || '—') + '</td>' +
                '<td class="hist-nowrap">' + esc(fmtTime(s.started_at)) +
                (s.finished_at ? ' → ' + esc(fmtTime(s.finished_at)) : ' → —') +
                (wall ? ' <span class="hist-wall-txt" title="Duration: sitting time, pauses included">(' +
                    fmtDur(wall) + ')</span>' : '') +
                (declared ? ' <span class="hist-tag" title="More real time than wall clock: declared without the timer">declared</span>' : '') +
                '</td>' +
                '<td class="hist-nowrap">' +
                '<span class="hist-plan">' +
                '<span class="hist-plan-bar"><i style="width:' + ratio + '%"></i></span>' +
                '<span><b>' + fmtDur(real) + '</b> <span class="hist-plan-txt">/ ' + fmtDur(planned) + '</span></span>' +
                '</span>' +
                '</td>' +
                '<td class="hist-nowrap">' +
                '<span class="hist-chip is-done" title="done">' + (s.n_done || 0) + '</span>' +
                '<span class="hist-chip is-skipped" title="skipped">' + Math.max(0, (s.n_skipped || 0) - partial) + '</span>' +
                (partial ? '<span class="hist-chip is-partial" title="skipped after some work">' + partial + '</span>' : '') +
                '</td>' +
                '<td class="hist-nowrap"><span class="hist-status is-' + esc(s.status) + '">' + esc(s.status) + '</span></td>' +
                '<td><button class="btn small hist-detail-btn" data-id="' + s.id + '">Details</button></td>' +
                '</tr>';
        }).join('');
        return '<div class="hist-table-wrap"><table class="hist-table"><thead><tr>' +
            '<th>Date</th><th>Routine</th><th>Start → end <span class="hist-th-sub">(duration)</span></th>' +
            '<th>Real / planned</th>' +
            '<th>done / skip / part</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    const STATE_LABEL = {
        timed: 'done · timer',
        untimed: 'done · no timer',
        skipped: 'skipped',
        pending: 'not reached'
    };

    function detailRow(full) {
        const items = (full.items || []).map(function (it) {
            const real = it.elapsed_seconds || 0;
            const plan = it.planned_seconds || 0;
            const extra = (plan && real > plan) ? real - plan : 0;
            const cat = (it.catalog_exercise_id != null && GPH.mgr && GPH.mgr.catalogById)
                ? GPH.mgr.catalogById(it.catalog_exercise_id) : null;
            // The current catalog name wins (a rename fixes the history too);
            // the snapshot name covers a deleted exercise.
            const exName = cat ? cat.name : (it.catalog_name || '');
            const bits = [];
            if (exName) bits.push(exName);
            bits.push(areaLabel(it.area_id));
            const extraText = (exName ? '\u2014 ' : '\u00b7 ') + bits.join(' \u00b7 ');
            return '<li class="hist-detail-item is-' + esc(it.state) + '">' +
                '<span class="hist-detail-state">' + esc(STATE_LABEL[it.state] || it.state) + '</span>' +
                '<span class="hist-detail-name">' + esc(it.name) + '</span>' +
                '<span class="hist-detail-extra">' + esc(extraText) + '</span>' +
                '<span class="hist-detail-time">' + fmtDur(real) + ' / ' + fmtDur(plan) +
                (extra ? ' <b class="hist-extra">+' + fmtDur(extra) + '</b>' : '') + '</span></li>';
        }).join('');
        return '<tr class="hist-detail-row"><td colspan="7"><ul class="hist-detail-list">' +
            (items || '<li class="hist-empty-row">No exercises recorded.</li>') + '</ul></td></tr>';
    }

    // Toggle the detail row that follows a session row.
    function toggleDetail(row) {
        const next = row.nextElementSibling;
        if (next && next.classList.contains('hist-detail-row')) {
            next.parentNode.removeChild(next);
            row.classList.remove('is-open');
            return;
        }
        const id = row.getAttribute('data-id');
        if (!id) return;
        api('/api/sessions/' + id).then(function (full) {
            if (!full || !full.id) return;
            // The row may have been toggled again while the request was in flight.
            const already = row.nextElementSibling;
            if (already && already.classList.contains('hist-detail-row')) return;
            row.insertAdjacentHTML('afterend', detailRow(full));
            row.classList.add('is-open');
        });
    }

    // One delegated listener on the table body: the whole row is the click target
    // (the Details button included), while links keep their own behaviour.
    function bindDetails(root) {
        root.querySelectorAll('.hist-table tbody').forEach(function (tbody) {
            tbody.addEventListener('click', function (e) {
                const target = e.target;
                if (!target || !target.closest) return;
                if (target.closest('a, .hist-no-toggle')) return;
                const row = target.closest('tr.hist-row');
                if (row) toggleDetail(row);
            });
        });
    }

    function rankings(stats) {
        const skipped = (stats.top_skipped || []).map(function (r) {
            const pct = r.total ? Math.round(r.skipped / r.total * 100) : 0;
            return '<li><span class="hist-rank-name">' + esc(r.name) + '</span>' +
                '<span class="hist-rank-val">' + pct + '% skipped</span></li>';
        }).join('') || '<li class="hist-empty-row">Not enough data yet.</li>';
        const time = (stats.top_time || []).map(function (r) {
            return '<li><span class="hist-rank-name">' + esc(r.name) + '</span>' +
                '<span class="hist-rank-val">' + fmtDur(r.seconds) + '</span></li>';
        }).join('') || '<li class="hist-empty-row">Not enough data yet.</li>';
        return '<div class="hist-charts">' +
            '<div class="hist-chart"><h3>Most skipped</h3><ul class="hist-rank">' + skipped + '</ul></div>' +
            '<div class="hist-chart"><h3>Most time invested</h3><ul class="hist-rank">' + time + '</ul></div>' +
            '</div>';
    }

    // Pager under the log: 20 per page, newest first, no need to load them all.
    function pager() {
        const pages = Math.max(1, Math.ceil(totalSessions / PAGE_SIZE));
        if (pages <= 1) return '';
        const from = page * PAGE_SIZE + 1;
        const to = Math.min(totalSessions, (page + 1) * PAGE_SIZE);
        return '<div class="hist-pager">' +
            '<button class="btn small hist-page-btn" data-go="prev"' + (page <= 0 ? ' disabled' : '') +
            '>← Newer</button>' +
            '<span class="hist-page-info">' + from + '–' + to + ' of ' + totalSessions +
            ' <span class="hist-page-sub">page ' + (page + 1) + ' / ' + pages + '</span></span>' +
            '<button class="btn small hist-page-btn" data-go="next"' + (page >= pages - 1 ? ' disabled' : '') +
            '>Older →</button>' +
            '</div>';
    }

    function bindPager(root) {
        root.querySelectorAll('.hist-page-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (btn.disabled) return;
                page = Math.max(0, page + (btn.getAttribute('data-go') === 'next' ? 1 : -1));
                reloadSessions();
            });
        });
    }

    // Only the log is fetched again: the charts above do not move.
    function reloadSessions() {
        const box = $('histSessions');
        if (!box) return;
        api('/api/sessions?limit=' + PAGE_SIZE + '&offset=' + page * PAGE_SIZE).then(function (res) {
            totalSessions = (res && res.total) || 0;
            const list = (res && res.sessions) || [];
            if (!list.length && page > 0) {          // the log shrank under us
                page = Math.max(0, Math.ceil(totalSessions / PAGE_SIZE) - 1);
                return reloadSessions();
            }
            box.innerHTML = sessionsTable(list) + pager();
            bindPager(box);
            bindDetails(box);
        });
    }

    // Breakdown table: the same window grouped by day / area / exercise / slot.
    // The bar behind the name keeps it readable without an extra column.
    function pivotTable(stats) {
        const rows = groupBy === 'area' ? (stats.by_area || [])
            : groupBy === 'exercise' ? (stats.by_exercise || [])
                : groupBy === 'slot' ? (stats.by_slot || [])
                    : (stats.daily || []);
        if (!rows.length) {
            return '<div class="hist-empty">No practice in this period for this grouping.</div>';
        }
        const max = Math.max.apply(null, rows.map(function (r) {
            return r.seconds || 0;
        }).concat([1]));
        const head = groupBy === 'area' ? ['Area', 'Time', 'Share', 'Sessions', 'Avg']
            : groupBy === 'exercise' ? ['Exercise', 'Time', 'Sessions', 'Avg', 'Last practised']
                : groupBy === 'slot' ? ['Slot', 'Area', 'Time', 'Sessions', 'Avg']
                    : ['Day', 'Time', 'Sessions'];
        let html = '<div class="hist-pivot-wrap"><table class="hist-pivot"><thead><tr>' +
            head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
            '</tr></thead><tbody>';
        rows.forEach(function (r) {
            const secs = r.seconds || 0;
            const pct = Math.round(secs / max * 100);
            const label = groupBy === 'area' ? areaLabel(r.area_id)
                : groupBy === 'exercise' ? (r.name || '')
                    : groupBy === 'slot' ? (r.name || '')
                        : (r.date || '');
            const cells = [
                '<td class="hist-pivot-name"><span class="hist-pivot-fill" style="width:' + pct +
                '%"></span><span class="hist-pivot-label">' + esc(label) + '</span></td>',
                '<td class="hist-pivot-time">' + fmtDur(secs) + '</td>'
            ];
            if (groupBy === 'area') cells.push('<td>' + Math.round((r.share || 0) * 100) + '%</td>');
            if (groupBy === 'slot') cells.push('<td>' + esc(areaLabel(r.area_id)) + '</td>');
            cells.push('<td>' + (r.sessions || 0) + '</td>');
            cells.push('<td>' + (r.sessions ? fmtDur(Math.round(secs / r.sessions)) : '\u2014') + '</td>');
            if (groupBy === 'exercise') {
                cells.push('<td>' + esc(r.last_practiced_on || '\u2014') + '</td>');
            }
            html += '<tr>' + cells.join('') + '</tr>';
        });
        return html + '</tbody></table></div>';
    }

    function render(stats, sessions) {
        if (!stats || !stats.totals || !stats.totals.sessions) {
            return '<div class="hist-empty">No practice recorded in this period yet.' +
                '<br><span>Finish a routine in the app and it will show up here.</span></div>';
        }
        return kpiCards(stats) +
            '<div class="hist-charts">' +
            '<div class="hist-chart hist-chart-wide"><h3>Activity</h3>' +
            activityChart(stats.activity || stats.daily, stats.totals) + '</div>' +
            '<div class="hist-chart hist-chart-wide"><h3>Practice per ' + (days <= 60 ? 'day' : 'week') + '</h3>' +
            dailyChart(stats.daily) + '</div>' +
            '<div class="hist-chart hist-chart-wide"><h3>How exercises are closed</h3>' +
            donutChart(stats.states) + '</div>' +
            '<div class="hist-chart hist-chart-wide"><h3>When you practise</h3>' +
            heatmapChart(stats.heatmap) + '</div>' +
            '</div>' + rankings(stats) +
            '<h3 class="hist-h3">Breakdown</h3>' + pivotTable(stats) +
            '<h3 class="hist-h3">Last sessions</h3>' +
            '<div id="histSessions">' + sessionsTable(sessions) + pager() + '</div>';
    }

    function load(which) {
        if (which) days = which;
        const body = $('histBody');
        if (!body) return;
        document.querySelectorAll('.hist-range-btn').forEach(function (b) {
            b.classList.toggle('active', parseInt(b.getAttribute('data-days'), 10) === days);
        });
        fillFilters();
        body.innerHTML = '<div class="hist-empty">Loading…</div>';
        Promise.all([api(statsUrl()),
                     api('/api/sessions?limit=' + PAGE_SIZE + '&offset=' + page * PAGE_SIZE)])
            .then(function (res) {
                totalSessions = (res[1] && res[1].total) || 0;
                const list = (res[1] && res[1].sessions) || [];
                if (!list.length && page > 0) {          // page out of range
                    page = 0;
                    return load();
                }
                body.innerHTML = render(res[0], list);
                bindDetails(body);
                bindPager(body);
            });
    }

    function init() {
        document.querySelectorAll('.hist-range-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                load(parseInt(b.getAttribute('data-days'), 10) || RANGES[0]);
            });
        });
        const groupSel = $('histGroup');
        if (groupSel) {
            groupSel.addEventListener('change', function () {
                groupBy = this.value || 'day';
                load();
            });
        }
        const areaSel = $('histAreaFilter');
        if (areaSel) {
            areaSel.addEventListener('change', function () {
                filterArea = this.value;
                page = 0;
                load();
            });
        }
        const routineSel = $('histRoutineFilter');
        if (routineSel) {
            routineSel.addEventListener('change', function () {
                filterRoutine = this.value;
                page = 0;
                load();
            });
        }
    }

    GPH.history = { init: init, show: function () { load(); }, load: load };
    init();
})(window.GPH = window.GPH || {});

