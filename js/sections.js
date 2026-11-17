// Renders dynamic sections (cards, items, folders and widgets) from the DB.
(function (GPH) {
    'use strict';

    function labelNodes(it) {
        const frag = document.createDocumentFragment();
        if (it.tag) {
            const s = document.createElement('span'); s.className = 'tag'; s.textContent = it.tag; frag.appendChild(s);
            if (it.label) frag.appendChild(document.createTextNode(' - ' + it.label));
        } else {
            frag.appendChild(document.createTextNode(it.label || ''));
        }
        return frag;
    }

    function itemText(it) {
        if (it.tag && it.label) return it.tag + ' - ' + it.label;
        return it.tag || it.label || '';
    }

    // The hover panel lives in practiceAssistant.js (same `.ex-tip` style as the
    // rest of the assistant); a missing helper simply leaves the row unstyled.
    function wireAudioTip(el) {
        if (el && GPH.tip && GPH.tip.wireMedia) GPH.tip.wireMedia(el);
    }

    // Type badge shown on hover: inline SVG painted with the section accent.
    function typeIcon(name) {
        const s = document.createElement('span');
        s.className = 'type-icon';
        s.innerHTML = (GPH.icons && GPH.icons.get) ? GPH.icons.get(name) : '';
        return s;
    }

    const SUB_COLLAPSED_KEY = 'gph_subfolder_collapsed';
    function loadSubCollapsed() {
        try { return JSON.parse(localStorage.getItem(SUB_COLLAPSED_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function saveSubfolder(toggleEl) {
        if (!toggleEl || !toggleEl.dataset || !toggleEl.dataset.subKey) return;
        const map = loadSubCollapsed();
        map[toggleEl.dataset.subKey] = toggleEl.classList.contains('collapsed');
        try { localStorage.setItem(SUB_COLLAPSED_KEY, JSON.stringify(map)); } catch (e) {}
    }
    function applySubState(tog, content, key, map) {
        tog.dataset.subKey = key;
        if (map && Object.prototype.hasOwnProperty.call(map, key)) {
            const collapsed = !!map[key];
            tog.classList.toggle('collapsed', collapsed);
            if (content) content.classList.toggle('collapsed', collapsed);
        }
    }

    function renderWidgetLi(it, rendered) {
        const li = document.createElement('li'); li.className = 'link-item';
        if (it.url === 'fretboard') { li.style.display = 'none'; return li; }
        let html = '';
        if (it.url === 'metronome') html = GPH.widgets.METRONOME_HTML;
        else if (it.url === 'drums') html = GPH.widgets.DRUM_HTML;
        else if (it.url === 'notes') html = GPH.widgets.NOTES_HTML;
        else if (it.url === 'delay') html = GPH.widgets.DELAY_HTML;
        else if (it.url === 'song') html = GPH.widgets.SONG_HTML;
        else if (it.url === 'transposer') html = GPH.widgets.TRANSPOSER_HTML;
        if (!html) { li.textContent = 'Unknown widget: ' + it.url; return li; }
        if (rendered[it.url]) {
            const warn = document.createElement('span');
            warn.className = 'song-icon';
            warn.innerHTML = (GPH.icons && GPH.icons.get) ? GPH.icons.get('alert') : '';
            li.appendChild(warn);
            li.appendChild(document.createTextNode(' ' + itemText(it) + ' already shown in another section'));
            return li;
        }
        rendered[it.url] = true;

        const tog = document.createElement('div'); tog.className = 'subfolder-toggle collapsed';
        const sp = document.createElement('span'); sp.appendChild(labelNodes(it)); tog.appendChild(sp);

        const content = document.createElement('div');
        content.className = (it.url === 'drums')
            ? 'subfolder-content-drum-machine collapsed'
            : 'subfolder-content collapsed';
        content.innerHTML = html;
        applySubState(tog, content, 'widget-' + it.url, loadSubCollapsed());

        li.appendChild(tog); li.appendChild(content);
        if (it.url === 'notes') GPH.widgets.initNotes(content);
        if (it.url === 'delay') GPH.widgets.initDelay(content);
        if (it.url === 'song') GPH.widgets.initSong(content);
        if (it.url === 'transposer') GPH.widgets.initTransposer(content);
        return li;
    }

    function renderItemLi(it, rendered) {
        if (it.kind === 'divider') {
            const d = document.createElement('li'); d.className = 'list-divider'; d.textContent = it.label || ''; return d;
        }
        if (it.kind === 'widget') return renderWidgetLi(it, rendered);

        const li = document.createElement('li'); li.className = 'link-item';

        if (it.kind === 'youtube') {
            const a = document.createElement('a');
            a.href = it.url;
            a.className = 'has-icon';
            a.dataset.url = it.url;
            a.dataset.title = itemText(it);
            wireAudioTip(a);
            a.appendChild(labelNodes(it)); a.appendChild(typeIcon('video')); li.appendChild(a); return li;
        }
        if (it.kind === 'external' || it.kind === 'file') {
            const a = document.createElement('a'); a.href = it.url; a.target = '_blank'; a.className = 'has-icon'; a.appendChild(labelNodes(it)); a.appendChild(typeIcon(it.kind === 'file' ? 'file' : 'globe')); li.appendChild(a); return li;
        }
        if (it.kind === 'audio' || it.kind === 'song') {
            const d = document.createElement('div'); d.className = 'audio-trigger has-icon';
            d.dataset.url = (it.kind === 'song') ? ('/api/media?path=' + encodeURIComponent(it.url)) : it.url;
            d.dataset.title = itemText(it);
            wireAudioTip(d);
            d.appendChild(labelNodes(it)); d.appendChild(typeIcon('music')); li.appendChild(d); return li;
        }
        if (it.kind === 'folder') {
            const tog = document.createElement('div'); tog.className = 'subfolder-toggle collapsed';
            const sp = document.createElement('span'); sp.appendChild(labelNodes(it)); tog.appendChild(sp);
            const content = document.createElement('div'); content.className = 'subfolder-content collapsed';
            applySubState(tog, content, 'folder-' + it.id, loadSubCollapsed());
            const songs = (it.meta && it.meta.songs) || [];
            if (!songs.length) {
                const e = document.createElement('div'); e.className = 'song-empty'; e.textContent = 'No songs in folder.'; content.appendChild(e);
            } else {
                songs.forEach(function (sng) {
                    const dd = document.createElement('div'); dd.className = 'audio-trigger';
                    dd.dataset.url = '/api/media?path=' + encodeURIComponent(sng.path);
                    dd.dataset.title = sng.title;
                    wireAudioTip(dd);
                    const t = document.createElement('span'); t.className = 'song-icon';
                    t.innerHTML = (GPH.icons && GPH.icons.get) ? GPH.icons.get('music') : '';
                    dd.appendChild(t); dd.appendChild(document.createTextNode(' ' + sng.title));
                    content.appendChild(dd);
                });
            }
            li.appendChild(tog); li.appendChild(content); return li;
        }
        li.textContent = itemText(it); return li;
    }

    const SEC_COLLAPSED_KEY = 'gph_section_collapsed';
    function loadCollapsed() {
        try { return JSON.parse(localStorage.getItem(SEC_COLLAPSED_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    // Stable card key: section id (dynamic) or DOM id (fixed)
    function sectionKey(card) {
        if (!card) return '';
        return card.dataset.secId || card.id || '';
    }
    function saveCollapsed(headingEl) {
        const card = headingEl.closest('.section-card');
        if (!card) return;
        const key = sectionKey(card);
        if (!key) return;
        const map = loadCollapsed();
        map[key] = headingEl.classList.contains('collapsed');
        try { localStorage.setItem(SEC_COLLAPSED_KEY, JSON.stringify(map)); } catch (e) {}
    }

    // Restaura el plegado guardado: secciones (fijas y dinamicas) y subcarpetas.
    function applyCollapsedStates() {
        const map = loadCollapsed();
        document.querySelectorAll('.section-card').forEach(function (card) {
            const key = sectionKey(card);
            if (!key || map[key] === undefined) return;
            const h = card.querySelector('h2');
            if (!h) return;
            const collapsed = !!map[key];
            h.classList.toggle('collapsed', collapsed);
            const body = h.nextElementSibling;
            if (body) body.classList.toggle('collapsed', collapsed);
        });
        const sub = loadSubCollapsed();
        document.querySelectorAll('.subfolder-toggle[data-sub-key]').forEach(function (tog) {
            const key = tog.dataset.subKey;
            if (!key || sub[key] === undefined) return;
            const collapsed = !!sub[key];
            tog.classList.toggle('collapsed', collapsed);
            const content = tog.nextElementSibling;
            if (content) content.classList.toggle('collapsed', collapsed);
        });
    }

    // Three independent lanes: 1-2 are the left column (under Theory), 3 is the
    // right rail. Each lane stacks on its own, so a tall section never holds up
    // a short neighbour. The lane comes from the DB (sections.lane).
    function renderDynamicSections(sections) {
        const lanes = ['sectionsColA', 'sectionsColB', 'sectionsColC']
            .map(function (id) { return document.getElementById(id); });
        if (!lanes[0]) return;
        lanes.forEach(function (col) { if (col) col.innerHTML = ''; });
        const rendered = {};
        const collapsedMap = loadCollapsed();
        sections.forEach(function (sec) {
            const card = document.createElement('div');
            card.className = 'section-card dyn-section';
            card.dataset.secId = String(sec.id);
            card.style.setProperty('--sec-color', sec.color || '#ff9800');
            const h2 = document.createElement('h2'); h2.className = 'section-heading'; h2.textContent = sec.title; card.appendChild(h2);
            const ul = document.createElement('ul'); ul.className = 'link-list';
            if (collapsedMap[sec.id]) { h2.classList.add('collapsed'); ul.classList.add('collapsed'); }
            (sec.items || []).forEach(function (it) { ul.appendChild(renderItemLi(it, rendered)); });
            card.appendChild(ul);
            const idx = (sec.lane >= 1 && sec.lane <= 3) ? sec.lane - 1 : 0;
            const target = lanes[idx] || lanes[0];
            target.appendChild(card);
        });
    }

    // The trainer lives in js/fretboard.js; the delegate is kept in the public API.
    function mountFretboard(el, meta) {
        if (GPH.fretboard && GPH.fretboard.mount) GPH.fretboard.mount(el, meta);
    }

    GPH.sections = {
        renderDynamicSections: renderDynamicSections,
        saveCollapsed: saveCollapsed,
        saveSubfolder: saveSubfolder,
        mountFretboard: mountFretboard,
        applyCollapsedStates: applyCollapsedStates
    };
})(window.GPH = window.GPH || {});
