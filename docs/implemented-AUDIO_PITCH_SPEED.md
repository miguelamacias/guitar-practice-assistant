# Implemented: pitch and speed controls in the audio player

Status: implemented in the local audio player.

## What was added

- Pitch: `+1` / `-1` semitone buttons, range `-6..+6`, shown as `0 st` … `+6 st`.
- Speed: `-5%` / `+5%` buttons, range `25%..150%`, shown as `100%`, `105%`, etc.
- Both controls are independent:
  - pitch uses **Signalsmith Stretch 1.3.2** (vendored);
  - speed uses the native `HTMLMediaElement.playbackRate` with
    `preservesPitch = true`.
- Effects are cleared when a track closes; on opening a track the saved pitch and
  speed are restored.
- Pitch and speed are persisted **per track** in `localStorage` under
  `gph.audioFx:<trackKey>`; `trackKey` is the same local-media path / URL used by
  the A-B marks. Returning to the track restores both values. Setting both back
  to `0 st` / `100%` removes the entry.
- The visible player title prefers the local MP3 ID3 **title - artist** and
  falls back to the section element label when neither tag is present. The
  server exposes this through `GET /api/media/tags?path=...`.

## Audio graph

Pitch is inserted only the first time a pitch button is used:

```text
<audio id="audioPlayer">
        -> MediaElementAudioSourceNode
        -> Signalsmith Stretch (live input)
        -> wet gain -> AudioContext.destination

        + dry gain -> AudioContext.destination   (bypass at 0 semitones)
```

The native `<audio>` remains the transport/clock: play, pause, seek, loop, A-B
marks and media telemetry are unchanged.

## Vendor

- Directory: `js/vendor/signalsmith-stretch/`
- Files: `SignalsmithStretch.js`, `README.md`, `LICENSE.txt`
- Version: 1.3.2
- License: MIT (kept in the vendor directory)

The UMD build is loaded as a classic script before `players.js`.

## Behaviour and limitations

- Speed is handled by the browser's pitch-preserving time stretch; at 5% steps
  it is suitable for practice.
- Pitch at `-4` and similar intervals benefits from the library; quality is
  better than a hand-written phase vocoder.
- The worklet adds processing latency; A/B loop edges may be slightly delayed
  relative to native time.
- Local media is the target. Cross-origin audio can become silent through Web
  Audio unless CORS is configured.
- YouTube audio is in an iframe and is not processed.
- If Signalsmith or Web Audio is unavailable, pitch buttons are disabled while
  speed remains available.

## ID3 editor

Hovering the player cover reveals a pencil button. It opens a small editor for
the local MP3's `TIT2` (title), `TPE1` (artist), `TALB` (album) and `APIC`
(cover). The native browser file picker selects a JPEG/PNG/WebP cover.

Saving:

- validates that the path is an allowed local MP3;
- creates a SHA-256-verified backup in `backups/id3/`;
- keeps only backups from the current calendar day: the folder is swept at
  server start, after each successful save and at local midnight, so old
  full-MP3 copies do not accumulate;
- writes the new ID3v2 tag atomically (temporary file + `os.replace`), with an
  in-place fallback when Windows keeps the media file locked;
- preserves unchanged ID3 frames (track, year, comments, etc.) when possible;
- leaves the audio frames untouched;
- refreshes the player title and cover after saving.

The editor is only available for local MP3 files. YouTube and remote audio are
not editable.

## Checks performed

- `node --check` for `players.js` and the other touched JS.
- ID3 writer on a temporary copy: tags updated, cover preserved, audio SHA-256 unchanged.
- ID3 endpoint on a temporary copy: SHA-256-verified backup created and new tags returned.
- ID3 backup sweeper: old-day backup removed; current-day, malformed and unknown files kept.
- Visual check of the ID3 editor at 1280×800 (title/artist/album/cover fields).
- Headless browser smoke test with a generated WAV:
  - `pitch=+1 st`, `disabled=false`;
  - `speed=105%`, actual `playbackRate=1.05`.
- Visual check of the audio bar at 1280×800.
- Restored a stored `{pitch: -4, speed: 110}` entry on the same track: the player
  showed `-4 st`, `110%` and `playbackRate=1.1`.
- Player order: elapsed time, seek, total duration, loop, A-B, pitch, speed,
  scrobble, close.
- `py_compile` for unchanged Python files as a regression guard.

## Not verified automatically

Actual subjective audio quality, A/B loop listening and long-running playback
must be checked manually with real MP3s at `-4` and several speed values.
The final save button flow should also be checked manually in Edge/Firefox with
an MP3 playing; the ID3 writer and endpoint were tested separately on temporary
MP3 copies.
