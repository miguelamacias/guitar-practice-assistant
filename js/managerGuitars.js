// Manager > Guitars: setup CRUD + string-change history.
(function (GPH) {
    'use strict';

    const G = GPH.guitars;
    const { $, toast, notify } = GPH.mgr;
    const HISTORY_PAGE_SIZE = 15;

    let guitars = [];
    let selectedId = null;
    let current = null;
    let loaded = false;
    let dirty = false;
    let lastType = 'electric';
    let historyPage = 0;

    function setDirty(v) {
        dirty = GPH.mgr.setDirty('guitarSaveBtn', v, 'Save this guitar');
    }

    async function show() {
        if (!loaded) return load(selectedId);
        return null;
    }

    function itemEl(g) {
        const it = document.createElement('div');
        it.className = 'gc-item' + (g.id === selectedId ? ' selected' : '') +
            (g.active ? '' : ' is-archived');
        const dot = document.createElement('span');
        dot.className = 'gc-item-dot';
        dot.style.background = g.color_hex || '#ff9800';
        it.appendChild(dot);
        const text = document.createElement('div');
        text.className = 'gc-item-text';
        const name = document.createElement('span');
        name.className = 'gc-item-name';
        name.textContent = g.name;
        const meta = document.createElement('span');
        meta.className = 'gc-item-meta';
        const st = G.statusFor(g);
        meta.textContent = G.TYPE_LABELS[g.type] + ' \u00b7 ' + g.string_count +
            ' strings \u00b7 ' + st.text;
        text.appendChild(name);
        text.appendChild(meta);
        it.appendChild(text);
        if (!g.active) {
            const badge = document.createElement('span');
            badge.className = 'gc-badge';
            badge.textContent = 'Archived';
            it.appendChild(badge);
        }
        it.addEventListener('click', function () { select(g.id); });
        return it;
    }

    function renderLists() {
        const active = guitars.filter(function (g) { return g.active; });
        const archived = guitars.filter(function (g) { return !g.active; });
        const list = $('guitarList');
        const arch = $('guitarArchivedList');
        list.innerHTML = '';
        arch.innerHTML = '';
        active.forEach(function (g) { list.appendChild(itemEl(g)); });
        archived.forEach(function (g) { arch.appendChild(itemEl(g)); });
        if (!active.length) {
            const d = document.createElement('div');
            d.className = 'empty';
            d.textContent = 'No active guitars.';
            list.appendChild(d);
        }
        if (!archived.length) {
            const d = document.createElement('div');
            d.className = 'empty';
            d.textContent = 'No archived guitars.';
            arch.appendChild(d);
        }
        $('guitarCount').textContent = active.length + ' active';
        $('guitarArchivedCount').textContent = archived.length ? archived.length + '' : '';
    }

    async function load(preferId) {
        try {
            guitars = await G.listGuitars(true);
            loaded = true;
            if (preferId != null && guitars.some(function (g) { return g.id === preferId; })) {
                selectedId = preferId;
            } else if (selectedId != null && guitars.some(function (g) { return g.id === selectedId; })) {
                // keep the selection
            } else {
                const first = guitars.filter(function (g) { return g.active; })[0] || guitars[0];
                selectedId = first ? first.id : null;
            }
            renderLists();
            if (selectedId != null) {
                current = guitars.filter(function (g) { return g.id === selectedId; })[0] || null;
                fillEditor();
            } else {
                current = null;
                emptyEditor();
            }
        } catch (err) {
            toast('Could not load guitars: ' + err.message, true);
        }
    }

    function emptyEditor() {
        $('guitarEditor').hidden = true;
        $('guitarEmpty').hidden = false;
        $('guitarHistoryPager').hidden = true;
        setDirty(false);
    }

    function fillEditor() {
        if (!current) { emptyEditor(); return; }
        $('guitarEmpty').hidden = true;
        $('guitarEditor').hidden = false;
        $('guitarName').value = current.name;
        $('guitarType').value = current.type;
        $('guitarStrings').value = current.string_count;
        $('guitarColor').value = current.color_hex || '#ff9800';
        $('guitarNotes').value = current.notes || '';
        $('guitarActive').checked = !!current.active;
        $('guitarStrings').disabled = current.changes_count > 0;
        $('guitarDeleteBtn').disabled = current.changes_count > 0;
        $('guitarLockNote').textContent = current.changes_count > 0
            ? 'String count locked: this guitar already has history.' : '';
        $('guitarArchiveBtn').textContent = current.active ? 'Archive' : 'Restore';
        lastType = current.type;
        historyPage = 0;
        setDirty(false);
        loadHistory(0);
    }

    function select(id) {
        if (dirty && id !== selectedId) {
            if (!confirm('You have unsaved changes in this guitar. Discard them?')) return;
        }
        selectedId = id;
        current = guitars.filter(function (g) { return g.id === id; })[0] || null;
        renderLists();
        fillEditor();
    }

    function newGuitar() {
        if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
        selectedId = null;
        current = null;
        renderLists();
        $('guitarEmpty').hidden = true;
        $('guitarEditor').hidden = false;
        $('guitarName').value = '';
        $('guitarType').value = 'electric';
        $('guitarStrings').value = '6';
        $('guitarStrings').disabled = false;
        $('guitarColor').value = '#ff9800';
        $('guitarNotes').value = '';
        $('guitarActive').checked = true;
        $('guitarDeleteBtn').disabled = true;
        $('guitarLockNote').textContent = '';
        $('guitarArchiveBtn').textContent = 'Archive';
        $('guitarHistory').innerHTML = '<div class="empty">Save the guitar first to add changes.</div>';
        $('guitarHistoryCount').textContent = '';
        $('guitarHistoryPager').hidden = true;
        $('guitarAddChangeBtn').disabled = true;
        lastType = 'electric';
        setDirty(false);
        $('guitarName').focus();
    }

    function renderHistoryPager(hasMore) {
        const pager = $('guitarHistoryPager');
        pager.hidden = !(historyPage > 0 || hasMore);
        $('guitarHistoryPage').textContent = 'Page ' + (historyPage + 1) +
            (current ? ' \u00b7 ' + current.changes_count + ' change' +
                (current.changes_count === 1 ? '' : 's') : '');
        $('guitarHistoryPrev').disabled = historyPage === 0;
        $('guitarHistoryNext').disabled = !hasMore;
    }

    async function loadHistory(page) {
        if (!current) return;
        if (page != null) historyPage = Math.max(0, page);
        const id = current.id;
        const box = $('guitarHistory');
        box.innerHTML = '<div class="empty">Loading…</div>';
        try {
            const raw = await G.getChanges(id, HISTORY_PAGE_SIZE + 1,
                                          historyPage * HISTORY_PAGE_SIZE);
            if (!current || current.id !== id) return;
            const hasMore = raw.length > HISTORY_PAGE_SIZE;
            const rows = raw.slice(0, HISTORY_PAGE_SIZE);
            box.innerHTML = '';
            $('guitarHistoryCount').textContent = current.changes_count
                ? '(' + current.changes_count + ')' : '';
            $('guitarAddChangeBtn').disabled = !current.active;
            renderHistoryPager(hasMore);
            if (!rows.length) {
                box.innerHTML = '<div class="empty">No string changes recorded yet.</div>';
                return;
            }
            rows.forEach(function (c) { box.appendChild(historyRow(c)); });
        } catch (err) {
            $('guitarHistoryPager').hidden = true;
            box.innerHTML = '';
            const d = document.createElement('div');
            d.className = 'empty';
            d.textContent = 'Could not load history: ' + err.message;
            box.appendChild(d);
        }
    }

    function historyRow(c) {
        const row = document.createElement('div');
        row.className = 'gc-hist-row';
        const main = document.createElement('div');
        main.className = 'gc-hist-main';
        const kind = document.createElement('span');
        kind.className = 'gc-kind ' + (c.type === 'full' ? 'is-full' : 'is-partial');
        kind.textContent = c.type === 'full' ? 'Full set' : 'Partial';
        const date = document.createElement('span');
        date.className = 'gc-hist-date';
        date.textContent = G.formatDate(c.date);
        const what = document.createElement('b');
        what.textContent = c.type === 'full'
            ? c.string_model
            : G.stringsLabel(c.changed_strings) + (c.string_model ? ' \u00b7 ' + c.string_model : '');
        main.appendChild(kind);
        main.appendChild(date);
        main.appendChild(what);
        row.appendChild(main);
        if (c.notes) {
            const notes = document.createElement('div');
            notes.className = 'gc-hist-notes';
            notes.textContent = c.notes;
            row.appendChild(notes);
        }
        const actions = document.createElement('div');
        actions.className = 'gc-hist-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn small';
        edit.textContent = 'Edit';
        edit.addEventListener('click', function () {
            G.openChangeDialog({
                guitar: current, change: c,
                onSaved: function () { load(selectedId); }
            });
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn small danger';
        del.textContent = 'Delete';
        del.addEventListener('click', function () {
            if (!confirm('Delete this string change from ' + G.formatDate(c.date) + '?')) return;
            G.api('DELETE', '/api/string-changes/' + c.id).then(function () {
                toast('String change deleted');
                notify();
                load(selectedId);
            }).catch(function (err) {
                toast(G.errorText((err.payload && err.payload.error) || err.message), true);
            });
        });
        actions.appendChild(edit);
        actions.appendChild(del);
        row.appendChild(actions);
        return row;
    }

    async function saveGuitar() {
        const payload = {
            name: $('guitarName').value.trim(),
            type: $('guitarType').value,
            string_count: Number($('guitarStrings').value),
            color_hex: $('guitarColor').value,
            notes: $('guitarNotes').value,
            active: $('guitarActive').checked
        };
        if (!payload.name) { toast('Give the guitar a name', true); return; }
        try {
            const saved = current
                ? await G.api('PUT', '/api/guitars/' + current.id, payload)
                : await G.api('POST', '/api/guitars', payload);
            toast(current ? 'Guitar saved' : 'Guitar created');
            notify();
            selectedId = saved.id;
            await load(saved.id);
        } catch (err) {
            toast(G.errorText((err.payload && err.payload.error) || err.message), true);
        }
    }

    function toggleArchive() {
        if (!current) return;
        $('guitarActive').checked = !$('guitarActive').checked;
        saveGuitar();
    }

    function deleteGuitar() {
        if (!current) return;
        if (current.changes_count > 0) {
            toast('This guitar has history. Archive it instead.', true);
            return;
        }
        if (!confirm('Delete "' + current.name + '"? This cannot be undone.')) return;
        G.api('DELETE', '/api/guitars/' + current.id).then(function () {
            toast('Guitar deleted');
            notify();
            selectedId = null;
            current = null;
            load(null);
        }).catch(function (err) {
            toast(G.errorText((err.payload && err.payload.error) || err.message), true);
        });
    }

    function addChange() {
        if (!current) return;
        if (!current.active) { toast('Archived guitars cannot receive new changes', true); return; }
        G.openChangeDialog({
            guitar: current,
            onSaved: function () { load(selectedId); }
        });
    }

    function init() {
        const newBtn = $('guitarNewBtn');
        if (!newBtn) return;
        newBtn.addEventListener('click', newGuitar);
        $('guitarSaveBtn').addEventListener('click', saveGuitar);
        $('guitarArchiveBtn').addEventListener('click', toggleArchive);
        $('guitarDeleteBtn').addEventListener('click', deleteGuitar);
        $('guitarAddChangeBtn').addEventListener('click', addChange);
        $('guitarHistoryPrev').addEventListener('click', function () {
            if (historyPage > 0) loadHistory(historyPage - 1);
        });
        $('guitarHistoryNext').addEventListener('click', function () {
            loadHistory(historyPage + 1);
        });
        $('guitarEditor').addEventListener('input', function (ev) {
            if (ev.target && ev.target.id === 'guitarStrings') return;
            setDirty(true);
        });
        $('guitarEditor').addEventListener('change', function (ev) {
            if (ev.target && ev.target.id === 'guitarType') {
                const next = ev.target.value;
                const oldDefault = G.DEFAULT_STRINGS[lastType] || 6;
                if (Number($('guitarStrings').value) === oldDefault && !$('guitarStrings').disabled) {
                    $('guitarStrings').value = G.DEFAULT_STRINGS[next] || 6;
                }
                lastType = next;
            }
            setDirty(true);
        });
    }

    GPH.guitarsManager = { show: show, reload: function () { return load(selectedId); } };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window.GPH = window.GPH || {});
