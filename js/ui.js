// Utilidades de interfaz: plegar/desplegar secciones y subcarpetas.
(function (GPH) {
    'use strict';

    function toggleSection(headingEl) {
        headingEl.classList.toggle('collapsed');
        const list = headingEl.nextElementSibling;
        if (list) list.classList.toggle('collapsed');
    }

    function toggleSubfolder(toggleEl) {
        toggleEl.classList.toggle('collapsed');
        const content = toggleEl.nextElementSibling;
        if (content) content.classList.toggle('collapsed');
    }

    // Opens every collapsed container between the page and `el` (its subfolder
    // and its section card) and brings it on screen. Used when an exercise
    // automation restarts a resource that lives further down the page
    // (fretboard trainer, metronome, drum machine...).
    function revealInPage(el) {
        if (!el || !el.closest) return;
        // `el` can be inside the panel or be the <li> that holds it.
        let content = el.closest('.subfolder-content, .subfolder-content-drum-machine');
        if (!content && el.querySelector) {
            content = el.querySelector('.subfolder-content, .subfolder-content-drum-machine');
        }
        const card = el.closest('.section-card');

        if (content) {
            content.classList.remove('collapsed');
            // Skip the max-height transition: if the panel was inside a collapsed
            // section it never got rendered, so the transition can stay stuck at 0.
            content.style.transition = 'none';
            requestAnimationFrame(function () { content.style.transition = ''; });
            const toggle = content.previousElementSibling;
            if (toggle && toggle.classList.contains('subfolder-toggle')) {
                toggle.classList.remove('collapsed');
                if (GPH.sections && GPH.sections.saveSubfolder) GPH.sections.saveSubfolder(toggle);
            }
        }
        if (card) {
            const head = card.querySelector('.section-heading') || card.querySelector('h2');
            if (head) {
                const wasCollapsed = head.classList.contains('collapsed');
                head.classList.remove('collapsed');
                if (wasCollapsed && GPH.sections && GPH.sections.saveCollapsed) {
                    try { GPH.sections.saveCollapsed(head); } catch (ignore) { /* noop */ }
                }
                const body = head.nextElementSibling;
                if (body) body.classList.remove('collapsed');
            }
        }

        const target = content || card || el;
        if (!target.scrollIntoView) return;
        try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (ignore) { /* noop */ }
        // Safety net: if the smooth scroll is unsupported or gets interrupted,
        // make sure the element really ends up on screen.
        setTimeout(function () {
            const r = target.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            if (r.top < 0 || r.bottom > vh) {
                try { target.scrollIntoView({ block: 'center' }); } catch (ignore) { /* noop */ }
            }
        }, 500);
    }

    GPH.ui = { toggleSection, toggleSubfolder, revealInPage };
})(window.GPH = window.GPH || {});
