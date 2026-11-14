// Fretboard drawing (shared by the Fretboard Trainer and Fretboard Theory).
// GPH.board.create(container, { frets, strings, interactive, points, nut, pad })
//   `nut` = width of the open-strings column (fraction of the width, default 0.05)
//   `pad` = top/bottom vertical margin (fraction of the height, default 11/180)
//   -> { el, wood, dotsEl, frets, strings, stepY, nutFrac, wireFrac,
//        xFor, yFor, pct, addDot, clearDots }
(function (GPH) {
    'use strict';

    const NUT_FRAC = 0.05;
    const RIGHT_PAD_FRAC = 0.02;
    const PAD_Y_FRAC = 11 / 180;   // 11 px on a 180 px board (trainer board)
    const MARK_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];

    function pct(x) { return (x * 100).toFixed(3) + '%'; }

    function create(container, opts) {
        opts = opts || {};
        const frets = Math.max(1, Math.min(24, parseInt(opts.frets, 10) || 12));
        const strings = Math.max(1, Math.min(6, parseInt(opts.strings, 10) || 6));
        const interactive = !!opts.interactive;
        const points = (opts.points !== false);
        const nut = (typeof opts.nut === 'number' && opts.nut >= 0 && opts.nut < 0.5) ? opts.nut : NUT_FRAC;
        const padY = (typeof opts.pad === 'number' && opts.pad >= 0 && opts.pad < 0.3) ? opts.pad : PAD_Y_FRAC;

        // Frets with real spacing (they narrow towards the bridge), normalized
        // so the last fret lands on the right edge of the board.
        const span = 1 - nut - RIGHT_PAD_FRAC;
        const denom = 1 - Math.pow(2, -frets / 12);
        const wireFrac = [];
        for (let k = 0; k <= frets; k++) {
            wireFrac[k] = (k === 0) ? nut : nut + span * ((1 - Math.pow(2, -k / 12)) / denom);
        }
        function xFor(f) { return (f <= 0) ? nut * 0.5 : (wireFrac[f - 1] + wireFrac[f]) / 2; }
        function yFor(r) { return (strings <= 1) ? 0.5 : (padY + (1 - 2 * padY) * (r / (strings - 1))); }
        const stepY = (strings <= 1) ? 0.7 : (1 - 2 * padY) / (strings - 1);

        container.innerHTML = '';
        const fb2 = document.createElement('div'); fb2.className = 'fb2';
        const wood = document.createElement('div'); wood.className = 'fb2-board';
        const nums = document.createElement('div'); nums.className = 'fb2-nums';
        fb2.appendChild(wood); fb2.appendChild(nums); container.appendChild(fb2);

        for (let r = 0; r < strings; r++) {
            const s = document.createElement('div'); s.className = 'fb2-string';
            s.style.top = pct(yFor(r)); s.style.left = pct(nut); s.style.right = pct(RIGHT_PAD_FRAC);
            s.style.height = (1 + r * 0.35).toFixed(1) + 'px';
            wood.appendChild(s);
        }
        for (let k = 0; k <= frets; k++) {
            const w = document.createElement('div'); w.className = 'fb2-fretwire' + (k === 0 ? ' fb2-nut' : '');
            w.style.left = pct(wireFrac[k]); wood.appendChild(w);
        }
        MARK_FRETS.forEach(function (f) {
            if (f > frets) return;
            if (f === 12 || f === 24) {
                [35, 65].forEach(function (tp) {
                    const d = document.createElement('div'); d.className = 'fb2-inlay';
                    d.style.left = pct(xFor(f)); d.style.top = tp + '%'; wood.appendChild(d);
                });
            } else {
                const d = document.createElement('div'); d.className = 'fb2-inlay';
                d.style.left = pct(xFor(f)); wood.appendChild(d);
            }
            const n = document.createElement('div'); n.className = 'fb2-fretnum';
            n.style.left = pct(xFor(f)); n.textContent = String(f); nums.appendChild(n);
        });

        const dotsEl = document.createElement('div'); dotsEl.className = 'fb2-dots'; wood.appendChild(dotsEl);

        if (interactive) {
            const layer = document.createElement('div'); layer.className = 'fb2-hotspots'; wood.appendChild(layer);
            for (let r = 0; r < strings; r++) {
                for (let f = 0; f <= frets; f++) {
                    const h = document.createElement('div'); h.className = 'fb2-hot';
                    const left = (f <= 0) ? 0 : wireFrac[f - 1];
                    const width = (f <= 0) ? nut : (wireFrac[f] - wireFrac[f - 1]);
                    h.style.left = pct(left); h.style.width = pct(width);
                    h.style.top = pct(yFor(r) - stepY / 2); h.style.height = pct(stepY);
                    h.dataset.row = String(r); h.dataset.fret = String(f);
                    if (points) {
                        const pt = document.createElement('span'); pt.className = 'fb2-pt'; h.appendChild(pt);
                    }
                    layer.appendChild(h);
                }
            }
        }

        function clearDots() { dotsEl.innerHTML = ''; }
        function addDot(r, f, cls, label) {
            const d = document.createElement('div'); d.className = cls;
            d.style.left = pct(xFor(f)); d.style.top = pct(yFor(r));
            d.style.transform = 'translate(-50%, -50%)';
            if (label) { const s = document.createElement('span'); s.textContent = label; d.appendChild(s); }
            dotsEl.appendChild(d);
            return d;
        }

        return {
            el: fb2, wood: wood, dotsEl: dotsEl,
            frets: frets, strings: strings, stepY: stepY,
            nutFrac: nut, wireFrac: wireFrac,
            xFor: xFor, yFor: yFor, pct: pct,
            addDot: addDot, clearDots: clearDots
        };
    }

    GPH.board = { create: create };
})(window.GPH = window.GPH || {});
