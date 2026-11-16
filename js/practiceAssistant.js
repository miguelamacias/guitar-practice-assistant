// Practice assistant: welcome screen, per-exercise timer,
// progress bar, sidebar with checks and navigation between exercises.
(function (GPH) {
    'use strict';

    let currentExerciseIndex = 0;
    let exerciseTimeTotal = 0;
    let exerciseTimeLeft = 0;
    let exerciseTimerInterval = null;
    let isExerciseRunning = false;
    let isExerciseFinished = false;
    let resourceApplied = false;
    // Outcome of each exercise in the current session: idx -> 'timed' | 'untimed' | 'skipped'.
    // A missing key means "pending" (not practiced yet).
    let exerciseStates = {};
    // Seconds actually played per exercise in this page load (kept while moving
    // between exercises; the countdown itself is not persisted across reloads).
    let playedSet = {};
    // Exercise clock: runs from the moment Play is pressed (not when the
    // exercise is shown), keeps running after the timer hits 0 (extra time) and
    // stops on Pause or when leaving. Stored per exercise in seconds.
    let clockSet = {};
    let clockStartedSet = {};
    let clockRunSince = null;
    const DONE_STATES = { timed: 1, untimed: 1 };
    // An exercise only counts as "timed" when at least half of its time was played.
    const TIMED_MIN_RATIO = 0.5;

    function rActiva() { return (GPH.data && GPH.data.activeRoutine) || { nombre: '', ejercicios: [] }; }

    // True when the dry-run flag is on (js/debug.js): nothing must be recorded.
    function debugMode() { return !!(GPH.debug && GPH.debug.on); }

    function setWelcomeName(name, totalMins) {
        const el = document.getElementById('welcomeRoutineName');
        el.textContent = name + ' ';
        const span = document.createElement('span');
        span.className = 'welcome-mins';
        span.textContent = '(' + totalMins + ' mins)';
        el.appendChild(span);
    }

    // Time helpers: 24h clock and relative day ("today", "yesterday", "3 days ago").
    function hhmm(d) {
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    // Legacy saved values ("07:42 PM") -> "19:42"
    function to24h(str) {
        const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(str || '').trim());
        if (!m) return str;
        let h = parseInt(m[1], 10) % 12;
        if (/PM/i.test(m[3])) h += 12;
        return String(h).padStart(2, '0') + ':' + m[2];
    }
    function relativeDay(then) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const day = new Date(then.getFullYear(), then.getMonth(), then.getDate());
        const days = Math.round((today - day) / 86400000);
        if (days <= 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 14) return days + ' days ago';
        return 'on ' + then.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    function fmtMinutes(mins) {
        if (mins == null || isNaN(mins) || mins <= 0) return '';
        if (mins < 60) return mins + ' min';
        const h = Math.floor(mins / 60), m = mins % 60;
        return h + ' h' + (m ? ' ' + m + ' min' : '');
    }

    // ---- Shared dark tooltip (welcome list, Start button…) ----------------
    // The native `title` cannot be styled, so both use the same `.ex-tip` panel.
    let tipEl = null;
    let tipTimer = null;

    function cancelTipTimer() {
        if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    }

    function hideTip() {
        cancelTipTimer();           // a pending panel must never appear later
        if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
        tipEl = null;
    }

    function tipPanel() {
        const tip = document.createElement('div');
        tip.className = 'ex-tip';
        tip.setAttribute('role', 'tooltip');
        return tip;
    }

    function showTip(anchor, node) {
        hideTip();
        if (!anchor || !node) return;
        tipEl = node;
        document.body.appendChild(node);
        const r = anchor.getBoundingClientRect();
        const t = node.getBoundingClientRect();
        const gap = 8;
        let top = r.bottom + gap;
        if (top + t.height > window.innerHeight - 8) top = Math.max(8, r.top - gap - t.height);
        const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - t.width - 8));
        node.style.top = Math.round(top) + 'px';
        node.style.left = Math.round(left) + 'px';
    }

    // Wires hover/focus once per element; `build()` returns the panel or null.
    // The pointer has to rest on the element for a moment before the panel shows,
    // like the native `title`: crossing the text must not open anything.
    const TIP_DELAY_MS = 800;

    function wireTip(el, build, opts) {
        if (!el || el._tipWired) return;
        el._tipWired = true;
        if (!opts || opts.focusable !== false) el.tabIndex = 0;
        const openNow = function () { cancelTipTimer(); showTip(el, build()); };
        el.addEventListener('mouseenter', function () {
            cancelTipTimer();
            tipTimer = setTimeout(openNow, TIP_DELAY_MS);
        });
        // hideTip() also drops a pending timer, so leaving or scrolling cancels it.
        el.addEventListener('mouseleave', hideTip);
        // Keyboard: focusing is already deliberate, so there is nothing to wait for.
        el.addEventListener('focus', openNow);
        el.addEventListener('blur', hideTip);
        window.addEventListener('scroll', hideTip, { passive: true });
    }

    // Text used by the Start button tooltip (updated on every init/refresh).
    let startTipText = '';

    function updateStartBtnTip() {
        const btn = document.getElementById('startRoutineBtn');
        if (!btn) return;
        btn.removeAttribute('title');                  // no native tooltip
        startTipText = '';

        const startISO = localStorage.getItem('lastRoutineStartedAt');
        const start = startISO ? new Date(startISO) : null;
        if (start && !isNaN(start.getTime())) {
            const endISO = localStorage.getItem('lastRoutineFinishedAt');
            const end = endISO ? new Date(endISO) : null;
            const finished = (end && !isNaN(end.getTime()) && end.getTime() >= start.getTime()) ? end : null;

            const dayLabel = relativeDay(start);
            startTipText = 'Last routine: ' + dayLabel + (/^on /.test(dayLabel) ? ' ' : ', ') + hhmm(start);
            if (finished) {
                startTipText += ' \u2192 ' + (sameDay(start, finished) ? hhmm(finished) : relativeDay(finished) + ' ' + hhmm(finished));
                const dur = fmtMinutes(Math.round((finished - start) / 60000));
                if (dur) startTipText += ' (' + dur + ')';
            }
        }
        btn.classList.toggle('has-tip', !!startTipText);
        if (startTipText) {
            wireTip(btn, function () { return buildLineTip(startTipText); }, { focusable: false });
        }
    }

    function buildLineTip(text) {
        if (!text) return null;
        const tip = tipPanel();
        tip.classList.add('ex-tip--line');
        const line = document.createElement('div');
        line.className = 'ex-tip-line';
        line.textContent = text;
        tip.appendChild(line);
        return tip;
    }

    // Free-text panel: descriptions can be several lines, so they are not
    // clamped like the exercise list rows.
    function buildDescTip(text) {
        text = String(text || '').trim();
        if (!text) return null;
        const tip = tipPanel();
        tip.classList.add('ex-tip--desc');
        const body = document.createElement('div');
        body.className = 'ex-tip-text';
        body.textContent = text;
        tip.appendChild(body);
        return tip;
    }

    function buildWelcomeTip() {
        const exs = rActiva().ejercicios || [];
        if (!exs.length) return null;
        const tip = tipPanel();
        exs.forEach(function (ex, i) {
            const row = document.createElement('div');
            row.className = 'ex-tip-row';
            const n = document.createElement('span');
            n.className = 'ex-tip-n'; n.textContent = (i + 1) + '.';

            const main = document.createElement('div');
            main.className = 'ex-tip-main';
            const name = document.createElement('span');
            name.className = 'ex-tip-name';
            // `Knowledge: Arpeggios` — area first, then the slot name, one line.
            appendAreaPrefix(name, 'ex-tip-area', ex);
            name.appendChild(document.createTextNode(ex.nombre || 'Exercise'));
            main.appendChild(name);

            // Second line: the exercise the slot points at right now, so the
            // preview answers both "what kind of slot" and "what exactly".
            const cat = slotExercise(ex);
            if (cat && cat.name) {
                const d = document.createElement('span');
                d.className = 'ex-tip-desc'; d.textContent = cat.name;
                main.appendChild(d);
            }

            const dur = document.createElement('span');
            dur.className = 'ex-tip-dur'; dur.textContent = formatDuration(ex.tiempo || 0);
            row.appendChild(n); row.appendChild(main); row.appendChild(dur);
            tip.appendChild(row);
        });
        return tip;
    }

    function initSimpleAssistant() {
        updateStartBtnTip();
        loadStates();
        loadSessionId();
        flushSessionQueue();
        hideTip();
        wireTimerFloat();
        const changeBtn = document.getElementById('exChangeBtn');
        if (changeBtn) changeBtn.addEventListener('click', openCatalogMenu);
        // The name is the thing you aim at: same action as the caret next to it.
        const mainName = document.getElementById('exMain');
        if (mainName) mainName.addEventListener('click', openCatalogMenu);
        const catalogMenu = document.getElementById('exCatalogMenu');
        if (catalogMenu) catalogMenu.addEventListener('keydown', catalogMenuKeys);
        // A click outside (menu or caret) closes it, like the Manager pickers.
        document.addEventListener('mousedown', function (e) {
            const menu = document.getElementById('exCatalogMenu');
            const btn = document.getElementById('exChangeBtn');
            if (!menu || menu.hidden) return;
            if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
            closeCatalogMenu();
        });
        const desc = document.getElementById('welcomeRoutineDesc');
        if (!rActiva().ejercicios.length) {
            const nameEl = document.getElementById('welcomeRoutineName');
            nameEl.innerHTML = GPH.icons.get('alert') + ' No active routine loaded';
            nameEl.classList.remove('has-tip');
            desc.textContent = 'Add or activate a routine in the Manager.';
            desc.classList.remove('has-tip');
            return;
        }

        const totalMins = getRoutineTotalMinutes();
        setWelcomeName(rActiva().nombre || 'Daily Guitar Routine', totalMins);
        // Hover / focus on the name: the routine description from the Manager.
        wireRoutineNameTip();
        desc.textContent = 'Contains ' + rActiva().ejercicios.length + ' slots to practice today.';
        // Hover / focus: the full list in a dark panel, one exercise per row.
        desc.classList.add('has-tip');
        wireTip(desc, buildWelcomeTip);

        // Check whether there is a previous session saved in the browser
        const savedActive = localStorage.getItem('routineSessionActive');
        if (savedActive === 'true' && orphanSession()) {
            // Leftover from a dry run (or from storage that was cleared): a live
            // session must have either a server id or a queued start request.
            // Drop the local copy and let the server restore the real one below.
            localStorage.setItem('routineSessionActive', 'false');
            localStorage.removeItem('currentExerciseIndex');
            exerciseStates = {};
            playedSet = {};
            saveStates();
        }
        // A routine still in progress in this browser: resumed only while the
        // server keeps it open (the 8 h rule). Otherwise it gets closed as
        // abandoned and we land on the welcome screen, ready for a clean start.
        if (localStorage.getItem('routineSessionActive') === 'true') {
            resumeLocalSession();
            return;
        }

        // Nothing live locally: the storage may have been wiped (or this is
        // another browser). Ask the server for a session still open.
        reconcileSession();
        showWelcomeScreen();
    }

    // The clock icon is an SVG from the HTML: only the text is updated, never the container.
    function setStartTimeLabel(timeString) {
        const t = document.getElementById('practiceStartTimeText');
        if (t) t.textContent = 'Start time: ' + to24h(timeString);
    }

    function showWelcomeScreen() {
        const wasRunning = localStorage.getItem('routineSessionActive') === 'true';
        pauseExerciseTimer();
        persistCurrentPlayed();
        if (clockRunSince !== null) clockStop();
        // Close the DB session with the final states, before they are wiped.
        if (wasRunning) sessionFinish();
        localStorage.setItem('routineSessionActive', 'false');
        localStorage.removeItem('currentExerciseIndex');
        exerciseStates = {};
        playedSet = {};
        clockSet = {};
        clockStartedSet = {};
        clockRunSince = null;
        try { localStorage.removeItem('routineStates'); } catch (e) {}
        try { localStorage.removeItem('routineCompleted'); } catch (e) {}
        // Finish button / skip on the last exercise: remember when the routine closed.
        // In a dry run nothing is recorded, so the tooltip keeps the last real one.
        if (!debugMode() && wasRunning && localStorage.getItem('lastRoutineStartedAt')) {
            localStorage.setItem('lastRoutineFinishedAt', new Date().toISOString());
        }
        updateStartBtnTip();
        document.getElementById('welcomeCard').classList.remove('is-hidden');
        document.getElementById('exerciseCard').classList.add('is-hidden');
        syncTimerFloat();
    }

    function startRoutineSession() {
        currentExerciseIndex = 0;

        const now = new Date();
        const timeString = hhmm(now);

        localStorage.setItem('routineSessionActive', 'true');
        exerciseStates = {};
        playedSet = {};
        clockSet = {};
        clockStartedSet = {};
        clockRunSince = null;
        saveStates();
        sessionStart();
        localStorage.setItem('currentExerciseIndex', currentExerciseIndex);
        localStorage.setItem('practiceStartTimeVal', timeString);
        if (!debugMode()) localStorage.setItem('lastRoutineStartedAt', now.toISOString());

        setStartTimeLabel(timeString);
        hideTip();

        document.getElementById('welcomeCard').classList.add('is-hidden');
        document.getElementById('exerciseCard').classList.remove('is-hidden');
        displayCurrentExercise();
    }

    // "Slot 2 of 8 · done" / "· skipped" (no suffix while pending).
    function setIndexLabel() {
        const el = document.getElementById('exIndex');
        if (!el) return;
        const state = exerciseStates[currentExerciseIndex];
        let suffix = '';
        if (DONE_STATES[state]) suffix = ' \u00b7 done';
        else if (state === 'skipped') suffix = ' \u00b7 skipped';
        el.textContent = 'Slot ' + (currentExerciseIndex + 1) + ' of ' +
            (rActiva().ejercicios || []).length + suffix;
    }

    // ---- Slot header: area, current exercise and the picker ----------------
    // Line 1 is the slot (name · area · duration); line 2 is the working
    // content: the catalog exercise, or the description the slot always carried
    // when it has none. The picker is locked while an attempt is live (§9.3).
    let catalogCache = null;
    let catalogLoading = null;
    let pathsCache = null;
    let pathsLoading = null;

    function slotExercise(ex) { return (ex && ex.catalog_exercise) || null; }

    // `Knowledge: ` in front of a slot name (welcome list, exercise list).
    // Written as its own span so the area stays dimmer than the name.
    function appendAreaPrefix(parent, cls, ex) {
        const area = String((ex && ex.area) || '').trim();
        if (!area) return;
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = area + ': ';
        parent.appendChild(span);
    }

    // Text shown when hovering the exercise name: the description of the catalog
    // exercise (the only place descriptions live now).
    function slotDescText(ex) {
        const cat = slotExercise(ex);
        return cat && cat.description ? String(cat.description).trim() : '';
    }

    // Panel for the exercise on screen. Null when the slot has no exercise: the
    // line already shows the slot text itself, so a copy on hover adds nothing.
    function currentExerciseDescTip() {
        const ex = rActiva().ejercicios[currentExerciseIndex];
        return slotExercise(ex) ? buildDescTip(slotDescText(ex)) : null;
    }

    // The routine description lives only in the database: hover / focus on the
    // routine name opens it in the same dark panel used for the Start button.
    function wireRoutineNameTip() {
        const el = document.getElementById('welcomeRoutineName');
        if (!el) return;
        const text = String(rActiva().descripcion || '').trim();
        el.classList.toggle('has-tip', !!text);
        if (!text) return;
        wireTip(el, function () { return buildDescTip(text); });
    }

    // Live attempt: started and not resolved yet (a pause keeps the lock).
    function attemptLive(idx) {
        return !!clockStartedSet[idx] && !DONE_STATES[exerciseStates[idx]];
    }

    function updateChangeLock() {
        const btn = document.getElementById('exChangeBtn');
        if (!btn) return;
        const ex = rActiva().ejercicios[currentExerciseIndex];
        const live = attemptLive(currentExerciseIndex);
        btn.disabled = live;
        btn.title = live
            ? 'The attempt is live: change it when the timer ends or press Reset'
            : (slotExercise(ex) ? 'Change exercise' : 'Pick an exercise from the catalog');
    }

    function renderSlotHeader(mode) {
        const ex = rActiva().ejercicios[currentExerciseIndex];
        if (!ex) return;
        if (mode !== 'keep') closeCatalogMenu();
        const title = document.getElementById('exTitle');
        if (title) title.textContent = ex.nombre;   // the time lives in the timer
        const cat = slotExercise(ex);
        const areaEl = document.getElementById('exAreaInline');
        if (areaEl) {
            areaEl.textContent = ex.area || 'No area';
            areaEl.className = 'ex-area-inline' + (ex.area_id ? '' : ' is-empty');
        }
        const mainEl = document.getElementById('exMain');
        if (mainEl) {
            const path = slotPath(ex);
            mainEl.textContent = cat ? cat.name
                : (path ? path.name + ' \u2014 pick one' : '');
            mainEl.className = 'ex-main' + (cat ? ' is-exercise' : (path ? ' is-path-hint' : ''));
            // Hover on the exercise name (not on the slot name): its description,
            // which is not displayed anywhere else. Only when the slot points at
            // an exercise: without one the line already shows the slot text.
            const descText = cat ? slotDescText(ex) : '';
            mainEl.classList.toggle('has-tip', !!descText);
            if (descText) {
                wireTip(mainEl, currentExerciseDescTip);
            }
        }
        const btn = document.getElementById('exChangeBtn');
        if (btn) btn.removeAttribute('hidden');
        updateChangeLock();
    }

    function loadCatalog() {
        if (catalogCache) return Promise.resolve(catalogCache);
        if (catalogLoading) return catalogLoading;
        catalogLoading = fetch('/api/catalog', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : { exercises: [] }; })
            .then(function (d) { catalogCache = (d && d.exercises) || []; return catalogCache; })
            .catch(function () { catalogCache = []; return catalogCache; });
        return catalogLoading;
    }

    // Learning paths: only the picker needs them, cached like the catalog.
    // A failure is not fatal: the picker falls back to the whole catalog.
    function loadPaths() {
        if (pathsCache) return Promise.resolve(pathsCache);
        if (pathsLoading) return pathsLoading;
        pathsLoading = fetch('/api/paths', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : { paths: [] }; })
            .then(function (d) { pathsCache = (d && d.paths) || []; return pathsCache; })
            .catch(function () { pathsCache = []; return pathsCache; });
        return pathsLoading;
    }

    // The path of a slot, from the cache when possible (the payload already
    // carries id and name, so the header can be rendered before the fetch lands).
    function slotPath(ex) {
        const pid = ex && ex.catalog_path_id;
        if (pid == null) return null;
        const found = (pathsCache || []).filter(function (p) { return p.id === pid; })[0];
        if (found) return found;
        return ex.catalog_path ? { id: pid, name: ex.catalog_path.name || '', steps: [] } : null;
    }

    // ---- Catalog menu ------------------------------------------------------
    // A floating list anchored under the exercise name. The line does not move:
    // the menu is positioned absolutely inside the centred row.
    let menuItems = [];
    let menuIndex = -1;

    function menuEl() { return document.getElementById('exCatalogMenu'); }

    function closeCatalogMenu() {
        const menu = menuEl();
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        menu.innerHTML = '';
        menuIndex = -1;
        const btn = document.getElementById('exChangeBtn');
        if (btn) btn.classList.remove('is-open');
    }

    function positionCatalogMenu(menu) {
        const row = document.getElementById('exDescription');
        const main = document.getElementById('exMain');
        if (!row || !main) return;
        const rr = row.getBoundingClientRect();
        const mr = main.getBoundingClientRect();
        const width = Math.max(220, Math.min(460, Math.ceil(mr.width) + 60));
        const left = Math.max(2, Math.min(mr.left - rr.left - 10, rr.width - width - 2));
        menu.style.left = left + 'px';
        menu.style.top = (mr.bottom - rr.top + 6) + 'px';
        menu.style.width = width + 'px';
    }

    function highlightMenuOption() {
        const menu = menuEl();
        if (!menu) return;
        const options = Array.prototype.slice.call(
            menu.querySelectorAll('.ex-catalog-option'));
        options.forEach(function (opt, i) {
            opt.classList.toggle('is-highlighted', i === menuIndex);
        });
        const active = options[menuIndex];
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    function openCatalogMenu() {
        const ex = rActiva().ejercicios[currentExerciseIndex];
        const menu = menuEl();
        const btn = document.getElementById('exChangeBtn');
        if (!ex || !menu || attemptLive(currentExerciseIndex)) return;
        if (!menu.hidden) { closeCatalogMenu(); return; }   // the caret toggles it
        Promise.all([loadCatalog(), loadPaths()]).then(function (res) {
            const list = res[0];
            const path = slotPath(ex);
            // A path only narrows the picker when its steps are known: an empty
            // path (or a failed /api/paths) falls back to the whole catalog.
            const steps = (path && path.steps) || [];
            const hasPool = steps.length > 0;
            const currentId = ex.catalog_exercise_id == null ? null : ex.catalog_exercise_id;
            // With a path the picker only offers its steps (path order); without
            // one, the whole catalog. A stale exercise outside the path stays
            // visible so it can be recognised and replaced.
            const pool = hasPool
                ? steps.map(function (s) {
                    const known = list.filter(function (c) {
                        return c.id === s.catalog_exercise_id;
                    })[0];
                    return { id: s.catalog_exercise_id, name: s.name || (known ? known.name : '') };
                })
                : list.map(function (c) { return { id: c.id, name: c.name }; });
            menuItems = [{ id: null, name: '\u2014 No exercise \u2014' }].concat(pool);
            if (hasPool && currentId != null &&
                !menuItems.some(function (it) { return it.id === currentId; })) {
                const known = list.filter(function (c) { return c.id === currentId; })[0];
                menuItems.splice(1, 0, {
                    id: currentId,
                    name: (known ? known.name : 'exercise ' + currentId) + ' (not in path)'
                });
            }
            menu.innerHTML = '';
            if (hasPool) {
                const head = document.createElement('div');
                head.className = 'ex-catalog-head';
                head.textContent = path.name + ' \u00b7 ' + steps.length +
                    ' step' + (steps.length === 1 ? '' : 's');
                menu.appendChild(head);
            }
            menuItems.forEach(function (item, i) {
                const opt = document.createElement('button');
                opt.type = 'button';
                opt.className = 'ex-catalog-option' + (item.id === currentId ? ' is-current' : '');
                opt.setAttribute('role', 'option');
                opt.textContent = item.name;
                opt.addEventListener('click', function () { chooseCatalogItem(i); });
                menu.appendChild(opt);
            });
            menu.hidden = false;
            if (btn) btn.classList.add('is-open');
            menuIndex = Math.max(0, menuItems.findIndex(function (it) { return it.id === currentId; }));
            highlightMenuOption();
            positionCatalogMenu(menu);
            menu.focus();
        });
    }

    function chooseCatalogItem(i) {
        const item = menuItems[i];
        if (!item) return;
        closeCatalogMenu();
        changeSlotExercise(item.id == null ? '' : String(item.id));
    }

    function catalogMenuKeys(e) {
        if (e.key === 'Escape') { e.preventDefault(); closeCatalogMenu(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!menuItems.length) return;
            const step = e.key === 'ArrowDown' ? 1 : -1;
            menuIndex = (menuIndex + step + menuItems.length) % menuItems.length;
            highlightMenuOption();
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            if (menuIndex >= 0) { e.preventDefault(); chooseCatalogItem(menuIndex); }
        }
    }

    function changeSlotExercise(value) {
        const ex = rActiva().ejercicios[currentExerciseIndex];
        if (!ex) return;
        const cid = value ? Number(value) : null;
        fetch('/api/exercises/' + ex.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ catalog_exercise_id: cid })
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function () {
            // Only the slot pointer moves: the attempt already recorded in the
            // session log keeps the exercise that was practised.
            ex.catalog_exercise_id = cid;
            ex.catalog_exercise = null;
            if (cid) {
                const found = (catalogCache || []).filter(function (c) { return c.id === cid; })[0];
                if (found) {
                    ex.catalog_exercise = { id: found.id, name: found.name,
                                            description: found.description || '' };
                }
            }
            renderSlotHeader();
        }).catch(function (e) {
            renderSlotHeader();
            alert('Could not change the exercise (' + e.message + ')');
        });
    }

    // Seconds really played for an exercise. After a page reload the countdown is
    // restarted, so a "timed" completion counts as fully played and a manual one
    // as not played at all (the progress bar must not fake 100 %).
    function playedFor(idx, ex) {
        if (Object.prototype.hasOwnProperty.call(playedSet, idx)) return playedSet[idx];
        return exerciseStates[idx] === 'timed' ? ((ex && ex.tiempo) || 0) : 0;
    }

    // Stores how much of the current exercise has really been played, so switching
    // away and back keeps the true elapsed time.
    function persistCurrentPlayed() {
        const ex = rActiva().ejercicios[currentExerciseIndex];
        if (!ex) return;
        const played = Math.round(Math.max(0, exerciseTimeTotal - exerciseTimeLeft));
        if (!played) return;
        playedSet[currentExerciseIndex] = Math.max(playedSet[currentExerciseIndex] || 0, played);
    }

    // 50 % rule: below half of the planned time it is "done without timer".
    function classifyDone(idx, ex) {
        const total = (ex && ex.tiempo) || 0;
        const played = playedFor(idx, ex);
        if (total <= 0) return played > 0 ? 'timed' : 'untimed';
        return played >= total * TIMED_MIN_RATIO ? 'timed' : 'untimed';
    }

    // ---- Exercise clock ---------------------------------------------------
    // Runs only while the exercise is being worked on: starts with Play, keeps
    // going after the countdown reaches 0 (extra time) and stops on Pause or
    // when leaving the exercise. Opening an exercise does NOT start it.
    function clockStart() {
        if (clockRunSince !== null) return;
        clockRunSince = Date.now();
        if (!clockStartedSet[currentExerciseIndex]) {
            clockStartedSet[currentExerciseIndex] = new Date().toISOString();
        }
    }

    function clockStop() {
        if (clockRunSince === null) return;
        clockSet[currentExerciseIndex] =
            (clockSet[currentExerciseIndex] || 0) + (Date.now() - clockRunSince) / 1000;
        clockRunSince = null;
    }

    // Seconds "real" for an exercise: the clock if it ran, otherwise a done
    // exercise declares its planned time and a skipped one declares nothing.
    function elapsedFor(idx, ex) {
        const running = (idx === currentExerciseIndex && clockRunSince !== null)
            ? (Date.now() - clockRunSince) / 1000 : 0;
        const clock = (clockSet[idx] || 0) + running;
        if (clock > 0) return Math.round(clock);
        return DONE_STATES[exerciseStates[idx]] ? ((ex && ex.tiempo) || 0) : 0;
    }

    function displayCurrentExercise() {
        clearAlarmFlash();
        resourceApplied = false;
        clockRunSince = null;          // a new exercise: the clock waits for Play
        const ejercicio = rActiva().ejercicios[currentExerciseIndex];

        setIndexLabel();
        renderSlotHeader();

        exerciseTimeTotal = ejercicio.tiempo;
        exerciseTimeLeft = Math.max(0, (ejercicio.tiempo || 0) - playedFor(currentExerciseIndex, ejercicio));
        isExerciseFinished = exerciseTimeLeft <= 0;
        updateResourceTag(ejercicio);

        updateTimerDisplay();
        updateProgressBar();
        renderExerciseSidebar();
        updateNextButtonState();

        const playBtn = document.getElementById('exPlayBtn');
        if (playBtn) {
            playBtn.classList.remove('is-playing');
            playBtn.innerHTML = GPH.icons.get('play') + ' Play';
            if (isExerciseFinished) {
                playBtn.disabled = true;
                playBtn.classList.add('is-ended');
            } else {
                playBtn.disabled = false;
                playBtn.classList.remove('is-ended');
            }
        }
    }

    function formatDuration(t) {
        if (t < 60) return t + 's';
        const min = t / 60;
        const shown = Number.isInteger(min) ? min : Math.round(min * 100) / 100;
        return shown + ' min';
    }

    function lightningSvg() {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '13');
        svg.setAttribute('height', '13');
        svg.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', 'M13 2 L4 14 h6 l-1 8 L20 10 h-7 z');
        p.setAttribute('fill', 'currentColor');
        svg.appendChild(p);
        return svg;
    }

    // "Section: TAG - label" built from the live section data. The label stored
    // in the DB is only a snapshot (it used to drop the item tag), so the live
    // one wins whenever the resource URL still points to a section item.
    let urlLabels = null;
    let urlLabelsLoading = false;

    function indexSectionLabels(secs) {
        const idx = {};
        (secs || []).forEach(function (sec) {
            const prefix = sec.title ? (sec.title + ': ') : '';
            (sec.items || []).forEach(function (it) {
                if (!it.url) return;
                const base = (it.label || it.tag || '').trim();
                if (!base) return;
                const text = (it.tag && base.indexOf(it.tag) !== 0) ? (it.tag + ' - ' + base) : base;
                idx[it.url] = prefix + text;
                if (it.kind === 'song') idx['/api/media?path=' + encodeURIComponent(it.url)] = prefix + text;
            });
        });
        return idx;
    }

    function loadSectionLabels() {
        if (urlLabels || urlLabelsLoading) return;
        if (!(GPH.api && GPH.api.getSections)) return;
        urlLabelsLoading = true;
        GPH.api.getSections().then(function (secs) {
            urlLabels = indexSectionLabels(secs);
            urlLabelsLoading = false;
            const card = document.getElementById('exerciseCard');
            if (card && !card.classList.contains('is-hidden')) {
                updateResourceTag(rActiva().ejercicios[currentExerciseIndex]);
            }
        }).catch(function () { urlLabelsLoading = false; });
    }

    function liveLabel(url) {
        return (urlLabels && url && urlLabels[url]) || '';
    }

    // Label of a single resource, e.g. "Metronome · 120 BPM".
    function singleResourceLabel(res) {
        if (!res || !res.kind) return '';
        const k = res.kind;
        if (k === 'metronome' || k === 'drums') {
            const base = res.label || (k === 'metronome' ? 'Metronome' : 'Drum Machine');
            return base + ' · ' + (res.bpm || 120) + ' BPM';
        }
        const live = liveLabel(res.url);
        if (live) return live;
        return res.label ||
            (k === 'youtube' ? 'YouTube video' : k === 'fretboard' ? 'Fretboard Trainer' : k === 'theory' ? 'Theory' : 'Audio');
    }

    // Tag of the exercise card: the first resource plus "+N" when there are more.
    function resourceLabel(ex) {
        const labels = resourcesOf(ex).map(singleResourceLabel).filter(Boolean);
        if (!labels.length) return '';
        return labels.length > 1 ? labels[0] + '  +' + (labels.length - 1) : labels[0];
    }

    let statsToken = 0;
    function fmtProj(n) {
        var r = Math.round(Number(n) * 10) / 10;
        return (Math.abs(r - Math.round(r)) < 1e-9) ? String(Math.round(r)) : r.toFixed(1);
    }
    function loadFretboardStats(resEl, durationSec) {
        const myToken = ++statsToken;
        const minutes = (Number(durationSec) || 0) / 60;
        fetch('/api/fretboard/stats', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (myToken !== statsToken || !resEl) return;
                const span = document.createElement('span');
                span.className = 'ex-stats';
                if (!d || !d.count) {
                    span.textContent = ' · No data';
                } else {
                    var lastProjected = (d.last || 0) * minutes;
                    span.textContent = ' · Last score: ' + fmtProj(lastProjected) + ', Avg score: ' + fmtProj(d.avg) + '/min';
                }
                resEl.appendChild(span);
            }).catch(function () {});
    }

    function updateResourceTag(ex) {
        const resEl = document.getElementById('exResource');
        if (!resEl) return;
        loadSectionLabels();
        const list = resourcesOf(ex);
        const rl = resourceLabel(ex);
        resEl.innerHTML = '';
        if (!rl) return;
        resEl.appendChild(lightningSvg());
        resEl.appendChild(document.createTextNode(rl));
        // Full list on hover when there is more than one resource.
        const all = list.map(function (r) { return singleResourceLabel(r); }).filter(Boolean);
        resEl.title = all.length > 1 ? all.join('\n') : '';
        if (list.some(function (r) { return r.kind === 'fretboard'; })) {
            loadFretboardStats(resEl, ex.tiempo);
        }
    }

    function renderExerciseSidebar() {
        const sidebar = document.getElementById('exerciseListSidebar');
        sidebar.innerHTML = '';

        const title = document.createElement('div');
        title.className = 'ex-sidebar-title';
        const titleIcon = document.createElement('span');
        titleIcon.className = 'ex-sidebar-icon';
        titleIcon.innerHTML = GPH.icons.get('clipboard');
        const titleName = document.createElement('span');
        titleName.textContent = rActiva().nombre;
        title.appendChild(titleIcon); title.appendChild(titleName);
        sidebar.appendChild(title);

        rActiva().ejercicios.forEach(function (ex, idx) {
            const isCurrent = idx === currentExerciseIndex;
            const state = exerciseStates[idx];
            const isCompleted = !!DONE_STATES[state];
            const isSkipped = state === 'skipped';

            const row = document.createElement('div');
            row.className = 'ex-row';
            if (isCurrent) row.classList.add('is-current');
            if (isCompleted) row.classList.add('is-completed');
            if (isSkipped) row.classList.add('is-skipped');
            row.style.cursor = 'pointer';
            row.title = isCompleted ? 'Completed in this session'
                : isSkipped ? 'Skipped in this session (not practiced)'
                : 'Open this exercise';
            row.addEventListener('click', function () { goToExercise(idx); });

            const check = document.createElement('span');
            check.className = 'ex-check';
            check.innerHTML = GPH.icons.get(isSkipped ? 'chevrons' : (isCompleted ? 'check-box' : 'box'));
            row.appendChild(check);

            const name = document.createElement('span');
            name.className = 'ex-name';
            // `Knowledge: Arpeggios` — the area and the slot in one line, so the
            // plan reads at a glance while practising.
            appendAreaPrefix(name, 'ex-row-area', ex);
            name.appendChild(document.createTextNode(ex.nombre));
            name.title = (ex.area ? ex.area + ': ' : '') + ex.nombre;
            row.appendChild(name);

            if (resourcesOf(ex).length) {
                const ic = document.createElement('span');
                ic.className = 'ex-res-icon';
                ic.title = 'Auto: ' + resourceLabel(ex);
                ic.appendChild(lightningSvg());
                row.appendChild(ic);
            }

            const dur = document.createElement('span');
            dur.className = 'ex-duration';
            dur.textContent = formatDuration(ex.tiempo);
            row.appendChild(dur);

            sidebar.appendChild(row);
        });

        const total = document.createElement('div');
        total.className = 'ex-sidebar-total';
        total.innerHTML = GPH.icons.get('clock') + ' ' + getRoutineTotalMinutes() + ' mins';
        sidebar.appendChild(total);

        const cur = sidebar.querySelector('.is-current');
        if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }

    // ---- Floating clock ---------------------------------------------------
    // A second copy of the countdown, shown only while the real clock is out
    // of view (a resource below the card can push it off screen). It is a
    // visual duplicate: aria-hidden in the markup, pointer-events none in CSS.
    let timerFloatShown = false;
    let mainTimerVisible = true;
    let timerFloatWired = false;

    function mainTimerRendered() {
        const main = document.getElementById('exTimer');
        return !!(main && main.getClientRects().length);   // false inside display:none
    }

    function syncTimerFloat() {
        const card = document.getElementById('exerciseCard');
        const pill = document.getElementById('exTimerFloat');
        if (!card || !pill) return;
        // Hidden when the assistant is not showing the running card, when its
        // section is collapsed, or when the card is not rendered at all.
        const hidden = card.classList.contains('is-hidden') ||
            !!card.closest('.collapsed') || !mainTimerRendered();
        const show = !hidden && !mainTimerVisible;
        if (show === timerFloatShown) return;
        timerFloatShown = show;
        pill.classList.toggle('is-visible', show);
    }

    function wireTimerFloat() {
        if (timerFloatWired) return;
        const main = document.getElementById('exTimer');
        if (!main || !('IntersectionObserver' in window)) return;   // no support: never shows
        timerFloatWired = true;
        new IntersectionObserver(function (entries) {
            mainTimerVisible = entries[entries.length - 1].isIntersecting;
            syncTimerFloat();
        }, { threshold: 0 }).observe(main);
    }

    function updateTimerDisplay() {
        const minutes = Math.floor(exerciseTimeLeft / 60);
        const seconds = Math.floor(exerciseTimeLeft % 60);
        const text = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        document.getElementById('exTimer').textContent = text;
        const float = document.getElementById('exTimerFloatValue');
        if (float) float.textContent = text;
        // Re-evaluating once per tick keeps the pill honest when the section is
        // collapsed or expanded while the clock is out of view.
        syncTimerFloat();
    }

    function updateProgressBar() {
        const progressBar = document.getElementById('exProgressBar');
        if (!exerciseTimeTotal || exerciseTimeTotal <= 0) {
            progressBar.style.width = '0%';
            progressBar.classList.remove('is-done');
            return;
        }

        const elapsed = exerciseTimeTotal - exerciseTimeLeft;
        const percentage = Math.min(100, Math.max(0, (elapsed / exerciseTimeTotal) * 100));

        progressBar.style.width = percentage + '%';

        if (isExerciseFinished || percentage >= 100) {
            progressBar.classList.add('is-done');
        } else {
            progressBar.classList.remove('is-done');
        }
    }

    // Next exercise NOT resolved yet (wraps around; returns -1 if none left).
    // "Resolved" = done (timed/untimed) or explicitly skipped.
    function nextPendingIndex(from) {
        const exs = rActiva().ejercicios || [];
        const n = exs.length;
        if (n <= 1) return -1;
        for (let i = 1; i < n; i++) {
            const idx = (from + i) % n;
            if (!exerciseStates[idx]) return idx;
        }
        return -1;
    }

    function updateResetButton() {
        const btn = document.getElementById('exResetBtn');
        if (!btn) return;
        const state = exerciseStates[currentExerciseIndex];
        const done = !!DONE_STATES[state];
        const skipped = state === 'skipped';
        const label = done ? 'Repeat exercise' : (skipped ? 'Undo skip' : 'Reset exercise');
        const span = btn.querySelector('span');
        if (span) span.textContent = label;
        else btn.appendChild(document.createTextNode(label));
        btn.title = done ? 'Repeat this exercise (clears its check mark)'
            : skipped ? 'Clear the skip and practice the exercise'
            : 'Reset the exercise timer';
        btn.classList.toggle('is-repeat', !!state);
    }

    function updateNextButtonState() {
        const nextBtn = document.getElementById('exNextBtn');
        if (!nextBtn) return;
        const currentDone = !!DONE_STATES[exerciseStates[currentExerciseIndex]];
        const pending = nextPendingIndex(currentExerciseIndex);

        // Done: the row flips to "Play · Next exercise" (Next on the right).
        const controls = nextBtn.parentElement;
        if (controls) controls.classList.toggle('is-done', currentDone);

        nextBtn.classList.remove('is-ready', 'is-finish');

        if (currentDone && pending < 0) {
            nextBtn.innerHTML = GPH.icons.get('check') + ' Finish routine';
            nextBtn.classList.add('is-finish');
        } else if (currentDone) {
            nextBtn.innerHTML = GPH.icons.get('next') + ' Next exercise';
            nextBtn.classList.add('is-ready');
        } else {
            nextBtn.innerHTML = GPH.icons.get('check') + ' Mark done';
        }

        renderExerciseSidebar();
        updateResetButton();
        updateSkipButton();
    }

    // "Skip" makes no sense once the exercise is done (timer ended or marked
    // done by hand): there is nothing left to skip.
    function updateSkipButton() {
        const btn = document.getElementById('exSkipBtn');
        if (!btn) return;
        const done = !!DONE_STATES[exerciseStates[currentExerciseIndex]] || isExerciseFinished;
        btn.disabled = done;
        btn.title = done ? 'Already completed - nothing to skip'
            : 'Skip this exercise (not practiced)';
    }

    // ---- Theory resources -------------------------------------------------
    // Stored in `recurso_url` as a query string, e.g.
    //   view=scales&kind=scale&type=Dorian&root=2
    //   view=chords&root=D&mode=dorian&seventh=0
    //   view=diagrams&root=A&quality=m7
    const THEORY_VIEWS = {
        scales: 'sub-fretboard-theory',
        chords: 'sub-fretboard-chords',
        diagrams: 'sub-fretboard-chord-diagrams'
    };

    function parseResourceParams(url) {
        const out = {};
        String(url || '').split('&').forEach(function (kv) {
            if (!kv) return;
            const i = kv.indexOf('=');
            if (i < 0) return;
            try {
                out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
            } catch (e) { /* noop */ }
        });
        return out;
    }

    // Opens the Theory subsection of the exercise and applies its parameters.
    // `url` is the encoded resource ("view=scales&kind=scale&type=Dorian&root=2").
    function applyTheoryResource(url) {
        const p = parseResourceParams(url);
        const view = THEORY_VIEWS[p.view] ? p.view : 'scales';
        const el = document.getElementById(THEORY_VIEWS[view]);
        if (!el || el.style.display === 'none') return;   // subsection disabled in Settings
        if (GPH.ui && GPH.ui.revealInPage) GPH.ui.revealInPage(el);

        if (view === 'scales') {
            if (GPH.theory && GPH.theory.apply) {
                GPH.theory.apply({ kind: p.kind, type: p.type, root: p.root });
            }
        } else if (view === 'chords') {
            if (GPH.chords && GPH.chords.apply) {
                GPH.chords.apply({ root: p.root, mode: p.mode, seventh: p.seventh === '1' });
            }
        } else if (GPH.chordDiagrams && GPH.chordDiagrams.apply) {
            GPH.chordDiagrams.apply({ root: p.root, quality: p.quality });
        }
    }

    function expandWidget(boxId) {
        const box = document.getElementById(boxId);
        if (!box) return;
        if (GPH.ui && GPH.ui.revealInPage) { GPH.ui.revealInPage(box); return; }
        const content = box.closest('.subfolder-content, .subfolder-content-drum-machine');
        if (!content) return;
        content.classList.remove('collapsed');
        const toggle = content.previousElementSibling;
        if (toggle && toggle.classList.contains('subfolder-toggle')) {
            toggle.classList.remove('collapsed');
            if (GPH.sections && GPH.sections.saveSubfolder) GPH.sections.saveSubfolder(toggle);
        }
    }

    // Resources of an exercise as a list (falls back to the legacy single fields).
    function resourcesOf(ex) {
        if (!ex) return [];
        if (ex.recursos && ex.recursos.length) return ex.recursos;
        if (ex.recurso_kind) {
            return [{ kind: ex.recurso_kind, url: ex.recurso_url || '', bpm: ex.recurso_bpm || 0, label: ex.recurso_label || '' }];
        }
        return [];
    }

    function applyExerciseResource(ex) {
        if (!ex) return;
        const list = resourcesOf(ex);
        if (!list.length) return;
        let audioUsed = false;                 // only one backing track at a time

        list.forEach(function (res) {
            const kind = res.kind;
            const url = res.url || '';
            const bpm = res.bpm || 0;

            if (kind === 'audio') {
                if (audioUsed || !url) return;
                audioUsed = true;
                if (GPH.players && GPH.players.playAudio) {
                    GPH.players.playAudio(url, ex.nombre || res.label || 'Backing track');
                }
            } else if (kind === 'youtube') {
                if (audioUsed || !url) return;
                audioUsed = true;
                if (GPH.players && GPH.players.getYouTubeId) {
                    const id = GPH.players.getYouTubeId(url);
                    if (id) GPH.players.openYouTube(id, ex.nombre || 'Video', url);
                }
            } else if (kind === 'metronome') {
                if (document.getElementById('metronomeBox') && GPH.metronome) {
                    expandWidget('metronomeBox');
                    GPH.metronome.updateBpm(bpm || 120);
                    // Saved signature + pattern of this exercise (may be absent)
                    if (GPH.metronome.applyConfig) GPH.metronome.applyConfig(res.cfg);
                    const btn = document.getElementById('metroPlayBtn');
                    if (btn && btn.textContent.indexOf('Stop') === -1) GPH.metronome.toggleMetronome();
                }
            } else if (kind === 'drums') {
                if (document.getElementById('drumMachineBox') && GPH.drumMachine) {
                    expandWidget('drumMachineBox');
                    GPH.drumMachine.updateDrumBpm(bpm || 120);
                    // Saved signature + style + grid + swing of this exercise
                    if (GPH.drumMachine.applyConfig) GPH.drumMachine.applyConfig(res.cfg);
                    const btn = document.getElementById('drumPlayBtn');
                    if (btn && btn.textContent.indexOf('Stop') === -1) GPH.drumMachine.toggleDrumMachine();
                }
            } else if (kind === 'fretboard') {
                if (GPH.fretboard && GPH.fretboard.startAuto) GPH.fretboard.startAuto();
            } else if (kind === 'theory') {
                applyTheoryResource(url);
            }
        });
    }

    // Two flat widget configs are equal when they hold the same values.
    function sameCfg(a, b) {
        if (!a || !b) return false;
        const ka = Object.keys(a);
        if (ka.length !== Object.keys(b).length) return false;
        return ka.every(function (k) { return String(a[k]) === String(b[k]); });
    }

    // BPM and widget settings (signature, pattern, style, grid, swing) belong to
    // the exercise, so they are written back when it changes or ends.
    function persistCurrentBpm() {
        if (!resourceApplied) return;
        const ex = rActiva().ejercicios[currentExerciseIndex];
        if (!ex) return;
        const list = resourcesOf(ex);
        ex.recursos = list;
        let changed = false;
        list.forEach(function (r) {
            let bpmVal = 0;
            let cfgVal = null;
            if (r.kind === 'metronome' && GPH.metronome) {
                bpmVal = GPH.metronome.getBpm ? GPH.metronome.getBpm() : 0;
                cfgVal = GPH.metronome.getConfig ? GPH.metronome.getConfig() : null;
            } else if (r.kind === 'drums' && GPH.drumMachine) {
                bpmVal = GPH.drumMachine.getBpm ? GPH.drumMachine.getBpm() : 0;
                cfgVal = GPH.drumMachine.getConfig ? GPH.drumMachine.getConfig() : null;
            }
            if (bpmVal && bpmVal >= 40 && bpmVal <= 240 && r.bpm !== bpmVal) {
                r.bpm = bpmVal;
                changed = true;
            }
            if (cfgVal && !sameCfg(r.cfg, cfgVal)) {
                r.cfg = cfgVal;
                changed = true;
            }
        });
        if (!changed) return;
        if (ex.id != null) {
            fetch('/api/exercises/' + ex.id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resources: ex.recursos })
            }).catch(function () {});
        }
    }

    function applyFinishAction() {
        const r = rActiva();
        const kind = r && r.finish_kind;
        if (!kind) return;
        const url = r.finish_url || '';
        if (kind === 'audio') {
            if (url && GPH.players && GPH.players.playAudio) GPH.players.playAudio(url, liveLabel(url) || r.finish_label || 'Backing track');
        } else if (kind === 'youtube') {
            if (url && GPH.players && GPH.players.getYouTubeId) {
                const id = GPH.players.getYouTubeId(url);
                if (id) GPH.players.openYouTube(id, liveLabel(url) || r.finish_label || 'Video', url);
            }
        } else if (kind === 'external' || kind === 'file') {
            if (url) window.open(url, '_blank');
        } else if (kind === 'metronome') {
            if (document.getElementById('metronomeBox') && GPH.metronome) {
                expandWidget('metronomeBox');
                GPH.metronome.updateBpm(r.finish_bpm || 120);
                const btn = document.getElementById('metroPlayBtn');
                if (btn && btn.textContent.indexOf('Stop') === -1) GPH.metronome.toggleMetronome();
            }
        } else if (kind === 'drums') {
            if (document.getElementById('drumMachineBox') && GPH.drumMachine) {
                expandWidget('drumMachineBox');
                GPH.drumMachine.updateDrumBpm(r.finish_bpm || 120);
                const btn = document.getElementById('drumPlayBtn');
                if (btn && btn.textContent.indexOf('Stop') === -1) GPH.drumMachine.toggleDrumMachine();
            }
        } else if (kind === 'fretboard') {
            if (GPH.fretboard && GPH.fretboard.startAuto) GPH.fretboard.startAuto();
        }
    }

    function notifyFretboardEnd() {
        const ex = rActiva().ejercicios[currentExerciseIndex];
        const hasTrainer = resourcesOf(ex).some(function (r) { return r.kind === 'fretboard'; });
        if (!(ex && hasTrainer && GPH.fretboard && GPH.fretboard.showResults)) return;
        function finish(avgPerMin) {
            const res = GPH.fretboard.showResults(exerciseTimeTotal, avgPerMin);
            if (res && res.attempts > 0) {
                fetch('/api/fretboard/stats', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ duration_seconds: res.duration, normalized: res.normalized })
                }).then(function () {
                    const cur = rActiva().ejercicios[currentExerciseIndex];
                    if (cur && resourcesOf(cur).some(function (r) { return r.kind === 'fretboard'; })) updateResourceTag(cur);
                }).catch(function () {});
            }
        }
        fetch('/api/fretboard/stats', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { finish(d && d.count ? d.avg : null); })
            .catch(function () { finish(null); });
    }

    function seekToFraction(f, fireEnd) {
        f = Math.max(0, Math.min(1, f));
        const total = exerciseTimeTotal || 0;
        if (!total) return;
        clearAlarmFlash();
        exerciseTimeLeft = Math.round(total * (1 - f));
        const btn = document.getElementById('exPlayBtn');
        if (exerciseTimeLeft <= 0) {
            exerciseTimeLeft = 0;
            isExerciseFinished = true;
            pauseExerciseTimer();
            updateTimerDisplay();
            updateProgressBar();
            updateNextButtonState();
            if (fireEnd) { GPH.audio.playAlarm(); flashExerciseCard(); notifyFretboardEnd(); }
        } else {
            isExerciseFinished = false;
            if (!isExerciseRunning && btn) {
                btn.disabled = false;
                btn.classList.remove('is-ended', 'is-playing');
                btn.textContent = '\u25B6 Play';
            }
            updateTimerDisplay();
            updateProgressBar();
            updateNextButtonState();
        }
    }

    let isSeeking = false;
    function seekFromEvent(e) {
        const track = document.querySelector('.ex-progress');
        if (!track) return;
        const rect = track.getBoundingClientRect();
        if (!rect.width) return;
        seekToFraction((e.clientX - rect.left) / rect.width, false);
    }
    function onSeekMove(e) { if (isSeeking) seekFromEvent(e); }
    function onSeekUp() {
        if (!isSeeking) return;
        isSeeking = false;
        document.removeEventListener('pointermove', onSeekMove);
        document.removeEventListener('pointerup', onSeekUp);
        if (exerciseTimeLeft <= 0) { markCurrentCompleted(); GPH.audio.playAlarm(); flashExerciseCard(); notifyFretboardEnd(); }
    }
    function startSeek(event) {
        event.preventDefault();
        isSeeking = true;
        seekFromEvent(event);
        document.addEventListener('pointermove', onSeekMove);
        document.addEventListener('pointerup', onSeekUp);
    }

    function clearAlarmFlash() {
        const card = document.getElementById('exerciseCard');
        if (card) card.classList.remove('alarm-flash');
    }

    function flashExerciseCard() {
        const card = document.getElementById('exerciseCard');
        if (!card) return;
        card.classList.remove('alarm-flash');
        void card.offsetWidth; // restarts the animation if repeated
        card.classList.add('alarm-flash');
        setTimeout(clearAlarmFlash, 2600);
    }

    function toggleExerciseTimer() {
        if (isExerciseRunning) {
            clockStop();            // pausing for a coffee also stops the exercise clock
            pauseExerciseTimer();
        } else {
            startExerciseTimer();
        }
    }

    function startExerciseTimer() {
        if (exerciseTimeLeft <= 0) return;
        isExerciseRunning = true;
        clockStart();
        // Play is the moment the server records this attempt: the area and the
        // exercise are captured then, before the picker is unlocked at the end
        // of the timer (plan 6.1 / 9.4).
        sessionSyncItem(currentExerciseIndex);

        if (!resourceApplied) { applyExerciseResource(rActiva().ejercicios[currentExerciseIndex]); resourceApplied = true; }

        const btn = document.getElementById('exPlayBtn');
        btn.innerHTML = GPH.icons.get('pause') + ' Pause';
        btn.classList.add('is-playing');
        btn.classList.remove('is-ended');
        updateChangeLock();   // the attempt is live: the picker locks now

        exerciseTimerInterval = setInterval(function () {
            if (exerciseTimeLeft > 0) {
                exerciseTimeLeft--;
                persistCurrentPlayed();
                updateTimerDisplay();
                updateProgressBar();
            }

            if (exerciseTimeLeft === 0) {
                isExerciseFinished = true;
                markCurrentCompleted();
                pauseExerciseTimer();
                updateProgressBar();
                updateNextButtonState();
                GPH.audio.playAlarm();
                flashExerciseCard();
                notifyFretboardEnd();
            }
        }, 1000);
    }

    function pauseExerciseTimer() {
        isExerciseRunning = false;
        clearInterval(exerciseTimerInterval);

        const btn = document.getElementById('exPlayBtn');
        if (!btn) return;

        btn.classList.remove('is-playing');
        btn.innerHTML = GPH.icons.get('play') + ' Play';

        if (isExerciseFinished || exerciseTimeLeft <= 0) {
            btn.classList.add('is-ended');
            btn.disabled = true;
        } else {
            btn.classList.remove('is-ended');
            btn.disabled = false;
        }
    }

    function resetExerciseTimer() {
        pauseExerciseTimer();
        clearAlarmFlash();
        const ejercicio = rActiva().ejercicios[currentExerciseIndex];
        exerciseTimeLeft = ejercicio.tiempo;
        exerciseTimeTotal = ejercicio.tiempo;
        isExerciseFinished = false;
        resourceApplied = false;
        delete exerciseStates[currentExerciseIndex];
        delete playedSet[currentExerciseIndex];
        delete clockSet[currentExerciseIndex];
        delete clockStartedSet[currentExerciseIndex];
        clockRunSince = null;
        saveStates();
        sessionSyncItem(currentExerciseIndex);
        setIndexLabel();

        const playBtn = document.getElementById('exPlayBtn');
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.classList.remove('is-ended', 'is-playing');
            playBtn.innerHTML = GPH.icons.get('play') + ' Play';
        }

        updateTimerDisplay();
        updateProgressBar();
        updateNextButtonState();
        updateChangeLock();   // Reset frees the attempt again
    }

    // Persisted per-session outcome. The legacy binary map (routineCompleted,
    // {idx: true}) is migrated on read so an in-flight session keeps its checks.
    function loadStates() {
        exerciseStates = {};
        try {
            const raw = JSON.parse(localStorage.getItem('routineStates') || 'null');
            if (raw && typeof raw === 'object') {
                Object.keys(raw).forEach(function (k) {
                    const v = raw[k];
                    if (DONE_STATES[v] || v === 'skipped') exerciseStates[k] = v;
                });
                return;
            }
            const legacy = JSON.parse(localStorage.getItem('routineCompleted') || '{}') || {};
            Object.keys(legacy).forEach(function (k) {
                if (legacy[k]) exerciseStates[k] = 'timed';
            });
        } catch (e) { exerciseStates = {}; }
    }

    function saveStates() {
        try { localStorage.setItem('routineStates', JSON.stringify(exerciseStates)); } catch (e) {}
    }

    // ---- Session log (DB) -------------------------------------------------
    // The open session id lives in localStorage, so a reload keeps writing to
    // the same row and the real start time is never lost. Writes that fail
    // (server down) are queued and replayed, so nothing is silently dropped.
    const SESSION_ID_KEY = 'routineSessionId';
    const SESSION_QUEUE_KEY = 'routineSessionQueue';
    let sessionId = null;

    function sessionQueue() {
        try { return JSON.parse(localStorage.getItem(SESSION_QUEUE_KEY) || '[]') || []; }
        catch (e) { return []; }
    }

    function sessionQueueSet(q) {
        try { localStorage.setItem(SESSION_QUEUE_KEY, JSON.stringify(q.slice(-100))); } catch (e) {}
    }

    function sessionPost(method, url, body, done) {
        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body == null ? undefined : JSON.stringify(body),
            keepalive: true
        }).then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (data && done) done(data);
                flushSessionQueue();
            })
            .catch(function () {
                sessionQueueSet(sessionQueue().concat([{ method: method, url: url, body: body }]));
            });
    }

    // Replays pending writes in order. 404/409 mean the row is stale: drop it.
    function flushSessionQueue() {
        const q = sessionQueue();
        if (!q.length) return;
        const entry = q[0];
        fetch(entry.url, {
            method: entry.method,
            headers: { 'Content-Type': 'application/json' },
            body: entry.body == null ? undefined : JSON.stringify(entry.body),
            keepalive: true
        }).then(function (r) {
            if (r.status !== 404 && r.status !== 409 && !r.ok) throw new Error('http');
            sessionQueueSet(q.slice(1));
            flushSessionQueue();
        }).catch(function () { /* keep it for the next attempt */ });
    }

    function loadSessionId() {
        sessionId = null;
        try { sessionId = parseInt(localStorage.getItem(SESSION_ID_KEY) || '', 10) || null; } catch (e) {}
    }

    function sessionStart() {
        if (sessionId) return;                       // resumed from a previous page load
        const r = rActiva();
        const items = (r.ejercicios || []).map(function (ex) {
            return { exercise_id: ex.id, name: ex.nombre, planned_seconds: ex.tiempo || 0 };
        });
        sessionPost('POST', '/api/sessions/start', {
            routine_id: r.id || null,
            routine_name: r.nombre || '',
            started_at: new Date().toISOString(),
            items: items
        }, function (res) {
            if (res && res.id) {
                sessionId = res.id;
                try { localStorage.setItem(SESSION_ID_KEY, String(res.id)); } catch (e) {}
            }
        });
    }

    function sessionSyncItem(idx) {
        if (!sessionId) return;
        const ex = rActiva().ejercicios[idx];
        if (!ex) return;
        const state = exerciseStates[idx] || 'pending';
        sessionPost('PUT', '/api/sessions/' + sessionId + '/item', {
            position: idx,
            state: state,
            played_seconds: playedFor(idx, ex),
            elapsed_seconds: elapsedFor(idx, ex),
            started_at: clockStartedSet[idx] || null,
            finished_at: state === 'pending' ? null : new Date().toISOString()
        });
    }

    function sessionFinish() {
        if (!sessionId) return;
        const sid = sessionId;
        const items = (rActiva().ejercicios || []).map(function (ex, i) {
            const state = exerciseStates[i] || 'pending';
            return {
                position: i,
                state: state,
                played_seconds: playedFor(i, ex),
                elapsed_seconds: elapsedFor(i, ex),
                started_at: clockStartedSet[i] || null
            };
        });
        sessionId = null;
        try { localStorage.removeItem(SESSION_ID_KEY); } catch (e) {}
        sessionPost('POST', '/api/sessions/' + sid + '/finish',
                    { finished_at: new Date().toISOString(), items: items });
    }

    // ---- Reconciliation with the server -----------------------------------
    // The browser storage is only a cache: if it is wiped (or the app opens in
    // another browser) the session still open on the server is recovered here,
    // so it is not left orphaned until it is auto-abandoned.

    function applyServerSession(full) {
        if (sessionId || localStorage.getItem('routineSessionActive') === 'true') return;
        const exs = rActiva().ejercicios || [];
        if (!full || !exs.length) return;

        sessionId = full.id;
        try { localStorage.setItem(SESSION_ID_KEY, String(full.id)); } catch (e) {}

        exerciseStates = {};
        playedSet = {};
        clockSet = {};
        clockStartedSet = {};
        clockRunSince = null;
        (full.items || []).forEach(function (it) {
            if (DONE_STATES[it.state] || it.state === 'skipped') exerciseStates[it.position] = it.state;
            if (it.played_seconds) playedSet[it.position] = it.played_seconds;
        });
        saveStates();

        let next = 0;
        (full.items || []).forEach(function (it, i) {
            if (it.state === 'pending' && next === 0) next = i;
        });
        currentExerciseIndex = Math.min(next, exs.length - 1);

        const start = full.started_at ? new Date(full.started_at) : null;
        localStorage.setItem('routineSessionActive', 'true');
        localStorage.setItem('currentExerciseIndex', currentExerciseIndex);
        localStorage.removeItem('lastRoutineFinishedAt');
        if (start && !isNaN(start.getTime())) {
            localStorage.setItem('lastRoutineStartedAt', full.started_at);
            localStorage.setItem('practiceStartTimeVal', hhmm(start));
            setStartTimeLabel(hhmm(start));
        }

        document.getElementById('welcomeCard').classList.add('is-hidden');
        document.getElementById('exerciseCard').classList.remove('is-hidden');
        displayCurrentExercise();
        updateStartBtnTip();
    }

    // A session kept in the browser is only trusted when it points somewhere:
    // an id from the server or a queued start request (started while offline).
    function orphanSession() {
        if (sessionId) return false;
        return !sessionQueue().some(function (e) { return /\/api\/sessions\/start$/.test(e.url || ''); });
    }

    // Rebuilds and reconciles the Start tooltip from the log: the database is
    // the source of truth, so a dry run (nothing written) or a wiped browser
    // cannot leave a fake "last routine" behind.
    function syncLastRoutineTip() {
        fetch('/api/sessions?limit=1', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d) return;
                const last = (d.sessions || [])[0];
                if (!last) {
                    localStorage.removeItem('lastRoutineStartedAt');
                    localStorage.removeItem('lastRoutineFinishedAt');
                } else {
                    localStorage.setItem('lastRoutineStartedAt', last.started_at);
                    if (last.finished_at) localStorage.setItem('lastRoutineFinishedAt', last.finished_at);
                    else localStorage.removeItem('lastRoutineFinishedAt');
                }
                updateStartBtnTip();
            })
            .catch(function () { /* offline: keep the cached values */ });
    }

    function reconcileSession() {
        if (sessionId) {
            // Stale pointer? (the server may have auto-abandoned the session)
            fetch('/api/sessions/' + sessionId, { cache: 'no-store' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    if (d && d.status && d.status !== 'open') {
                        sessionId = null;
                        try { localStorage.removeItem(SESSION_ID_KEY); } catch (e) {}
                    }
                })
                .catch(function () {});
            return;
        }
        if (localStorage.getItem('routineSessionActive') === 'true') return;
        fetch('/api/sessions/active', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                const rid = (GPH.data && GPH.data.activeRoutine && GPH.data.activeRoutine.id) || null;
                if (d && d.id && (!d.routine_id || !rid || d.routine_id === rid)) applyServerSession(d);
                else syncLastRoutineTip();
            })
            .catch(function () { syncLastRoutineTip(); });
    }

    // ---- Resume or drop the routine left in this browser --------------------
    // The browser keeps its own copy of the session; it is only trusted while
    // the server still has that row open. Past the 8 h window the server has
    // abandoned it, so the local copy is dropped (without touching the log,
    // which keeps the honest "abandoned" row) and the app starts from scratch.
    let lastSessionCheck = 0;

    function resumeLocalSession() {
        const restore = function () {
            const savedStartTime = localStorage.getItem('practiceStartTimeVal');
            if (savedStartTime) setStartTimeLabel(savedStartTime);
            const savedIndex = localStorage.getItem('currentExerciseIndex');
            if (savedIndex !== null) {
                const idx = parseInt(savedIndex, 10);
                if (idx >= 0 && idx < rActiva().ejercicios.length) {
                    currentExerciseIndex = idx;
                    document.getElementById('welcomeCard').classList.add('is-hidden');
                    document.getElementById('exerciseCard').classList.remove('is-hidden');
                    displayCurrentExercise();
                    return;
                }
            }
            showWelcomeScreen();
        };
        lastSessionCheck = Date.now();
        // No id yet: a start queued while offline, nothing to ask the server.
        if (!sessionId) { restore(); return; }
        fetch('/api/sessions/' + sessionId, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (d && d.status && d.status !== 'open') dropStaleSession();
                else restore();
            })
            .catch(function () { restore(); });      // offline: trust the browser
    }

    function dropStaleSession() {
        sessionId = null;
        try { localStorage.removeItem(SESSION_ID_KEY); } catch (e) {}
        // Set before the reset so showWelcomeScreen does not try to finish it.
        localStorage.setItem('routineSessionActive', 'false');
        showWelcomeScreen();
        reconcileSession();
    }

    // A tab left open overnight (laptop asleep, no reload): same rule when you
    // come back. Throttled so alt-tabbing does not hammer the server.
    function revalidateSession() {
        if (localStorage.getItem('routineSessionActive') !== 'true' || !sessionId) return;
        if (Date.now() - lastSessionCheck < 10 * 60 * 1000) return;
        lastSessionCheck = Date.now();
        fetch('/api/sessions/' + sessionId, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d && d.status && d.status !== 'open') dropStaleSession(); })
            .catch(function () {});
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') revalidateSession();
    });

    function setExerciseState(idx, state) {
        if (!state) delete exerciseStates[idx];
        else exerciseStates[idx] = state;
        saveStates();
        // Re-renders the list, the reset/skip buttons and the control row
        // (this is what used to be missed when a seek jumped to the end).
        updateNextButtonState();
        sessionSyncItem(idx);
    }

    // Marks the current exercise as done (50 % rule decides timed vs untimed).
    function markCurrentCompleted() {
        persistCurrentPlayed();
        const ex = rActiva().ejercicios[currentExerciseIndex];
        setExerciseState(currentExerciseIndex, classifyDone(currentExerciseIndex, ex));
        setIndexLabel();
        updateChangeLock();   // timer finished: the next session can use another one
    }
    function goToExercise(idx) {
        const exs = rActiva().ejercicios;
        if (!exs || idx < 0 || idx >= exs.length) return;
        if (idx === currentExerciseIndex) return;
        persistCurrentBpm();
        clockStop();
        pauseExerciseTimer();
        persistCurrentPlayed();
        currentExerciseIndex = idx;
        localStorage.setItem('currentExerciseIndex', currentExerciseIndex);
        displayCurrentExercise();
    }

    // Ends the routine: the real finish time is recorded by showWelcomeScreen().
    function finishRoutine() {
        persistCurrentPlayed();
        persistCurrentBpm();
        applyFinishAction();
        showWelcomeScreen();
    }

    // "Mark done": accepts the current exercise as done (50 % rule) and moves on.
    function handleNextOrFinish() {
        const exs = rActiva().ejercicios || [];
        if (!exs.length) { showWelcomeScreen(); return; }

        if (!DONE_STATES[exerciseStates[currentExerciseIndex]]) markCurrentCompleted();

        if (nextPendingIndex(currentExerciseIndex) < 0) { finishRoutine(); return; }
        nextExercise();
    }

    // "Skip": the exercise was NOT practiced. It is resolved (not pending) but it
    // never counts as done; the list shows it with the amber chevrons.
    function skipExercise() {
        const exs = rActiva().ejercicios || [];
        if (!exs.length) { showWelcomeScreen(); return; }
        if (clockRunSince !== null) clockStop();      // keep the partial time
        setExerciseState(currentExerciseIndex, 'skipped');
        setIndexLabel();

        if (nextPendingIndex(currentExerciseIndex) < 0) { finishRoutine(); return; }
        nextExercise();
    }

    // Moves to the next exercise NOT resolved yet (not the next one in the list)
    function nextExercise() {
        persistCurrentBpm();
        clockStop();
        pauseExerciseTimer();
        persistCurrentPlayed();
        const nxt = nextPendingIndex(currentExerciseIndex);
        if (nxt >= 0) {
            currentExerciseIndex = nxt;
            localStorage.setItem('currentExerciseIndex', currentExerciseIndex);
            displayCurrentExercise();
        } else {
            showWelcomeScreen();
        }
    }

    function getRoutineTotalMinutes() {
        if (!rActiva().ejercicios) return 0;
        const totalSeconds = rActiva().ejercicios.reduce(function (sum, ex) { return sum + (ex.tiempo || 0); }, 0);
        return Math.round(totalSeconds / 60);
    }

    // Refreshes the assistant after external changes (manager). If there is a session
    // in progress, it only updates texts and the list WITHOUT restarting the timer;
    // the new times are applied when switching exercise.
    function softRefreshMidSession() {
        if (!rActiva().ejercicios.length) { showWelcomeScreen(); return; }
        if (currentExerciseIndex >= rActiva().ejercicios.length) {
            currentExerciseIndex = rActiva().ejercicios.length - 1;
            localStorage.setItem('currentExerciseIndex', currentExerciseIndex);
            displayCurrentExercise();
            return;
        }
        if (currentExerciseIndex < 0) { currentExerciseIndex = 0; displayCurrentExercise(); return; }

        const ejercicio = rActiva().ejercicios[currentExerciseIndex];
        setIndexLabel();
        renderSlotHeader('keep');   // a soft refresh must not close the picker

        updateResourceTag(ejercicio);
        renderExerciseSidebar();
        updateProgressBar();
        updateNextButtonState();
    }

    function refresh() {
        if (typeof rActiva() === 'undefined' || !rActiva() || !rActiva().ejercicios) return;
        const exerciseCard = document.getElementById('exerciseCard');
        const exerciseVisible = exerciseCard && !exerciseCard.classList.contains('is-hidden');
        if (exerciseVisible) {
            softRefreshMidSession();
        } else {
            initSimpleAssistant();
        }
    }

    GPH.practiceAssistant = {
        init: initSimpleAssistant,
        refresh: refresh,
        startRoutineSession: startRoutineSession,
        toggleExerciseTimer: toggleExerciseTimer,
        resetExerciseTimer: resetExerciseTimer,
        handleNextOrFinish: handleNextOrFinish,
        skipExercise: skipExercise,
        nextExercise: nextExercise,
        startSeek: startSeek
    };
})(window.GPH = window.GPH || {});
