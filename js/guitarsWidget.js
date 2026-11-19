// Dynamic "Guitar Maintenance" widget (cards + monthly mini-calendar).
(function (GPH) {
    'use strict';

    const HTML =
        '<div class="guitars-widget">' +
            '<div class="gw-head">' +
                '<div class="gw-heading"><span class="gw-title">String health</span>' +
                    '<span class="gw-sub">Full sets and partial string changes</span></div>' +
            '</div>' +
            '<div class="gw-cards"><div class="gw-empty">No guitars yet.</div></div>' +
            '<div class="gw-calendar">' +
                '<div class="gw-cal-head">' +
                    '<button type="button" class="gw-nav gw-prev" aria-label="Previous two months">&#8249;</button>' +
                    '<span class="gw-month"></span>' +
                    '<button type="button" class="gw-nav gw-next" aria-label="Next two months">&#8250;</button>' +
                '</div>' +
                '<div class="gw-months"></div>' +
                '<div class="gw-day-detail" hidden></div>' +
            '</div>' +
        '</div>';

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }

    function init(root) {
        const el = root.querySelector('.guitars-widget');
        if (!el || el.dataset.gwReady) return;
        el.dataset.gwReady = '1';
        const G = GPH.guitars;
        const state = {
            guitars: [], changes: [], models: [],
            month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            selectedDay: G.todayIso(), loadSeq: 0
        };
        const cards = el.querySelector('.gw-cards');
        const monthEl = el.querySelector('.gw-month');
        const monthsEl = el.querySelector('.gw-months');
        const detail = el.querySelector('.gw-day-detail');

        function renderCards() {
            const list = state.guitars;
            cards.innerHTML = '';
            if (!list.length) {
                const d = document.createElement('div');
                d.className = 'gw-empty';
                d.textContent = state.guitars.length ? 'Select a guitar to see it here.' :
                    'No guitars yet. Add one in Manager > Guitars.';
                cards.appendChild(d);
                return;
            }
            list.forEach(function (g) {
                const st = G.statusFor(g);
                const card = document.createElement('article');
                card.className = 'gw-card gw-tone-' + st.tone;
                card.style.setProperty('--guitar-color', g.color_hex || '#ff9800');
                const lastPartial = g.last_partial;
                card.innerHTML =
                    '<span class="gw-color"></span>' +
                    '<div class="gw-card-body">' +
                        '<div class="gw-card-top">' +
                            '<span class="gw-name"></span>' +
                            '<span class="gw-state gw-tone-' + st.tone + '"></span>' +
                        '</div>' +
                        '<div class="gw-card-info">' +
                            '<span class="gw-last-full"></span>' +
                            '<span class="gw-last-partial"></span>' +
                        '</div>' +
                    '</div>' +
                    '<button type="button" class="gw-btn gw-icon-btn gw-card-add" ' +
                        'title="Register change" aria-label="Register change">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
                            'stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>' +
                    '</button>';
                card.querySelector('.gw-name').textContent = g.name;
                card.querySelector('.gw-state').textContent = st.text;
                card.querySelector('.gw-last-full').textContent = g.last_full_date
                    ? 'Last full: ' + G.formatDate(g.last_full_date)
                    : 'Last full: \u2014';
                card.querySelector('.gw-last-partial').textContent = lastPartial
                    ? 'Last partial: ' + G.formatDate(lastPartial.date) + ' \u00b7 ' +
                        G.stringsLabel(lastPartial.changed_strings) +
                        (lastPartial.string_model ? ' \u00b7 ' + lastPartial.string_model : '')
                    : 'No partial changes yet';
                card.querySelector('.gw-card-add').addEventListener('click', function () {
                    G.openChangeDialog({
                        guitar: g, onSaved: function (saved) { afterSaved(saved); }
                    });
                });
                cards.appendChild(card);
            });
        }


        function changesByDay() {
            const map = {};
            state.changes.forEach(function (c) {
                (map[c.date] = map[c.date] || []).push(c);
            });
            return map;
        }

        function monthPanel(monthDate, byDay, today) {
            const y = monthDate.getFullYear();
            const m = monthDate.getMonth();
            const first = new Date(y, m, 1);
            const days = new Date(y, m + 1, 0).getDate();
            const panel = document.createElement('div');
            panel.className = 'gw-month-panel';

            const name = document.createElement('div');
            name.className = 'gw-month-name';
            name.textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            panel.appendChild(name);

            const dow = document.createElement('div');
            dow.className = 'gw-dow';
            ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (label) {
                const span = document.createElement('span');
                span.textContent = label;
                dow.appendChild(span);
            });
            panel.appendChild(dow);

            const grid = document.createElement('div');
            grid.className = 'gw-grid';
            // Monday-first: getDay() is Sunday=0, so move Sunday to the end.
            const leading = (first.getDay() + 6) % 7;
            for (let i = 0; i < leading; i++) {
                const blank = document.createElement('span');
                blank.className = 'gw-day gw-day-blank';
                grid.appendChild(blank);
            }
            for (let d = 1; d <= days; d++) {
                const date = iso(y, m, d);
                const list = byDay[date] || [];
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'gw-day' + (date === today ? ' gw-today' : '') +
                    (date === state.selectedDay ? ' gw-selected' : '') +
                    (list.length ? ' gw-has-changes' : '');
                btn.title = list.length
                    ? list.length + ' change' + (list.length === 1 ? '' : 's')
                    : G.formatDate(date);
                btn.addEventListener('click', function () {
                    state.selectedDay = date;
                    renderCalendar();
                    renderDayDetail();
                });
                const num = document.createElement('span');
                num.className = 'gw-day-num';
                num.textContent = String(d);
                btn.appendChild(num);
                if (list.length) {
                    const dots = document.createElement('span');
                    dots.className = 'gw-dots';
                    list.slice(0, 3).forEach(function (c) {
                        const dot = document.createElement('span');
                        dot.className = 'gw-dot ' + (c.type === 'full' ? 'gw-full' : 'gw-partial');
                        dot.style.setProperty('--guitar-color', c.guitar_color || '#ff9800');
                        dots.appendChild(dot);
                    });
                    if (list.length > 3) {
                        const more = document.createElement('span');
                        more.className = 'gw-more';
                        more.textContent = '+' + (list.length - 3);
                        dots.appendChild(more);
                    }
                    btn.appendChild(dots);
                }
                grid.appendChild(btn);
            }
            const trailing = (7 - (grid.children.length % 7)) % 7;
            for (let i = 0; i < trailing; i++) {
                const blank = document.createElement('span');
                blank.className = 'gw-day gw-day-blank';
                grid.appendChild(blank);
            }
            // Always reserve six weeks per month, even when the month needs
            // fewer rows, so the two panels do not jump when navigating.
            while (grid.children.length < 42) {
                const blank = document.createElement('span');
                blank.className = 'gw-day gw-day-blank';
                grid.appendChild(blank);
            }
            panel.appendChild(grid);
            return panel;
        }

        function renderCalendar() {
            const byDay = changesByDay();
            const today = G.todayIso();
            const first = state.month;
            const second = new Date(first.getFullYear(), first.getMonth() + 1, 1);
            const firstLabel = first.toLocaleDateString('en-US', { month: 'short' });
            const secondLabel = second.toLocaleDateString('en-US', { month: 'short' });
            const sameYear = first.getFullYear() === second.getFullYear();
            monthEl.textContent = sameYear
                ? firstLabel + ' \u2013 ' + secondLabel + ' ' + second.getFullYear()
                : firstLabel + ' ' + first.getFullYear() + ' \u2013 ' +
                    secondLabel + ' ' + second.getFullYear();
            monthsEl.innerHTML = '';
            monthsEl.appendChild(monthPanel(first, byDay, today));
            monthsEl.appendChild(monthPanel(second, byDay, today));
        }

        function renderDayDetail() {
            if (!state.selectedDay) { detail.hidden = true; return; }
            const list = state.changes.filter(function (c) {
                return c.date === state.selectedDay;
            });
            detail.hidden = false;
            detail.innerHTML = '';
            const head = document.createElement('div');
            head.className = 'gw-detail-head';
            head.textContent = G.formatDate(state.selectedDay) + ' \u00b7 ' +
                (list.length ? list.length + ' change' + (list.length === 1 ? '' : 's') :
                    'no changes');
            detail.appendChild(head);
            if (!list.length) {
                const empty = document.createElement('div');
                empty.className = 'gw-empty';
                empty.textContent = 'No string changes on this day.';
                detail.appendChild(empty);
                return;
            }
            list.forEach(function (c) {
                const row = document.createElement('div');
                row.className = 'gw-detail-row';
                row.innerHTML = '<span class="gw-color" style="background:' +
                    (c.guitar_color || '#ff9800') + '"></span>' +
                    '<b></b><span class="gw-kind"></span><span class="gw-detail-text"></span>';
                row.querySelector('b').textContent = c.guitar_name;
                row.querySelector('.gw-kind').textContent = c.type === 'full' ? 'Full set' : 'Partial';
                row.querySelector('.gw-detail-text').textContent = c.type === 'full'
                    ? c.string_model
                    : G.stringsLabel(c.changed_strings) +
                        (c.string_model ? ' \u00b7 ' + c.string_model : '');
                detail.appendChild(row);
                if (c.notes) {
                    const note = document.createElement('div');
                    note.className = 'gw-detail-note';
                    note.textContent = c.notes;
                    row.appendChild(note);
                }
            });
        }

        function afterSaved(saved) {
            if (saved && saved.date) {
                const d = G.parseIso(saved.date);
                if (d) state.month = new Date(d.getFullYear(), d.getMonth(), 1);
                state.selectedDay = saved.date;
            }
            loadAll();
        }

        function loadMonth() {
            const y = state.month.getFullYear();
            const m = state.month.getMonth();
            const nextY = m === 11 ? y + 1 : y;
            const nextM = (m + 1) % 12;
            const from = iso(y, m, 1);
            const to = iso(nextY, nextM, new Date(nextY, nextM + 1, 0).getDate());
            const seq = ++state.loadSeq;
            return G.api('GET', '/api/string-changes?active_only=1&limit=5000&from=' +
                from + '&to=' + to).then(function (rows) {
                    if (seq !== state.loadSeq) return;
                    state.changes = rows || [];
                    renderCalendar();
                    renderDayDetail();
                }).catch(function () { /* keep the last months visible */ });
        }

        function loadAll() {
            return Promise.all([G.listGuitars(false), G.getModels()]).then(function (res) {
                state.guitars = res[0] || [];
                state.models = res[1] || [];
                renderCards();
                return loadMonth();
            }).catch(function (err) {
                cards.innerHTML = '';
                const d = document.createElement('div');
                d.className = 'gw-empty gw-error-text';
                d.textContent = 'Could not load guitars: ' + err.message;
                cards.appendChild(d);
            });
        }

        el.querySelector('.gw-prev').addEventListener('click', function () {
            state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
            state.selectedDay = '';
            renderCalendar();
            detail.hidden = true;
            loadMonth();
        });
        el.querySelector('.gw-next').addEventListener('click', function () {
            state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
            state.selectedDay = '';
            renderCalendar();
            detail.hidden = true;
            loadMonth();
        });
        loadAll();
    }

    GPH.guitarsWidget = { HTML: HTML, init: init };
})(window.GPH = window.GPH || {});
