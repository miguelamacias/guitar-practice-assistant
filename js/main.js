// Startup and event wiring (no onclick/oninput in the HTML).
(function (GPH) {
    'use strict';

    function $(id) { return document.getElementById(id); }

    // Global collapse delegation (works with static and dynamic content)
    function wireToggles() {
        document.addEventListener('click', function (event) {
            const h = event.target.closest('.section-card > h2');
            if (h) { GPH.ui.toggleSection(h); if (GPH.sections && GPH.sections.saveCollapsed) GPH.sections.saveCollapsed(h); return; }
            const t = event.target.closest('.subfolder-toggle');
            if (t) { GPH.ui.toggleSubfolder(t); if (GPH.sections && GPH.sections.saveSubfolder) GPH.sections.saveSubfolder(t); return; }
        });
    }

    // Global delegation: local audio + YouTube links
    function wireGlobalClicks() {
        document.addEventListener('click', function (event) {
            const trigger = event.target.closest('.audio-trigger[data-url]');
            if (trigger) {
                GPH.players.playAudio(trigger.dataset.url, trigger.dataset.title);
                return;
            }

            const link = event.target.closest('a[href*="youtube.com"], a[href*="youtu.be"]');
            if (link && !link.closest('#youtubeModal')) {
                if (event.ctrlKey || event.metaKey || event.button === 1) return;
                const videoId = GPH.players.getYouTubeId(link.href);
                if (videoId) {
                    event.preventDefault();
                    const titleText = link.textContent.replace('🎬', '').trim();
                    GPH.players.openYouTube(videoId, titleText, link.href);
                }
            }
        });

        const ytClose = $('ytCloseBtn');
        if (ytClose) ytClose.addEventListener('click', GPH.players.closeYouTube);
        const closeAudio = $('closeAudioBtn');
        if (closeAudio) closeAudio.addEventListener('click', GPH.players.closeAudio);
    }

    function wireMetronome() {
        if (!$('metronomeBox')) return;
        $('bpmSlider').addEventListener('input', function () { GPH.metronome.updateBpm(this.value); });
        $('metroPlayBtn').addEventListener('click', GPH.metronome.toggleMetronome);
        $('metronomeBox').addEventListener('keydown', GPH.metronome.handleMetroKeyboard);
        const sigSel = $('metroSig');
        if (sigSel) sigSel.addEventListener('change', function () { GPH.metronome.setSig(this.value); });
        const btns = $('metroPattern');
        if (btns) {
            btns.addEventListener('click', function (event) {
                const btn = event.target.closest('[data-pattern]');
                if (btn) GPH.metronome.setSubdiv(btn.dataset.pattern);
            });
        }
        const accBtn = $('metroAccentBtn');
        if (accBtn) accBtn.addEventListener('click', GPH.metronome.toggleAccent);
        document.querySelectorAll('[data-metro-adjust]').forEach(function (b) {
            b.addEventListener('click', function () {
                GPH.metronome.adjustBpm(parseInt(b.dataset.metroAdjust, 10));
            });
        });
        const drumDisp = $('metronomeBox').querySelector('.metro-bpm-display');
        if (drumDisp) drumDisp.addEventListener('click', function () { $('metronomeBox').focus(); GPH.metronome.tap(); });
        GPH.metronome.updateBpm(GPH.metronome.getBpm());
        GPH.metronome.init();
    }

    function wireDrumMachine() {
        if (!$('drumMachineBox')) return;
        $('drumBpmSlider').addEventListener('input', function () { GPH.drumMachine.updateDrumBpm(this.value); });
        $('drumPlayBtn').addEventListener('click', GPH.drumMachine.toggleDrumMachine);
        $('drumGridContainer').addEventListener('click', GPH.drumMachine.onGridClick);
        $('drumMachineBox').addEventListener('keydown', GPH.drumMachine.handleDrumKeyboard);
        $('timeSigBtn').addEventListener('click', GPH.drumMachine.toggleTimeSignature);
        $('swingToggleBtn').addEventListener('click', GPH.drumMachine.toggleSwing);
        $('drumResetBtn').addEventListener('click', GPH.drumMachine.resetDrumPattern);
        const styleSel = $('drumStyleSel');
        if (styleSel) styleSel.addEventListener('change', function () { GPH.drumMachine.setStyle(this.value); });
        const resBtn = $('drumResBtn');
        if (resBtn) resBtn.addEventListener('click', GPH.drumMachine.toggleResolution);
        $('drumClearBtn').addEventListener('click', GPH.drumMachine.clearDrumPattern);
        document.querySelectorAll('[data-drum-adjust]').forEach(function (b) {
            b.addEventListener('click', function () {
                GPH.drumMachine.adjustDrumBpm(parseInt(b.dataset.drumAdjust, 10));
            });
        });
        GPH.drumMachine.initDrumMachineGrid();
        const drumDisp = $('drumMachineBox').querySelector('.metro-bpm-display');
        if (drumDisp) drumDisp.addEventListener('click', function () { $('drumMachineBox').focus(); GPH.drumMachine.tap(); });
        GPH.drumMachine.updateDrumBpm(GPH.drumMachine.getBpm());
    }

    function wirePracticeAssistant() {
        $('startRoutineBtn').addEventListener('click', GPH.practiceAssistant.startRoutineSession);
        $('exPlayBtn').addEventListener('click', GPH.practiceAssistant.toggleExerciseTimer);
        $('exNextBtn').addEventListener('click', GPH.practiceAssistant.handleNextOrFinish);
        $('exSkipBtn').addEventListener('click', GPH.practiceAssistant.skipExercise);
        $('exResetBtn').addEventListener('click', GPH.practiceAssistant.resetExerciseTimer);
        const progTrack = document.querySelector('.ex-progress');
        if (progTrack) progTrack.addEventListener('pointerdown', GPH.practiceAssistant.startSeek);
        GPH.practiceAssistant.init();
        if (GPH.prefs) GPH.prefs.start();
    }

    let refreshing = false;
    let lastSectionsJson = '';
    let fbMountedConfig = '';
    function safeJson(o) { try { return JSON.stringify(o); } catch (e) { return ''; } }
    function refreshFromDb() {
        if (refreshing || !(GPH.api && GPH.api.loadState)) return;
        refreshing = true;
        // The sections and the assistant state are independent payloads: ask for
        // both now instead of waiting for one to finish before the other starts.
        const sectionsReady = (GPH.api && GPH.api.getSections)
            ? GPH.api.getSections().catch(function () { return null; })
            : Promise.resolve(null);
        GPH.api.loadState().then(async function () {
            if (GPH.settings) GPH.settings.loadAccent();
            loadFretboardFixed();
            loadAssistantPref();
            const secs = await sectionsReady;
            if (secs) {
                const js = safeJson(secs || []);
                if (js !== lastSectionsJson) {
                    lastSectionsJson = js;
                    document.querySelectorAll('.dyn-section').forEach(function (e) { e.remove(); });
                    GPH.sections.renderDynamicSections(secs || []);
                    wireMetronome();
                    wireDrumMachine();
                }
            }
            if (GPH.practiceAssistant && GPH.practiceAssistant.refresh) {
                GPH.practiceAssistant.refresh();
            }
        }).catch(function () { /* noop */ }).then(function () { refreshing = false; });
    }

    function wireAutoRefresh() {
        try {
            const bc = new BroadcastChannel('gph');
            bc.addEventListener('message', refreshFromDb);
        } catch (e) { /* noop */ }
        window.addEventListener('focus', refreshFromDb);
    }

    // `view` opens the Manager straight on that tab (e.g. 'history'): that is
    // what the little chart icon on the welcome card uses.
    function openManager(view) {
        const ov = document.getElementById('managerOverlay');
        const fr = document.getElementById('managerFrame');
        if (!ov || !fr) return;
        const q = '?t=' + Date.now() + (view ? '&view=' + encodeURIComponent(view) : '');
        fr.setAttribute('src', 'manager.html' + q);
        ov.classList.add('is-open');
    }
    GPH.openManager = openManager;

    function closeManager() {
        const ov = document.getElementById('managerOverlay');
        if (ov) ov.classList.remove('is-open');
        refreshFromDb();
    }

    function wireManagerOverlay() {
        const manageBtn = document.getElementById('manageBtn');
        if (manageBtn) manageBtn.addEventListener('click', function (e) { e.preventDefault(); openManager(); });
        const histBtn = document.getElementById('welcomeHistBtn');
        if (histBtn) histBtn.addEventListener('click', function (e) { e.preventDefault(); openManager('history'); });
        const closeBtn = document.getElementById('managerCloseBtn');
        if (closeBtn) closeBtn.addEventListener('click', closeManager);
        const bd = document.getElementById('managerBackdrop');
        if (bd) bd.addEventListener('click', closeManager);
        document.addEventListener('keydown', function (e) {
            const ov = document.getElementById('managerOverlay');
            if (e.key === 'Escape' && ov && ov.classList.contains('is-open')) closeManager();
            // "h" on the welcome screen: same destination, no UI needed.
            if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const t = e.target;
                if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                          t.tagName === 'SELECT' || t.isContentEditable)) return;
                if (ov && ov.classList.contains('is-open')) return;
                const wc = document.getElementById('welcomeCard');
                if (wc && !wc.classList.contains('is-hidden')) openManager('history');
            }
        });
    }

    function loadFretboardFixed() {
        const sec = document.getElementById('fretboardSection');
        const mount = document.getElementById('fretboardMount');
        if (!sec || !mount || !GPH.settings) return;
        const S = GPH.settings, U = GPH.util;
        const SUB_KEYS = [
            { setting: 'fretboard_trainer_enabled', elId: 'sub-fretboard-trainer' },
            { setting: 'fretboard_theory_enabled', elId: 'sub-fretboard-theory' },
            { setting: 'fretboard_chords_enabled', elId: 'sub-fretboard-chords' },
            { setting: 'fretboard_chord_diagrams_enabled', elId: 'sub-fretboard-chord-diagrams' }
        ];
        Promise.all(['fretboard_enabled', 'fretboard_strings', 'fretboard_frets', 'fretboard_color'].map(S.getOr)).then(function (res) {
            if (!S.isOn(res[0])) { sec.style.display = 'none'; return; }
            const enabled = U.parseCsvInts(res[1], 1, 6, [1, 2, 3, 4, 5, 6]);
            const frets = Math.max(1, Math.min(24, parseInt(res[2], 10) || 12));
            const color = U.normalizeHex(res[3]) || S.DEFAULTS.fretboard_color;
            sec.style.setProperty('--sec-color', color);
            const cfg = enabled.join(',') + '|' + frets + '|' + color;
            sec.style.display = '';
            if (fbMountedConfig !== cfg) {
                fbMountedConfig = cfg;
                if (GPH.sections && GPH.sections.mountFretboard) {
                    GPH.sections.mountFretboard(mount, { frets: frets, enabled: enabled });
                }
            }
            // Show/hide each Theory subsection according to its individual setting.
            SUB_KEYS.forEach(function (sk) {
                const el = document.getElementById(sk.elId);
                if (!el) return;
                S.getOr(sk.setting).then(function (v) {
                    el.style.display = S.isOn(v) ? '' : 'none';
                }).catch(function () {});
            });
            if (GPH.theory) GPH.theory.init(sec);
            if (GPH.chords && GPH.chords.mount) GPH.chords.mount(sec);
            if (GPH.chordDiagrams && GPH.chordDiagrams.mount) GPH.chordDiagrams.mount(sec);
        }).catch(function () {});
    }

    function loadAssistantPref() {
        const sec = document.querySelector('.practice-assistant-section');
        if (!sec || !GPH.settings) return;
        GPH.settings.getOr('assistant_enabled').then(function (v) {
            sec.style.display = GPH.settings.isOn(v) ? '' : 'none';
        }).catch(function () {});
    }

    async function initApp() {
        // Wired before any await: the Manager overlay (and the History shortcut)
        // must work from the first frame, not only once the data has loaded.
        wireManagerOverlay();
        // The accent, the assistant state and the sections are independent, so
        // the three go out together: the colour lands first (it is the one that
        // shows) and the sections no longer wait for the routine payload.
        if (GPH.settings) GPH.settings.loadAccent();
        const stateReady = (GPH.api && GPH.api.loadState)
            ? GPH.api.loadState().catch(function () { /* noop */ })
            : Promise.resolve();
        const sectionsReady = (GPH.api && GPH.api.getSections)
            ? GPH.api.getSections().catch(function () { return null; })
            : Promise.resolve(null);
        await stateReady;
        wireToggles();
        wireGlobalClicks();
        const secs = await sectionsReady;
        if (secs) {
            lastSectionsJson = safeJson(secs || []);
            if (secs.length) { GPH.sections.renderDynamicSections(secs); }
        }
        if (GPH.sections) GPH.sections.applyCollapsedStates();
        loadFretboardFixed();
        loadAssistantPref();
        wireMetronome();
        wireDrumMachine();
        wirePracticeAssistant();
        wireAutoRefresh();
    }

    document.addEventListener('DOMContentLoaded', initApp);
})(window.GPH = window.GPH || {});
