# Guitar maintenance (setup + string change log)

Additive module for tracking guitars and the strings changed on each one.

## Data model

- `guitars`: integer PK, unique name (`COLLATE NOCASE`), type, string count,
  hex colour, active flag, notes, timestamps.
- `string_changes`: integer PK, guitar FK, local calendar `date` (`YYYY-MM-DD`),
  `type` (`full` / `partial`), JSON array of changed strings, optional model,
  notes, timestamps.
- The string model history is derived from `string_changes`; there is no
  separate history table.
- `guitars.active=0` means archived. Archived guitars keep their history but do
  not appear in the app widget and cannot receive new changes.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/guitars?include_archived=1` | List guitars with derived last-full / last-partial data |
| POST | `/api/guitars` | Create guitar |
| PUT / DELETE | `/api/guitars/<id>` | Update / delete (delete refused with 409 once history exists) |
| GET / POST | `/api/guitars/<id>/changes?limit=&offset=` | List / add string changes |
| PUT / DELETE | `/api/string-changes/<id>` | Edit / delete a change |
| GET | `/api/string-changes?from=&to=&active_only=1&limit=&offset=` | Calendar feed (paged) |
| GET | `/api/string-models` | Autocomplete suggestions, most recent first |

Server-side rules: no future dates; a full change requires a model and rejects
strings; a partial change needs at least one string but not all of them; the
guitar must be active for a new change; string count is locked after the first
change; names are unique case-insensitively.

## UI

- `Manager > Guitars`: active/archived lists, setup form, archive/restore,
  delete (only without history), history edit/delete, and a change dialog with
  model autocomplete. History is paged 15 changes at a time (`limit` / `offset`
  on the API).
- Section widget `Guitar Maintenance` (`widget` item, key `guitars`): cards with
  per-guitar status and a monthly mini-calendar. Solid dot = full set, ring =
  partial; each dot uses the guitar colour. A day shows its details below the
  calendar; `+N` appears after three dots. The widget is added to any section
  from `Manager > Sections`, just like the metronome or chord transposer.
