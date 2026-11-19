# Pending: pitch shift (+1 / -1 semitone) in the audio player

Status: pending, not implemented.

## Goal

Add `+1` / `-1` buttons to the MP3 audio bar that transpose the current track by
one semitone per press **without changing its tempo**.

## Current implementation

- `index.html` uses a native `<audio id="audioPlayer">`.
- `js/players.js` owns play/pause, seek, loop, A-B marks and media telemetry.
- `js/audioEngine.js` already exposes a shared `AudioContext` (`GPH.audio`).
- There is no `playbackRate` or pitch-shift code today.

## Conclusion

Native HTML audio cannot shift pitch independently from tempo:

- `playbackRate` changes both tempo and pitch.
- `preservesPitch = true` keeps the pitch while changing speed; it cannot
  transpose.
- `AudioBufferSourceNode.detune` also changes speed/duration.

The feature needs time-stretch + resampling or a phase vocoder.

## Recommended additive approach

Keep the native `<audio>` as the transport/clock and insert a Web Audio graph:

```text
<audio id="audioPlayer">
        -> MediaElementAudioSourceNode
        -> PitchShift AudioWorklet
        -> AudioContext.destination
```

- Create the media-element source **once**, lazily on the first pitch button press.
- Create/load the worklet lazily; resume the shared `AudioContext` inside the
  button click.
- At `0` semitones, bypass the worklet or use a dry path.
- Reset/flush the worklet buffer on seek, pause, track change and loop jump.
- Add a short crossfade when enabling/disabling pitch to avoid clicks.
- Proposed range: `-6..+6`, step 1, with the current offset visible.
- Proposed reset: return to `0` on track change; confirm before implementing.

This does not require rewriting the player or its telemetry.

## Quality and limitations

- A phase vocoder around 2048 samples / hop 512 should be acceptable for
  practising at +/-1 semitone.
- Expect mild smearing/pre-echo on vocals, cymbals and transients; latency around
  30-50 ms. A/B loop edges may sound slightly delayed relative to native time.
- A granular/WSOLA approach may preserve attacks better but can warble on
  sustained notes.
- Higher quality would require a proven SoundTouch/Rubber Band WASM library,
  which adds a dependency and licensing considerations.
- Local MP3s served by the app are the target. Cross-origin audio may become
  silent through Web Audio unless CORS is configured.
- YouTube audio is in an iframe and cannot be processed this way.

## Likely files

- `js/pitchShiftWorklet.js` (new, AudioWorkletProcessor).
- `js/players.js` (graph/state/buttons wiring).
- `index.html` (buttons + offset display).
- `css/styles.css` (button and active-state styles).

## Minimum tests when implemented

- play/pause, seek and duration unchanged;
- loop and A-B loop;
- volume/mute;
- change track and close player;
- short practice loops;
- pitch +1, pitch -1, return to 0;
- no console errors in Edge/Firefox;
- visual check of the audio bar at desktop resolution.

## Decision needed before implementation

Choose between:

1. Self-contained AudioWorklet (no new dependency, acceptable practice quality).
2. Proven SoundTouch/Rubber Band WASM library (better quality, new dependency).
