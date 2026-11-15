// Helpers shared by the managers (routines and sections).
(function (GPH) {
    'use strict';
    const $ = function (id) { return document.getElementById(id); };
    const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('gph') : null;

    let toastTimer = null;
    function toast(msg, isErr) {
        const t = $('toast'); if (!t) return;
        t.textContent = msg;
        t.classList.toggle('err', !!isErr);
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
    }

    async function api(method, url, body) {
        const opts = { method: method, headers: {} };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        if (!res.ok) {
            let e = {};
            try { e = await res.json(); } catch (ignore) { /* noop */ }
            throw new Error((e && (e.detail || e.error)) || ('HTTP ' + res.status));
        }
        return res.json();
    }

    function notify() { if (bc) bc.postMessage('changed'); }

    // Spreads sections across the three dashboard lanes: each one goes to the
    // shortest lane, using +1 header + items as a cheap height proxy. Returns
    // the layout array the reorder endpoint expects.
    function balanceLanes(sections) {
        const lanes = [[], [], []];
        const totals = [0, 0, 0];
        (sections || []).forEach(function (s) {
            let target = 0;
            for (let i = 1; i < 3; i++) if (totals[i] < totals[target]) target = i;
            lanes[target].push(s);
            totals[target] += 1 + ((s.items && s.items.length) || 0);
        });
        const layout = [];
        lanes.forEach(function (list, i) {
            list.forEach(function (s, pos) {
                layout.push({ id: s.id, lane: i + 1, position: pos });
            });
        });
        return layout;
    }

    // Grip used as the drag handle of a list row (only the handle is draggable,
    // so the inputs inside the row keep working normally).
    function dragHandle(title) {
        const h = document.createElement('span');
        h.className = 'drag-handle';
        h.title = title || 'Drag to reorder';
        h.draggable = true;
        h.innerHTML = (GPH.icons && GPH.icons.get) ? GPH.icons.get('grip') : '\u22ee\u22ee';
        return h;
    }

    // ---------------------------------------------------------------
    // Drag & drop reordering for flat lists (desktop, HTML5 DnD).
    //   makeSortable(container, { itemSelector, handleSelector, onReorder(ids) })
    // The dragged row moves live inside the container, so the user sees the
    // result while dragging; on drop the ids are read from the DOM and handed
    // to onReorder(), which persists them. A cancelled drag restores the row.
    // ---------------------------------------------------------------
    function rowId(el) {
        return el.dataset.id || el.dataset.eid || el.dataset.iid || '';
    }

    function makeSortable(container, opts) {
        if (!container || container._sortable) return;
        const cfg = opts || {};
        const itemSel = cfg.itemSelector || '[data-id]';
        const handleSel = cfg.handleSelector || '.drag-handle';
        let dragRow = null;
        let dragNext = null;
        let scrollRaf = 0;
        let lastY = 0;

        function rows() {
            return Array.prototype.slice.call(container.querySelectorAll(itemSel));
        }

        function autoScroll(y) {
            const edge = 90;
            if (y < edge) window.scrollBy(0, -Math.round((edge - y) / 6) - 4);
            else if (y > window.innerHeight - edge) window.scrollBy(0, Math.round((y - window.innerHeight + edge) / 6) + 4);
        }

        // Keeps scrolling while the pointer rests near an edge of the window.
        function scrollLoop() {
            scrollRaf = requestAnimationFrame(scrollLoop);
            if (!dragRow) return;
            autoScroll(lastY);
        }

        // Nearest row to the pointer, so the gaps between rows still resolve.
        function rowNear(y) {
            let best = null;
            let bestDist = Infinity;
            rows().forEach(function (r) {
                const b = r.getBoundingClientRect();
                const d = Math.abs((b.top + b.height / 2) - y);
                if (d < bestDist) { bestDist = d; best = r; }
            });
            return best;
        }

        container.addEventListener('dragstart', function (e) {
            const handle = e.target && e.target.closest ? e.target.closest(handleSel) : null;
            if (!handle) return;                                   // only the grip starts a drag
            const row = handle.closest(itemSel);
            if (!row || !container.contains(row)) return;
            dragRow = row;
            dragNext = row.nextElementSibling;
            lastY = e.clientY || 0;
            row.classList.add('dragging');
            container.classList.add('is-sorting');
            if (!scrollRaf) scrollRaf = requestAnimationFrame(scrollLoop);
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', rowId(row)); } catch (ignore) { /* noop */ }
            }
        });

        container.addEventListener('dragover', function (e) {
            if (!dragRow) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            lastY = e.clientY;
            autoScroll(e.clientY);
            const target = rowNear(e.clientY);
            if (!target || target === dragRow) return;
            const b = target.getBoundingClientRect();
            const after = e.clientY > b.top + b.height / 2;
            container.insertBefore(dragRow, after ? target.nextElementSibling : target);
        });

        function finish(commit) {
            const row = dragRow;
            if (!row) return;
            dragRow = null;
            if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
            row.classList.remove('dragging');
            container.classList.remove('is-sorting');
            const next = dragNext;
            dragNext = null;
            if (!commit) {
                // Dropped outside / cancelled: restore the original position.
                if (next && next.parentNode === container) container.insertBefore(row, next);
                else container.appendChild(row);
                return;
            }
            const ids = rows().map(rowId).filter(Boolean);
            if (cfg.onReorder && ids.length) cfg.onReorder(ids, rowId(row));
        }

        container.addEventListener('drop', function (e) {
            if (!dragRow) return;
            e.preventDefault();
            finish(true);
        });

        container.addEventListener('dragend', function () { finish(false); });

        container._sortable = { itemSelector: itemSel };
    }

    // Highlights the save button when there are pending changes (same class/CSS in both managers).
    function setDirty(btnId, dirty, cleanTitle) {
        const b = $(btnId);
        if (!b) return !!dirty;
        b.classList.toggle('is-dirty', !!dirty);
        b.title = dirty ? 'You have unsaved changes — click to save' : (cleanTitle || 'Save');
        return !!dirty;
    }

    GPH.mgr = {
        $: $, api: api, toast: toast, notify: notify, bc: bc, setDirty: setDirty,
        dragHandle: dragHandle, makeSortable: makeSortable, balanceLanes: balanceLanes
    };
})(window.GPH = window.GPH || {});
