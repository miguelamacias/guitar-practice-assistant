# Stats instrumentation (2026-11-17)

Transparent capture of practice facts that cannot be reconstructed later. The
user never fills anything in: the app writes the data as it is already used
(timer, metronome, drum machine, player, trainer). The trainer **Statistics**
screen and the **Manager → History → Details** row already read part of it; the
rest of this document is the contract for future reports.

> What is shown now, what is used internally and what is only recorded:
> [`implemented-STATS_USAGE.md`](implemented-STATS_USAGE.md).

## Principle

Persist **raw facts**, derive metrics in SQL. Do not store ratios, streaks,
weekdays or totals: they can be recomputed. Do store the facts that disappear
when the session closes (the BPM actually used, how many times an exercise was
restarted, which bars were looped, which tool was open, how a trainer run went).

Two layers:

1. **Authoritative counters** in `routine_sessions` / `routine_session_items`.
   They travel with the session queue, so they survive a failed request.
2. **Supplementary timelines** in `media_plays`, `fretboard_cell_attempts` and
   `practice_events`. They are best-effort (a killed tab can lose the last
   event), which is fine because no aggregate depends on them.

## Field dictionary

### `routine_sessions`

| Field | Type / default | Meaning | Captured |
|---|---|---|---|
| `tz_offset_min` | INTEGER, 0 | Minutes the browser was **ahead of UTC** when the session started (`-getTimezoneOffset()`). 60 = UTC+1. | `sessionStart()` |
| `resume_count` | INTEGER, 0 | Times the browser recovered this open session after a reload (or from another browser). | `resumeLocalSession()` / `applyServerSession()`, sent on finish |
| `abandon_reason` | TEXT, `''` | `new_session` (another session started), `sweep` (auto-closed after 8 h) or `''` (finished / old rows). | `_abandon_session()` |

### `routine_session_items`

| Field | Type / default | Meaning | Captured |
|---|---|---|---|
| `area_label` | TEXT, `''` | Area label at practice time, so deleting or renaming an area does not rewrite history. | `sessionStart()` / `sessionSyncItem()` |
| `catalog_path_id` | INTEGER NULL | Learning path the slot belonged to at practice time. | `sessionStart()` / sync |
| `metro_bpm_start` / `metro_bpm_end` | INTEGER, 0 | Metronome BPM when the item started / when it was last written. | `captureBpmStart()` + `telemetryFor()` |
| `drums_bpm_start` / `drums_bpm_end` | INTEGER, 0 | Same for the drum machine. | same |
| `bpm_target` | INTEGER, 0 | BPM saved in the metronome/drums resource of the exercise (a preset/last used value, not a goal). | `sessionStart()` / `markToolUsed()` |
| `tool_cfg` | TEXT, `''` | Flat JSON snapshot: `metro_sig`, `metro_pattern`, `metro_accent`, `drums_sig`, `drums_style`, `drums_res`, `drums_swing`. Values are capped by `_clean_cfg` (16-char keys, 24-char strings). | `toolCfgFor()` |
| `used_metronome` … `used_fretboard` | INTEGER 0/1 | Which tools were actually activated for this item (metronome, drums, audio, YouTube, fretboard). | `markToolUsed()` |
| `play_count` | INTEGER, 0 | Times Play was pressed (a resume after Pause counts again). | `clockStart()` |
| `pause_count` | INTEGER, 0 | User pauses (leaving the exercise is not a pause). | `toggleExerciseTimer()` |
| `reset_count` | INTEGER, 0 | Reset from a pending item. | `resetExerciseTimer()` |
| `repeat_count` | INTEGER, 0 | Repeat/undo after the item was already resolved. | `resetExerciseTimer()` |
| `completed_by` | TEXT, `''` | `timer` (countdown reached 0), `manual` (Mark done / seek to the end) or `skip`. | `markCurrentCompleted(cause)` / `skipExercise()` |

### `exercises`

| Field | Type | Meaning |
|---|---|---|
| `created_at` | TEXT NULL | When the slot was created. Existing rows stay `NULL` (unknown) because SQLite cannot add a non-constant default. New rows are stamped by `create_exercise()` and `duplicate_routine()`. |

### `fretboard_stats` (one row per trainer run)

| Field | Meaning |
|---|---|
| `mode` | `identify` / `locate` / `zone` |
| `hits` / `misses` | Correct / wrong answers |
| `score` | Trainer score (can be negative) |
| `best_streak` | Longest run of consecutive correct answers |
| `avg_ms` | Average time to a correct answer |
| `run_uid` | Client id; a retried POST is ignored (`INSERT OR IGNORE` + partial unique index) |
| `session_id` / `item_position` / `catalog_exercise_id` | Context, when the trainer ran inside a session item |

`played_at` is UTC for runs recorded from this version and carries a `Z`, so
the browser converts it to local time. Rows written before 2026-11-17 are
server-local and have no timezone suffix. Use `fretboard_cell_attempts.at` (UTC)
for precise time series.

### `fretboard_cell_attempts` (raw, append-only)

`id`, `run_uid`, `at` (UTC), `string_no`, `fret`, `mode`, `kind` (`hit`/`miss`),
`time_ms`. The aggregate `fretboard_cell_stats` table is unchanged and remains
the fast read; this table adds the time dimension that the aggregate cannot
hold.

### `media_plays` (one row per playback)

| Field | Meaning |
|---|---|
| `play_uid` | Client id, unique; retries are ignored |
| `session_id` / `item_position` | Context at the moment the track started |
| `kind` | `audio` (local file) / `youtube` |
| `ref` | Local media path, web-audio URL or YouTube video id |
| `label` | Visible title |
| `duration_seconds` | Track duration when known |
| `played_seconds` | Measured wall time while playing (audio). YouTube: wall time with the modal open (`measured = 0`) |
| `loops` | Native loop wraps + A-B loop wraps |
| `ab_start` / `ab_end` | A-B marks in seconds, 0 when not set |
| `completed` | Reached the end without looping (audio only) |
| `measured` | 1 = real playback clock; 0 = approximation |
| `started_at` / `ended_at` | UTC |

This table is **not** a Last.fm substitute: `lastfm_scrobbles` only keeps
eligible scrobbles, while this one keeps every practice loop (including tracks
shorter than the scrobble minimum).

### `practice_events` (append-only timeline)

`event_uid` (unique, idempotent), `session_id`, `item_position`, `at`, `type`,
`value_num`, `value_text`, `payload` (small JSON, 2000 chars max).

Types emitted today:

- `session_start`, `session_resume`, `session_finish`
- `item_play`, `item_pause`, `item_reset`, `item_repeat`, `item_skip`,
  `item_done`
- `media_start`, `media_stop`, `ab_loop_set`

`trainer_run` is covered by `fretboard_stats` and is not duplicated here.

## Capture points

- `js/practiceAssistant.js`: session start/sync/finish payloads, item counters,
  tool flags, BPM snapshots, path/area snapshots, resume count, player context.
- `js/players.js`: one `media_plays` row per playback, loops, A-B marks,
  YouTube wall time, `media_start` / `media_stop` / `ab_loop_set` events. Local
  files use the inner `/api/media` path as `ref`; web audio uses its URL.
- `js/fretboard.js`: per-run metrics, `run_uid`, raw cell attempts.
- `js/stats.js`: id generation, best-effort POSTs, small localStorage retry
  queue, flush on `online` / visibility / `pagehide`.
- `server.py`: `POST /api/media/plays`, `GET /api/media/stats` (agregado de
  solo lectura por `kind` + `ref`), `POST /api/practice/events`, extended
  `POST /api/fretboard/stats`, `run_uid` on `POST /api/fretboard/cell`.
- `db.py`: schema, additive migration, cleaners, writers, CSV export.

## Screens wired to this data (2026-11-17)

Three surfaces are live; the rest of the tables remain ready for future reports.

### Fretboard Trainer → Statistics

- KPI cards: detailed runs, accuracy, best streak and average response time.
- **By mode** table: runs, accuracy, average time and best streak.
- **Recent runs** table: the last 30 detailed runs with local date/time, mode,
  score, accuracy, best streak and average time, 10 per page with Prev/Next.
- The statistics panel scrolls inside the trainer subfolder, so it no longer
  spills over the next Theory subfolders.
- The existing heatmap and the note/string/fret tables keep using the
  aggregate `fretboard_cell_stats` table.
- `GET /api/fretboard/stats` keeps `last`, `avg` and `count` (all runs,
  including legacy rows) and now also returns `summary`, `runs` and `by_mode`.
- Runs before 2026-11-17 only have duration + normalized: they still count in
  the heatmap and the overall average, but not in the new detail tables.

### Manager → History → Details

- Each item keeps its original single line. On hover or keyboard focus it
  opens the app's dark tooltip with one group per line: counters, metronome
  BPM, drums BPM, other tools and tool settings.
- The detail header shows `Resumed N×` and the abandon reason when present.
- The area label falls back to the snapshot stored with the session if the area
  was deleted.
- No extra request: `/api/sessions/{id}` already returns all of these fields.

### Main screen → section tracks and videos

- Hovering a `.audio-trigger` row (local song, backing track or web audio) or a
  YouTube link opens the same dark `.ex-tip` panel used by the assistant.
- `GET /api/media/stats?kind=audio|youtube&ref=…` returns one aggregate per
  track: plays, listened time, last play, loops, completed and the last A-B
  range. Loops, completed and A-B are audio-only; YouTube has no playback API.
  It is read-only; no table or row is written.
- Aggregation is by `kind` + `ref`, so a track shared by two exercises shows the
  combined history. YouTube time is marked approximate (`measured = 0`).
- A track without rows shows `No media plays recorded yet.`

## SQL cookbook (for future visualizations)

BPM progression of a catalog exercise:

```sql
SELECT date(s.started_at, 'localtime') AS day,
       MAX(i.metro_bpm_end) AS bpm
FROM routine_session_items i
JOIN routine_sessions s ON s.id = i.session_id
WHERE i.catalog_exercise_id = ? AND i.metro_bpm_end > 0
GROUP BY day ORDER BY day;
```

Time by tool (sum of real clock time):

```sql
SELECT SUM(CASE WHEN used_metronome = 1 THEN elapsed_seconds ELSE 0 END) AS metro,
       SUM(CASE WHEN used_drums = 1 THEN elapsed_seconds ELSE 0 END) AS drums,
       SUM(CASE WHEN used_audio = 1 OR used_youtube = 1 THEN elapsed_seconds ELSE 0 END) AS backing,
       SUM(CASE WHEN used_fretboard = 1 THEN elapsed_seconds ELSE 0 END) AS trainer
FROM routine_session_items i
JOIN routine_sessions s ON s.id = i.session_id
WHERE s.started_at >= ?;
```

Restart / effort shape per material:

```sql
SELECT MAX(i.catalog_name) AS material,
       AVG(i.play_count) AS plays,
       AVG(i.reset_count + i.repeat_count) AS restarts,
       AVG(i.pause_count) AS pauses
FROM routine_session_items i
WHERE i.catalog_exercise_id IS NOT NULL
GROUP BY i.catalog_exercise_id
HAVING COUNT(*) >= 2
ORDER BY restarts DESC;
```

Listening vs playing inside an item:

```sql
SELECT i.name, i.elapsed_seconds AS clock_seconds,
       COALESCE(SUM(m.played_seconds), 0) AS listening_seconds
FROM routine_session_items i
LEFT JOIN media_plays m
  ON m.session_id = i.session_id AND m.item_position = i.position
GROUP BY i.id ORDER BY i.session_id DESC, i.position;
```

Trouble spots from A-B marks:

```sql
SELECT ref, ab_start, ab_end, COUNT(*) AS times, SUM(played_seconds) AS seconds
FROM media_plays
WHERE ab_end > ab_start AND measured = 1
GROUP BY ref, ab_start, ab_end
ORDER BY times DESC, seconds DESC;
```

Trainer evolution by mode:

```sql
SELECT date(played_at, 'localtime') AS day, mode,
       ROUND(SUM(hits) * 1.0 / NULLIF(SUM(hits + misses), 0), 3) AS accuracy,
       ROUND(AVG(avg_ms), 0) AS avg_ms,
       MAX(best_streak) AS best_streak
FROM fretboard_stats
WHERE hits + misses > 0
GROUP BY day, mode ORDER BY day;
```

Weak cells over time:

```sql
SELECT string_no, fret, mode,
       SUM(hits) AS hits, SUM(misses) AS misses,
       SUM(time_ms) AS total_ms
FROM fretboard_cell_attempts
GROUP BY string_no, fret, mode
HAVING misses > hits
ORDER BY misses DESC;
```

Session overhead (pauses, coffee, listening while parked):

```sql
SELECT date(started_at, 'localtime') AS day,
       SUM(real_seconds) AS practice,
       SUM(wall_seconds) AS sitting,
       SUM(MAX(0, wall_seconds - real_seconds)) AS overhead
FROM routine_sessions
WHERE status = 'finished'
GROUP BY day ORDER BY day;
```

Path progress:

```sql
SELECT i.catalog_path_id,
       COUNT(DISTINCT i.catalog_exercise_id) AS materials,
       SUM(i.elapsed_seconds) AS seconds,
       MAX(date(s.started_at, 'localtime')) AS last_day
FROM routine_session_items i
JOIN routine_sessions s ON s.id = i.session_id
WHERE i.catalog_path_id IS NOT NULL
GROUP BY i.catalog_path_id;
```

Abandoned vs finished:

```sql
SELECT status, COALESCE(NULLIF(abandon_reason, ''), 'n/a') AS reason,
       COUNT(*) AS sessions, ROUND(AVG(resume_count), 2) AS resumes
FROM routine_sessions
GROUP BY status, reason;
```

## What is NOT captured (and why)

- **BPM curve inside an item**: only start/end are stored. Add a `bpm_set`
  event later if the curve matters; the event table is ready for it.
- **YouTube exact playback time**: the iframe has no playback API. The row is
  stored with `measured = 0` and wall time; exclude it from precise listening
  totals if needed.
- **Timer fallback after a reload**: `played_seconds` can equal the planned
  time for a `timed` completion (pre-existing behaviour). `elapsed_seconds` is
  the honest clock.
- **Manual ratings, goals, free-practice tags**: they need user input. Out of
  scope by design.
- **`created_at` for old slots**: left `NULL` instead of pretending they were
  all created on migration day.

## Volume and retention

A typical session writes 1 session row, N item rows, ~0–3 media rows, ~0–2
trainer rows, ~10–30 events and (only in trainer runs) ~20–60 raw cell
attempts. A year of daily practice is tens of thousands of small rows; SQLite
handles it comfortably. No rotation is applied. If it ever matters, roll the
raw attempts into daily aggregates and delete the oldest detail.

## Migration and backup

- Pre-migration snapshot: `backups/practice-pre-stats-20261117.db`
  (`VACUUM INTO`, `PRAGMA integrity_check = ok`, same counts as the original:
  3 sessions, 30 items, 14 trainer runs, 138 cells, 19 slots).
- Migration is additive: `ALTER TABLE ... ADD COLUMN` and
  `CREATE TABLE IF NOT EXISTS`. No `DROP`, no mass `UPDATE`.
- `init_db()` now takes the daily backup **before** `executescript` /
  `_migrate` (it used to run after the migration).
- Old clients keep working: `_apply_item()` writes the new columns only when
  the key is present in the payload, and old rows get the column defaults.
- The real `practice.db` migrates on the next server start; all tests were run
  against `test_stats.db` and `practice_sandbox.db`.

## Sandbox demo data

`python sandbox_seed.py` fills `practice_sandbox.db` with a rich demo: routine
and free sessions across 120 days, telemetry on every item, 70 detailed trainer
runs plus raw cell attempts, 60 media plays, practice events and extra
metronome/drum presets. It **never touches `practice.db`** and takes a verified
backup in `backups/practice_sandbox-pre-demo-*.db` before writing.

- Default: 110 sessions (at least 20 free) and 70 trainer runs.
- `--force` replaces the previous demo cleanly; without it an existing demo is
  kept.
- The normal sandbox launcher keeps the database. `ReiniciarPracticeHubSandbox.vbs`
  /fresh recreates it from `practice.db` and therefore wipes the demo.
- After seeding, refresh the browser; if the sandbox server was started before
  a code update, relaunch it with `IniciarPracticeHubSandbox.vbs` (the database
  is kept).

## Verification performed

- `python -m py_compile db.py server.py`.
- `node --check` on `stats.js`, `players.js`, `fretboard.js`,
  `practiceAssistant.js`.
- Migration on a copy: columns and new tables present, counts unchanged,
  `integrity_check = ok`.
- Old-style and new-style session payloads written and read back.
- Duplicate `run_uid` / `play_uid` / `event_uid` ignored (idempotency).
- HTTP smoke test against `test_stats.db`: `/api/health`,
  `/api/sessions/stats`, `/api/practice/events`, `/api/media/plays`,
  `/api/fretboard/stats`, `/api/fretboard/cell`, session start → item → finish,
  and `/api/export/items.csv`.
- Visual check with headless Edge at 1400×1200 and 430×900: History details
  opened on a session with telemetry, and the trainer Statistics panel opened
  with five seeded runs. On mobile the four cell tables stack vertically; the
  History table keeps its inherited horizontal scroll. The Recent runs pager
  was checked on pages 1/3 and 2/3. Screenshots inspected; **zero console
  errors** (manager.html now declares the same data-URI favicon as index.html).
- Not tested: the real `practice.db` migration (deliberately left for the next
  app start).

## Future visualization ideas

- BPM progression per material and per area.
- Time split by tool (metronome / drums / backing track / trainer).
- Restart and pause heat: materials that always need three attempts.
- A-B trouble spots: the exact bars that get looped the most.
- Trainer accuracy and response time by mode, string and fret, over time.
- Playing vs listening time inside one material.
- Path progress and "new material I have not practised yet".
- Session overhead and the real effect of resuming a parked routine.
- Adherence against a weekly goal (needs a small goals-history table first).
