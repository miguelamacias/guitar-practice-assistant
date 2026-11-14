// Shared audio engine: a single AudioContext reused by
// the metronome, drum machine and assistant alarm.
(function (GPH) {
    'use strict';

    let audioCtx = null;

    function ensureAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function getCtx() {
        return ensureAudio();
    }

    // Timer end alarm: a pleasant bell arpeggio (previously: square-wave
    // beeps). Each note is built from a fundamental tone plus soft harmonics
    // to get a bell timbre with natural attack and decay.
    function chimeNote(ctx, out, freq, start, dur, level) {
        const partials = [
            { mult: 1.0, gain: 1.0 },
            { mult: 2.0, gain: 0.35 },
            { mult: 3.01, gain: 0.15 }
        ];
        partials.forEach(function (p) {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq * p.mult;
            const peak = level * p.gain;
            g.gain.setValueAtTime(0.0001, start);
            g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
            osc.connect(g);
            g.connect(out);
            osc.start(start);
            osc.stop(start + dur + 0.02);
        });
    }

    function playAlarm() {
        const ctx = ensureAudio();

        // Louder bus + limiter: it is heard over the backing track without clipping
        const master = ctx.createGain();
        master.gain.value = 1.6;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -8;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.15;
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 8000;
        master.connect(limiter);
        limiter.connect(tone);
        tone.connect(ctx.destination);

        const t0 = ctx.currentTime + 0.02;
        // Ascending major arpeggio: C6 - E6 - G6
        const arpeggio = [1046.50, 1318.51, 1567.98];
        const step = 0.15;
        arpeggio.forEach(function (f, i) {
            chimeNote(ctx, master, f, t0 + i * step, 1.0, 0.34);
        });

        // Resolution chord (C6 + E6 + G6), "ta-da" style
        const tChord = t0 + arpeggio.length * step;
        arpeggio.forEach(function (f) {
            chimeNote(ctx, master, f, tChord, 1.3, 0.26);
        });
    }

    function playBeep(fx, delay, duration, ctx) {
        ctx = ctx || ensureAudio();
        const startTime = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.value = fx;
        gain.gain.setValueAtTime(0.8, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration);
    }

    // Drum sounds generator by synthesis (Web Audio API)
    // Drum bus with compressor: makes hits punchy and avoids clipping when
    // several instruments overlap. Noise is cached to avoid recreating buffers.
    let drumNoiseBuffer = null;
    let drumBus = null;

    function getDrumBus(ctx) {
        if (!drumBus) {
            drumBus = ctx.createGain();
            drumBus.gain.value = 0.9;
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -14;
            comp.knee.value = 24;
            comp.ratio.value = 3;
            comp.attack.value = 0.003;
            comp.release.value = 0.18;
            drumBus.connect(comp);
            comp.connect(ctx.destination);
        }
        return drumBus;
    }

    function getNoiseBuffer(ctx) {
        if (!drumNoiseBuffer) {
            const len = Math.floor(ctx.sampleRate * 2);
            drumNoiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = drumNoiseBuffer.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        }
        return drumNoiseBuffer;
    }

    // Burst of filtered noise with a decay envelope. A small
    // random offset at the start slightly varies each hit texture.
    function noiseBurst(ctx, out, t, dur, type, freq, Q, level) {
        const src = ctx.createBufferSource();
        src.buffer = getNoiseBuffer(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        if (Q) filter.Q.value = Q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(level, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(filter); filter.connect(g); g.connect(out);
        const maxOffset = Math.max(0, src.buffer.duration - dur - 0.02);
        src.start(t, Math.random() * maxOffset);
        src.stop(t + dur + 0.02);
    }

    // Tonal body with pitch glide and amplitude envelope.
    function toneBody(ctx, out, t, type, f0, f1, glideEnd, attack, decay, level) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f1, t + glideEnd);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(level, t + attack);
        g.gain.exponentialRampToValueAtTime(0.001, t + decay);
        osc.connect(g); g.connect(out);
        osc.start(t); osc.stop(t + decay + 0.02);
        return osc;
    }

    // Small random deviations so no two hits are identical. The pitch of the
    // tonal bodies barely moves (a few cents: more would sound out of tune); the
    // variation lives in the noise filters (timbre) and in the level/decay.
    function jitter(spread) { return 1 + (Math.random() * 2 - 1) * spread; }

    function playSynthDrum(inst, t, vel) {
        const ctx = ensureAudio();
        const out = getDrumBus(ctx);
        if (t == null) t = ctx.currentTime;
        const level = (vel == null ? 1 : Math.max(0, Math.min(1.3, vel))) * jitter(0.15);
        const pitch = jitter(0.012);      // ±1.2 % on the tonal bodies only
        const timbre = jitter(0.06);      // ±6 % on the noise filters
        const decay = jitter(0.08);
        const tone = (type, f0, f1, glide, attack, dec, lv) =>
            toneBody(ctx, out, t, type, f0 * pitch, f1 * pitch, glide, attack, dec * decay, lv * level);
        const noise = (dur, type, freq, Q, lv) =>
            noiseBurst(ctx, out, t, dur * decay, type, freq * timbre, Q, lv * level);

        if (inst === 'kick') {
            // Body with pitch drop + a sub layer for weight + beater click
            tone('sine', 150, 45, 0.09, 0.006, 0.40, 1);
            tone('triangle', 92, 55, 0.06, 0.004, 0.22, 0.45);
            noise(0.02, 'highpass', 3200, 0.7, 0.35);
        } else if (inst === 'snare') {
            // Short tonal body + crack + snap
            tone('triangle', 210, 150, 0.08, 0.002, 0.12, 0.5);
            noise(0.22, 'highpass', 1100, 0.7, 0.72);
            noise(0.12, 'bandpass', 3400, 0.9, 0.45);
        } else if (inst === 'ride') {
            // Metallic ping plus a longer shimmer (a hi-hat that rings)
            tone('triangle', 2400, 2200, 0.02, 0.002, 0.15, 0.12);
            noise(0.34, 'highpass', 5800, 0.7, 0.28);
            noise(0.26, 'bandpass', 8000, 2.2, 0.22);
        } else if (inst === 'hihat') {
            // Metallic hi-hat: high noise + resonant band
            noise(0.055, 'highpass', 8200, 0.7, 0.40);
            noise(0.045, 'bandpass', 10500, 1.6, 0.50);
        } else if (inst === 'tom') {
            // Tom with body and a light click
            tone('sine', 190, 95, 0.16, 0.003, 0.33, 0.85);
            noise(0.02, 'highpass', 2600, 0.7, 0.18);
        } else if (inst === 'splash') {
            // Cymbal: long bright tail with layers of different timbre
            noise(0.80, 'highpass', 4200, 0.7, 0.32);
            noise(0.70, 'bandpass', 6800, 2.2, 0.28);
            noise(0.50, 'bandpass', 9200, 2.5, 0.20);
        }
    }

    // Metronome click. kind: 'accent' (first beat of the bar), 'beat', or 'sub'
    // (subdivision: quieter and tickier so it does not fight with the pulse).
    function playMetronomeClick(time, kind) {
        const ctx = ensureAudio();
        if (time == null) time = ctx.currentTime;
        const cfg = kind === 'accent' ? { freq: 1600, level: 1.0, dur: 0.055, tick: 0.20 }
            : kind === 'sub' ? { freq: 1900, level: 0.30, dur: 0.028, tick: 0.09 }
                : { freq: 1200, level: 0.72, dur: 0.05, tick: 0.16 };
        const freq = cfg.freq;
        const level = cfg.level;
        const dur = cfg.dur;

        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(level, time + 0.0015); // short attack, no pop
        g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(time); osc.stop(time + dur + 0.01);

        // Noise transient for a sharper "tick"
        noiseBurst(ctx, ctx.destination, time, 0.012, 'highpass', 2500, 0.7, cfg.tick);
    }

    // Synthetic string pluck (fretboard trainer)
    function playPluck(freq) {
        const ctx = ensureAudio();
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(Math.min(12000, freq * 6), t);
        filter.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 1.5), t + 0.25);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.7, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0006, t + 0.9);
        osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.95);
        noiseBurst(ctx, ctx.destination, t, 0.02, 'highpass', 2000, 0.7, 0.15);
    }

    GPH.audio = { ensureAudio, getCtx, playAlarm, playBeep, playSynthDrum, playMetronomeClick, playPluck };
})(window.GPH = window.GPH || {});
