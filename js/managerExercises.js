// Exercise catalog and practice areas: the "what do I practise" side.
// Exposes GPH.exercises { init, show, load } and the areas card of Settings.
(function (GPH) {
    'use strict';

    const { $, api, toast } = GPH.mgr;

    // ------------------------------ Catalog --------------------------------
    let items = [];
    let selectedId = null;
    let current = null;

    // Collapsed area groups are remembered per browser, so a catalog you keep
    // tidy stays tidy after a reload.
    const COLLAPSED_KEY = 'gphCatalogCollapsed';

    function collapsedGroups() {
        try {
            const list = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    function isCollapsed(key) {
        return collapsedGroups().indexOf(key) >= 0;
    }

    function setCollapsed(key, collapsed) {
        const list = collapsedGroups().filter(function (k) { return k !== key; });
        if (collapsed) list.push(key);
        try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(list)); } catch (e) { /* noop */ }
    }

    function setDirty(v) {
        GPH.mgr.setDirty('saveCatalogBtn', v, 'Save the exercise');
    }

    function span(cls, text) {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = text;
        return s;
    }

    function fmtDur(sec) {
        const m = Math.round((sec || 0) / 60);
        if (m < 60) return m + ' min';
        return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
    }

    // Names are compared without accents, case or punctuation: "Arp Maj7" and
    // "arp-maj7!" are the same exercise as far as the user is concerned.
    function normName(text) {
        return String(text || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    // Up to three exercises whose name looks the same, ignoring `skipId`.
    function similarExercises(name, skipId) {
        const key = normName(name);
        if (!key) return [];
        return items.filter(function (it) {
            if (it.id === skipId) return false;
            const other = normName(it.name);
            if (!other) return false;
            return other === key ||
                (other.length >= 5 && (other.indexOf(key) >= 0 || key.indexOf(other) >= 0));
        }).slice(0, 3);
    }

    // Confirmation before saving a name that already exists (or is contained in
    // another one). Creating a duplicate stays possible: it just should be a
    // conscious decision.
    function confirmDuplicate(name, skipId, action) {
        const dupes = similarExercises(name, skipId);
        if (!dupes.length) return true;
        const list = dupes.map(function (d) { return '"' + d.name + '"'; }).join(', ');
        return confirm('There is already ' + (dupes.length === 1 ? 'an exercise' : 'exercises') +
            ' with a similar name: ' + list + '.\n\n' + action + ' anyway?');
    }

    // "New exercise", then "New exercise 2", "New exercise 3"...
    function uniqueDefaultName(base) {
        const taken = items.map(function (it) { return normName(it.name); });
        if (taken.indexOf(normName(base)) < 0) return base;
        let n = 2;
        while (taken.indexOf(normName(base + ' ' + n)) >= 0) n += 1;
        return base + ' ' + n;
    }

    function sorted() {
        const q = ($('catSearch') ? $('catSearch').value : '').trim().toLowerCase();
        const mode = $('catSort') ? $('catSort').value : 'name';
        const show = $('catFilter') ? $('catFilter').value : 'active';
        const list = items.filter(function (it) {
            if (show === 'active' && it.archived) return false;
            if (show === 'archived' && !it.archived) return false;
            return !q || String(it.name || '').toLowerCase().indexOf(q) >= 0;
        });
        if (mode === 'recent') {
            return list.slice().sort(function (a, b) {
                const d = String(b.last_practiced_on || '').localeCompare(String(a.last_practiced_on || ''));
                return d || String(a.name).localeCompare(String(b.name));
            });
        }
        // Rotation queue: never practised first, then the oldest date first.
        if (mode === 'stale') {
            return list.slice().sort(function (a, b) {
                const da = String(a.last_practiced_on || '');
                const db = String(b.last_practiced_on || '');
                if (!da && !db) return String(a.name).localeCompare(String(b.name));
                if (!da) return -1;              // never practised goes first
                if (!db) return 1;
                return da.localeCompare(db) || String(a.name).localeCompare(String(b.name));
            });
        }
        if (mode === 'time') {
            return list.slice().sort(function (a, b) {
                return (b.seconds || 0) - (a.seconds || 0);
            });
        }
        return list.slice().sort(function (a, b) {
            return String(a.name).localeCompare(String(b.name));
        });
    }

    function renderList() {
        const wrap = $('catalogList');
        if (!wrap) return;
        wrap.innerHTML = '';
        const list = sorted();
        if ($('catCount')) {
            const live = items.filter(function (it) { return !it.archived; }).length;
            const gone = items.length - live;
            $('catCount').textContent = '(' + live + ' active' +
                (gone ? ', ' + gone + ' archived' : '') + ')';
        }
        if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            const show = $('catFilter') ? $('catFilter').value : 'active';
            empty.textContent = items.length
                ? (show === 'archived' ? 'Nothing archived.' : 'Nothing matches the search.')
                : 'No exercises yet.';
            wrap.appendChild(empty);
            return;
        }
        const grouped = $('catGroup') ? $('catGroup').value !== 'none' : true;
        if (!grouped) {
            list.forEach(function (it) { wrap.appendChild(catalogRow(it)); });
            return;
        }
        // A search must never hide its own matches behind a collapsed group.
        const filtering = !!($('catSearch') ? $('catSearch').value : '').trim();
        // Grouped view: area order comes from the areas panel, then the chosen
        // sort applies inside each group. Unclassified goes last.
        const order = GPH.mgr.areas().map(function (a) { return a.id; });
        const rank = function (it) {
            const at = order.indexOf(it.area_id);
            return it.area_id ? (at < 0 ? 900 : at) : 901;
        };
        const byArea = list.slice().sort(function (a, b) { return rank(a) - rank(b); });
        let last = null;
        let body = null;
        byArea.forEach(function (it) {
            const label = it.area || 'No area';
            if (label !== last) {
                const key = it.area_id || '';
                const n = byArea.filter(function (o) {
                    return (o.area || 'No area') === label;
                }).length;
                const collapsed = !filtering && isCollapsed(key);
                const head = document.createElement('button');
                head.type = 'button';
                head.className = 'cat-group' + (collapsed ? ' is-collapsed' : '');
                head.textContent = label + ' (' + n + ')';
                head.title = collapsed ? 'Expand this group' : 'Collapse this group';
                wrap.appendChild(head);
                body = document.createElement('div');
                body.className = 'cat-group-body';
                body.hidden = collapsed;
                wrap.appendChild(body);
                // Toggled in place (no re-render, the list keeps its scroll).
                head.addEventListener('click', (function (k, b, h) {
                    return function () {
                        const now = !b.hidden;
                        b.hidden = now;
                        h.classList.toggle('is-collapsed', now);
                        h.title = now ? 'Expand this group' : 'Collapse this group';
                        setCollapsed(k, now);
                    };
                })(key, body, head));
                last = label;
            }
            body.appendChild(catalogRow(it));
        });
    }

    function catalogRow(it) {
        const row = document.createElement('div');
        row.className = 'cat-item' + (it.id === selectedId ? ' selected' : '') +
            (it.archived ? ' is-archived' : '');
        row.appendChild(span('cat-name', it.name || ''));
        if (it.archived) row.appendChild(span('cat-tag', 'archived'));
        const bits = [(it.practices || 0) + '\u00d7', fmtDur(it.seconds)];
        if (it.last_practiced_on) bits.push(it.last_practiced_on);
        row.appendChild(span('cat-meta', bits.join(' \u00b7 ')));
        row.addEventListener('click', function () { select(it.id); });
        return row;
    }

    function clearEditor() {
        current = null;
        if ($('catEmpty')) $('catEmpty').hidden = false;
        if ($('catEditor')) $('catEditor').hidden = true;
        if ($('catResources')) $('catResources').innerHTML = '';
        resEditor = null;
        setDirty(false);
    }

    // Area select of the catalog editor (the areas panel is the source).
    function renderAreaSelect() {
        const sel = $('catArea');
        if (!sel) return;
        const keep = current ? (current.area_id || '') : '';
        sel.innerHTML = '';
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '\u2014 No area \u2014';
        sel.appendChild(none);
        GPH.mgr.areas().forEach(function (a) {
            const o = document.createElement('option');
            o.value = a.id;
            o.textContent = a.label;
            sel.appendChild(o);
        });
        sel.value = keep;
    }

    async function load() {
        // Areas drive the grouping: wait for them so the first paint is right.
        try { await GPH.mgr.loadMeta(); } catch (e) { /* the list still renders */ }
        try {
            const res = await api('GET', '/api/catalog');
            items = res.exercises || [];
        } catch (e) {
            items = [];
            toast('Error: ' + e.message, true);
        }
        if (selectedId != null && !items.some(function (i) { return i.id === selectedId; })) {
            selectedId = null;
        }
        renderList();
        if (selectedId != null) await select(selectedId); else clearEditor();
    }

    function renderUsage() {
        const usedBox = $('catUsedIn');
        const recentBox = $('catRecent');
        const usage = $('catUsage');
        const stat = items.filter(function (i) { return i.id === selectedId; })[0] || {};
        if (usage) {
            usage.textContent = (stat.practices || 0) + ' practices \u00b7 ' + fmtDur(stat.seconds) +
                (stat.last_practiced_on ? ' \u00b7 last ' + stat.last_practiced_on : '');
        }
        if (usedBox) {
            usedBox.innerHTML = '';
            const used = (current && current.used_in) || [];
            if (!used.length) {
                usedBox.appendChild(span('cat-empty', 'Not used in any slot yet.'));
            } else {
                used.forEach(function (u) {
                    const row = document.createElement('div');
                    row.className = 'cat-use-row';
                    row.appendChild(span('cat-use-name', u.name || ''));
                    row.appendChild(span('cat-use-routine', u.routine_name || ''));
                    usedBox.appendChild(row);
                });
            }
        }
        if (recentBox) {
            recentBox.innerHTML = '';
            const recent = (current && current.recent) || [];
            if (!recent.length) {
                recentBox.appendChild(span('cat-empty', 'No practices recorded yet.'));
            } else {
                recent.forEach(function (r) {
                    const row = document.createElement('div');
                    row.className = 'cat-use-row';
                    row.appendChild(span('cat-use-name', (r.started_at || '').slice(0, 10)));
                    row.appendChild(span('cat-use-routine', (r.name || '') +
                        (r.area_id ? ' \u00b7 ' + GPH.mgr.areaLabel(r.area_id) : '')));
                    row.appendChild(span('cat-use-time', fmtDur(r.seconds)));
                    recentBox.appendChild(row);
                });
            }
        }
    }

    // Resources belong to the exercise (a backing track, a scale, a metronome
    // preset): the editor is mounted here and rebuilt on every selection.
    let resEditor = null;

    function renderResources() {
        const box = $('catResources');
        if (!box) return;
        box.innerHTML = '';
        resEditor = null;
        if (!current || !GPH.mgr.createResourceEditor) return;
        resEditor = GPH.mgr.createResourceEditor(current.resources || []);
        box.appendChild(resEditor.root);
        // Any edit in there needs the Save button to light up.
        resEditor.root.addEventListener('change', function () { setDirty(true); });
        resEditor.root.addEventListener('input', function () { setDirty(true); });
    }

    async function select(id) {
        selectedId = id;
        try {
            current = await api('GET', '/api/catalog/' + id);
        } catch (e) {
            toast('Error: ' + e.message, true);
            return;
        }
        if ($('catEmpty')) $('catEmpty').hidden = true;
        if ($('catEditor')) $('catEditor').hidden = false;
        if ($('catName')) $('catName').value = current.name || '';
        if ($('catDesc')) $('catDesc').value = current.description || '';
        renderAreaSelect();
        renderResources();
        const archBtn = $('archiveCatalogBtn');
        if (archBtn) {
            archBtn.textContent = current.archived ? 'Unarchive' : 'Archive';
            archBtn.title = current.archived
                ? 'Bring it back to the active list and the picker'
                : 'Hide it from the list and the assistant picker (the history is kept)';
        }
        setDirty(false);
        renderUsage();
        renderList();
    }

    async function newExercise() {
        try {
            const created = await api('POST', '/api/catalog',
                { name: uniqueDefaultName('New exercise'), description: '' });
            selectedId = created.id;
            await GPH.mgr.loadMeta(true);
            document.dispatchEvent(new CustomEvent('slot-meta:changed'));
            await load();
            const name = $('catName');
            if (name) { name.focus(); name.select(); }
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function saveExercise() {
        if (!current) return;
        const name = ($('catName').value || '').trim();
        if (!name) { toast('The name cannot be empty', true); return; }
        if (!confirmDuplicate(name, current.id, 'Save it')) return;
        try {
            await api('PUT', '/api/catalog/' + current.id,
                { name: name, description: $('catDesc').value || '',
                  area_id: $('catArea') ? $('catArea').value : '',
                  resources: resEditor ? resEditor.getResources() : undefined });
            setDirty(false);
            await GPH.mgr.loadMeta(true);
            document.dispatchEvent(new CustomEvent('slot-meta:changed'));
            await load();
            toast('Exercise saved');
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // Archive / unarchive: the exercise leaves the list and the assistant picker
    // but keeps its history and stays on whatever slots already point at it.
    async function archiveExercise() {
        if (!current) return;
        const to = current.archived ? 0 : 1;
        if (to && !confirm('Archive "' + current.name + '"?\n\nIt leaves the active list and ' +
                           'the assistant picker. The slots that already use it keep it, ' +
                           'and the practice history is untouched.')) return;
        try {
            await api('PUT', '/api/catalog/' + current.id,
                { name: current.name, description: current.description || '',
                  archived: to });
            await GPH.mgr.loadMeta(true);
            document.dispatchEvent(new CustomEvent('slot-meta:changed'));
            await load();
            toast(to ? 'Exercise archived' : 'Exercise back in the list');
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function deleteExercise() {
        if (!current) return;
        if (!confirm('Delete "' + current.name + '" from the catalog? Slots lose the link ' +
                     'and the practice history keeps its recorded name.')) return;
        try {
            const res = await api('DELETE', '/api/catalog/' + current.id);
            selectedId = null;
            await GPH.mgr.loadMeta(true);
            document.dispatchEvent(new CustomEvent('slot-meta:changed'));
            await load();
            toast('Exercise deleted (' + (res.slots_cleared || 0) + ' slots cleared)');
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // --------------------------- Practice areas ----------------------------
    let areaList = [];

    function slug(text) {
        return String(text || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    }

    async function putAreas(list) {
        const res = await fetch('/api/settings/practice_areas', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: JSON.stringify(list) })
        });
        let body = {};
        try { body = await res.json(); } catch (e) { /* noop */ }
        if (!res.ok) throw body;
        return body;
    }

    function areaButton(text, title, disabled, fn) {
        const b = document.createElement('button');
        b.className = 'btn small';
        b.type = 'button';
        b.textContent = text;
        b.title = title;
        b.disabled = !!disabled;
        b.addEventListener('click', fn);
        return b;
    }

    function renderAreas() {
        const box = $('areaList');
        if (!box) return;
        box.innerHTML = '';
        if (!areaList.length) {
            box.appendChild(span('cat-empty', 'No areas yet. Add one below.'));
            return;
        }
        areaList.forEach(function (a, idx) {
            const row = document.createElement('div');
            row.className = 'area-row';
            const label = document.createElement('input');
            label.type = 'text';
            label.className = 'area-label';
            label.value = a.label;
            label.title = 'Area name (id: ' + a.id + ')';
            label.addEventListener('change', function () {
                a.label = label.value.trim() || a.label;
                label.value = a.label;
                saveAreas();
            });
            const up = areaButton('\u2191', 'Move up', idx === 0, function () {
                const tmp = areaList[idx - 1];
                areaList[idx - 1] = a;
                areaList[idx] = tmp;
                saveAreas();
            });
            const down = areaButton('\u2193', 'Move down', idx === areaList.length - 1, function () {
                const tmp = areaList[idx + 1];
                areaList[idx + 1] = a;
                areaList[idx] = tmp;
                saveAreas();
            });
            const del = areaButton('\ud83d\uddd1', 'Delete area', false, function () {
                removeArea(a);
            });
            del.classList.add('danger');
            row.appendChild(label);
            row.appendChild(up);
            row.appendChild(down);
            row.appendChild(del);
            box.appendChild(row);
        });
    }

    async function saveAreas() {
        areaList.forEach(function (a, i) { a.position = i; });
        try {
            await putAreas(areaList);
            await GPH.mgr.loadMeta(true);
            document.dispatchEvent(new CustomEvent('slot-meta:changed'));
            renderAreas();
            GPH.mgr.notify();
            toast('Areas saved');
        } catch (e) {
            if (e && e.error === 'area_in_use') {
                toast('Area in use by: ' + (e.slots || []).map(function (s) {
                    return s.name;
                }).join(', '), true);
            } else {
                toast('Could not save areas' + (e && e.error ? ': ' + e.error : ''), true);
            }
            await loadAreas();
        }
    }

    async function loadAreas() {
        try {
            const raw = await GPH.settings.get('practice_areas');
            areaList = JSON.parse(raw || '[]');
            if (!Array.isArray(areaList)) areaList = [];
        } catch (e) { areaList = []; }
        renderAreas();
        renderAreaSelect();      // the catalog editor uses the same vocabulary
    }

    async function addArea() {
        const label = prompt('Name of the new area:', '');
        if (!label) return;
        const id = slug(label);
        if (!id) { toast('Use letters or numbers in the name', true); return; }
        if (areaList.some(function (a) { return a.id === id; })) {
            toast('There is already an area with that name', true);
            return;
        }
        if (areaList.some(function (a) { return a.label.toLowerCase() === label.trim().toLowerCase(); })) {
            toast('There is already an area with that label', true);
            return;
        }
        areaList.push({ id: id, label: label.trim(), position: areaList.length });
        await saveAreas();
    }

    async function removeArea(area) {
        const next = areaList.filter(function (a) { return a.id !== area.id; });
        try {
            await putAreas(next.map(function (a, i) {
                return { id: a.id, label: a.label, position: i };
            }));
            areaList = next;
            await GPH.mgr.loadMeta(true);
            document.dispatchEvent(new CustomEvent('slot-meta:changed'));
            renderAreas();
            GPH.mgr.notify();
            toast('Area deleted');
        } catch (e) {
            if (e && e.error === 'area_in_use') {
                const slots = e.slots || [];
                toast('Cannot delete: used by ' + slots.length + ' slot(s): ' +
                    slots.map(function (s) { return s.name; }).join(', '), true);
            } else {
                toast('Could not delete the area', true);
            }
        }
    }

    // ------------------------------- Wiring -------------------------------
    function init() {
        if (!$('catalogList')) return;
        const bind = function (id, fn, ev) {
            const el = $(id);
            if (el) el.addEventListener(ev || 'click', fn);
        };
        bind('newCatalogBtn', newExercise);
        bind('saveCatalogBtn', saveExercise);
        bind('delCatalogBtn', deleteExercise);
        bind('catSearch', renderList, 'input');
        bind('catSort', renderList, 'change');
        bind('catFilter', renderList, 'change');
        bind('catGroup', renderList, 'change');
        bind('catArea', function () { setDirty(true); }, 'change');
        bind('archiveCatalogBtn', archiveExercise);
        bind('catName', function () { setDirty(true); }, 'input');
        bind('catDesc', function () { setDirty(true); }, 'input');
        bind('addAreaBtn', addArea);
        // The resource picker list arrives with the sections; rebuild the editor
        // only if nothing has been edited yet, never on top of user changes.
        document.addEventListener('resources:ready', function () {
            if (current && !dirty) renderResources();
        });
        loadAreas();
    }

    function show() {
        load();
        loadAreas();
    }

    GPH.exercises = { init: init, show: show, load: load };
    GPH.areas = { load: loadAreas };
    document.addEventListener('DOMContentLoaded', init);
})(window.GPH = window.GPH || {});

