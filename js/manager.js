// Routine manager: CRUD against /api with the SQLite DB (server.py).
(function (GPH) {
    'use strict';

    const { $, api, toast, notify } = GPH.mgr;

    function toSeconds(min) {
        const m = parseFloat(String(min).replace(',', '.'));
        return Math.round((isNaN(m) ? 0 : m) * 60);
    }

    function toMinutes(sec) {
        const m = (sec || 0) / 60;
        return Number.isInteger(m) ? m : Math.round(m * 100) / 100;
    }

    let routines = [];
    let selectedId = null;
    let current = null;
    let dirty = false;
    let resources = [];
    let finishResources = [];
    let finishPicker = null;
    let activeResourcePicker = null;

    async function loadRoutines(preferId) {
        routines = await api('GET', '/api/routines');
        renderList();

        const active = routines.filter(function (r) { return r.is_active; })[0];
        let target = null;
        if (preferId != null && routines.some(function (r) { return r.id === preferId; })) {
            target = preferId;
        } else if (selectedId != null && routines.some(function (r) { return r.id === selectedId; })) {
            target = selectedId;
        } else if (active) {
            target = active.id;
        } else if (routines.length) {
            target = routines[0].id;
        }

        if (target != null) {
            await selectRoutine(target);
        } else {
            selectedId = null;
            current = null;
            clearEditor();
        }
    }

    function renderList() {
        const list = $('routineList');
        list.innerHTML = '';
        if (!routines.length) {
            const d = document.createElement('div');
            d.className = 'empty';
            d.textContent = 'No routines yet.';
            list.appendChild(d);
            return;
        }
        routines.forEach(function (r) {
            const item = document.createElement('div');
            item.className = 'routine-item' + (r.id === selectedId ? ' selected' : '');

            const name = document.createElement('span');
            name.className = 'rname';
            name.textContent = r.name;
            item.appendChild(name);

            const tot = document.createElement('span');
            tot.className = 'r-total';
            tot.textContent = Math.round((r.total_seconds || 0) / 60) + ' min';
            item.appendChild(tot);

            if (r.is_active) {
                const dot = document.createElement('span');
                dot.className = 'dot-active';
                dot.title = 'Active';
                item.appendChild(dot);
            }

            item.addEventListener('click', function () { selectRoutine(r.id); });
            list.appendChild(item);
        });
    }

    async function selectRoutine(id) {
        if (dirty && id !== selectedId) {
            if (!confirm('You have unsaved changes in this routine. Discard them?')) return;
        }
        selectedId = id;
        current = await api('GET', '/api/routines/' + id);
        setDirty(false);
        renderList();
        renderEditor();
    }

    function setDirty(v) {
        dirty = GPH.mgr.setDirty('saveRoutineBtn', v, 'Save the routine and all exercise changes');
    }

    // Saves a setting and notifies the app (BroadcastChannel).
    function putSetting(key, value) {
        return GPH.settings.set(key, value).then(function () { notify(); }).catch(function () {});
    }

    function clearEditor() {
        $('editor').hidden = true;
        $('editorEmpty').hidden = false;
        setDirty(false);
    }

    function updateRoutineTotal() {
        const el = $('exTotal');
        if (!el) return;
        const inputs = document.querySelectorAll('#exerciseList input.ex-dur');
        let total = 0;
        inputs.forEach(function (inp) {
            const v = parseFloat(inp.value);
            if (!isNaN(v)) total += v;
        });
        total = Math.round(total * 100) / 100;
        el.textContent = 'Total: ' + total + ' min';
    }

    function renderEditor() {
        if (!current) { clearEditor(); return; }
        $('editorEmpty').hidden = true;
        $('editor').hidden = false;
        $('rName').value = current.name || '';
        $('rDesc').value = current.description || '';
        const fSel = $('finishResource'); const fBpm = $('finishBpm');
        if (fSel && fBpm) {
            let fval = '';
            if (current.finish_kind) {
                finishResources.forEach(function (fr, fi) {
                    const fixed = (fr.kind === 'metronome' || fr.kind === 'drums' || fr.kind === 'fretboard');
                    if (fr.kind === current.finish_kind && (fixed || fr.url === current.finish_url)) fval = String(fi);
                });
            }
            fSel.value = fval;
            if (finishPicker) finishPicker.refresh();
            fBpm.value = current.finish_bpm || '';
            syncFinishBpm();
        }
        $('activeBadge').hidden = !current.is_active;
        const actBtn = $('activateBtn');
        if (actBtn) actBtn.hidden = !!current.is_active;
        $('exCount').textContent = '(' + (current.exercises ? current.exercises.length : 0) + ')';
        renderExercises();
        updateRoutineTotal();
    }

    function renderExercises() {
        const wrap = $('exerciseList');
        wrap.innerHTML = '';
        const exs = current.exercises || [];
        if (!exs.length) {
            const d = document.createElement('div');
            d.className = 'empty';
            d.textContent = 'No exercises. Add one below.';
            wrap.appendChild(d);
            return;
        }
        exs.forEach(function (ex, idx) {
            wrap.appendChild(buildExerciseRow(ex, idx, exs.length));
        });
        GPH.mgr.makeSortable(wrap, {
            itemSelector: '.exercise[data-eid]',
            onReorder: applyExerciseOrder
        });
    }

    function mk(txt, title, fn) {
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = txt;
        b.title = title;
        b.addEventListener('click', fn);
        return b;
    }

    // Text used in the resource pickers: "Section: TAG - label", the same way
    // the sections list renders the item (tag first, then the label).
    function sectionItemLabel(prefix, it, fallback) {
        const base = (it.label || it.tag || fallback || '').trim();
        if (!base) return prefix.replace(/: $/, '');
        const needsTag = it.tag && base.indexOf(it.tag) !== 0;
        return prefix + (needsTag ? it.tag + ' - ' : '') + base;
    }

    // ---- Searchable resource picker ---------------------------------------
    // The native select stays as the value source so saving/reloading keeps
    // working; the visible trigger is a small custom combobox with a filter.
    function closeResourcePicker() {
        if (!activeResourcePicker) return;
        const picker = activeResourcePicker;
        activeResourcePicker = null;
        picker.menu.hidden = true;
        picker.trigger.setAttribute('aria-expanded', 'false');
    }

    document.addEventListener('mousedown', function (event) {
        if (activeResourcePicker && !activeResourcePicker.root.contains(event.target)) {
            closeResourcePicker();
        }
    });

    function normalizeSearch(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function createResourcePicker(items, initialValue, opts) {
        const options = opts || {};
        const noneLabel = options.noneLabel || '\u2014 No resource \u2014';
        const root = document.createElement('div');
        root.className = 'ex-res-picker';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ex-res-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'Choose resource');

        const menu = document.createElement('div');
        menu.className = 'ex-res-menu';
        menu.hidden = true;

        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'ex-res-search';
        search.placeholder = 'Search resources\u2026';
        search.autocomplete = 'off';
        search.spellcheck = false;
        search.setAttribute('aria-label', 'Search resources');

        const optionsBox = document.createElement('div');
        optionsBox.className = 'ex-res-options';
        optionsBox.setAttribute('role', 'listbox');

        menu.appendChild(search);
        menu.appendChild(optionsBox);
        root.appendChild(trigger);
        root.appendChild(menu);

        // Keep a real <select> as the value source for the existing save code.
        const select = document.createElement('select');
        select.className = 'ex-res';
        select.hidden = true;
        if (options.selectId) select.id = options.selectId;
        const none = document.createElement('option');
        none.value = '';
        none.textContent = noneLabel;
        select.appendChild(none);
        items.forEach(function (item, index) {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = item.label;
            select.appendChild(option);
        });
        select.value = initialValue || '';
        root.appendChild(select);

        let highlighted = -1;

        function selectedLabel() {
            if (select.value === '') return noneLabel;
            const item = items[Number(select.value)];
            return item ? item.label : noneLabel;
        }

        function refresh() {
            const label = selectedLabel();
            trigger.textContent = label;
            trigger.title = label;
        }

        function matches(label, query) {
            return !query || normalizeSearch(label).indexOf(query) >= 0;
        }

        function renderOptions() {
            const query = normalizeSearch(search.value.trim());
            optionsBox.innerHTML = '';
            highlighted = -1;

            function addOption(value, label) {
                const option = document.createElement('button');
                option.type = 'button';
                option.className = 'ex-res-option';
                option.dataset.value = value;
                option.textContent = label;
                option.title = label;
                option.setAttribute('role', 'option');
                if (String(select.value) === String(value)) option.classList.add('selected');
                option.addEventListener('click', function () { choose(value); });
                optionsBox.appendChild(option);
                if (highlighted < 0) {
                    highlighted = optionsBox.children.length - 1;
                    option.classList.add('highlighted');
                }
            }

            if (matches(noneLabel, query)) {
                addOption('', noneLabel);
            }
            items.forEach(function (item, index) {
                if (matches(item.label, query)) addOption(String(index), item.label);
            });

            if (!optionsBox.children.length) {
                const empty = document.createElement('div');
                empty.className = 'ex-res-empty';
                empty.textContent = 'No resources match.';
                optionsBox.appendChild(empty);
            }
        }

        function choose(value) {
            select.value = value;
            refresh();
            closeResourcePicker();
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function moveHighlight(delta) {
            const options = Array.prototype.slice.call(
                optionsBox.querySelectorAll('.ex-res-option')
            );
            if (!options.length) return;
            options.forEach(function (option) { option.classList.remove('highlighted'); });
            highlighted = (highlighted + delta + options.length) % options.length;
            const current = options[highlighted];
            current.classList.add('highlighted');
            current.scrollIntoView({ block: 'nearest' });
        }

        function open() {
            if (activeResourcePicker === api) {
                closeResourcePicker();
                return;
            }
            closeResourcePicker();
            search.value = '';
            renderOptions();
            menu.classList.toggle('up', window.innerHeight - trigger.getBoundingClientRect().bottom < 280);
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            activeResourcePicker = api;
            search.focus();
        }

        trigger.addEventListener('click', open);
        search.addEventListener('input', renderOptions);
        search.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeResourcePicker();
                trigger.focus();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveHighlight(1);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveHighlight(-1);
            } else if (event.key === 'Enter') {
                const current = optionsBox.querySelector('.ex-res-option.highlighted');
                if (current) {
                    event.preventDefault();
                    choose(current.dataset.value);
                }
            }
        });
        menu.addEventListener('keydown', function (event) {
            if (event.key === 'Tab') closeResourcePicker();
        });

        const api = {
            root: root,
            menu: menu,
            trigger: trigger,
            select: select,
            refresh: refresh,
            close: closeResourcePicker,
            open: open
        };
        refresh();
        return api;
    }

    // ---- Theory resources -------------------------------------------------
    // Stored in `resource_url` as a query string, exactly what the app parses:
    //   view=scales&kind=scale&type=Dorian&root=2
    //   view=chords&root=D&mode=dorian&seventh=0
    //   view=diagrams&root=Cs&quality=c00
    const THEORY_VIEWS = [
        { view: 'scales', label: 'Theory: Scales & Chords' },
        { view: 'chords', label: 'Theory: Chords in Key' },
        { view: 'diagrams', label: 'Theory: Chord Diagrams' }
    ];

    function parseParams(str) {
        const out = {};
        String(str || '').split('&').forEach(function (kv) {
            const i = kv.indexOf('=');
            if (i < 0) return;
            try { out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); } catch (e) { /* noop */ }
        });
        return out;
    }

    function enc(v) { return encodeURIComponent(String(v)); }

    // Small select helper for the parameter row.
    function thSelect(cls, options, value) {
        const sel = document.createElement('select');
        sel.className = cls;
        options.forEach(function (o) {
            const opt = document.createElement('option');
            opt.value = String(o.value); opt.textContent = o.label;
            sel.appendChild(opt);
        });
        if (value != null) sel.value = String(value);
        return sel;
    }

    function thField(text, ctl) {
        const w = document.createElement('label');
        w.className = 'ex-th-field';
        const s = document.createElement('span');
        s.textContent = text;
        w.appendChild(s); w.appendChild(ctl);
        return w;
    }

    // Builds the parameter controls of `view` inside `box`.
    function buildTheoryControls(box, view, p) {
        box.innerHTML = '';
        box.dataset.view = view;
        const opt = GPH.theory && GPH.theory.OPTIONS;

        if (view === 'scales') {
            const roots = (opt && opt.roots) || [];
            const groups = (opt && opt.groups) || [];
            const typeSel = document.createElement('select');
            typeSel.className = 'ex-th-type';
            groups.forEach(function (g) {
                const og = document.createElement('optgroup'); og.label = g.label;
                g.items.forEach(function (it) {
                    const o = document.createElement('option');
                    o.value = it.value; o.textContent = it.label;
                    og.appendChild(o);
                });
                typeSel.appendChild(og);
            });
            const wanted = (p.kind || 'scale') + '|' + (p.type || 'Ionian (major)');
            typeSel.value = wanted;
            if (typeSel.value !== wanted && typeSel.options.length) typeSel.value = typeSel.options[0].value;
            box.appendChild(thField('Root', thSelect('ex-th-root', roots, p.root != null ? p.root : 0)));
            box.appendChild(thField('Type', typeSel));
        } else if (view === 'chords') {
            const roots = (GPH.chords && GPH.chords.ROOTS) || ['C'];
            const modes = (GPH.chords && GPH.chords.MODES) || {};
            const modeOpts = Object.keys(modes).map(function (k) { return { value: k, label: modes[k].label }; });
            box.appendChild(thField('Key', thSelect('ex-th-key', roots.map(function (r) { return { value: r, label: r }; }), p.root || 'C')));
            box.appendChild(thField('Mode', thSelect('ex-th-mode', modeOpts, p.mode || 'ionian')));
            const sev = document.createElement('input');
            sev.type = 'checkbox'; sev.className = 'ex-th-sev';
            sev.checked = p.seventh === '1';
            const lab = document.createElement('label'); lab.className = 'ex-th-field ex-th-check';
            lab.appendChild(sev); lab.appendChild(document.createTextNode('7ths'));
            box.appendChild(lab);
        } else {
            const roots = (GPH.chordDiagrams && GPH.chordDiagrams.ROOTS) || [];
            const quals = (GPH.chordDiagrams && GPH.chordDiagrams.QUALITIES) || [];
            box.appendChild(thField('Root', thSelect('ex-th-root', roots.map(function (r) { return { value: r.value, label: r.label }; }), p.root || 'C')));
            box.appendChild(thField('Quality', thSelect('ex-th-quality', quals.map(function (q) { return { value: q.code, label: q.label }; }), p.quality || 'c00')));
        }
    }

    // Reads the controls back and returns the encoded resource URL.
    function readTheoryUrl(box) {
        if (!box) return '';
        const view = box.dataset.view || 'scales';
        const val = function (cls) { const el = box.querySelector('.' + cls); return el ? el.value : ''; };
        if (view === 'scales') {
            const parts = String(val('ex-th-type')).split('|');
            return 'view=scales&kind=' + enc(parts[0] || 'scale') +
                '&type=' + enc(parts.slice(1).join('|')) + '&root=' + enc(val('ex-th-root') || '0');
        }
        if (view === 'chords') {
            const sev = box.querySelector('.ex-th-sev');
            return 'view=chords&root=' + enc(val('ex-th-key')) +
                '&mode=' + enc(val('ex-th-mode')) + '&seventh=' + (sev && sev.checked ? '1' : '0');
        }
        return 'view=diagrams&root=' + enc(val('ex-th-root')) + '&quality=' + enc(val('ex-th-quality'));
    }

    // Human label for the resource tag, e.g. "Theory: Scales & Chords · D Dorian".
    function readTheoryLabel(box, base) {
        if (!box) return base;
        const view = box.dataset.view || 'scales';
        const text = function (cls) {
            const el = box.querySelector('.' + cls);
            return el && el.selectedIndex >= 0 ? el.options[el.selectedIndex].textContent : '';
        };
        if (view === 'scales') return base + ' \u00b7 ' + text('ex-th-root') + ' ' + text('ex-th-type');
        if (view === 'chords') {
            const sev = box.querySelector('.ex-th-sev');
            return base + ' \u00b7 ' + text('ex-th-key') + ' ' + text('ex-th-mode') + (sev && sev.checked ? ' (7ths)' : '');
        }
        return base + ' \u00b7 ' + text('ex-th-root') + ' ' + text('ex-th-quality');
    }

    // Resource pickers: fixed widgets first, then the Theory subsections, then
    // every item of the dynamic sections.
    function buildResources(sections) {
        const out = [
            { kind: 'metronome', url: '', label: 'Metronome' },
            { kind: 'drums', url: '', label: 'Drum Machine' },
            { kind: 'fretboard', url: '', label: 'Theory: Fretboard Trainer' }
        ];
        THEORY_VIEWS.forEach(function (tv) {
            out.push({ kind: 'theory', view: tv.view, url: '', label: tv.label });
        });
        (sections || []).forEach(function (sec) {
            const prefix = sec.title ? (sec.title + ': ') : '';
            (sec.items || []).forEach(function (it) {
                if (it.kind === 'youtube') {
                    out.push({ kind: 'youtube', url: it.url, label: sectionItemLabel(prefix, it, 'YouTube video') });
                } else if (it.kind === 'audio') {
                    out.push({ kind: 'audio', url: it.url, label: sectionItemLabel(prefix, it, 'Audio') });
                } else if (it.kind === 'song') {
                    out.push({ kind: 'audio', url: '/api/media?path=' + encodeURIComponent(it.url), label: sectionItemLabel(prefix, it, 'Song') });
                } else if (it.kind === 'folder') {
                    ((it.meta && it.meta.songs) || []).forEach(function (s) {
                        out.push({ kind: 'audio', url: '/api/media?path=' + encodeURIComponent(s.path), label: prefix + s.title });
                    });
                }
            });
        });
        return out;
    }

    function buildFinishResources(sections) {
        const out = [
            { kind: 'metronome', url: '', label: 'Metronome' },
            { kind: 'drums', url: '', label: 'Drum Machine' },
            { kind: 'fretboard', url: '', label: 'Fretboard Trainer' }
        ];
        (sections || []).forEach(function (sec) {
            const prefix = sec.title ? (sec.title + ': ') : '';
            (sec.items || []).forEach(function (it) {
                if (it.kind === 'youtube') out.push({ kind: 'youtube', url: it.url, label: sectionItemLabel(prefix, it, 'YouTube video') });
                else if (it.kind === 'audio') out.push({ kind: 'audio', url: it.url, label: sectionItemLabel(prefix, it, 'Audio') });
                else if (it.kind === 'song') out.push({ kind: 'audio', url: '/api/media?path=' + encodeURIComponent(it.url), label: sectionItemLabel(prefix, it, 'Song') });
                else if (it.kind === 'external') out.push({ kind: 'external', url: it.url, label: sectionItemLabel(prefix, it, it.url) });
                else if (it.kind === 'file') out.push({ kind: 'file', url: it.url, label: sectionItemLabel(prefix, it, it.url) });
                else if (it.kind === 'folder') { ((it.meta && it.meta.songs) || []).forEach(function (s) { out.push({ kind: 'audio', url: '/api/media?path=' + encodeURIComponent(s.path), label: prefix + s.title }); }); }
            });
        });
        return out;
    }
    function populateFinishSelect() {
        if (finishPicker) return;
        const sel = $('finishResource');
        if (!sel) return;
        const picker = createResourcePicker(finishResources, '', {
            noneLabel: '\u2014 None \u2014',
            selectId: 'finishResource'
        });
        sel.replaceWith(picker.root);
        picker.select.addEventListener('change', syncFinishBpm);
        finishPicker = picker;
    }
    function syncFinishBpm() {
        const sel = $('finishResource'); const bpm = $('finishBpm');
        if (!sel || !bpm) return;
        const r = sel.value !== '' ? finishResources[Number(sel.value)] : null;
        bpm.style.display = (r && (r.kind === 'metronome' || r.kind === 'drums')) ? '' : 'none';
    }
    function collectFinish() {
        const sel = $('finishResource'); const bpm = $('finishBpm');
        let kind = '', url = '', label = '', bpmVal = 0;
        if (sel && sel.value !== '') {
            const r = finishResources[Number(sel.value)];
            if (r) { kind = r.kind; url = r.url || ''; label = r.label || ''; }
            if (kind === 'metronome' || kind === 'drums') { bpmVal = parseInt(bpm && bpm.value, 10); if (!bpmVal || bpmVal < 40 || bpmVal > 240) bpmVal = 120; }
        }
        return { kind: kind, url: url, label: label, bpm: bpmVal };
    }

    function buildExerciseRow(ex, idx, total) {
        const row = document.createElement('div');
        row.className = 'exercise has-drag';
        row.dataset.eid = ex.id;
        row.appendChild(GPH.mgr.dragHandle('Drag to reorder this exercise'));

        const fields = document.createElement('div');
        fields.className = 'ex-fields';

        const nameIn = document.createElement('input');
        nameIn.type = 'text';
        nameIn.className = 'ex-name';
        nameIn.value = ex.name || '';

        const descIn = document.createElement('input');
        descIn.type = 'text';
        descIn.className = 'ex-desc';
        descIn.value = ex.description || '';

        const durIn = document.createElement('input');
        durIn.type = 'number';
        durIn.className = 'ex-dur';
        durIn.min = '0';
        durIn.step = '0.5';
        durIn.value = toMinutes(ex.duration_seconds);
        durIn.title = 'minutes';
        durIn.addEventListener('input', updateRoutineTotal);

        const actions = document.createElement('div');
        actions.className = 'ex-actions';

        const upBtn = mk('↑', 'Move up', function () { moveExercise(idx, -1); });
        upBtn.disabled = idx === 0;
        const downBtn = mk('↓', 'Move down', function () { moveExercise(idx, 1); });
        downBtn.disabled = idx === total - 1;
        const delBtn = mk('🗑', 'Delete', function () { deleteExercise(ex.id); });
        delBtn.classList.add('danger');

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(delBtn);

        fields.appendChild(nameIn);
        fields.appendChild(descIn);
        fields.appendChild(durIn);
        fields.appendChild(actions);
        row.appendChild(fields);

        // ---- resources: a list (a scale + a backing track is a normal combo) ----
        const resWrap = document.createElement('div');
        resWrap.className = 'ex-resources';
        const resList = document.createElement('div');
        resList.className = 'ex-res-list';
        resWrap.appendChild(resList);

        const existing = (ex.resources && ex.resources.length)
            ? ex.resources
            : (ex.resource_kind ? [{ kind: ex.resource_kind, url: ex.resource_url, bpm: ex.resource_bpm, label: ex.resource_label }] : []);

        function addResourceLine(res) {
            const line = document.createElement('div');
            line.className = 'ex-res-line';
            const p = parseParams(res && res.url);
            // Settings learnt while practising (signature, pattern, style...) are
            // carried over untouched when the exercise is edited here.
            line._resKind = res ? res.kind : '';
            line._resCfg = (res && res.cfg) || {};
            line._resUrl = res ? res.url : '';

            let selVal = '';
            resources.forEach(function (r, i) {
                if (!res) return;
                const isFixed = (r.kind === 'metronome' || r.kind === 'drums' || r.kind === 'fretboard');
                const match = (r.kind === 'theory')
                    ? (res.kind === 'theory' && (p.view || 'scales') === r.view)
                    : (res.kind === r.kind && (isFixed || r.url === res.url));
                if (match) selVal = String(i);
            });
            const picker = createResourcePicker(resources, selVal);
            const sel = picker.select;

            const bpm = document.createElement('input');
            bpm.type = 'number'; bpm.className = 'ex-res-bpm';
            bpm.min = '40'; bpm.max = '240'; bpm.placeholder = 'BPM';
            bpm.value = (res && res.bpm) || '';

            // ---- settings of the widget (metronome / drums) ----
            const cfgBox = document.createElement('div');
            cfgBox.className = 'ex-res-cfgbox';
            const sigSel = makeSel('Time signature');
            const patSel = makeSel('Metronome click pattern');
            const accentSel = makeSel('Accent on beat 1');
            const styleSel = makeSel('Drum preset');
            const resSel = makeSel('Grid resolution');
            const swingSel = makeSel('Swing');
            sigSel.dataset.cfg = 'sig';
            patSel.dataset.cfg = 'pattern';
            accentSel.dataset.cfg = 'accent';
            styleSel.dataset.cfg = 'style';
            resSel.dataset.cfg = 'res';
            swingSel.dataset.cfg = 'swing';

            function fillStyles() {
                const dm = window.GPH && GPH.drumMachine;
                const opts = (dm && dm.styleOptions) ? dm.styleOptions() : [];
                const items = opts.map(function (o) {
                    return { v: o.value, t: 'preset: ' + o.label };
                });
                fillSel(styleSel, 'preset: auto', items);
            }

            function styleSigOf(id) {
                const dm = window.GPH && GPH.drumMachine;
                return (dm && dm.styleSig) ? dm.styleSig(id) : '';
            }

            function styleTextOf(id) {
                const dm = window.GPH && GPH.drumMachine;
                return (dm && dm.styleLabel) ? dm.styleLabel(id) : id;
            }

            // Builds the controls for a kind and shows the settings stored on it.
            // Every option carries its own label ("sig: 4/4"), so the row needs no
            // extra captions and nothing gets truncated.
            function buildCfg(kind) {
                const isDrums = kind === 'drums';
                fillSel(sigSel, 'sig: auto', (isDrums ? ['4/4', '3/4', '6/8']
                    : ['4/4', '3/4', '2/4', '6/8']).map(function (v) {
                    return { v: v, t: 'sig: ' + v };
                }));
                fillSel(patSel, 'click: auto', [
                    { v: '1', t: 'click: 4th' }, { v: '2', t: 'click: 8ths' },
                    { v: '4', t: 'click: 16ths' }, { v: '3', t: 'click: triplets' },
                    { v: 'shuffle', t: 'click: shuffle' }
                ]);
                fillSel(accentSel, 'accent: auto', [
                    { v: 'on', t: 'accent: on' }, { v: 'off', t: 'accent: off' }
                ]);
                fillSel(resSel, 'grid: auto', [{ v: '8', t: 'grid: 8ths' }, { v: '16', t: 'grid: 16ths' }]);
                fillSel(swingSel, 'swing: auto', [{ v: 'on', t: 'swing: on' }, { v: 'off', t: 'swing: off' }]);

                const cfg = line._resCfg || {};
                const legacyFlat = cfg.pattern === 'flat';
                let styleVal = cfg.style || '';
                // Old states stored a single "custom"; map it to the custom of
                // the saved signature.
                if (styleVal === 'custom' && (cfg.sig === '6/8' || cfg.sig === '3/4')) {
                    const dm = window.GPH && GPH.drumMachine;
                    if (dm && dm.customStyleId) styleVal = dm.customStyleId(cfg.sig);
                }
                sigSel.value = cfg.sig || '';
                patSel.value = legacyFlat ? '1' : (cfg.pattern != null ? String(cfg.pattern) : '');
                accentSel.value = legacyFlat ? 'off'
                    : (cfg.accent === true ? 'on' : (cfg.accent === false ? 'off' : ''));
                resSel.value = cfg.res ? String(cfg.res) : '';
                swingSel.value = cfg.swing === true ? 'on' : (cfg.swing === false ? 'off' : '');
                fillStyles();
                styleSel.value = styleVal;
                if (styleVal && !styleSel.value) {
                    // Unknown/legacy preset: keep it visible, never lose it
                    const o = document.createElement('option');
                    o.value = styleVal;
                    o.textContent = 'preset: ' + styleTextOf(styleVal);
                    styleSel.appendChild(o);
                    styleSel.value = styleVal;
                }
                const styleSig = styleSigOf(styleSel.value);
                if (styleSig) sigSel.value = styleSig;
                patSel.style.display = isDrums ? 'none' : '';
                accentSel.style.display = isDrums ? 'none' : '';
                styleSel.style.display = isDrums ? '' : 'none';
                resSel.style.display = isDrums ? '' : 'none';
                swingSel.style.display = isDrums ? '' : 'none';
                cfgBox.dataset.kind = kind;
            }

            // All styles stay visible. Choosing one loads its meter; changing
            // the meter manually clears an incompatible preset.
            sigSel.addEventListener('change', function () {
                if (cfgBox.dataset.kind !== 'drums') return;
                const sig = sigSel.value;
                const styleSig = styleSigOf(styleSel.value);
                if (sig && styleSig && styleSig !== sig) styleSel.value = '';
            });
            styleSel.addEventListener('change', function () {
                if (cfgBox.dataset.kind !== 'drums') return;
                const sig = styleSigOf(styleSel.value);
                if (sig) sigSel.value = sig;
            });

            cfgBox.appendChild(bpm);
            cfgBox.appendChild(sigSel);
            cfgBox.appendChild(patSel);
            cfgBox.appendChild(accentSel);
            cfgBox.appendChild(styleSel);
            cfgBox.appendChild(resSel);
            cfgBox.appendChild(swingSel);

            const thBox = document.createElement('div');
            thBox.className = 'ex-theory';

            function sync() {
                const r = sel.value !== '' ? resources[Number(sel.value)] : null;
                const kind = r ? r.kind : '';
                const isWidget = (kind === 'metronome' || kind === 'drums');
                bpm.style.display = isWidget ? '' : 'none';
                cfgBox.style.display = isWidget ? '' : 'none';
                if (isWidget && cfgBox.dataset.kind !== kind) buildCfg(kind);
                const isTheory = !!(r && r.kind === 'theory');
                thBox.style.display = isTheory ? '' : 'none';
                if (isTheory && thBox.dataset.view !== r.view) {
                    buildTheoryControls(thBox, r.view, (res && res.kind === 'theory') ? p : {});
                }
            }
            sel.addEventListener('change', sync);

            const del = document.createElement('button');
            del.type = 'button'; del.className = 'btn small danger ex-res-del';
            del.textContent = '\u2715'; del.title = 'Remove this resource';
            del.addEventListener('click', function () {
                if (resList.querySelectorAll('.ex-res-line').length > 1) {
                    line.remove();
                    refreshDeleteButtons();
                } else {
                    sel.value = '';
                    picker.refresh();
                    sync();
                }
            });

            line.appendChild(picker.root);
            line.appendChild(cfgBox);
            line.appendChild(thBox);
            line.appendChild(del);
            resList.appendChild(line);
            sync();
            return line;
        }

        function refreshDeleteButtons() {
            const lines = resList.querySelectorAll('.ex-res-line');
            Array.prototype.forEach.call(lines, function (l) {
                const btn = l.querySelector('.ex-res-del');
                if (btn) btn.disabled = lines.length <= 1;
            });
        }

        (existing.length ? existing : [null]).forEach(addResourceLine);
        refreshDeleteButtons();

        const addRes = document.createElement('button');
        addRes.type = 'button'; addRes.className = 'btn small ex-res-add';
        addRes.textContent = '+ Add resource';
        addRes.title = 'Add another resource to this exercise';
        addRes.addEventListener('click', function () {
            addResourceLine(null);
            refreshDeleteButtons();
        });
        resWrap.appendChild(addRes);
        row.appendChild(resWrap);
        return row;
    }

    async function createRoutine() {
        try {
            if (current) { try { await saveAll(); } catch (ignore) {} }
            const r = await api('POST', '/api/routines', { name: 'New routine' });
            notify();
            toast('Routine created');
            await loadRoutines(r.id);
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function saveRoutine() {
        if (!current) return;
        try {
            await saveAll();
            notify();
            toast('All changes saved');
            await loadRoutines(current.id);
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function activateRoutine() {
        if (!current) return;
        try {
            await api('POST', '/api/routines/' + current.id + '/activate');
            notify();
            toast('Routine activated');
            await saveAllAndReload();
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function duplicateRoutine() {
        if (!current) return;
        try {
            try { await saveAll(); } catch (ignore) {}
            const r = await api('POST', '/api/routines/' + current.id + '/duplicate');
            notify();
            toast('Routine duplicated');
            await loadRoutines(r.id);
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function deleteRoutine() {
        if (!current) return;
        if (!confirm('Delete routine "' + current.name + '" and all its exercises?')) return;
        try {
            await api('DELETE', '/api/routines/' + current.id);
            notify();
            toast('Deleted');
            selectedId = null;
            setDirty(false);
            await loadRoutines();
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // --- widget settings stored with a resource (metronome / drums) ----------

    function makeSel(title) {
        const s = document.createElement('select');
        s.className = 'ex-res-cfg-sel';
        if (title) s.title = title;
        return s;
    }

    // First option is "auto" (empty value): that setting is not forced.
    function fillSel(s, autoLabel, items) {
        s.innerHTML = '';
        const o0 = document.createElement('option');
        o0.value = ''; o0.textContent = autoLabel;
        s.appendChild(o0);
        items.forEach(function (it) {
            const o = document.createElement('option');
            o.value = it.v; o.textContent = it.t;
            s.appendChild(o);
        });
    }

    // Reads the widget selects of a resource line into a flat cfg. Empty values are
    // omitted, so an all-default line stores {} (= "do not force anything").
    function readLineCfg(line) {
        const raw = {};
        Array.prototype.forEach.call(line.querySelectorAll('[data-cfg]'), function (el) {
            raw[el.dataset.cfg] = el.value;
        });
        const cfg = {};
        if (raw.sig) cfg.sig = raw.sig;
        if (raw.pattern) cfg.pattern = raw.pattern;
        if (raw.accent === 'on') cfg.accent = true;
        else if (raw.accent === 'off') cfg.accent = false;
        if (raw.style) cfg.style = raw.style;
        if (raw.res) cfg.res = parseInt(raw.res, 10);
        if (raw.swing === 'on') cfg.swing = true;
        else if (raw.swing === 'off') cfg.swing = false;
        return cfg;
    }

    // Collects the current values of all exercise rows.
    function collectExerciseRows() {
        const rows = document.querySelectorAll('#exerciseList .exercise[data-eid]');
        const out = [];
        rows.forEach(function (row) {
            const name = row.querySelector('.ex-name');
            const desc = row.querySelector('.ex-desc');
            const dur = row.querySelector('.ex-dur');
            const list = [];

            Array.prototype.forEach.call(row.querySelectorAll('.ex-res-line'), function (line) {
                const sel = line.querySelector('.ex-res');
                if (!sel || sel.value === '') return;
                const r = resources[Number(sel.value)];
                if (!r) return;
                const item = { kind: r.kind, url: r.url || '', bpm: 0, label: r.label || '' };
                if (r.kind === 'theory') {
                    const thBox = line.querySelector('.ex-theory');
                    item.url = readTheoryUrl(thBox);
                    item.label = readTheoryLabel(thBox, item.label || 'Theory');
                }
                if (r.kind === 'metronome' || r.kind === 'drums') {
                    const bpmIn = line.querySelector('.ex-res-bpm');
                    let bpm = parseInt(bpmIn && bpmIn.value, 10);
                    if (!bpm || bpm < 40 || bpm > 240) bpm = 120;
                    item.bpm = bpm;
                    // signature / pattern / preset / grid / swing ("auto" = not forced)
                    item.cfg = readLineCfg(line);
                }
                list.push(item);
            });

            out.push({
                id: Number(row.dataset.eid),
                name: name ? name.value : '',
                description: desc ? desc.value : '',
                duration_seconds: toSeconds(dur ? dur.value : 0),
                resources: list
            });
        });
        return out;
    }

    // Saves the header (name/description) and all exercise rows.
    async function saveAll() {
        if (!current) return;
        const finish = collectFinish();
        await api('PUT', '/api/routines/' + current.id,
            { name: $('rName').value, description: $('rDesc').value,
              finish_kind: finish.kind, finish_url: finish.url, finish_label: finish.label, finish_bpm: finish.bpm });
        const rows = collectExerciseRows();
        for (const ex of rows) {
            await api('PUT', '/api/exercises/' + ex.id,
                { name: ex.name, description: ex.description, duration_seconds: ex.duration_seconds,
                  resources: ex.resources });
        }
        setDirty(false);
    }


    // Auto-saves the header (name/description) and reloads the routine.
    async function saveAllAndReload() {
        if (current) {
            try {
                await saveAll();
                // (cabecera y ejercicios guardados via saveAll)
            } catch (e) {}
        }
        await loadRoutines(current ? current.id : undefined);
    }
    async function addExercise() {
        if (!current) return;
        const name = $('newExName').value.trim();
        if (!name) { toast('Enter an exercise name', true); return; }
        const desc = $('newExDesc').value;
        const durMin = $('newExDur').value;
        try {
            await api('POST', '/api/routines/' + current.id + '/exercises',
                { name: name, description: desc, duration_seconds: toSeconds(durMin) });
            $('newExName').value = '';
            $('newExDesc').value = '';
            $('newExDur').value = '';
            notify();
            toast('Exercise added');
            await saveAllAndReload();
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // (Per-exercise saving removed: everything is now saved with the
    //  "Save routine" button, which persists the header and all rows.)

    async function deleteExercise(eid) {
        if (!confirm('Delete this exercise?')) return;
        try {
            try { await saveAll(); } catch (ignore) {}
            await api('DELETE', '/api/exercises/' + eid);
            notify();
            toast('Exercise deleted');
            await saveAllAndReload();
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // Persists a new exercise order. Used by drag & drop and by the ↑/↓ buttons,
    // so pending edits are saved first and the routine is reloaded afterwards.
    async function applyExerciseOrder(ids) {
        if (!current) return;
        try { await saveAll(); } catch (ignore) { /* noop */ }
        try {
            await api('POST', '/api/routines/' + current.id + '/reorder',
                { order: ids.map(function (id) { return Number(id); }) });
            notify();
        } catch (e) { toast('Error: ' + e.message, true); }
        await loadRoutines(current.id);
    }

    async function moveExercise(idx, dir) {
        const exs = (current.exercises || []).slice();
        const j = idx + dir;
        if (j < 0 || j >= exs.length) return;
        const tmp = exs[idx];
        exs[idx] = exs[j];
        exs[j] = tmp;
        await applyExerciseOrder(exs.map(function (e) { return e.id; }));
    }

    function loadAssistantSettings() {
        GPH.settings.getOr('assistant_enabled').then(function (v) {
            const cb = $('assistantEnabled');
            if (cb) cb.checked = GPH.settings.isOn(v);
        }).catch(function () {});
    }
    function bindAssistantSettings() {
        const cb = $('assistantEnabled');
        if (cb) cb.addEventListener('change', function () { putSetting('assistant_enabled', this.checked ? '1' : '0'); });
    }
    function getStringChecks() { return Array.prototype.slice.call(document.querySelectorAll('.fb-str')); }
    function setStringChecks(val) {
        const arr = GPH.util.parseCsvInts(val, 1, 6, [1, 2, 3, 4, 5, 6]);
        getStringChecks().forEach(function (c) { c.checked = arr.indexOf(parseInt(c.value, 10)) >= 0; });
    }
    function saveStringsSelection() {
        let cbs = getStringChecks();
        let checked = cbs.filter(function (c) { return c.checked; });
        if (!checked.length) { cbs.forEach(function (c) { c.checked = true; }); checked = cbs; }
        putSetting('fretboard_strings', checked.map(function (c) { return c.value; }).join(','));
    }
    function loadFretboardSettings() {
        Promise.all(['fretboard_enabled', 'fretboard_strings', 'fretboard_frets'].map(GPH.settings.getOr)).then(function (res) {
            const cb = $('fbEnabled');
            if (cb) cb.checked = GPH.settings.isOn(res[0]);
            setStringChecks(res[1]);
            const f = $('fbFrets'); if (f) f.value = parseInt(res[2], 10) || 12;
        }).catch(function () {});
    }
    function bindFretboardSettings() {
        const cb = $('fbEnabled');
        if (cb) cb.addEventListener('change', function () { putSetting('fretboard_enabled', this.checked ? '1' : '0'); });
        document.querySelectorAll('.fb-str').forEach(function (c) { c.addEventListener('change', saveStringsSelection); });
        const f = $('fbFrets');
        if (f) f.addEventListener('change', function () { putSetting('fretboard_frets', String(Math.max(1, Math.min(24, parseInt(this.value, 10) || 12)))); });
    }
    function loadFretboardSubSettings() {
        ['fbTrainerEnabled', 'fbTheoryEnabled', 'fbChordsEnabled', 'fbChordDiagramsEnabled'].forEach(function (id) {
            const cb = $(id);
            if (!cb) return;
            const key = {
                'fbTrainerEnabled': 'fretboard_trainer_enabled',
                'fbTheoryEnabled': 'fretboard_theory_enabled',
                'fbChordsEnabled': 'fretboard_chords_enabled',
                'fbChordDiagramsEnabled': 'fretboard_chord_diagrams_enabled'
            }[id];
            GPH.settings.getOr(key).then(function (v) { cb.checked = GPH.settings.isOn(v); }).catch(function () {});
        });
    }
    function bindFretboardSubSettings() {
        ['fbTrainerEnabled', 'fbTheoryEnabled', 'fbChordsEnabled', 'fbChordDiagramsEnabled'].forEach(function (id) {
            const cb = $(id);
            if (!cb) return;
            const key = {
                'fbTrainerEnabled': 'fretboard_trainer_enabled',
                'fbTheoryEnabled': 'fretboard_theory_enabled',
                'fbChordsEnabled': 'fretboard_chords_enabled',
                'fbChordDiagramsEnabled': 'fretboard_chord_diagrams_enabled'
            }[id];
            cb.addEventListener('change', function () { putSetting(key, this.checked ? '1' : '0'); });
        });
    }

    // ---- Developer: debug dry-run toggle ----------------------------------
    // The flag lives in localStorage (`gphDebug`, read by js/debug.js). Turning
    // it on/off reloads the app (and this page) with ?debug=1 / ?debug=0 so the
    // fetch wrapper is installed from the very first request.
    function debugOn() {
        try { return localStorage.getItem('gphDebug') === '1'; } catch (e) { return false; }
    }

    function renderDebugSetting() {
        const btn = $('debugToggleBtn'), state = $('debugState');
        const on = debugOn();
        if (btn) {
            btn.textContent = on ? 'Disable debug mode' : 'Enable debug mode';
            btn.classList.toggle('danger', on);
        }
        if (state) {
            state.textContent = on ? 'ON - every write is blocked' : 'OFF';
            state.style.color = on ? '#f0b429' : '#9a9a9a';
        }
    }

    function toggleDebugMode() {
        const on = debugOn();
        try {
            if (on) localStorage.removeItem('gphDebug');
            else localStorage.setItem('gphDebug', '1');
        } catch (e) { /* private mode */ }
        const flag = on ? '0' : '1';
        renderDebugSetting();
        // Reload the app itself when the manager runs inside its iframe.
        try {
            const host = window.top;
            if (host && host !== window && host.location && /index\.html$/.test(host.location.pathname)) {
                host.location.href = 'index.html?debug=' + flag;
            }
        } catch (e) { /* cross-origin: ignore */ }
        location.href = 'manager.html?debug=' + flag;
    }

    function bindDebugSetting() {
        const btn = $('debugToggleBtn');
        if (btn) btn.addEventListener('click', toggleDebugMode);
        renderDebugSetting();
    }

    // CSV export of the practice history (the server sends it as a download).
    function bindExports() {
        [['exportSessionsBtn', '/api/export/sessions.csv'],
         ['exportItemsBtn', '/api/export/items.csv']].forEach(function (pair) {
            const btn = $(pair[0]);
            if (btn) btn.addEventListener('click', function () { window.location.href = pair[1]; });
        });
    }

    function init() {
        bindDebugSetting();
        bindExports();
        bindFretboardSettings();
        loadFretboardSettings();
        bindFretboardSubSettings();
        loadFretboardSubSettings();
        bindAssistantSettings();
        loadAssistantSettings();
        $('newRoutineBtn').addEventListener('click', createRoutine);
        $('saveRoutineBtn').addEventListener('click', saveRoutine);
        $('activateBtn').addEventListener('click', activateRoutine);
        $('dupRoutineBtn').addEventListener('click', duplicateRoutine);
        $('deleteRoutineBtn').addEventListener('click', deleteRoutine);
        $('addExBtn').addEventListener('click', addExercise);
        const editorBox = $('editor');
        if (editorBox) {
            const markDirty = function (e) {
                if (e.target && e.target.closest && e.target.closest('.add-ex')) return;
                setDirty(true);
            };
            editorBox.addEventListener('input', markDirty);
            editorBox.addEventListener('change', markDirty);
        }
        const stopBtn = $('stopServerBtn');
        if (stopBtn) stopBtn.addEventListener('click', function () {
            if (!confirm('Stop the local server? You will need to relaunch it to use the app again.')) return;
            fetch('/api/shutdown', { method: 'POST' }).catch(function () {});
            toast('Server stopped. You can close this page.');
        });
        const finishSel = $('finishResource');
        if (finishSel) finishSel.addEventListener('change', syncFinishBpm);
        api('GET', '/api/sections').then(function (secs) {
            resources = buildResources(secs);
            finishResources = buildFinishResources(secs);
            populateFinishSelect();
        })
            .catch(function () { /* noop */ })
            .then(function () { loadRoutines().catch(function (e) { toast('Error: ' + e.message, true); }); });
    }

    document.addEventListener('DOMContentLoaded', init);
})(window.GPH = window.GPH || {});
