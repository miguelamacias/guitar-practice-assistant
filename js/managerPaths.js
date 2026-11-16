// Learning paths: an ordered subset of the exercise catalog.
// Exposes GPH.paths { init, show, load } and the Catalog | Paths segment.
(function (GPH) {
    'use strict';

    const { $, api, toast } = GPH.mgr;

    let items = [];         // every path, from /api/paths
    let selectedId = null;  // path being edited
    let current = null;     // that path as returned by /api/paths/<id>
    let steps = [];         // working copy: [{catalog_exercise_id, name, note}]

    function setDirty(v) {
        GPH.mgr.setDirty('savePathBtn', v, 'Save the path');
    }

    function span(cls, text) {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = text;
        return s;
    }

    // --------------------------- Catalog | Paths ---------------------------
    function setPanel(which, keepUrl) {
        const paths = which === 'paths';
        if ($('catPanelCatalog')) $('catPanelCatalog').hidden = paths;
        if ($('catPanelPaths')) $('catPanelPaths').hidden = !paths;
        ['catTabCatalog', 'catTabPaths'].forEach(function (id) {
            const btn = $(id);
            if (!btn) return;
            const active = (id === 'catTabPaths') === paths;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        // The search box only filters the catalog list.
        const search = document.querySelector('.cat-search');
        if (search) search.hidden = paths;
        if (!keepUrl && window.history && window.history.replaceState) {
            const url = new URL(window.location.href);
            if (paths) url.searchParams.set('panel', 'paths');
            else url.searchParams.delete('panel');
            window.history.replaceState(null, '', url.toString());
        }
    }

    // -------------------------------- List --------------------------------
    function renderList() {
        const wrap = $('pathList');
        if (!wrap) return;
        wrap.innerHTML = '';
        if ($('pathCount')) $('pathCount').textContent = '(' + items.length + ')';
        if (!items.length) {
            wrap.appendChild(span('empty', 'No paths yet.'));
            return;
        }
        items.forEach(function (p) {
            const row = document.createElement('div');
            row.className = 'cat-item path-item' + (p.id === selectedId ? ' selected' : '');
            row.appendChild(span('cat-name', p.name || ''));
            const bits = [(p.steps || []).length + ' steps'];
            bits.push(p.slots ? 'in ' + p.slots + ' slot' + (p.slots === 1 ? '' : 's')
                              : 'not used');
            row.appendChild(span('cat-meta', bits.join(' \u00b7 ')));
            row.addEventListener('click', function () { select(p.id); });
            wrap.appendChild(row);
        });
    }

    async function load() {
        try {
            const res = await api('GET', '/api/paths');
            items = res.paths || [];
        } catch (e) {
            items = [];
            toast('Error: ' + e.message, true);
        }
        if (selectedId != null && !items.some(function (p) { return p.id === selectedId; })) {
            selectedId = null;
        }
        renderList();
        if (selectedId != null) await select(selectedId); else clearEditor();
    }
    // ------------------------------- Editor -------------------------------
    function clearEditor() {
        current = null;
        steps = [];
        if ($('pathEmpty')) $('pathEmpty').hidden = false;
        if ($('pathEditor')) $('pathEditor').hidden = true;
        setDirty(false);
    }

    async function select(id) {
        selectedId = id;
        try {
            current = await api('GET', '/api/paths/' + id);
        } catch (e) {
            toast('Error: ' + e.message, true);
            return;
        }
        steps = (current.steps || []).map(function (s) {
            return { catalog_exercise_id: s.catalog_exercise_id, name: s.name,
                     note: s.note || '' };
        });
        if ($('pathEmpty')) $('pathEmpty').hidden = true;
        if ($('pathEditor')) $('pathEditor').hidden = false;
        if ($('pathName')) $('pathName').value = current.name || '';
        if ($('pathDesc')) $('pathDesc').value = current.description || '';
        if ($('pathUsage')) {
            $('pathUsage').textContent = current.slots
                ? 'Used by ' + current.slots + ' slot' + (current.slots === 1 ? '' : 's')
                : 'Not used by any slot yet';
        }
        setDirty(false);
        renderSteps();
        renderList();
    }

    function renderSteps() {
        const wrap = $('pathSteps');
        if (!wrap) return;
        wrap.innerHTML = '';
        if ($('pathStepsEmpty')) $('pathStepsEmpty').hidden = !!steps.length;
        steps.forEach(function (s, i) {
            const row = document.createElement('div');
            row.className = 'path-step';
            row.dataset.id = String(s.catalog_exercise_id);

            row.appendChild(GPH.mgr.dragHandle('Drag to reorder this step'));
            row.appendChild(span('path-step-n', (i + 1) + '.'));

            const main = document.createElement('div');
            main.className = 'path-step-main';
            main.appendChild(span('path-step-name',
                                  s.name || ('exercise ' + s.catalog_exercise_id)));
            const note = document.createElement('input');
            note.type = 'text';
            note.className = 'path-step-note';
            note.placeholder = 'Note (optional)';
            note.title = 'Note for this step, e.g. "until 100 BPM"';
            note.value = s.note || '';
            note.addEventListener('input', function () {
                s.note = note.value;
                setDirty(true);
            });
            main.appendChild(note);
            row.appendChild(main);

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'btn small danger path-step-del';
            del.textContent = '\u00d7';
            del.title = 'Remove this step from the path';
            del.addEventListener('click', function () { removeStep(s.catalog_exercise_id); });
            row.appendChild(del);

            wrap.appendChild(row);
        });
        renderAddOptions();
    }

    // Select of catalog exercises that are not part of the path yet.
    function renderAddOptions() {
        const sel = $('pathAddSel');
        if (!sel) return;
        const used = steps.map(function (s) { return s.catalog_exercise_id; });
        const free = GPH.mgr.catalog().filter(function (c) {
            return used.indexOf(c.id) < 0;
        });
        sel.innerHTML = '';
        if (!free.length) {
            const o = document.createElement('option');
            o.value = '';
            o.textContent = 'Every catalog exercise is already in this path';
            sel.appendChild(o);
            sel.disabled = true;
            return;
        }
        sel.disabled = false;
        free.forEach(function (c) {
            const o = document.createElement('option');
            o.value = String(c.id);
            o.textContent = c.name;
            sel.appendChild(o);
        });
    }

    function addStep() {
        const sel = $('pathAddSel');
        if (!sel || !sel.value) return;
        const id = Number(sel.value);
        const item = GPH.mgr.catalogById(id);
        if (!item) return;
        steps.push({ catalog_exercise_id: id, name: item.name, note: '' });
        setDirty(true);
        renderSteps();
    }

    function removeStep(cid) {
        steps = steps.filter(function (s) { return s.catalog_exercise_id !== cid; });
        setDirty(true);
        renderSteps();
    }

    // Drag & drop: the DOM order becomes the new order of the list.
    function bindStepsSortable() {
        const wrap = $('pathSteps');
        if (!wrap) return;
        GPH.mgr.makeSortable(wrap, {
            itemSelector: '.path-step[data-id]',
            onReorder: function (ids) {
                const byId = {};
                steps.forEach(function (s) { byId[String(s.catalog_exercise_id)] = s; });
                const next = ids.map(function (id) { return byId[id]; }).filter(Boolean);
                if (next.length !== steps.length) return;   // safety
                steps = next;
                setDirty(true);
                renderSteps();
            }
        });
    }
    // ------------------------------ Actions ------------------------------
    async function newPath() {
        try {
            const created = await api('POST', '/api/paths',
                { name: 'New path', description: '' });
            selectedId = created.id;
            await GPH.mgr.loadMeta(true);
            document.dispatchEvent(new CustomEvent('paths:changed'));
            await load();
            const name = $('pathName');
            if (name) { name.focus(); name.select(); }
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function save() {
        if (!current) return;
        const name = ($('pathName').value || '').trim();
        if (!name) { toast('The name cannot be empty', true); return; }
        if (!steps.length) {
            toast('Add at least one step before saving', true);
            return;
        }
        try {
            await api('PUT', '/api/paths/' + current.id,
                { name: name, description: $('pathDesc').value || '' });
            await api('PUT', '/api/paths/' + current.id + '/steps', {
                steps: steps.map(function (s) {
                    return { catalog_exercise_id: s.catalog_exercise_id, note: s.note || '' };
                })
            });
            setDirty(false);
            await GPH.mgr.loadMeta(true);
            document.dispatchEvent(new CustomEvent('paths:changed'));
            await load();
            toast('Path saved');
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    async function remove() {
        if (!current) return;
        const used = current.slots || 0;
        const msg = 'Delete the path "' + current.name + '"?' +
            (used ? ' The ' + used + ' slot(s) using it keep their exercise but lose the path.'
                  : '');
        if (!confirm(msg)) return;
        try {
            await api('DELETE', '/api/paths/' + current.id);
            selectedId = null;
            current = null;
            await GPH.mgr.loadMeta(true);
            document.dispatchEvent(new CustomEvent('paths:changed'));
            await load();
            toast('Path deleted');
        } catch (e) { toast('Error: ' + e.message, true); }
    }

    // ------------------------------- Wiring ------------------------------
    function init() {
        if (!$('pathList')) return;
        const bind = function (id, fn, ev) {
            const el = $(id);
            if (el) el.addEventListener(ev || 'click', fn);
        };
        bind('catTabCatalog', function () { setPanel('catalog'); });
        bind('catTabPaths', function () { setPanel('paths'); });
        bind('newPathBtn', newPath);
        bind('savePathBtn', save);
        bind('delPathBtn', remove);
        bind('pathAddBtn', addStep);
        bind('pathName', function () { setDirty(true); }, 'input');
        bind('pathDesc', function () { setDirty(true); }, 'input');
        bindStepsSortable();
        const start = new URLSearchParams(window.location.search).get('panel');
        setPanel(start === 'paths' ? 'paths' : 'catalog', true);
    }

    function show() {
        load();
    }

    GPH.paths = { init: init, show: show, load: load, panel: setPanel };
    document.addEventListener('DOMContentLoaded', init);
})(window.GPH = window.GPH || {});
