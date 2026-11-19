// Sections manager: items = youtube | external | audio | divider | folder | song | file | widget
(function (GPH) {
    'use strict';

    const COLOR_DEFS = [
        { hex: '#ff9800', name: 'Orange', text: '#000' },
        { hex: '#2196f3', name: 'Blue', text: '#fff' },
        { hex: '#4caf50', name: 'Green', text: '#000' },
        { hex: '#f44336', name: 'Red', text: '#fff' },
        { hex: '#e91e63', name: 'Pink', text: '#fff' },
        { hex: '#9c27b0', name: 'Purple', text: '#fff' },
        { hex: '#009688', name: 'Teal', text: '#fff' },
        { hex: '#3f51b5', name: 'Indigo', text: '#fff' },
        { hex: '#ffc107', name: 'Amber', text: '#000' },
        { hex: '#00bcd4', name: 'Cyan', text: '#000' },
        { hex: '#ff5722', name: 'Deep Orange', text: '#fff' },
        { hex: '#cddc39', name: 'Lime', text: '#000' }
    ];
    const COLORS = COLOR_DEFS.map(function (c) { return c.hex; });
    const KIND_LABELS = { youtube: 'YouTube', external: 'External', audio: 'Web audio', divider: 'Divider', folder: 'Local folder', song: 'Local song', file: 'Local file', widget: 'Widget' };
    const { $, api, toast, notify } = GPH.mgr;

    let sections = [];
    let selectedId = null;
    let current = null;
    let widgets = [];
    let newFields = {};
    let dirty = false;

    // Highlights the Save button with the same effect as in routines (helper in managerCommon.js).
    function setDirty(v) {
        dirty = GPH.mgr.setDirty('saveSectionBtn', v, 'Save the section and all item changes');
    }




    function colorOptions(sel) {
        const s = $('sColor'); s.innerHTML = '';
        COLOR_DEFS.forEach(function (cd) {
            const o = document.createElement('option');
            o.value = cd.hex;
            o.textContent = cd.name;
            o.style.backgroundColor = cd.hex;
            o.style.color = cd.text;
            s.appendChild(o);
        });
        if (sel) s.value = sel;
        applySelectColor();
    }

    function applySelectColor() {
        const s = $('sColor');
        const cd = COLOR_DEFS.filter(function (c) { return c.hex === s.value; })[0] || COLOR_DEFS[0];
        s.style.backgroundColor = cd.hex;
        s.style.color = cd.text;
    }

    function showView(which) {
        const r = $('viewRoutines'), s = $('viewSections'), a = $('viewAbout');
        if (!r || !s) return;
        r.classList.toggle('view-hidden', which !== 'routines');
        s.classList.toggle('view-hidden', which !== 'sections');
        if (a) a.classList.toggle('view-hidden', which !== 'about');
        const h = $('viewHistory');
        if (h) h.classList.toggle('view-hidden', which !== 'history');
        const x = $('viewExercises');
        if (x) x.classList.toggle('view-hidden', which !== 'exercises');
        const gu = $('viewGuitars');
        if (gu) gu.classList.toggle('view-hidden', which !== 'guitars');
        $('tabRoutines').classList.toggle('active', which === 'routines');
        $('tabSections').classList.toggle('active', which === 'sections');
        const tabA = $('tabAbout'); if (tabA) tabA.classList.toggle('active', which === 'about');
        const tabH = $('tabHistory'); if (tabH) tabH.classList.toggle('active', which === 'history');
        const tabE = $('tabExercises'); if (tabE) tabE.classList.toggle('active', which === 'exercises');
        const tabG = $('tabGuitars'); if (tabG) tabG.classList.toggle('active', which === 'guitars');
        if (which === 'history' && GPH.history) GPH.history.show();
        if (which === 'exercises' && GPH.exercises) {
            GPH.exercises.show();
            if (GPH.paths) GPH.paths.show();
        }
        if (which === 'guitars' && GPH.guitarsManager) GPH.guitarsManager.show();
        if (which === 'about' && GPH.areas) GPH.areas.load();
    }

    async function loadSections(preferId) {
        sections = await api('GET', '/api/sections');
        renderSectionList();
        const target = pickTarget(preferId);
        if (target != null) { await selectSection(target); }
        else { selectedId = null; current = null; hideEditor(); }
    }

    function pickTarget(preferId) {
        if (preferId != null && sections.some(function (s) { return s.id === preferId; })) return preferId;
        if (selectedId != null && sections.some(function (s) { return s.id === selectedId; })) return selectedId;
        if (sections.length) return sections[0].id;
        return null;
    }

    function renderSectionList() {
        const list = $('sectionList'); list.innerHTML = '';
        if (!sections.length) {
            const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'No sections yet.'; list.appendChild(d); return;
        }
        sections.forEach(function (s, index) {
            const it = document.createElement('div');
            it.className = 'section-item has-drag' + (s.id === selectedId ? ' selected' : '') +
                (s.hidden ? ' is-hidden' : '');
            it.dataset.id = String(s.id);
            it.appendChild(GPH.mgr.dragHandle('Drag to reorder this section'));
            const dot = document.createElement('span'); dot.className = 'section-dot'; dot.style.background = s.color || '#888'; it.appendChild(dot);
            const lane = document.createElement('span');
            lane.className = 'lane-badge' + ((s.lane || 1) === 3 ? ' is-rail' : '');
            lane.textContent = (s.lane || 1) === 3 ? 'R' : 'L' + (s.lane || 1);
            lane.title = (s.lane || 1) === 3 ? 'Right rail' : ('Left column, lane ' + (s.lane || 1));
            it.appendChild(lane);
            const nm = document.createElement('span'); nm.className = 'sname'; nm.textContent = s.title; it.appendChild(nm);
            const hide = mkIconBtn(s.hidden ? 'eye-off' : 'eye',
                s.hidden ? 'Show this section' : 'Hide this section', null,
                function (ev) { ev.stopPropagation(); toggleSectionHidden(s); });
            it.appendChild(hide);
            // Arrows reorder inside the lane only; the column is the select in the editor.
            const prevSec = sections[index - 1];
            const nextSec = sections[index + 1];
            const up = mkBtn('↑', 'Move up', null, function (ev) { ev.stopPropagation(); moveSectionById(s.id, -1); });
            up.disabled = !prevSec || (prevSec.lane || 1) !== (s.lane || 1);
            const down = mkBtn('↓', 'Move down', null, function (ev) { ev.stopPropagation(); moveSectionById(s.id, 1); });
            down.disabled = !nextSec || (nextSec.lane || 1) !== (s.lane || 1);
            it.appendChild(up); it.appendChild(down);
            it.addEventListener('click', function () { selectSection(s.id); });
            list.appendChild(it);
        });
        GPH.mgr.makeSortable(list, {
            itemSelector: '.section-item[data-id]',
            onReorder: applySectionOrder
        });
    }

    async function selectSection(id) {
        if (dirty && id !== selectedId) {
            if (!confirm('You have unsaved changes in this section. Discard them?')) return;
        }
        selectedId = id;
        current = sections.filter(function (s) { return s.id === id; })[0] || null;
        setDirty(false);
        renderSectionList();
        if (!current) { hideEditor(); return; }
        $('sectionEmpty').hidden = true;
        $('sectionEditor').hidden = false;
        $('sTitle').value = current.title || '';
        colorOptions(current.color);
        $('sLane').value = String(current.lane || 1);
        $('itemCount').textContent = '(' + (current.items ? current.items.length : 0) + ')';
        renderItems();
    }

    function hideEditor() { $('sectionEditor').hidden = true; $('sectionEmpty').hidden = false; setDirty(false); }

    async function newSection() {
        try {
            await savePendingQuiet();
            const r = await api('POST', '/api/sections', { title: 'New Section', description: '', color: COLORS[0],
                                                           lane: current ? (current.lane || 1) : 1 });
            notify(); toast('Section created'); await loadSections(r.id);
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // Saves the header (title/color) and ALL item rows
    // (label, tag, url and meta: fretboard strings/frets and song titles).
    async function saveAll() {
        if (!current) return;
        await api('PUT', '/api/sections/' + current.id, {
            title: $('sTitle').value,
            color: $('sColor').value,
            lane: parseInt($('sLane').value, 10) || 1
        });
        const items = current.items || [];
        for (const it of items) {
            const row = document.querySelector('#itemList .item-row[data-iid="' + it.id + '"]');
            if (!row) continue;
            const body = {};
            const labelIn = row.querySelector('.item-label');
            const tagIn = row.querySelector('.item-tag');
            const urlIn = row.querySelector('input.item-url-input');
            if (labelIn) body.label = labelIn.value;
            if (tagIn) body.tag = tagIn.value;
            if (urlIn) body.url = urlIn.value;
            let meta = null;
            if (it.kind === 'widget' && it.url === 'fretboard' && row._fbStrings && row._fbFrets) {
                meta = Object.assign({}, it.meta || {}, {
                    strings: Math.max(1, Math.min(6, parseInt(row._fbStrings.value, 10) || 6)),
                    frets: Math.max(1, Math.min(24, parseInt(row._fbFrets.value, 10) || 12))
                });
            }
            const songInputs = row.querySelectorAll('input[data-path]');
            if (songInputs.length) {
                const existing = (it.meta && it.meta.songs) || [];
                const relMap = {}; existing.forEach(function (s) { relMap[s.path] = s.rel; });
                const songs = [];
                songInputs.forEach(function (inp) {
                    songs.push({ path: inp.dataset.path, rel: relMap[inp.dataset.path] || '', title: inp.value });
                });
                meta = Object.assign({}, meta || it.meta || {}, { songs: songs });
            }
            if (meta) body.meta = meta;
            if (Object.keys(body).length) await api('PUT', '/api/items/' + it.id, body);
        }
        setDirty(false);
    }

    // Before a structural action (add/del/move/rescan) it persists pending changes silently.
    async function savePendingQuiet() {
        try { await saveAll(); } catch (e) { /* noop */ }
    }

    async function saveSection() {
        if (!current) return;
        try {
            await saveAll();
            notify(); toast('All changes saved'); await loadSections(current.id);
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function delSection() {
        if (!current) return;
        if (!confirm('Delete this section and all its items?')) return;
        try {
            await api('DELETE', '/api/sections/' + current.id);
            notify(); toast('Deleted'); selectedId = null; setDirty(false); await loadSections();
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // Persists a new section order. The lane of every section is kept and only
    // the section that was actually dragged adopts the lane of its neighbour,
    // so dragging in this list can also change the column.
    async function applySectionOrder(ids, movedId) {
        try { await savePendingQuiet(); } catch (ignore) { /* noop */ }
        const nums = ids.map(function (id) { return Number(id); });
        const byId = {};
        sections.forEach(function (s) { byId[s.id] = s; });
        const moved = (movedId !== undefined && movedId !== null) ? byId[Number(movedId)] : null;
        if (moved) {
            const i = nums.indexOf(Number(movedId));
            const neighbour = byId[nums[i - 1]] || byId[nums[i + 1]];
            if (neighbour) moved.lane = neighbour.lane || 1;
        }
        const perLane = { 1: [], 2: [], 3: [] };
        nums.forEach(function (id) {
            const s = byId[id];
            if (!s) return;
            perLane[s.lane || 1].push(id);
        });
        const layout = [];
        [1, 2, 3].forEach(function (lane) {
            perLane[lane].forEach(function (id, pos) {
                layout.push({ id: id, lane: lane, position: pos });
            });
        });
        try {
            await api('POST', '/api/sections/reorder', { layout: layout });
            notify();
        } catch (e) { toast('Error: ' + e.message, true); }
        await loadSections(selectedId);
    }

    // Spreads the sections over the three lanes by size. It is only a starting
    // point: they can be dragged again afterwards.
    async function resetLayout() {
        if (!sections.length) return;
        try { await savePendingQuiet(); } catch (ignore) { /* noop */ }
        try {
            await api('POST', '/api/sections/reorder',
                { layout: GPH.mgr.balanceLanes(sections) });
            notify();
            toast('Layout reset');
        } catch (e) { toast('Error: ' + e.message, true); }
        await loadSections(selectedId);
    }

    async function moveSectionById(id, dir) {
        const idx = sections.findIndex(function (s) { return s.id === id; });
        const j = idx + dir;
        if (idx < 0 || j < 0 || j >= sections.length) return;
        const arr = sections.slice();
        const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
        await applySectionOrder(arr.map(function (s) { return s.id; }));
    }

    async function toggleSectionHidden(section) {
        const next = section.hidden ? 0 : 1;
        try {
            await api('PUT', '/api/sections/' + section.id, { hidden: next });
            section.hidden = next;
            if (current && current.id === section.id) current.hidden = next;
            renderSectionList();
            notify();
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function toggleItemHidden(item, row) {
        const next = item.hidden ? 0 : 1;
        try {
            await api('PUT', '/api/items/' + item.id, { hidden: next });
            item.hidden = next;
            row.classList.toggle('is-hidden', !!next);
            notify();
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function moveItemTo(item, targetSection) {
        const target = Number(targetSection);
        if (!target) return;
        try {
            await savePendingQuiet();
            await api('POST', '/api/items/' + item.id + '/move', { section_id: target });
            notify();
            toast('Item moved');
            await loadSections(target);
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    function renderItems() {
        const wrap = $('itemList'); wrap.innerHTML = '';
        const items = current.items || [];
        if (!items.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'No items yet.'; wrap.appendChild(d); return; }
        items.forEach(function (it, idx) { wrap.appendChild(buildItemRow(it, idx, items.length)); });
        GPH.mgr.makeSortable(wrap, {
            itemSelector: '.item-row[data-iid]',
            onReorder: applyItemOrder
        });
    }

    function mkBtn(txt, title, cls, fn) {
        const b = document.createElement('button');
        b.className = 'btn small' + (cls ? ' ' + cls : '');
        b.textContent = txt; b.title = title; b.addEventListener('click', fn);
        return b;
    }

    function mkIconBtn(name, title, cls, fn) {
        const b = mkBtn('', title, cls, fn);
        b.classList.add('icon-btn');
        b.innerHTML = GPH.icons.get(name);
        return b;
    }

    // Human name of a widget: the /api/widgets list first, a title-cased key otherwise.
    function widgetName(key) {
        const w = widgets.filter(function (x) { return x.key === key; })[0];
        if (w) return w.name;
        return String(key || '').replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
    }

    // "file:///D:/.../Practice%20Calendar.xlsx" -> "Practice Calendar.xlsx"
    // (only for display; the raw value is what gets saved).
    function prettyPath(p) {
        let s = String(p || '');
        try { s = decodeURI(s); } catch (ignore) { /* keep the raw value */ }
        s = s.replace(/^file:\/{0,3}/i, '').replace(/[\\/]+$/, '');
        const parts = s.split(/[\\/]/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : s;
    }

    function buildItemRow(it, idx, total) {
        const row = document.createElement('div');
        row.className = 'item-row has-drag' + (it.hidden ? ' is-hidden' : '');
        row.dataset.iid = String(it.id);
        row.dataset.kind = it.kind || '';
        row.appendChild(GPH.mgr.dragHandle('Drag to reorder this item'));

        const isDivider = it.kind === 'divider';

        const head = document.createElement('div');
        head.className = 'item-head' + (isDivider ? ' item-head--divider' : '');
        const kind = document.createElement('div'); kind.className = 'item-kind';
        kind.textContent = KIND_LABELS[it.kind] || it.kind; head.appendChild(kind);

        let tagIn = null;
        if (!isDivider) {
            tagIn = document.createElement('input'); tagIn.type = 'text';
            tagIn.className = 'item-tag';
            tagIn.value = it.tag || ''; tagIn.placeholder = 'Tag'; head.appendChild(tagIn);
        }

        const labelIn = document.createElement('input'); labelIn.type = 'text';
        labelIn.className = 'item-label';
        labelIn.value = it.label || ''; labelIn.placeholder = isDivider ? 'Divider text' : 'Label';
        head.appendChild(labelIn);
        row.appendChild(head);

        let urlCtl = null;
        if (it.kind === 'folder' || it.kind === 'song' || it.kind === 'file' || it.kind === 'widget') {
            urlCtl = document.createElement('div'); urlCtl.className = 'item-url';
            if (it.kind === 'widget') {
                // "Widget: Notes" instead of the raw "widget: notes" key.
                urlCtl.textContent = 'Widget: ' + widgetName(it.url);
                urlCtl.title = 'widget: ' + (it.url || '');
            } else {
                // Friendly name on screen, full path on hover (the raw path is stored as is).
                urlCtl.textContent = prettyPath(it.url);
                urlCtl.title = it.url || '';
            }
        } else if (it.kind !== 'divider') {
            urlCtl = document.createElement('input'); urlCtl.type = 'text';
            urlCtl.className = 'item-url-input';
            urlCtl.value = it.url || ''; urlCtl.placeholder = 'URL';
        }

        const actions = document.createElement('div'); actions.className = 'item-actions';
        if (it.kind === 'folder') {
            actions.appendChild(mkBtn('🔄', 'Rescan folder', null, function () { refreshFolder(it.id); }));
        }
        const up = mkBtn('↑', 'Move up', null, function () { moveItem(idx, -1); }); up.disabled = idx === 0;
        const down = mkBtn('↓', 'Move down', null, function () { moveItem(idx, 1); }); down.disabled = idx === total - 1;
        const hide = mkIconBtn(it.hidden ? 'eye-off' : 'eye',
            it.hidden ? 'Show this item' : 'Hide this item', null,
            function (ev) { ev.stopPropagation(); toggleItemHidden(it, row); });
        const move = document.createElement('select');
        move.className = 'item-move';
        move.title = 'Move to another section';
        const placeholder = document.createElement('option');
        placeholder.value = ''; placeholder.textContent = 'Move to…';
        move.appendChild(placeholder);
        sections.forEach(function (sec) {
            if (!current || sec.id === current.id) return;
            const opt = document.createElement('option');
            opt.value = String(sec.id);
            opt.textContent = sec.title + (sec.hidden ? ' (hidden)' : '');
            move.appendChild(opt);
        });
        move.addEventListener('click', function (ev) { ev.stopPropagation(); });
        move.addEventListener('change', function () {
            if (this.value) moveItemTo(it, this.value);
        });
        actions.appendChild(hide);
        actions.appendChild(move);
        actions.appendChild(up); actions.appendChild(down);
        actions.appendChild(mkBtn('🗑', 'Delete', 'danger', function () { delItem(it.id); }));

        const foot = document.createElement('div'); foot.className = 'item-foot';
        if (isDivider) {
            head.appendChild(actions);
        } else {
            if (urlCtl) foot.appendChild(urlCtl);
            if (it.kind === 'widget' && it.url === 'fretboard') {
                const cfg = document.createElement('div'); cfg.className = 'item-url';
                const meta = it.meta || {};
                const sIn = document.createElement('input'); sIn.type = 'number'; sIn.min = '1'; sIn.max = '6'; sIn.value = String(meta.strings || 6); sIn.title = 'Number of strings';
                const fIn = document.createElement('input'); fIn.type = 'number'; fIn.min = '1'; fIn.max = '24'; fIn.value = String(meta.frets || 12); fIn.title = 'Number of frets';
                const l1 = document.createElement('span'); l1.textContent = 'Strings ';
                const l2 = document.createElement('span'); l2.textContent = '  Frets ';
                cfg.appendChild(l1); cfg.appendChild(sIn); cfg.appendChild(l2); cfg.appendChild(fIn);
                foot.appendChild(cfg);
                row._fbStrings = sIn; row._fbFrets = fIn;
            }
            foot.appendChild(actions);
            row.appendChild(foot);
        }

        if (it.kind === 'folder') {
            const songs = (it.meta && it.meta.songs) || [];
            const sl = document.createElement('div'); sl.className = 'song-list';
            const top = document.createElement('div'); top.className = 'song-line';
            const cnt = document.createElement('div'); cnt.className = 'mini';
            cnt.textContent = songs.length + ' songs'; top.appendChild(cnt);
            sl.appendChild(top);

            const scroll = document.createElement('div'); scroll.className = 'song-scroll';
            songs.forEach(function (sng) {
                const ln = document.createElement('div'); ln.className = 'song-line';
                const inp = document.createElement('input'); inp.type = 'text';
                inp.value = sng.title || ''; inp.dataset.path = sng.path; ln.appendChild(inp);
                const previewBtn = mkBtn('', 'Preview', null, function () {
                    window.open('/api/media?path=' + encodeURIComponent(sng.path), '_blank');
                });
                previewBtn.innerHTML = GPH.icons.get('play');
                ln.appendChild(previewBtn);
                scroll.appendChild(ln);
            });
            sl.appendChild(scroll);
            row.appendChild(sl);
        }
        return row;
    }

    async function delItem(id) {
        if (!confirm('Delete this item?')) return;
        try {
            await savePendingQuiet();
            await api('DELETE', '/api/items/' + id); notify(); toast('Deleted'); await loadSections(selectedId);
        }
        catch (e) { toast('Error: ' + e.message, true); }
    }

    // Persists a new item order. Used by drag & drop and by the ↑/↓ buttons:
    // pending edits are saved first, then the section is reloaded.
    async function applyItemOrder(ids) {
        if (!current) return;
        try { await savePendingQuiet(); } catch (ignore) { /* noop */ }
        try {
            await api('POST', '/api/sections/' + current.id + '/items/reorder',
                { order: ids.map(function (id) { return Number(id); }) });
            notify();
        } catch (e) { toast('Error: ' + e.message, true); }
        await loadSections(selectedId);
    }

    async function moveItem(idx, dir) {
        const items = (current.items || []).slice();
        const j = idx + dir;
        if (j < 0 || j >= items.length) return;
        const tmp = items[idx]; items[idx] = items[j]; items[j] = tmp;
        await applyItemOrder(items.map(function (i) { return i.id; }));
    }

    async function refreshFolder(id) {
        try {
            await savePendingQuiet();
            await api('POST', '/api/items/' + id + '/refresh', {}); notify(); toast('Folder refreshed'); await loadSections(selectedId);
        }
        catch (e) { toast('Error: ' + e.message, true); }
    }

    function mkInput(type, ph) {
        const i = document.createElement('input'); i.type = type; if (ph) i.placeholder = ph; return i;
    }

    function renderNewItemFields(kind) {
        newFields = { chosenPath: null, autoTag: '', autoLabel: '' };
        const head = $('newItemHead');
        const tagSlot = $('newItemTag');
        const labelSlot = $('newItemLabel');
        const main = $('newItemMain');
        if (!head || !tagSlot || !labelSlot || !main) return;
        tagSlot.innerHTML = ''; labelSlot.innerHTML = ''; main.innerHTML = '';

        // Same two-line grammar as the saved item rows: type + tag + label + Add on the
        // first line, and the "main" control (URL / picker / widget) on the second.
        const compact = (kind === 'divider');
        head.className = 'add-head' + (compact ? ' add-head--compact' : '');
        tagSlot.hidden = compact;

        const input = function (host, placeholder) {
            const inp = mkInput('text', placeholder);
            host.appendChild(inp);
            return inp;
        };

        if (kind === 'divider') {
            newFields.label = input(labelSlot, 'Divider text');
        } else if (kind === 'widget') {
            const sel = document.createElement('select'); sel.id = 'newWidgetKey';
            widgets.forEach(function (w) { const o = document.createElement('option'); o.value = w.key; o.textContent = w.name; sel.appendChild(o); });
            newFields.widget = sel;
            main.appendChild(sel);
            newFields.tag = input(tagSlot, 'Tag (optional)');
            newFields.label = input(labelSlot, 'Label (optional)');
        } else if (kind === 'folder' || kind === 'song' || kind === 'file') {
            main.appendChild(mkBtn(kind === 'folder' ? '📁 Select folder' : '📄 Select file', 'Native dialog', 'primary', function () { choosePath(kind); }));
            newFields.pathInfo = document.createElement('span'); newFields.pathInfo.className = 'mini';
            newFields.pathInfo.textContent = 'none selected';
            main.appendChild(newFields.pathInfo);
            newFields.tag = input(tagSlot, 'Tag (optional)');
            newFields.label = input(labelSlot, 'Label (optional)');
        } else {
            newFields.url = input(main, 'URL');
            newFields.tag = input(tagSlot, 'Tag (optional)');
            newFields.label = input(labelSlot, 'Label');
        }

        // No second line when there is nothing to put there (divider).
        const foot = main.parentElement;
        if (foot) foot.hidden = !main.childNodes.length;
    }

    async function choosePath(kind) {
        try {
            const endpoint = kind === 'folder' ? '/api/dialog/folder' : '/api/dialog/file';
            const r = await api('POST', endpoint, {});
            if (!r || !r.path) { toast('Cancelled'); return; }
            newFields.chosenPath = r.path;
            if (newFields.pathInfo) newFields.pathInfo.textContent = r.path;
            if (kind === 'song' || kind === 'file') applyPickedTags(r);
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // The server reads ID3 tags when the native file dialog closes. Fill Tag with
    // the artist and Label with the title, but never overwrite something the user
    // typed by hand. Tracking the last auto-filled values also clears them if a
    // new file has no tags.
    function applyPickedTags(r) {
        const tagInp = newFields.tag;
        const labelInp = newFields.label;
        const prevTag = newFields.autoTag || '';
        const prevLabel = newFields.autoLabel || '';
        const artist = (r.artist || '').trim();
        const title = (r.title || '').trim();
        const fillTag = tagInp && (!tagInp.value || tagInp.value === prevTag);
        const fillLabel = labelInp && (!labelInp.value || labelInp.value === prevLabel);
        if (fillTag) tagInp.value = artist;
        if (fillLabel) labelInp.value = title;
        // Only remember values we wrote ourselves: a value typed by hand must
        // survive the next file selection.
        newFields.autoTag = fillTag ? tagInp.value : prevTag;
        newFields.autoLabel = fillLabel ? labelInp.value : prevLabel;
        if (!artist && !title && /\.mp3$/i.test(r.path || '')) {
            toast('No ID3 artist/title found in this MP3');
        }
    }

    function baseName(p) {
        const s = p.replace(/[\\/]+$/, '');
        const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
        return i >= 0 ? s.slice(i + 1) : s;
    }

    function toFileUri(p) {
        let s = p.replace(/\\/g, '/');
        if (s.charAt(0) !== '/') s = '/' + s;
        return 'file://' + s;
    }

    async function addItem() {
        if (!current) return;
        const kind = $('newItemKind').value;
        const body = { kind: kind, label: '', tag: '', url: '' };
        try {
            if (kind === 'divider') {
                body.label = newFields.label.value;
            } else if (kind === 'widget') {
                body.url = newFields.widget.value;
                body.label = newFields.label.value || newFields.widget.options[newFields.widget.selectedIndex].textContent;
                body.tag = newFields.tag ? newFields.tag.value : '';
            } else if (kind === 'folder') {
                if (!newFields.chosenPath) { toast('Choose a folder first', true); return; }
                body.url = newFields.chosenPath;
                body.label = (newFields.label && newFields.label.value) || baseName(newFields.chosenPath);
                body.tag = (newFields.tag && newFields.tag.value) || '';
            } else if (kind === 'song' || kind === 'file') {
                if (!newFields.chosenPath) { toast('Choose a file first', true); return; }
                body.url = kind === 'file' ? toFileUri(newFields.chosenPath) : newFields.chosenPath;
                body.label = (newFields.label && newFields.label.value) || baseName(newFields.chosenPath);
                body.tag = (newFields.tag && newFields.tag.value) || '';
            } else {
                body.url = newFields.url.value;
                body.label = newFields.label.value;
                body.tag = newFields.tag.value;
            }
            await savePendingQuiet();
            await api('POST', '/api/sections/' + current.id + '/items', body);
            notify(); toast('Item added'); renderNewItemFields(kind); await loadSections(selectedId);
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // ---- Ajustes de apariencia (helpers compartidos en js/settings.js) ----
    function putSetting(key, value) {
        return GPH.settings.set(key, value).then(function () { notify(); });
    }

    function loadAccentSetting() {
        GPH.settings.getOr('accent_color').then(function (v) {
            var inp = $('accentColor');
            if (inp) inp.value = v;
            GPH.settings.applyAccent(v);
        }).catch(function () {});
    }

    function resetAccent() {
        var v = GPH.settings.DEFAULTS.accent_color;
        var inp = $('accentColor');
        if (inp) inp.value = v;
        GPH.settings.applyAccent(v);
        putSetting('accent_color', v)
            .then(function () { toast('App color reset to ' + v); })
            .catch(function () { toast('Error saving setting', true); });
    }

    function loadFretboardColor() {
        GPH.settings.getOr('fretboard_color').then(function (v) {
            var inp = $('fbColor');
            if (inp) inp.value = v;
        }).catch(function () {});
    }

    function resetFretboardColor() {
        var v = GPH.settings.DEFAULTS.fretboard_color;
        var inp = $('fbColor');
        if (inp) inp.value = v;
        putSetting('fretboard_color', v)
            .then(function () { toast('Fretboard color reset to ' + v); })
            .catch(function () { toast('Error saving setting', true); });
    }

    // ---- FreqBlog API key (widget Song Info) ----
    function setKeyStatus(text, cls) {
        var el = $('fbApiKeyStatus');
        if (!el) return;
        el.innerHTML = text || '';
        el.className = 'api-key-status' + (cls ? ' ' + cls : '');
    }
    function loadApiKey() {
        GPH.settings.get('freqblog_api_key').then(function (v) {
            var inp = $('fbApiKey');
            if (inp) inp.value = v || '';
        }).catch(function () {});
    }
    function saveApiKey() {
        var inp = $('fbApiKey');
        var val = inp ? inp.value.trim() : '';
        return putSetting('freqblog_api_key', val)
            .then(function () { setKeyStatus(val ? 'Key saved' : 'Key cleared'); })
            .catch(function () { setKeyStatus('Error saving the key', 'err'); });
    }
    // Human-readable summary of the FreqBlog /me/stats.
    function statsSummary(st) {
        st = st || {};
        var parts = ['Key valid'];
        var tier = st.tier || st.plan || (st.account && st.account.plan);
        if (tier) parts.push(String(tier));
        var used = (st.requests_this_month !== undefined) ? st.requests_this_month
                 : (st.requests_used !== undefined) ? st.requests_used
                 : (st.used !== undefined) ? st.used : null;
        var limit = (st.monthly_quota !== undefined) ? st.monthly_quota
                  : (st.requests_limit !== undefined) ? st.requests_limit
                  : (st.limit !== undefined) ? st.limit : null;
        var pct = null;
        if (used !== null && limit) {
            pct = (st.quota_used_pct !== undefined) ? st.quota_used_pct
                : Math.round(used / limit * 1000) / 10;
            parts.push(used + '/' + limit + ' this month (' + pct + '%)');
        } else if (used !== null) {
            parts.push(used + ' requests this month');
        }
        if (st.requests_today !== undefined) parts.push(st.requests_today + ' today');
        if (st.quota_reset_date) parts.push('resets ' + st.quota_reset_date);
        if (st.key_prefix) parts.push('key ' + st.key_prefix + '…');
        var text = parts.join(' · ');
        if (pct !== null && pct >= 90) text += '  ' + GPH.icons.get('alert') + ' close to the monthly limit';
        return { text: text, pct: pct };
    }

    function testApiKey() {
        setKeyStatus('Checking…');
        fetch('/api/song/key-check')
            .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
            .then(function (res) {
                var d = res.d || {};
                if (res.status === 200 && d.ok) {
                    var s = statsSummary(d.stats);
                    setKeyStatus(s.text, (s.pct !== null && s.pct >= 90) ? 'err' : 'ok');
                    return;
                }
                if (res.status === 400 && d.error === 'no_api_key') return setKeyStatus('No API key saved yet', 'err');
                if (res.status === 401) return setKeyStatus('Invalid key' + (d.detail ? ' (' + d.detail + ')' : ''), 'err');
                setKeyStatus('Could not check' + (d.detail ? ': ' + d.detail : ' (offline?)'), 'err');
            })
            .catch(function () { setKeyStatus('Could not check (offline?)', 'err'); });
    }

    function init() {
        if (!$('newSectionBtn')) return;
        colorOptions(COLORS[0]);
        $('sColor').addEventListener('change', applySelectColor);
        $('tabRoutines').addEventListener('click', function () { showView('routines'); });
        $('tabSections').addEventListener('click', function () { showView('sections'); });
        const tabGuitars = $('tabGuitars');
        if (tabGuitars) tabGuitars.addEventListener('click', function () { showView('guitars'); });
        $('tabAbout').addEventListener('click', function () { showView('about'); });
        const tabHistory = $('tabHistory');
        if (tabHistory) tabHistory.addEventListener('click', function () { showView('history'); });
        const tabExercises = $('tabExercises');
        if (tabExercises) tabExercises.addEventListener('click', function () { showView('exercises'); });
        // Deep link from the app (chart icon on the welcome card): manager.html?view=history
        try {
            const want = new URLSearchParams(location.search).get('view');
            if (want && ['routines', 'sections', 'history', 'about', 'exercises', 'guitars'].indexOf(want) >= 0) showView(want);
        } catch (e) { /* noop */ }
        $('newSectionBtn').addEventListener('click', newSection);
        const resetLayoutBtn = $('resetLayoutBtn');
        if (resetLayoutBtn) resetLayoutBtn.addEventListener('click', resetLayout);
        $('saveSectionBtn').addEventListener('click', saveSection);
        $('delSectionBtn').addEventListener('click', delSection);
        $('newItemKind').addEventListener('change', function () { renderNewItemFields(this.value); });
        $('addItemBtn').addEventListener('click', addItem);
        const secEditor = $('sectionEditor');
        if (secEditor) {
            const markDirty = function (e) {
                if (e.target && e.target.closest && e.target.closest('.add-item')) return;
                setDirty(true);
            };
            secEditor.addEventListener('input', markDirty);
            secEditor.addEventListener('change', markDirty);
        }
        var accentInput = $('accentColor');
        if (accentInput) {
            accentInput.addEventListener('input', function () { GPH.settings.applyAccent(this.value); });
            accentInput.addEventListener('change', function () { putSetting('accent_color', this.value); });
        }
        loadAccentSetting();
        var resetAccentBtn = $('resetAccentBtn');
        if (resetAccentBtn) resetAccentBtn.addEventListener('click', resetAccent);
        var fbColorInput = $('fbColor');
        if (fbColorInput) fbColorInput.addEventListener('change', function () { putSetting('fretboard_color', this.value); });
        loadFretboardColor();
        var keyInp = $('fbApiKey');
        if (keyInp) {
            keyInp.addEventListener('change', saveApiKey);
            keyInp.addEventListener('blur', saveApiKey);
        }
        var keyShow = $('fbApiKeyShow');
        if (keyShow) keyShow.addEventListener('click', function () {
            var i = $('fbApiKey');
            if (!i) return;
            i.type = (i.type === 'password') ? 'text' : 'password';
            keyShow.textContent = (i.type === 'password') ? 'Show' : 'Hide';
        });
        var keyTest = $('fbApiKeyTest');
        if (keyTest) keyTest.addEventListener('click', function () { saveApiKey().then(testApiKey); });
        loadApiKey();
        var resetFbBtn = $('resetFbColorBtn');
        if (resetFbBtn) resetFbBtn.addEventListener('click', resetFretboardColor);
        renderNewItemFields('youtube');
        api('GET', '/api/widgets').then(function (w) { widgets = w || []; }).catch(function () {});
        loadSections().catch(function (e) { toast('Error: ' + e.message, true); });
    }

    document.addEventListener('DOMContentLoaded', init);
})(window.GPH = window.GPH || {});
