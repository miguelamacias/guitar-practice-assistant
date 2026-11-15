// Dashboard layout: drag & drop of the user's sections between the three lanes
// (1-2 left column, 3 right rail). Pointer events, so mouse, pen and touch all
// work. The section heading is the handle: a plain click still folds the
// section, dragging it moves the card (8px threshold separates both).
(function (GPH) {
    'use strict';

    const LANES = ['sectionsColA', 'sectionsColB', 'sectionsColC'];
    const CARD = '.section-card.dyn-section';
    const THRESHOLD = 8;
    const EDGE = 90;                 // auto-scroll band at the top/bottom

    let drag = null;
    let suppressClick = false;
    let scrollRaf = 0;
    let bc = null;

    const $ = function (id) { return document.getElementById(id); };

    // Forgiving hit test: a lane is any point inside its column strip, plus the
    // nearest lane when the pointer is over the gaps or the empty space around
    // the columns (that is what made the drop area feel tiny).
    function laneAt(x, y) {
        const el = document.elementFromPoint(x, y);
        const hit = el && el.closest ? el.closest('.masonry-col') : null;
        if (hit && LANES.indexOf(hit.id) >= 0) return hit;

        let best = null;
        let bestDist = Infinity;
        LANES.forEach(function (id) {
            const lane = $(id);
            if (!lane) return;
            const r = lane.getBoundingClientRect();
            const dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
            const dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
            const dist = dx + dy * 0.25;      // horizontal distance weighs more
            if (dist < bestDist) { bestDist = dist; best = lane; }
        });
        return best;
    }

    function setTargetLane(lane) {
        LANES.forEach(function (id) {
            const el = $(id);
            if (el) el.classList.toggle('is-drop-target', el === lane);
        });
    }

    function cards(lane) {
        return Array.prototype.slice.call(lane.querySelectorAll(':scope > ' + CARD));
    }

    // Current layout as the API expects it: one entry per section.
    function layoutNow() {
        const out = [];
        LANES.forEach(function (id, i) {
            const lane = $(id);
            if (!lane) return;
            cards(lane).forEach(function (card, pos) {
                const sid = parseInt(card.dataset.secId || '', 10);
                if (sid) out.push({ id: sid, lane: i + 1, position: pos });
            });
        });
        return out;
    }

    function sameLayout(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i].id !== b[i].id || a[i].lane !== b[i].lane ||
                a[i].position !== b[i].position) return false;
        }
        return true;
    }

    function toast(msg) {
        let t = document.getElementById('layoutToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'layoutToast';
            t.className = 'layout-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('is-visible');
        clearTimeout(t._timer);
        t._timer = setTimeout(function () { t.classList.remove('is-visible'); }, 3200);
    }

    function armClickSuppression() {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 400);
    }

    function autoScrollLoop() {
        scrollRaf = requestAnimationFrame(autoScrollLoop);
        if (!drag || !drag.started) return;
        const y = drag.lastY || 0;
        if (y < EDGE) window.scrollBy(0, -Math.round((EDGE - y) / 6) - 4);
        else if (y > window.innerHeight - EDGE) {
            window.scrollBy(0, Math.round((y - window.innerHeight + EDGE) / 6) + 4);
        }
    }

    function begin() {
        const card = drag.card;
        const rect = card.getBoundingClientRect();
        drag.rect = rect;

        const ph = document.createElement('div');
        ph.className = 'section-placeholder';
        ph.style.height = rect.height + 'px';
        card.parentNode.insertBefore(ph, card);
        drag.placeholder = ph;

        card.classList.add('is-dragging');
        card.style.width = rect.width + 'px';
        card.style.left = rect.left + 'px';
        card.style.top = rect.top + 'px';
        drag.started = true;

        armClickSuppression();
        document.body.classList.add('is-dragging-section');
        if (!scrollRaf) scrollRaf = requestAnimationFrame(autoScrollLoop);
    }

    function moveGhost(x, y) {
        drag.card.style.left = (drag.rect.left + (x - drag.startX)) + 'px';
        drag.card.style.top = (drag.rect.top + (y - drag.startY)) + 'px';
    }

    // Moves the placeholder to the gap the pointer is closest to.
    function place(x, y) {
        const lane = laneAt(x, y);
        if (!lane) return;
        setTargetLane(lane);
        const ph = drag.placeholder;
        const refs = cards(lane).filter(function (c) { return c !== drag.card; });
        let before = null;
        for (let i = 0; i < refs.length; i++) {
            const r = refs[i].getBoundingClientRect();
            if (y < r.top + r.height / 2) { before = refs[i]; break; }
        }
        if (before) lane.insertBefore(ph, before);
        else lane.appendChild(ph);
    }

    function resetCard(card) {
        card.classList.remove('is-dragging');
        card.style.position = '';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.zIndex = '';
    }

    // A background refresh (BroadcastChannel / focus) rebuilds the cards, so the
    // nodes we are dragging can disappear mid-gesture.
    function isConnected(el) {
        if (!el) return false;
        if (document.contains) return document.contains(el);
        return true;
    }

    function restore(d) {
        resetCard(d.card);
        setTargetLane(null);
        if (d.placeholder && d.placeholder.parentNode) {
            d.placeholder.parentNode.removeChild(d.placeholder);
        }
        if (!isConnected(d.card)) return;             // the card was re-rendered
        const lane = d.lane || d.card.parentNode;
        if (!lane) return;
        if (d.next && d.next.parentNode === lane) lane.insertBefore(d.card, d.next);
        else lane.appendChild(d.card);
    }

    function save(layout, d) {
        fetch('/api/sections/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layout: layout })
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            if (data && data.debug) {
                // The dry-run wrapper (js/debug.js, ?debug=1) fakes every write.
                toast('Debug dry run: layout not saved. Add ?debug=0 to persist.');
                return;
            }
            try {
                bc = bc || new BroadcastChannel('gph');
                bc.postMessage('changed');            // other tabs / Manager
            } catch (e) { /* noop */ }
        }).catch(function () {
            restore(d);
            toast('Could not save the layout — reverted.');
        });
    }

    function finish(commit) {
        if (!drag || !drag.started) { drag = null; return; }
        const d = drag;
        drag = null;
        if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
        document.body.classList.remove('is-dragging-section');

        const ph = d.placeholder;
        resetCard(d.card);
        setTargetLane(null);
        if (!commit || !isConnected(ph) || !isConnected(d.card)) { restore(d); return; }

        ph.parentNode.insertBefore(d.card, ph);
        ph.parentNode.removeChild(ph);

        const after = layoutNow();
        if (sameLayout(d.origin, after)) return;      // dropped in the same place
        save(after, d);
    }

    function onDown(e) {
        if (drag) return;
        if (e.button !== undefined && e.button !== 0) return;
        const h = e.target.closest ? e.target.closest('h2') : null;
        const card = h && h.closest ? h.closest(CARD) : null;
        if (!card) return;                            // fixed cards keep their heading
        drag = {
            card: card,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            lastY: e.clientY,
            lane: card.parentElement || card.parentNode,
            next: card.nextElementSibling,
            origin: layoutNow(),
            started: false
        };
    }

    function onMove(e) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.lastY = e.clientY;
        if (!drag.started) {
            if (Math.abs(e.clientX - drag.startX) < THRESHOLD &&
                Math.abs(e.clientY - drag.startY) < THRESHOLD) return;
            begin();
            if (!drag || !drag.started) return;
        }
        e.preventDefault();
        moveGhost(e.clientX, e.clientY);
        place(e.clientX, e.clientY);
    }

    function onUp(e) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        if (!drag.started) { drag = null; return; }   // a plain click: let it fold
        finish(true);
    }

    function onCancel(e) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        finish(false);
    }

    // A drag must never fold the section on release: swallow that one click.
    document.addEventListener('click', function (e) {
        if (!suppressClick) return;
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
    }, true);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && drag && drag.started) finish(false);
    });

    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);

    GPH.sectionLayout = { layout: layoutNow };
})(window.GPH = window.GPH || {});
