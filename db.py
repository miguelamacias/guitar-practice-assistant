"""Guitar Practice Hub - servidor local (solo libreria estandar).

Sirve los archivos estaticos desde la carpeta padre (Guitar Resources) para que
los MP3 sigan accesibles, y expone una API REST sobre una base de datos SQLite.

Uso:  python server.py [puerto]
"""
import os
import io
import csv
import json
import random
import sqlite3
import functools
import re
import sys
import time
import mimetypes
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs, quote
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))          # ...\PracticeAssistant
ROOT = os.path.dirname(HERE)                                # ...\Guitar Resources
DB_PATH = os.path.join(HERE, 'practice.db')
SEED_PATH = os.path.join(HERE, 'seed.json')
DEFAULT_PORT = 8001

# Controlled vocabulary for slot areas (settings key AREAS_KEY). The defaults are
# never written to the DB until the user edits areas in the Manager.
AREAS_KEY = 'practice_areas'
DEFAULT_AREAS = [
    {'id': 'knowledge', 'label': 'Knowledge', 'position': 0},
    {'id': 'technique', 'label': 'Technique', 'position': 1},
    {'id': 'repertoire', 'label': 'Repertoire', 'position': 2},
    {'id': 'rhythm', 'label': 'Rhythm', 'position': 3},
    {'id': 'improvisation', 'label': 'Improvisation', 'position': 4},
    {'id': 'ear_training', 'label': 'Ear Training', 'position': 5},
]
AREA_ID_RE = re.compile(r'^[a-z0-9_]+$')

SCHEMA = """
CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    finish_kind TEXT DEFAULT '',
    finish_url TEXT DEFAULT '',
    finish_label TEXT DEFAULT '',
    finish_bpm INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS catalog_exercises (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
-- Learning paths: an ordered subset of the catalog. A slot may point at one
-- path and then only picks exercises from it.
CREATE TABLE IF NOT EXISTS catalog_paths (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS catalog_path_steps (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    path_id             INTEGER NOT NULL REFERENCES catalog_paths(id) ON DELETE CASCADE,
    catalog_exercise_id INTEGER NOT NULL REFERENCES catalog_exercises(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    note                TEXT NOT NULL DEFAULT '',
    UNIQUE(path_id, catalog_exercise_id)
);
CREATE INDEX IF NOT EXISTS idx_path_steps_path ON catalog_path_steps(path_id);
-- Resources belong to the exercise, not to the slot: a backing track or a
-- metronome preset travels with the material. One row per resource, shared by
-- as many exercises as need it.
CREATE TABLE IF NOT EXISTS resources (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL DEFAULT '',
    bpm         INTEGER NOT NULL DEFAULT 0,
    label       TEXT NOT NULL DEFAULT '',
    cfg         TEXT NOT NULL DEFAULT '',      -- per-kind settings (JSON)
    created_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS catalog_exercise_resources (
    catalog_exercise_id INTEGER NOT NULL REFERENCES catalog_exercises(id) ON DELETE CASCADE,
    resource_id         INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    UNIQUE(catalog_exercise_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_cat_res_exercise
    ON catalog_exercise_resources(catalog_exercise_id);
CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    duration_seconds INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    area_id TEXT NOT NULL DEFAULT '',
    catalog_exercise_id INTEGER REFERENCES catalog_exercises(id) ON DELETE SET NULL,
    catalog_path_id INTEGER REFERENCES catalog_paths(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    key TEXT DEFAULT '',
    subtitle TEXT DEFAULT '',
    accent_color TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    full_width INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS section_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    kind TEXT DEFAULT '',
    label TEXT DEFAULT '',
    tag TEXT DEFAULT '',
    url TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    meta_json TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS song_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    source_key TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL REFERENCES song_folders(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    position INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS lastfm_scrobbles (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    track TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    duration INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL DEFAULT 0,
    played_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lastfm_scrobbles_queue
    ON lastfm_scrobbles(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS fretboard_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duration_seconds INTEGER NOT NULL,
    normalized REAL NOT NULL,
    played_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fretboard_cell_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    string_no INTEGER NOT NULL,
    fret INTEGER NOT NULL,
    mode TEXT DEFAULT '',
    hits INTEGER DEFAULT 0,
    misses INTEGER DEFAULT 0,
    time_sum_ms INTEGER DEFAULT 0,
    UNIQUE(string_no, fret, mode)
);
CREATE TABLE IF NOT EXISTS song_info_cache (
    cache_key   TEXT PRIMARY KEY,
    query       TEXT NOT NULL,
    status      INTEGER NOT NULL,
    payload     TEXT,
    fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
    retry_after TEXT
);
CREATE TABLE IF NOT EXISTS routine_sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id        INTEGER,
    routine_name      TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'open',   -- open | finished | abandoned
    started_at        TEXT NOT NULL,                  -- UTC 'YYYY-MM-DD HH:MM:SS'
    finished_at       TEXT,
    planned_seconds   INTEGER NOT NULL DEFAULT 0,     -- sum of the routine durations
    practiced_seconds INTEGER NOT NULL DEFAULT 0,     -- timer consumed
    real_seconds      INTEGER NOT NULL DEFAULT 0,     -- sum of the exercise clocks
    wall_seconds      INTEGER NOT NULL DEFAULT 0,     -- start -> finish (coffee included)
    n_total           INTEGER NOT NULL DEFAULT 0,
    n_timed           INTEGER NOT NULL DEFAULT 0,
    n_untimed         INTEGER NOT NULL DEFAULT 0,
    n_skipped         INTEGER NOT NULL DEFAULT 0,
    n_done            INTEGER NOT NULL DEFAULT 0,     -- timed + untimed
    n_partial         INTEGER NOT NULL DEFAULT 0      -- skipped, but with clock time
);
CREATE TABLE IF NOT EXISTS routine_session_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES routine_sessions(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    exercise_id     INTEGER,
    name            TEXT NOT NULL DEFAULT '',
    state           TEXT NOT NULL DEFAULT 'pending',  -- pending | timed | untimed | skipped
    planned_seconds INTEGER NOT NULL DEFAULT 0,
    played_seconds  INTEGER NOT NULL DEFAULT 0,       -- timer consumed
    elapsed_seconds INTEGER NOT NULL DEFAULT 0,       -- clock (Play -> leave, pauses out)
    started_at      TEXT,                             -- when Play was pressed
    finished_at     TEXT,
    area_id         TEXT NOT NULL DEFAULT '',         -- snapshot of the slot area
    catalog_exercise_id INTEGER
                    REFERENCES catalog_exercises(id) ON DELETE SET NULL,
    catalog_name    TEXT NOT NULL DEFAULT '',         -- snapshot of the exercise name
    UNIQUE(session_id, position)
);
CREATE INDEX IF NOT EXISTS idx_routine_sessions_started ON routine_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_session_items_session ON routine_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_session_items_name ON routine_session_items(name);
CREATE INDEX IF NOT EXISTS idx_catalog_exercises_name ON catalog_exercises(name);
"""


def db_connect():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA foreign_keys=ON')
    conn.row_factory = sqlite3.Row
    return conn


def set_db_path(path):
    """Point every connection at another SQLite file.

    Used by `python server.py --sandbox` (practice_sandbox.db) so development
    and manual testing never write into practice.db.
    """
    global DB_PATH
    DB_PATH = path


# Tables of the session log (created in a later phase; these helpers already
# tolerate their absence so the debug endpoints work with any database).
SESSION_TABLES = ('routine_sessions', 'routine_session_items')

# How many daily copies of practice.db are kept next to it.
BACKUP_KEEP = 7


def backup_db(keep=BACKUP_KEEP):
    """Daily consolidated copy of practice.db (VACUUM INTO + rotation).

    Sandbox databases are skipped: they are throw-away by definition.
    """
    if not os.path.basename(DB_PATH).startswith('practice.db'):
        return None
    folder = os.path.dirname(DB_PATH)
    target = os.path.join(folder, 'practice-backup-%s.db' % datetime.now().strftime('%Y%m%d'))
    if os.path.exists(target):
        return target
    try:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute("VACUUM INTO '" + target.replace("'", "''") + "'")
            conn.commit()
        finally:
            conn.close()
    except sqlite3.Error:
        return None
    files = sorted(f for f in os.listdir(folder)
                   if f.startswith('practice-backup-') and f.endswith('.db'))
    for name in files[:-max(1, int(keep))]:
        try:
            os.remove(os.path.join(folder, name))
        except OSError:
            pass
    return target


def _csv_local(value):
    """DB UTC text -> local 'YYYY-MM-DD HH:MM:SS' for spreadsheets."""
    if not value:
        return ''
    try:
        dt = datetime.strptime(str(value), '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
        return dt.astimezone().strftime('%Y-%m-%d %H:%M:%S')
    except ValueError:
        return str(value)


def export_csv(conn, what='sessions'):
    """CSV text (semicolon separated, Excel friendly) for a manual backup."""
    buf = io.StringIO()
    out = csv.writer(buf, delimiter=';', lineterminator='\n')
    if what == 'items':
        out.writerow(['session_id', 'started_at', 'routine', 'position', 'exercise', 'state',
                      'planned_seconds', 'played_seconds', 'area_id', 'catalog_exercise_id',
                      'catalog_name'])
        rows = conn.execute(
            'SELECT i.session_id, s.started_at, s.routine_name, i.position, i.name, i.state,'
            ' i.planned_seconds, i.played_seconds, i.area_id, i.catalog_exercise_id,'
            ' i.catalog_name'
            ' FROM routine_session_items i JOIN routine_sessions s ON s.id = i.session_id'
            ' ORDER BY s.started_at, i.position').fetchall()
        for r in rows:
            out.writerow([r['session_id'], _csv_local(r['started_at']), r['routine_name'],
                          r['position'], r['name'], r['state'],
                          r['planned_seconds'], r['played_seconds'],
                          r['area_id'] or '', r['catalog_exercise_id'],
                          r['catalog_name'] or ''])
    else:
        out.writerow(['id', 'routine', 'status', 'started_at', 'finished_at', 'planned_seconds',
                      'practiced_seconds', 'n_total', 'n_timed', 'n_untimed', 'n_skipped'])
        for r in conn.execute('SELECT * FROM routine_sessions ORDER BY started_at, id').fetchall():
            out.writerow([r['id'], r['routine_name'], r['status'], _csv_local(r['started_at']),
                          _csv_local(r['finished_at']), r['planned_seconds'],
                          r['practiced_seconds'], r['n_total'], r['n_timed'],
                          r['n_untimed'], r['n_skipped']])
    return buf.getvalue()



def table_counts(conn, tables=SESSION_TABLES):
    """Rows per table; None when the table does not exist yet."""
    out = {}
    for t in tables:
        try:
            out[t] = conn.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0]
        except sqlite3.Error:
            out[t] = None
    return out


def clear_tables(conn, tables=SESSION_TABLES):
    """Deletes every row of the given tables (sandbox debugging only)."""
    cleared = {}
    for t in tables:
        try:
            cleared[t] = conn.execute('DELETE FROM ' + t).rowcount
        except sqlite3.Error:
            cleared[t] = None
    conn.commit()
    return cleared


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.executescript(SCHEMA)
    _migrate(conn)
    seed_if_empty(conn)
    conn.commit()
    conn.close()
    backup_db()


def _migrate(conn):
    """Anade columnas nuevas a tablas existentes (bases de datos antiguas)."""
    scols = [r[1] for r in conn.execute('PRAGMA table_info(sections)').fetchall()]
    if 'full_width' not in scols:
        conn.execute('ALTER TABLE sections ADD COLUMN full_width INTEGER DEFAULT 0')
    if 'lane' not in scols:
        # Dashboard lane 1..3 (1-2 = left column, 3 = right rail).
        conn.execute('ALTER TABLE sections ADD COLUMN lane INTEGER NOT NULL DEFAULT 0')
    # Existing sections get a starting lane; the user can move them afterwards.
    # The first two (short ones: Tools, Rhythm) go to the right rail, the rest
    # alternate between the two left lanes. Idempotent: only rows still
    # unassigned are touched.
    conn.execute(
        'UPDATE sections SET lane = CASE WHEN position < 2 THEN 3 ELSE 1 + (position % 2) END'
        ' WHERE lane NOT IN (1, 2, 3)'
    )
    # Session log: wall clock and per-exercise clock (added after 3-b).
    def add_cols(table, pairs):
        try:
            have = [r[1] for r in conn.execute('PRAGMA table_info(' + table + ')').fetchall()]
        except sqlite3.Error:
            return
        if not have:
            return
        for name, ddl in pairs:
            if name not in have:
                conn.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, name, ddl))

    add_cols('routine_session_items', [('elapsed_seconds', 'INTEGER NOT NULL DEFAULT 0'),
                                       ('started_at', 'TEXT')])
    add_cols('routine_sessions', [('real_seconds', 'INTEGER NOT NULL DEFAULT 0'),
                                  ('wall_seconds', 'INTEGER NOT NULL DEFAULT 0'),
                                  ('n_done', 'INTEGER NOT NULL DEFAULT 0'),
                                  ('n_partial', 'INTEGER NOT NULL DEFAULT 0')])
    # Slots get an area and a pointer into the global exercise catalog; session
    # items keep a snapshot of both so the history survives renames/deletions.
    # Those columns are nullable-with-NULL-default, the only shape SQLite accepts
    # for ADD COLUMN ... REFERENCES.
    add_cols('exercises', [('area_id', "TEXT NOT NULL DEFAULT ''"),
                           ('catalog_exercise_id',
                            'INTEGER REFERENCES catalog_exercises(id) ON DELETE SET NULL'),
                           ('catalog_path_id',
                            'INTEGER REFERENCES catalog_paths(id) ON DELETE SET NULL')])
    # Catalog hygiene: archiving instead of deleting, and a classification hint
    # (the area that counts in the statistics is still the slot's).
    add_cols('catalog_exercises', [('archived', 'INTEGER NOT NULL DEFAULT 0'),
                                   ('area_id', "TEXT NOT NULL DEFAULT ''")])
    add_cols('routine_session_items', [
        ('area_id', "TEXT NOT NULL DEFAULT ''"),
        ('catalog_exercise_id',
         'INTEGER REFERENCES catalog_exercises(id) ON DELETE SET NULL'),
        ('catalog_name', "TEXT NOT NULL DEFAULT ''"),
    ])
    for stmt in ('CREATE INDEX IF NOT EXISTS idx_exercises_area ON exercises(area_id)',
                 'CREATE INDEX IF NOT EXISTS idx_exercises_path ON exercises(catalog_path_id)',
                 'CREATE INDEX IF NOT EXISTS idx_session_items_area'
                 ' ON routine_session_items(area_id)',
                 'CREATE INDEX IF NOT EXISTS idx_session_items_catalog'
                 ' ON routine_session_items(catalog_exercise_id)'):
        try:
            conn.execute(stmt)
        except sqlite3.Error:
            pass
    rcols = [r[1] for r in conn.execute('PRAGMA table_info(routines)').fetchall()]
    for rname, rddl in [('finish_kind', "TEXT DEFAULT ''"), ('finish_url', "TEXT DEFAULT ''"),
                        ('finish_label', "TEXT DEFAULT ''"), ('finish_bpm', 'INTEGER DEFAULT 0')]:
        if rname not in rcols:
            conn.execute('ALTER TABLE routines ADD COLUMN %s %s' % (rname, rddl))
    # fretboard_cell_stats: `mode` joins the unique key so each mode keeps its own
    # timings (the grade uses a different speed scale per mode). Old rows -> ''.
    ccols = [r[1] for r in conn.execute('PRAGMA table_info(fretboard_cell_stats)').fetchall()]
    if ccols and 'mode' not in ccols:
        conn.execute('ALTER TABLE fretboard_cell_stats RENAME TO fretboard_cell_stats_old')
        conn.execute(
            'CREATE TABLE fretboard_cell_stats ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT, string_no INTEGER NOT NULL, fret INTEGER NOT NULL, '
            "mode TEXT DEFAULT '', hits INTEGER DEFAULT 0, misses INTEGER DEFAULT 0, "
            'time_sum_ms INTEGER DEFAULT 0, UNIQUE(string_no, fret, mode))'
        )
        conn.execute(
            'INSERT INTO fretboard_cell_stats(string_no, fret, mode, hits, misses, time_sum_ms) '
            "SELECT string_no, fret, '', hits, misses, time_sum_ms FROM fretboard_cell_stats_old"
        )
        conn.execute('DROP TABLE fretboard_cell_stats_old')
        conn.commit()


def seed_if_empty(conn):
    count = conn.execute('SELECT COUNT(*) FROM routines').fetchone()[0]
    if count > 0:
        return
    if not os.path.isfile(SEED_PATH):
        return
    with open(SEED_PATH, encoding='utf-8') as f:
        seed = json.load(f)

    rpos = 0
    for r in seed.get('routines', []):
        cur = conn.execute(
            'INSERT INTO routines(name, description, is_active, position) VALUES(?,?,?,?)',
            (r.get('name', ''), r.get('description', ''), 1 if r.get('is_active') else 0, rpos),
        )
        rid = cur.lastrowid
        for i, e in enumerate(r.get('exercises', [])):
            conn.execute(
                'INSERT INTO exercises(routine_id, name, duration_seconds, position) '
                'VALUES(?,?,?,?)',
                (rid, e.get('name', ''), int(e.get('duration_seconds', 0)), i),
            )
        rpos += 1

    fpos = 0
    for key, info in seed.get('songSources', {}).items():
        folder = info.get('folder', '')
        name = os.path.basename(folder) or folder
        cur = conn.execute(
            'INSERT INTO song_folders(name, rel_path, source_key, position) VALUES(?,?,?,?)',
            (name, folder, key, fpos),
        )
        fid = cur.lastrowid
        for i, s in enumerate(info.get('songs', [])):
            conn.execute(
                'INSERT INTO songs(folder_id, title, rel_path, position) VALUES(?,?,?,?)',
                (fid, s.get('title', ''), s.get('rel_path', ''), i),
            )
        fpos += 1


# ------------------------- API (lectura) -------------------------

def _resource_labels(conn):
    """(full, short) label maps for section items, from one query.

    `full` is "Section: TAG - label", what the Manager picker and the exercise's
    resource line show (the section gives context there). `short` is
    "TAG - label", exactly the text the item itself shows and the one used when
    you click it in its section: that is what the player and the scrobbler want.

    The label stored on a resource is only a snapshot taken when the exercise was
    saved, so it misses later edits of the section/item (the tag above all).
    The live section data wins, so already saved resources get the full title.
    """
    full, short = {}, {}
    try:
        rows = conn.execute(
            'SELECT s.title AS sec_title, i.kind, i.label, i.tag, i.url '
            'FROM section_items i JOIN sections s ON s.id = i.section_id'
        ).fetchall()
    except Exception:  # noqa: BLE001
        return full, short
    for r in rows:
        url = (r['url'] or '').strip()
        if not url:
            continue
        tag = (r['tag'] or '').strip()
        label = (r['label'] or '').strip()
        base = label or tag
        if not base:
            continue
        text = base if (not tag or base.startswith(tag)) else (tag + ' - ' + base)
        full_text = ((r['sec_title'] + ': ') if r['sec_title'] else '') + text
        keys = [url]
        if r['kind'] == 'song':
            # Same encoding the panel uses (encodeURIComponent) for /api/media.
            keys.append('/api/media?path=' + quote(url, safe="!'()*"))
        for key in keys:
            full[key] = full_text
            short[key] = text
    return full, short


def _label_for(labels, url, fallback):
    return labels.get((url or '').strip()) or (fallback or '')


def _with_labels(resources, labels, short_labels=None):
    """Same list with the labels refreshed from the live section data.

    `label` keeps the section prefix (the resource line of the exercise shows
    it) and `label_short` is the item's own text, which is what the player and
    the scrobbler display, exactly like clicking the item in its section.
    """
    out = []
    for r in resources:
        url = (r.get('url') or '').strip()
        label = labels.get(url) or (r.get('label') or '')
        out.append({
            'kind': r.get('kind') or '',
            'url': url,
            'bpm': int(r.get('bpm') or 0),
            'label': label,
            'label_short': (short_labels or {}).get(url) or label,
            'cfg': r.get('cfg') if isinstance(r.get('cfg'), dict) else {},
        })
    return out


def _exercise_payload(e, labels, catalog=None, areas_map=None, paths=None,
                      resources_map=None, short_labels=None):
    """Exercise dict for the app: `recursos` plus the legacy single-resource keys.

    `catalog` is a {id: {id, name, description}} map, `areas_map` an
    {area_id: label} map, `paths` an {id: name} map of the learning paths and
    `resources_map` a {catalog_exercise_id: [resource]} map, all resolved once
    per call by the caller.

    Resources belong to the catalog exercise: the slot only says *which*
    exercise is played, so the list travels with the material and rotating a
    slot brings its own backing track along.
    """
    cid = e['catalog_exercise_id'] if 'catalog_exercise_id' in e.keys() else None
    pid = e['catalog_path_id'] if 'catalog_path_id' in e.keys() else None
    aid = (e['area_id'] if 'area_id' in e.keys() else '') or ''
    res = _with_labels(((resources_map or {}).get(cid) or []) if cid is not None else [],
                       labels, short_labels)
    first = res[0] if res else {'kind': '', 'url': '', 'bpm': 0, 'label': ''}
    return {
        'id': e['id'], 'nombre': e['name'],
        'tiempo': e['duration_seconds'],
        'recursos': res,
        'recurso_kind': first['kind'], 'recurso_url': first['url'],
        'recurso_bpm': first['bpm'], 'recurso_label': first['label'],
        'area_id': aid,
        'area': (areas_map or {}).get(aid, ''),
        'catalog_exercise_id': cid,
        'catalog_exercise': (catalog or {}).get(cid) if cid is not None else None,
        'catalog_path_id': pid,
        'catalog_path': ({'id': pid, 'name': (paths or {}).get(pid, '')}
                         if pid is not None else None),
    }


def api_state(conn):
    row = conn.execute(
        'SELECT id, name, description, finish_kind, finish_url, finish_label, finish_bpm '
        'FROM routines WHERE is_active=1 ORDER BY id LIMIT 1'
    ).fetchone()
    if row is None:
        row = conn.execute(
            'SELECT id, name, description, finish_kind, finish_url, finish_label, finish_bpm '
            'FROM routines ORDER BY id LIMIT 1'
        ).fetchone()

    active = None
    if row is not None:
        rid, name, desc = row['id'], row['name'], row['description']
        labels, short_labels = _resource_labels(conn)
        exs = conn.execute(
            'SELECT id, name, duration_seconds, area_id, catalog_exercise_id, '
            'catalog_path_id '
            'FROM exercises WHERE routine_id=? ORDER BY position, id',
            (rid,),
        ).fetchall()
        catalog = _catalog_map(conn, [e['catalog_exercise_id'] for e in exs])
        resources_map = _resource_rows(conn, [e['catalog_exercise_id'] for e in exs])
        areas_map = area_map(conn)
        paths = path_names(conn)
        active = {
            'id': rid,
            'nombre': name,
            'descripcion': desc,
            'finish_kind': row['finish_kind'] or '',
            'finish_url': row['finish_url'] or '',
            'finish_label': _label_for(labels, row['finish_url'], row['finish_label']),
            'finish_bpm': row['finish_bpm'] or 0,
            'ejercicios': [_exercise_payload(e, labels, catalog, areas_map, paths,
                                             resources_map, short_labels)
                           for e in exs],
        }

    sources = {}
    folders = conn.execute(
        'SELECT id, rel_path, source_key FROM song_folders ORDER BY position, id'
    ).fetchall()
    for f in folders:
        songs = conn.execute(
            'SELECT title, rel_path FROM songs WHERE folder_id=? ORDER BY position, id',
            (f['id'],),
        ).fetchall()
        lst = sources.setdefault(f['source_key'], [])
        for s in songs:
            lst.append({'carpeta': f['rel_path'], 'nombre': s['title'], 'url': '/' + s['rel_path']})

    return {'activeRoutine': active, 'songSources': sources}


def api_routines(conn):
    rows = conn.execute(
        'SELECT r.id, r.name, r.description, r.is_active, '
        "COALESCE((SELECT SUM(duration_seconds) FROM exercises e WHERE e.routine_id=r.id), 0) AS total_seconds "
        'FROM routines r ORDER BY r.position, r.id'
    ).fetchall()
    return [
        {'id': r['id'], 'name': r['name'], 'description': r['description'],
         'is_active': bool(r['is_active']), 'total_seconds': r['total_seconds']}
        for r in rows
    ]


# ------------------------- API (escritura: gestor) -------------------------

def _routine_full(conn, rid):
    r = conn.execute(
        'SELECT id, name, description, is_active, finish_kind, finish_url, finish_label, finish_bpm '
        'FROM routines WHERE id=?', (rid,)
    ).fetchone()
    if r is None:
        return None
    labels, short_labels = _resource_labels(conn)
    exs = conn.execute(
        'SELECT id, name, duration_seconds, position, '
        'area_id, catalog_exercise_id, catalog_path_id FROM exercises '
        'WHERE routine_id=? ORDER BY position, id',
        (rid,),
    ).fetchall()
    catalog = _catalog_map(conn, [e['catalog_exercise_id'] for e in exs])
    resources_map = _resource_rows(conn, [e['catalog_exercise_id'] for e in exs])
    paths = path_names(conn)
    out_exs = []
    for e in exs:
        res = _with_labels(((resources_map.get(e['catalog_exercise_id'])) or [])
                           if e['catalog_exercise_id'] is not None else [], labels,
                           short_labels)
        first = res[0] if res else {'kind': '', 'url': '', 'bpm': 0, 'label': ''}
        cid = e['catalog_exercise_id']
        pid = e['catalog_path_id']
        out_exs.append({
            'id': e['id'], 'name': e['name'],
            'duration_seconds': e['duration_seconds'], 'position': e['position'],
            'resources': res,
            'resource_kind': first['kind'], 'resource_url': first['url'],
            'resource_bpm': first['bpm'], 'resource_label': first['label'],
            'area_id': e['area_id'] or '',
            'catalog_exercise_id': cid,
            'catalog_exercise': catalog.get(cid) if cid is not None else None,
            'catalog_path_id': pid,
            'catalog_path': ({'id': pid, 'name': paths.get(pid, '')}
                             if pid is not None else None),
        })
    return {
        'id': r['id'], 'name': r['name'], 'description': r['description'],
        'is_active': bool(r['is_active']),
        'finish_kind': r['finish_kind'] or '', 'finish_url': r['finish_url'] or '',
        'finish_label': _label_for(labels, r['finish_url'], r['finish_label']),
        'finish_bpm': r['finish_bpm'] or 0,
        'exercises': out_exs,
    }


def create_routine(conn, data):
    name = (data.get('name') or 'New Routine').strip()
    desc = data.get('description') or ''
    count = conn.execute('SELECT COUNT(*) FROM routines').fetchone()[0]
    pos = conn.execute('SELECT COALESCE(MAX(position), -1) + 1 FROM routines').fetchone()[0]
    active = 1 if count == 0 else 0
    cur = conn.execute(
        'INSERT INTO routines(name, description, is_active, position) VALUES(?,?,?,?)',
        (name, desc, active, pos),
    )
    conn.commit()
    return _routine_full(conn, cur.lastrowid)


def update_routine(conn, rid, data):
    if conn.execute('SELECT id FROM routines WHERE id=?', (rid,)).fetchone() is None:
        return None
    if data.get('name') is not None:
        conn.execute("UPDATE routines SET name=?, updated_at=datetime('now') WHERE id=?",
                     (data['name'], rid))
    if data.get('description') is not None:
        conn.execute("UPDATE routines SET description=?, updated_at=datetime('now') WHERE id=?",
                     (data['description'], rid))
    if data.get('finish_kind') is not None:
        conn.execute('UPDATE routines SET finish_kind=? WHERE id=?', (data['finish_kind'], rid))
    if data.get('finish_url') is not None:
        conn.execute('UPDATE routines SET finish_url=? WHERE id=?', (data['finish_url'], rid))
    if data.get('finish_label') is not None:
        conn.execute('UPDATE routines SET finish_label=? WHERE id=?', (data['finish_label'], rid))
    if data.get('finish_bpm') is not None:
        conn.execute('UPDATE routines SET finish_bpm=? WHERE id=?', (int(data['finish_bpm'] or 0), rid))
    conn.commit()
    return _routine_full(conn, rid)


def delete_routine(conn, rid):
    conn.execute('DELETE FROM routines WHERE id=?', (rid,))
    conn.commit()
    if conn.execute('SELECT COUNT(*) FROM routines WHERE is_active=1').fetchone()[0] == 0:
        first = conn.execute('SELECT id FROM routines ORDER BY position, id LIMIT 1').fetchone()
        if first is not None:
            conn.execute('UPDATE routines SET is_active=1 WHERE id=?', (first['id'],))
            conn.commit()
    return {'deleted': rid}


def activate_routine(conn, rid):
    conn.execute('UPDATE routines SET is_active=0')
    conn.execute("UPDATE routines SET is_active=1, updated_at=datetime('now') WHERE id=?", (rid,))
    conn.commit()
    return {'active': rid}


def duplicate_routine(conn, rid):
    r = conn.execute('SELECT name, description, finish_kind, finish_url, finish_label,'
                     ' finish_bpm FROM routines WHERE id=?', (rid,)).fetchone()
    if r is None:
        return None
    name = (r['name'] or 'Routine') + ' - copy'
    desc = r['description'] or ''
    pos = conn.execute('SELECT COALESCE(MAX(position), -1) + 1 FROM routines').fetchone()[0]
    cur = conn.execute(
        'INSERT INTO routines(name, description, is_active, position, finish_kind,'
        ' finish_url, finish_label, finish_bpm) VALUES(?,?,0,?,?,?,?,?)',
        (name, desc, pos, r['finish_kind'] or '', r['finish_url'] or '',
         r['finish_label'] or '', r['finish_bpm'] or 0),
    )
    nid = cur.lastrowid
    exs = conn.execute(
        'SELECT name, duration_seconds, position, area_id, catalog_exercise_id,'
        ' catalog_path_id FROM exercises WHERE routine_id=? ORDER BY position, id', (rid,)
    ).fetchall()
    for e in exs:
        # The copy points at the same catalog exercises, so it also gets their
        # resources: that is what makes a duplicated routine usable as is.
        conn.execute(
            'INSERT INTO exercises(routine_id, name, duration_seconds, position, area_id,'
            ' catalog_exercise_id, catalog_path_id) VALUES(?,?,?,?,?,?,?)',
            (nid, e['name'], e['duration_seconds'], e['position'], e['area_id'] or '',
             e['catalog_exercise_id'], e['catalog_path_id']),
        )
    conn.commit()
    return _routine_full(conn, nid)


def _clean_cfg(cfg):
    """Widget state saved with a resource (metronome / drums).

    Kept flat and small: strings, numbers and booleans only. Unknown or empty
    values are dropped, so a hand-crafted payload cannot store junk.
    """
    if not isinstance(cfg, dict):
        return {}
    out = {}
    for k, v in cfg.items():
        key = str(k)[:16]
        if not key:
            continue
        if isinstance(v, bool):
            out[key] = v
        elif isinstance(v, (int, float)):
            out[key] = v
        elif isinstance(v, str):
            v = v.strip()[:24]
            if v:
                out[key] = v
    return out


def _clean_resources(arr):
    out = []
    for r in (arr or []):
        if not isinstance(r, dict):
            continue
        kind = (r.get('kind') or '').strip()
        if not kind:
            continue
        try:
            bpm = int(r.get('bpm') or 0)
        except Exception:  # noqa: BLE001
            bpm = 0
        out.append({
            'kind': kind,
            'url': r.get('url') or '',
            'bpm': bpm,
            'label': r.get('label') or '',
            'cfg': _clean_cfg(r.get('cfg')),
        })
    # Only keep the settings object when it actually holds something: an empty one
    # means "nothing forced", and dropping it keeps the JSON readable.
    for item in out:
        if not item['cfg']:
            del item['cfg']
    return out


def create_exercise(conn, rid, data):
    if conn.execute('SELECT id FROM routines WHERE id=?', (rid,)).fetchone() is None:
        return None
    meta, err = _slot_meta(conn, data)
    if err:
        return {'error': err}
    name = (data.get('name') or 'New Exercise').strip()
    dur = int(data.get('duration_seconds') or 0)
    pos = conn.execute(
        'SELECT COALESCE(MAX(position), -1) + 1 FROM exercises WHERE routine_id=?', (rid,)
    ).fetchone()[0]
    conn.execute(
        'INSERT INTO exercises(routine_id, name, duration_seconds, position, '
        'area_id, catalog_exercise_id, catalog_path_id) VALUES(?,?,?,?,?,?,?)',
        (rid, name, dur, pos,
         meta.get('area_id', ''), meta.get('catalog_exercise_id'),
         meta.get('catalog_path_id')),
    )
    conn.commit()
    return _routine_full(conn, rid)


def update_exercise(conn, eid, data):
    if conn.execute('SELECT id FROM exercises WHERE id=?', (eid,)).fetchone() is None:
        return None
    meta, err = _slot_meta(conn, data)
    if err:
        return {'error': err}
    if 'area_id' in meta:
        conn.execute('UPDATE exercises SET area_id=? WHERE id=?', (meta['area_id'], eid))
    if 'catalog_exercise_id' in meta:
        conn.execute('UPDATE exercises SET catalog_exercise_id=? WHERE id=?',
                     (meta['catalog_exercise_id'], eid))
    if 'catalog_path_id' in meta:
        conn.execute('UPDATE exercises SET catalog_path_id=? WHERE id=?',
                     (meta['catalog_path_id'], eid))
    if data.get('name') is not None:
        conn.execute('UPDATE exercises SET name=? WHERE id=?', (data['name'], eid))
    if data.get('duration_seconds') is not None:
        conn.execute('UPDATE exercises SET duration_seconds=? WHERE id=?',
                     (int(data['duration_seconds']), eid))

    if 'resources' in data:
        # Compatibility shim: resources belong to the catalog exercise, so a
        # stale client still posting them to the slot lands on the right row.
        cid = conn.execute('SELECT catalog_exercise_id FROM exercises WHERE id=?',
                           (eid,)).fetchone()['catalog_exercise_id']
        if cid is not None:
            set_exercise_resources(conn, cid, data.get('resources'))
    conn.commit()
    return {'updated': eid}


def delete_exercise(conn, eid):
    conn.execute('DELETE FROM exercises WHERE id=?', (eid,))
    conn.commit()
    return {'deleted': eid}


def reorder_exercises(conn, rid, order):
    for idx, eid in enumerate(order):
        conn.execute('UPDATE exercises SET position=? WHERE id=? AND routine_id=?',
                     (idx, int(eid), rid))
    conn.commit()
    return _routine_full(conn, rid)


# ------------------------- API (secciones, items, media, dialogos) -------------------------

WIDGETS = [
    {'key': 'metronome', 'name': 'Metronome'},
    {'key': 'drums', 'name': 'Drum Machine'},
    {'key': 'notes', 'name': 'Notes'},
    {'key': 'delay', 'name': 'Delay Calculator'},
    {'key': 'transposer', 'name': 'Chord Transposer'},
    {'key': 'song', 'name': 'Song Info (BPM/Key)'},
]
AUDIO_EXTS = ('.mp3', '.m4a', '.wav', '.ogg', '.flac')
COLORS = ['#ff9800', '#2196f3', '#4caf50', '#f44336', '#e91e63',
          '#9c27b0', '#009688', '#3f51b5', '#ffc107', '#00bcd4']


def _scan_folder(path):
    songs = []
    try:
        for root, dirs, files in os.walk(path):
            dirs.sort()
            for fn in sorted(files):
                if fn.lower().endswith(AUDIO_EXTS):
                    fp = os.path.join(root, fn)
                    songs.append({'path': fp, 'rel': os.path.relpath(fp, path),
                                  'title': os.path.splitext(fn)[0]})
    except Exception:  # noqa: BLE001
        pass
    return songs


def _is_media_allowed(conn, target):
    ap = os.path.abspath(target)
    root = os.path.abspath(ROOT)
    if ap == root or ap.startswith(root + os.sep):
        return True
    try:
        rows = conn.execute('SELECT kind, url FROM section_items').fetchall()
    except Exception:  # noqa: BLE001
        return False
    for r in rows:
        url = (r['url'] or '').strip()
        if not url:
            continue
        if r['kind'] == 'folder':
            fp = os.path.abspath(url)
            if ap == fp or ap.startswith(fp + os.sep):
                return True
        elif r['kind'] in ('song', 'audio'):
            if not url.lower().startswith(('http://', 'https://', 'file://')):
                if ap == os.path.abspath(url):
                    return True
    return False


def api_sections(conn):
    secs = conn.execute(
        'SELECT id, title, subtitle, accent_color, position, full_width, lane FROM sections'
        ' ORDER BY lane, position, id'
    ).fetchall()
    out = []
    for s in secs:
        items = conn.execute(
            'SELECT id, kind, label, tag, url, position, meta_json FROM section_items '
            'WHERE section_id=? ORDER BY position, id', (s['id'],)
        ).fetchall()
        out.append({
            'id': s['id'], 'title': s['title'], 'description': s['subtitle'],
            'color': s['accent_color'], 'position': s['position'], 'full_width': s['full_width'],
            'lane': s['lane'],
            'items': [
                {'id': i['id'], 'kind': i['kind'], 'label': i['label'], 'tag': i['tag'],
                 'url': i['url'], 'position': i['position'],
                 'meta': json.loads(i['meta_json'] or '{}')}
                for i in items
            ],
        })
    return out


def create_section(conn, data):
    title = (data.get('title') or 'New Section').strip()
    desc = data.get('description') or ''
    color = data.get('color') or COLORS[0]
    fw = 1 if data.get('full_width') else 0
    try:
        lane = int(data.get('lane') or 1)
    except (TypeError, ValueError):
        lane = 1
    if lane not in (1, 2, 3):
        lane = 1
    pos = conn.execute('SELECT COALESCE(MAX(position), -1) + 1 FROM sections').fetchone()[0]
    cur = conn.execute(
        'INSERT INTO sections(title, subtitle, accent_color, position, full_width, lane)'
        ' VALUES(?,?,?,?,?,?)',
        (title, desc, color, pos, fw, lane),
    )
    conn.commit()
    return {'id': cur.lastrowid}


def update_section(conn, sid, data):
    if conn.execute('SELECT id FROM sections WHERE id=?', (sid,)).fetchone() is None:
        return None
    if data.get('title') is not None:
        conn.execute('UPDATE sections SET title=? WHERE id=?', (data['title'], sid))
    if data.get('description') is not None:
        conn.execute('UPDATE sections SET subtitle=? WHERE id=?', (data['description'], sid))
    if data.get('color') is not None:
        conn.execute('UPDATE sections SET accent_color=? WHERE id=?', (data['color'], sid))
    if data.get('full_width') is not None:
        conn.execute('UPDATE sections SET full_width=? WHERE id=?', (1 if data['full_width'] else 0, sid))
    if data.get('lane') is not None:
        try:
            lane = int(data['lane'])
        except (TypeError, ValueError):
            lane = 1
        conn.execute('UPDATE sections SET lane=? WHERE id=?', (lane if lane in (1, 2, 3) else 1, sid))
    conn.commit()
    return {'updated': sid}


def delete_section(conn, sid):
    conn.execute('DELETE FROM sections WHERE id=?', (sid,))
    conn.commit()
    return {'deleted': sid}


def reorder_sections(conn, order=None, layout=None):
    """Persists the section order.

    `layout` (dashboard) wins when present: [{id, lane, position}, ...] in one
    transaction, so a half-applied layout is impossible. `order` keeps the old
    flat list working for the Manager (no lanes involved).
    """
    if layout:
        applied = 0
        for row in layout:
            try:
                sid = int(row.get('id'))
            except (TypeError, ValueError, AttributeError):
                continue
            try:
                lane = int(row.get('lane') or 1)
            except (TypeError, ValueError):
                lane = 1
            if lane not in (1, 2, 3):
                lane = 1
            try:
                pos = int(row.get('position') or 0)
            except (TypeError, ValueError):
                pos = 0
            conn.execute('UPDATE sections SET lane=?, position=? WHERE id=?',
                         (lane, max(0, pos), sid))
            applied += 1
        conn.commit()
        return {'ok': True, 'updated': applied}
    for idx, sid in enumerate(order or []):
        try:
            sid = int(sid)
        except (TypeError, ValueError):
            continue
        conn.execute('UPDATE sections SET position=? WHERE id=?', (idx, sid))
    conn.commit()
    return {'ok': True}


def create_section_item(conn, sid, data):
    if conn.execute('SELECT id FROM sections WHERE id=?', (sid,)).fetchone() is None:
        return None
    kind = data.get('kind') or 'external'
    label = data.get('label') or ''
    tag = data.get('tag') or ''
    url = data.get('url') or ''
    meta = data.get('meta') or {}
    if kind == 'folder' and url:
        meta['songs'] = _scan_folder(url)
    pos = conn.execute(
        'SELECT COALESCE(MAX(position), -1) + 1 FROM section_items WHERE section_id=?', (sid,)
    ).fetchone()[0]
    conn.execute(
        'INSERT INTO section_items(section_id, kind, label, tag, url, position, meta_json) '
        'VALUES(?,?,?,?,?,?,?)',
        (sid, kind, label, tag, url, pos, json.dumps(meta, ensure_ascii=False)),
    )
    conn.commit()
    return {'ok': True}


def update_item(conn, iid, data):
    row = conn.execute('SELECT kind, url, meta_json FROM section_items WHERE id=?', (iid,)).fetchone()
    if row is None:
        return None
    kind = data.get('kind', row['kind'])
    url = data.get('url', row['url'])
    if data.get('label') is not None:
        conn.execute('UPDATE section_items SET label=? WHERE id=?', (data['label'], iid))
    if data.get('tag') is not None:
        conn.execute('UPDATE section_items SET tag=? WHERE id=?', (data['tag'], iid))
    if data.get('kind') is not None:
        conn.execute('UPDATE section_items SET kind=? WHERE id=?', (kind, iid))
    if data.get('url') is not None:
        conn.execute('UPDATE section_items SET url=? WHERE id=?', (url, iid))
    if data.get('meta') is not None:
        conn.execute('UPDATE section_items SET meta_json=? WHERE id=?',
                     (json.dumps(data['meta'], ensure_ascii=False), iid))
    elif kind == 'folder' and url and url != row['url']:
        conn.execute('UPDATE section_items SET meta_json=? WHERE id=?',
                     (json.dumps({'songs': _scan_folder(url)}, ensure_ascii=False), iid))
    conn.commit()
    return {'updated': iid}


def delete_item(conn, iid):
    conn.execute('DELETE FROM section_items WHERE id=?', (iid,))
    conn.commit()
    return {'deleted': iid}


def reorder_items(conn, sid, order):
    for idx, iid in enumerate(order):
        conn.execute('UPDATE section_items SET position=? WHERE id=? AND section_id=?',
                     (idx, int(iid), sid))
    conn.commit()
    return {'ok': True}


def refresh_item_folder(conn, iid):
    row = conn.execute('SELECT kind, url, meta_json FROM section_items WHERE id=?', (iid,)).fetchone()
    if row is None or row['kind'] != 'folder':
        return None
    old = json.loads(row['meta_json'] or '{}').get('songs', [])
    titles = {s.get('path'): s.get('title') for s in old}
    new = _scan_folder(row['url'] or '')
    for s in new:
        if titles.get(s['path']):
            s['title'] = titles[s['path']]
    conn.execute('UPDATE section_items SET meta_json=? WHERE id=?',
                 (json.dumps({'songs': new}, ensure_ascii=False), iid))
    conn.commit()
    return {'songs': new}


# ------------------------- Areas + exercise catalog -------------------------

def clean_areas(value):
    """settings value -> (areas, error). Missing or empty means the defaults."""
    if value is None or value == '':
        return [dict(a) for a in DEFAULT_AREAS], None
    try:
        data = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError):
        return None, 'invalid_json'
    if not isinstance(data, list):
        return None, 'invalid_json'
    out, seen = [], set()
    for idx, item in enumerate(data):
        if not isinstance(item, dict):
            return None, 'invalid_json'
        aid = str(item.get('id') or '').strip()
        label = str(item.get('label') or '').strip()
        if not AREA_ID_RE.match(aid) or aid in seen:
            return None, 'invalid_area_id'
        if not label:
            return None, 'invalid_label'
        try:
            pos = int(item.get('position', idx))
        except (TypeError, ValueError):
            return None, 'invalid_position'
        seen.add(aid)
        out.append({'id': aid, 'label': label[:80], 'position': pos})
    out.sort(key=lambda a: (a['position'], a['id']))
    return out, None


def areas(conn):
    """Area list in display order (DEFAULT_AREAS when nothing is stored)."""
    got, _err = clean_areas(get_setting(conn, AREAS_KEY))
    return got if got is not None else [dict(a) for a in DEFAULT_AREAS]


def area_map(conn):
    """{area_id: label} for labels shown in the app."""
    return {a['id']: a['label'] for a in areas(conn)}


def areas_in_use(conn):
    """{area_id: [{exercise_id, routine_id, name}]} for slots with an area."""
    out = {}
    for r in conn.execute(
        "SELECT id, routine_id, name, area_id FROM exercises WHERE area_id <> ''"
    ).fetchall():
        out.setdefault(r['area_id'], []).append({
            'exercise_id': r['id'], 'routine_id': r['routine_id'],
            'name': r['name'] or '',
        })
    return out


# ------------------------- Resources (catalog side) ------------------------

def _resource_rows(conn, cids):
    """{catalog_exercise_id: [resource, ...]} in one query.

    A resource carries its own settings (`cfg`): the metronome preset of an
    exercise is part of the exercise's material, so it travels with it.
    """
    clean = sorted({int(c) for c in cids if c is not None})
    out = {c: [] for c in clean}
    if not clean:
        return out
    marks = ','.join('?' * len(clean))
    rows = conn.execute(
        'SELECT l.catalog_exercise_id AS cid, r.id, r.kind, r.url, r.bpm, r.label, r.cfg'
        ' FROM catalog_exercise_resources l'
        ' JOIN resources r ON r.id = l.resource_id'
        ' WHERE l.catalog_exercise_id IN (' + marks + ')'
        ' ORDER BY l.catalog_exercise_id, l.position, r.id', clean).fetchall()
    for r in rows:
        cfg = {}
        if r['cfg']:
            try:
                cfg = json.loads(r['cfg'])
            except (TypeError, ValueError):
                cfg = {}
            if not isinstance(cfg, dict):
                cfg = {}
        out.setdefault(r['cid'], []).append({
            'id': r['id'], 'kind': r['kind'] or '', 'url': r['url'] or '',
            'bpm': r['bpm'] or 0, 'label': r['label'] or '', 'cfg': cfg,
        })
    return out


def _cfg_text(cfg):
    """Settings stored as canonical JSON, or '' when there is nothing forced."""
    clean = _clean_cfg(cfg)
    return json.dumps(clean, ensure_ascii=False, sort_keys=True) if clean else ''


def set_exercise_resources(conn, cid, resources):
    """Replaces the resource list of one catalog exercise.

    Rows are shared: an identical resource (same kind, url, bpm, label and
    settings) already in the table is reused, so two exercises pointing at the
    same backing track do not duplicate it.
    """
    clean = _clean_resources(resources)
    conn.execute('DELETE FROM catalog_exercise_resources WHERE catalog_exercise_id=?', (cid,))
    for pos, res in enumerate(clean):
        cfg_text = _cfg_text(res.get('cfg'))
        row = conn.execute(
            'SELECT id FROM resources WHERE kind=? AND url=? AND bpm=? AND label=? AND cfg=?',
            (res['kind'], res['url'], res['bpm'], res['label'], cfg_text)).fetchone()
        if row is not None:
            rid = row['id']
        else:
            rid = conn.execute(
                'INSERT INTO resources(kind, url, bpm, label, cfg) VALUES(?,?,?,?,?)',
                (res['kind'], res['url'], res['bpm'], res['label'], cfg_text)).lastrowid
        conn.execute('INSERT OR IGNORE INTO catalog_exercise_resources'
                     '(catalog_exercise_id, resource_id, position) VALUES(?,?,?)',
                     (cid, rid, pos))
    drop_orphan_resources(conn)
    conn.commit()


def drop_orphan_resources(conn):
    """Removes resources nobody points at (they would only accumulate)."""
    conn.execute('DELETE FROM resources WHERE id NOT IN'
                 ' (SELECT resource_id FROM catalog_exercise_resources)')


def _catalog_dict(row):
    keys = row.keys()
    return {'id': row['id'], 'name': row['name'] or '',
            'description': row['description'] or '',
            'archived': bool(row['archived']) if 'archived' in keys else False,
            'area_id': (row['area_id'] or '') if 'area_id' in keys else '',
            'created_at': row['created_at'], 'updated_at': row['updated_at']}


def _catalog_map(conn, ids):
    """{id: {id, name, description}} for the given ids (None entries dropped)."""
    clean = sorted({int(i) for i in ids if i is not None})
    if not clean:
        return {}
    marks = ','.join('?' * len(clean))
    rows = conn.execute(
        'SELECT id, name, description FROM catalog_exercises WHERE id IN (' + marks + ')',
        clean).fetchall()
    return {r['id']: {'id': r['id'], 'name': r['name'] or '',
                      'description': r['description'] or ''} for r in rows}


def get_catalog_exercise(conn, cid):
    row = conn.execute(
        'SELECT id, name, description, archived, area_id, created_at, updated_at'
        ' FROM catalog_exercises WHERE id=?', (cid,)).fetchone()
    if row is None:
        return None
    item = _catalog_dict(row)
    item['resources'] = _resource_rows(conn, [cid]).get(cid, [])
    return item


def catalog_exists(conn, cid):
    return conn.execute('SELECT 1 FROM catalog_exercises WHERE id=?',
                        (cid,)).fetchone() is not None


def list_catalog(conn, q=''):
    """Catalog plus derived metrics, aggregated in SQL (no per-row queries)."""
    query = (q or '').strip()
    like = '%' + query + '%'
    rows = conn.execute(
        'SELECT c.id, c.name, c.description, c.archived, c.area_id, c.created_at,'
        ' c.updated_at,'
        ' (SELECT COUNT(*) FROM routine_session_items i'
        '   WHERE i.catalog_exercise_id = c.id AND i.elapsed_seconds > 0) AS practices,'
        ' (SELECT COALESCE(SUM(i.elapsed_seconds), 0) FROM routine_session_items i'
        '   WHERE i.catalog_exercise_id = c.id) AS seconds,'
        " (SELECT MAX(date(s.started_at, 'localtime'))"
        '   FROM routine_session_items i JOIN routine_sessions s ON s.id = i.session_id'
        '   WHERE i.catalog_exercise_id = c.id) AS last_practiced_on'
        ' FROM catalog_exercises c'
        " WHERE (? = '' OR c.name LIKE ?)"
        ' ORDER BY c.name COLLATE NOCASE, c.id', (query, like)).fetchall()
    slots = {}
    for r in conn.execute(
        'SELECT DISTINCT i.catalog_exercise_id AS cid,'
        ' COALESCE(e.name, i.name) AS slot_name'
        ' FROM routine_session_items i LEFT JOIN exercises e ON e.id = i.exercise_id'
        ' WHERE i.catalog_exercise_id IS NOT NULL ORDER BY slot_name').fetchall():
        slots.setdefault(r['cid'], []).append(r['slot_name'] or '')
    used = {}
    for r in conn.execute(
        'SELECT DISTINCT catalog_exercise_id AS cid, area_id'
        ' FROM routine_session_items'
        " WHERE catalog_exercise_id IS NOT NULL AND area_id <> ''"
        ' ORDER BY area_id').fetchall():
        used.setdefault(r['cid'], []).append(r['area_id'])
    out = []
    labels = area_map(conn)
    order = {a['id']: a.get('position', 0) for a in areas(conn)}
    resources_map = _resource_rows(conn, [r['id'] for r in rows])
    for r in rows:
        item = _catalog_dict(r)
        item.update({
            'practices': r['practices'] or 0,
            'seconds': r['seconds'] or 0,
            'last_practiced_on': r['last_practiced_on'] or '',
            'slots': slots.get(r['id'], []),
            'areas': used.get(r['id'], []),
            # Classification for browsing: never used for statistics.
            'area': labels.get(item['area_id'], ''),
            'resources': resources_map.get(r['id'], []),
        })
        out.append(item)
    # Area first (in the user's order), then name: the lists and the assistant
    # picker can group without sorting again. Unclassified exercises go last.
    out.sort(key=lambda i: (order.get(i['area_id'], 999) if i['area_id'] else 1000,
                            (i['name'] or '').lower()))
    return out


def catalog_detail(conn, cid):
    """One catalog exercise with the slots using it and its latest practices."""
    item = get_catalog_exercise(conn, cid)
    if item is None:
        return None
    used = [{'exercise_id': r['id'], 'routine_id': r['routine_id'],
             'routine_name': r['routine_name'] or '', 'name': r['name'] or ''}
            for r in conn.execute(
                'SELECT e.id, e.routine_id, r.name AS routine_name, e.name'
                ' FROM exercises e JOIN routines r ON r.id = e.routine_id'
                ' WHERE e.catalog_exercise_id=? ORDER BY r.position, e.position, e.id',
                (cid,)).fetchall()]
    recent = [{'session_id': r['session_id'], 'started_at': _db_to_iso(r['started_at']),
               'exercise_id': r['exercise_id'], 'name': r['name'] or '',
               'area_id': r['area_id'] or '', 'seconds': r['elapsed_seconds'] or 0}
              for r in conn.execute(
                  'SELECT i.session_id, s.started_at, i.exercise_id, i.name, i.area_id,'
                  ' i.elapsed_seconds'
                  ' FROM routine_session_items i'
                  ' JOIN routine_sessions s ON s.id = i.session_id'
                  ' WHERE i.catalog_exercise_id=? AND i.elapsed_seconds > 0'
                  ' ORDER BY s.started_at DESC LIMIT 10', (cid,)).fetchall()]
    area_ids = []
    for r in recent:
        if r['area_id'] and r['area_id'] not in area_ids:
            area_ids.append(r['area_id'])
    item['used_in'] = used
    item['areas'] = area_ids
    item['recent'] = recent
    return item


def _catalog_fields(conn, data):
    """Validated fields of a catalog exercise -> (fields, error).

    `archived` and `area_id` are optional: the keys only appear when the caller
    sends them, so saving a name never touches either flag.
    """
    name = str(data.get('name') or '').strip()
    if not name or len(name) > 200:
        return None, 'invalid_name'
    desc = str(data.get('description') or '').strip()
    if len(desc) > 2000:
        return None, 'invalid_description'
    out = {'name': name, 'description': desc}
    if 'archived' in data:
        out['archived'] = 1 if data.get('archived') else 0
    if 'area_id' in data:
        aid = str(data.get('area_id') or '').strip()
        if aid and aid not in area_map(conn):
            return None, 'unknown_area'
        out['area_id'] = aid
    return out, None


def create_catalog_exercise(conn, data):
    fields, err = _catalog_fields(conn, data)
    if err:
        return {'error': err}
    cur = conn.execute('INSERT INTO catalog_exercises(name, description, archived,'
                       ' area_id) VALUES(?, ?, ?, ?)',
                       (fields['name'], fields['description'],
                        fields.get('archived', 0), fields.get('area_id', '')))
    conn.commit()
    cid = cur.lastrowid
    if 'resources' in data:
        set_exercise_resources(conn, cid, data.get('resources'))
    return get_catalog_exercise(conn, cid)


def update_catalog_exercise(conn, cid, data):
    row = conn.execute('SELECT name, description FROM catalog_exercises WHERE id=?',
                       (cid,)).fetchone()
    if row is None:
        return None
    # Partial update: a client that only sends `resources` (the assistant saves
    # the BPM and the widget settings while practising) keeps the rest as is.
    merged = {'name': row['name'] or '', 'description': row['description'] or ''}
    for key in ('name', 'description', 'archived', 'area_id'):
        if key in data:
            merged[key] = data[key]
    fields, err = _catalog_fields(conn, merged)
    if err:
        return {'error': err}
    sets = ['name=?', 'description=?', "updated_at=datetime('now')"]
    args = [fields['name'], fields['description']]
    if 'archived' in fields:
        sets.insert(2, 'archived=?')
        args.append(fields['archived'])
    if 'area_id' in fields:
        sets.insert(2, 'area_id=?')
        args.append(fields['area_id'])
    args.append(cid)
    conn.execute('UPDATE catalog_exercises SET ' + ', '.join(sets) + ' WHERE id=?', args)
    conn.commit()
    # Only when the caller sends the list: a rename must never wipe resources.
    if 'resources' in data:
        set_exercise_resources(conn, cid, data.get('resources'))
    return get_catalog_exercise(conn, cid)


def delete_catalog_exercise(conn, cid):
    if not catalog_exists(conn, cid):
        return None
    slots = conn.execute('SELECT COUNT(*) n FROM exercises WHERE catalog_exercise_id=?',
                         (cid,)).fetchone()['n']
    # ON DELETE SET NULL clears the slot pointers; item snapshots keep their
    # catalog_name, so the history stays readable.
    conn.execute('DELETE FROM catalog_exercises WHERE id=?', (cid,))
    # The links went with the exercise (ON DELETE CASCADE); its exclusive
    # resources are now orphans.
    drop_orphan_resources(conn)
    conn.commit()
    return {'deleted': cid, 'slots_cleared': slots}


# ------------------------- Learning paths (catalog) ------------------------

def _path_dict(row):
    return {'id': row['id'], 'name': row['name'] or '',
            'description': row['description'] or '',
            'position': row['position'] or 0,
            'created_at': row['created_at'], 'updated_at': row['updated_at']}


def path_exists(conn, pid):
    return conn.execute('SELECT 1 FROM catalog_paths WHERE id=?',
                        (pid,)).fetchone() is not None


def path_names(conn):
    """{id: name} for the slot payloads (one query per call, like the catalog)."""
    return {r['id']: r['name'] or '' for r in
            conn.execute('SELECT id, name FROM catalog_paths').fetchall()}


def _path_steps_map(conn, ids=None):
    """{path_id: [step, ...]} in one query; `ids` limits the paths to load."""
    sql = ('SELECT s.path_id, s.catalog_exercise_id, s.position, s.note,'
           " COALESCE(c.name, '') AS name"
           ' FROM catalog_path_steps s'
           ' LEFT JOIN catalog_exercises c ON c.id = s.catalog_exercise_id')
    args = []
    if ids is not None:
        ids = [int(i) for i in ids]
        if not ids:
            return {}
        sql += ' WHERE s.path_id IN (' + ','.join('?' * len(ids)) + ')'
        args = ids
    sql += ' ORDER BY s.path_id, s.position, s.id'
    out = {}
    for r in conn.execute(sql, args).fetchall():
        out.setdefault(r['path_id'], []).append({
            'catalog_exercise_id': r['catalog_exercise_id'],
            'name': r['name'],
            'position': r['position'],
            'note': r['note'] or '',
        })
    return out


def get_path(conn, pid):
    row = conn.execute('SELECT * FROM catalog_paths WHERE id=?', (pid,)).fetchone()
    if row is None:
        return None
    item = _path_dict(row)
    item['steps'] = _path_steps_map(conn, [pid]).get(pid, [])
    item['slots'] = conn.execute('SELECT COUNT(*) n FROM exercises'
                                 ' WHERE catalog_path_id=?', (pid,)).fetchone()['n']
    return item


def list_paths(conn):
    """Every path with its ordered steps and how many slots use it."""
    rows = conn.execute('SELECT * FROM catalog_paths ORDER BY position, id').fetchall()
    steps = _path_steps_map(conn)
    used = {r['catalog_path_id']: r['n'] for r in conn.execute(
        'SELECT catalog_path_id, COUNT(*) n FROM exercises'
        ' WHERE catalog_path_id IS NOT NULL GROUP BY catalog_path_id').fetchall()}
    out = []
    for row in rows:
        item = _path_dict(row)
        item['steps'] = steps.get(row['id'], [])
        item['slots'] = used.get(row['id'], 0)
        out.append(item)
    return out


def _path_fields(data):
    """Validated name/description of a path -> (fields, error)."""
    name = str(data.get('name') or '').strip()
    if not name or len(name) > 120:
        return None, 'invalid_name'
    desc = str(data.get('description') or '').strip()
    if len(desc) > 2000:
        return None, 'invalid_description'
    return {'name': name, 'description': desc}, None


def create_path(conn, data):
    fields, err = _path_fields(data)
    if err:
        return {'error': err}
    pos = conn.execute('SELECT COALESCE(MAX(position), -1) + 1'
                       ' FROM catalog_paths').fetchone()[0]
    cur = conn.execute('INSERT INTO catalog_paths(name, description, position)'
                       ' VALUES(?,?,?)',
                       (fields['name'], fields['description'], pos))
    conn.commit()
    return get_path(conn, cur.lastrowid)


def update_path(conn, pid, data):
    if not path_exists(conn, pid):
        return None
    fields, err = _path_fields(data)
    if err:
        return {'error': err}
    conn.execute("UPDATE catalog_paths SET name=?, description=?,"
                 " updated_at=datetime('now') WHERE id=?",
                 (fields['name'], fields['description'], pid))
    conn.commit()
    return get_path(conn, pid)


def delete_path(conn, pid):
    if not path_exists(conn, pid):
        return None
    slots = conn.execute('SELECT COUNT(*) n FROM exercises WHERE catalog_path_id=?',
                         (pid,)).fetchone()['n']
    # ON DELETE CASCADE removes its steps and ON DELETE SET NULL clears the slots,
    # which fall back to the whole catalog.
    conn.execute('DELETE FROM catalog_paths WHERE id=?', (pid,))
    conn.commit()
    return {'deleted': pid, 'slots_cleared': slots}


def set_path_steps(conn, pid, steps):
    """Replaces the whole step list (the position is the order of the list)."""
    if not path_exists(conn, pid):
        return None
    if not isinstance(steps, list):
        return {'error': 'invalid_steps'}
    clean = []
    seen = set()
    for raw in steps:
        if not isinstance(raw, dict):
            return {'error': 'invalid_steps'}
        try:
            cid = int(raw.get('catalog_exercise_id'))
        except (TypeError, ValueError):
            return {'error': 'unknown_exercise'}
        if not catalog_exists(conn, cid):
            return {'error': 'unknown_exercise'}
        if cid in seen:
            return {'error': 'duplicate_step'}
        seen.add(cid)
        note = str(raw.get('note') or '').strip()
        if len(note) > 200:
            return {'error': 'invalid_note'}
        clean.append((cid, note))
    conn.execute('DELETE FROM catalog_path_steps WHERE path_id=?', (pid,))
    for pos, (cid, note) in enumerate(clean):
        conn.execute('INSERT INTO catalog_path_steps(path_id, catalog_exercise_id,'
                     ' position, note) VALUES(?,?,?,?)', (pid, cid, pos, note))
    conn.execute("UPDATE catalog_paths SET updated_at=datetime('now') WHERE id=?",
                 (pid,))
    conn.commit()
    return get_path(conn, pid)


def _slot_meta(conn, data):
    """Validates the area / catalog / path pointers of a slot payload.

    Returns ({only the keys present in `data`}, error). A catalog exercise that
    is not part of the chosen path is allowed on purpose: the Manager warns about
    it instead of blocking the save.
    """
    out = {}
    if 'area_id' in data:
        aid = str(data.get('area_id') or '').strip()
        if aid and aid not in area_map(conn):
            return None, 'unknown_area'
        out['area_id'] = aid
    if 'catalog_exercise_id' in data:
        raw = data.get('catalog_exercise_id')
        if raw in (None, '', 0, '0'):
            out['catalog_exercise_id'] = None
        else:
            try:
                cid = int(raw)
            except (TypeError, ValueError):
                return None, 'unknown_exercise'
            if not catalog_exists(conn, cid):
                return None, 'unknown_exercise'
            out['catalog_exercise_id'] = cid
    if 'catalog_path_id' in data:
        raw = data.get('catalog_path_id')
        if raw in (None, '', 0, '0'):
            out['catalog_path_id'] = None
        else:
            try:
                pid = int(raw)
            except (TypeError, ValueError):
                return None, 'unknown_path'
            if not path_exists(conn, pid):
                return None, 'unknown_path'
            out['catalog_path_id'] = pid
    return out, None


# ------------------------- Settings (clave/valor) -------------------------

def get_setting(conn, key):
    row = conn.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return row['value'] if row else None


def set_setting(conn, key, value):
    conn.execute('INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)', (key, value))
    conn.commit()
    return {'ok': True}


# ------------------------- Last.fm scrobble queue -------------------------

def lastfm_enqueue_scrobble(conn, item):
    """Insert one pending scrobble. Returns True when it was new."""
    cur = conn.execute(
        'INSERT OR IGNORE INTO lastfm_scrobbles'
        '(id, path, artist, track, album, duration, started_at, played_seconds) '
        'VALUES(?,?,?,?,?,?,?,?)',
        (item['id'], item.get('path', ''), item['artist'], item['track'],
         item['album'], int(item.get('duration') or 0),
         int(item.get('started_at') or 0), int(item.get('played_seconds') or 0)),
    )
    conn.commit()
    return cur.rowcount > 0


def lastfm_pending(conn, limit=50, now=None):
    if now is None:
        now = int(time.time())
    rows = conn.execute(
        'SELECT * FROM lastfm_scrobbles '
        "WHERE status IN ('pending','needs_auth') AND next_attempt_at<=? "
        'ORDER BY created_at, id LIMIT ?',
        (int(now), max(1, min(50, int(limit)))),
    ).fetchall()
    return [dict(r) for r in rows]


def lastfm_update_scrobble(conn, sid, status, error='', attempts=None, next_attempt_at=0):
    if attempts is None:
        conn.execute(
            "UPDATE lastfm_scrobbles SET status=?, last_error=?, next_attempt_at=?, "
            "sent_at=CASE WHEN ?='sent' THEN datetime('now') ELSE sent_at END "
            "WHERE id=?",
            (status, error or '', int(next_attempt_at or 0), status, sid),
        )
    else:
        conn.execute(
            "UPDATE lastfm_scrobbles SET status=?, last_error=?, attempts=?, "
            "next_attempt_at=?, sent_at=CASE WHEN ?='sent' THEN datetime('now') ELSE sent_at END "
            "WHERE id=?",
            (status, error or '', int(attempts), int(next_attempt_at or 0), status, sid),
        )
    conn.commit()


def lastfm_queue_counts(conn):
    out = {'pending': 0, 'sent': 0, 'ignored': 0, 'failed': 0, 'needs_auth': 0}
    for r in conn.execute('SELECT status, COUNT(*) AS n FROM lastfm_scrobbles GROUP BY status'):
        if r['status'] in out:
            out[r['status']] = int(r['n'])
    out['total'] = sum(out.values())
    return out


# ------------------------- Cache de "Song Info" (BPM/Key) -------------------------

def get_song_cache(conn, cache_key):
    row = conn.execute('SELECT * FROM song_info_cache WHERE cache_key=?', (cache_key,)).fetchone()
    return dict(row) if row else None


def set_song_cache(conn, cache_key, query, status, payload, retry_after=None):
    conn.execute(
        'INSERT OR REPLACE INTO song_info_cache'
        '(cache_key, query, status, payload, fetched_at, retry_after)'
        " VALUES(?,?,?,?,datetime('now'),?)",
        (cache_key, query or '', int(status),
         json.dumps(payload, ensure_ascii=False) if payload is not None else None,
         retry_after))
    conn.commit()
    return {'ok': True}


def add_fretboard_stat(conn, duration_seconds, normalized):
    try:
        dur = int(duration_seconds or 0)
        val = float(normalized or 0)
    except (TypeError, ValueError):
        return {'error': 'bad_data'}
    conn.execute(
        'INSERT INTO fretboard_stats(duration_seconds, normalized, played_at) VALUES(?,?,?)',
        (dur, val, datetime.now().isoformat(timespec='seconds')),
    )
    conn.commit()
    return {'ok': True}


def get_fretboard_stats(conn):
    rows = conn.execute(
        'SELECT normalized FROM fretboard_stats ORDER BY id DESC'
    ).fetchall()
    if not rows:
        return {'last': None, 'avg': None, 'count': 0}
    vals = [r['normalized'] for r in rows]
    return {
        'last': round(vals[0], 3),
        'avg': round(sum(vals) / len(vals), 3),
        'count': len(vals),
    }


def add_cell_attempt(conn, string_no, fret, kind, time_ms, mode=''):
    try:
        s = int(string_no)
        fr = int(fret)
        tm = int(time_ms or 0)
    except (TypeError, ValueError):
        return {'error': 'bad_data'}
    if tm < 0:
        tm = 0
    md = (mode or '').strip().lower()
    if md not in ('identify', 'locate', 'zone'):
        md = ''
    row = conn.execute(
        'SELECT id FROM fretboard_cell_stats WHERE string_no=? AND fret=? AND mode=?', (s, fr, md)
    ).fetchone()
    if row is None:
        hits = 1 if kind == 'hit' else 0
        misses = 1 if kind == 'miss' else 0
        conn.execute(
            'INSERT INTO fretboard_cell_stats(string_no, fret, mode, hits, misses, time_sum_ms) '
            'VALUES(?,?,?,?,?,?)',
            (s, fr, md, hits, misses, tm if kind == 'hit' else 0),
        )
    elif kind == 'hit':
        conn.execute(
            'UPDATE fretboard_cell_stats SET hits=hits+1, time_sum_ms=time_sum_ms+? WHERE id=?',
            (tm, row['id']),
        )
    else:
        conn.execute(
            'UPDATE fretboard_cell_stats SET misses=misses+1 WHERE id=?', (row['id'],)
        )
    conn.commit()
    return {'ok': True}


def get_cell_stats(conn):
    rows = conn.execute(
        'SELECT string_no, fret, mode, hits, misses, time_sum_ms FROM fretboard_cell_stats'
    ).fetchall()
    return [
        {'string_no': r['string_no'], 'fret': r['fret'], 'mode': r['mode'] or '',
         'hits': r['hits'], 'misses': r['misses'], 'time_sum_ms': r['time_sum_ms']}
        for r in rows
    ]



# ------------------------- Session log (practice history) -------------------------
# Everything is stored in UTC as 'YYYY-MM-DD HH:MM:SS'; the browser sends and
# receives ISO strings, so both conversions live here.

SESSION_STATES = ('pending', 'timed', 'untimed', 'skipped')


def _iso_to_db(value):
    """ISO 8601 from the browser (Z or offset) -> 'YYYY-MM-DD HH:MM:SS' UTC."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace('Z', '+00:00'))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def _db_to_iso(value):
    """'YYYY-MM-DD HH:MM:SS' UTC -> ISO with Z for the browser."""
    return (str(value).replace(' ', 'T') + 'Z') if value else None


def _utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None).strftime('%Y-%m-%d %H:%M:%S')


def _session_row(row):
    return {
        'id': row['id'],
        'routine_id': row['routine_id'],
        'routine_name': row['routine_name'] or '',
        'status': row['status'],
        'started_at': _db_to_iso(row['started_at']),
        'finished_at': _db_to_iso(row['finished_at']),
        'planned_seconds': row['planned_seconds'],
        'practiced_seconds': row['practiced_seconds'],
        'real_seconds': row['real_seconds'] if 'real_seconds' in row.keys() else 0,
        'wall_seconds': row['wall_seconds'] if 'wall_seconds' in row.keys() else 0,
        'n_total': row['n_total'],
        'n_timed': row['n_timed'],
        'n_untimed': row['n_untimed'],
        'n_skipped': row['n_skipped'],
        'n_done': row['n_done'] if 'n_done' in row.keys() else (row['n_timed'] + row['n_untimed']),
        'n_partial': row['n_partial'] if 'n_partial' in row.keys() else 0,
    }


def _session_items(conn, sid):
    rows = conn.execute(
        'SELECT position, exercise_id, name, state, planned_seconds, played_seconds,'
        ' elapsed_seconds, started_at, finished_at, area_id, catalog_exercise_id,'
        ' catalog_name'
        ' FROM routine_session_items WHERE session_id=? ORDER BY position', (sid,)).fetchall()
    return [{
        'position': r['position'],
        'exercise_id': r['exercise_id'],
        'name': r['name'],
        'state': r['state'],
        'planned_seconds': r['planned_seconds'],
        'played_seconds': r['played_seconds'],
        'elapsed_seconds': r['elapsed_seconds'] if 'elapsed_seconds' in r.keys() else 0,
        'started_at': _db_to_iso(r['started_at']),
        'finished_at': _db_to_iso(r['finished_at']),
        'area_id': (r['area_id'] if 'area_id' in r.keys() else '') or '',
        'catalog_exercise_id': r['catalog_exercise_id']
                              if 'catalog_exercise_id' in r.keys() else None,
        'catalog_name': (r['catalog_name'] if 'catalog_name' in r.keys() else '') or '',
    } for r in rows]


def _session_full(conn, sid):
    # Reading one session also settles the ones left open for too long: a stale
    # pointer in the browser must not resume a routine started yesterday.
    sweep_open_sessions(conn)
    row = conn.execute('SELECT * FROM routine_sessions WHERE id=?', (sid,)).fetchone()
    if row is None:
        return None
    out = _session_row(row)
    out['items'] = _session_items(conn, sid)
    return out


def _apply_item(conn, sid, item):
    """Writes one item state; False when the position does not exist.

    The area/exercise snapshot is captured from the slot on the first "touched"
    write (Play, mark done, any time), kept afterwards, and dropped when the
    client resets the item to zero. See docs/SLOTS_AND_EXERCISES_PLAN.md 6.1.
    """
    state = item.get('state') or 'pending'
    if state not in SESSION_STATES:
        return False
    position = int(item.get('position') or 0)
    played = max(0, int(item.get('played_seconds') or 0))
    elapsed = max(0, int(item.get('elapsed_seconds') or 0))
    started = _iso_to_db(item.get('started_at'))
    row = conn.execute(
        'SELECT exercise_id, area_id, catalog_exercise_id, catalog_name'
        ' FROM routine_session_items WHERE session_id=? AND position=?',
        (sid, position)).fetchone()
    if row is None:
        return False
    area_id = row['area_id'] or ''
    cid = row['catalog_exercise_id']
    cname = row['catalog_name'] or ''
    touched = started is not None or state != 'pending' or played > 0 or elapsed > 0
    if not touched:
        # Reset: the attempt is discarded, so is its snapshot.
        area_id, cid, cname = '', None, ''
    elif not area_id and cid is None and not cname and row['exercise_id']:
        slot = conn.execute(
            'SELECT area_id, catalog_exercise_id FROM exercises WHERE id=?',
            (row['exercise_id'],)).fetchone()
        if slot is not None:
            area_id = slot['area_id'] or ''
            cid = slot['catalog_exercise_id']
            if cid is not None:
                cat = conn.execute('SELECT name FROM catalog_exercises WHERE id=?',
                                   (cid,)).fetchone()
                cname = (cat['name'] if cat else '') or ''
    cur = conn.execute(
        'UPDATE routine_session_items SET state=?, played_seconds=?, elapsed_seconds=?,'
        ' started_at=?, finished_at=?, area_id=?, catalog_exercise_id=?, catalog_name=?'
        ' WHERE session_id=? AND position=?',
        (state, played, elapsed, started, _iso_to_db(item.get('finished_at')),
         area_id, cid, cname, sid, position))
    return cur.rowcount > 0


def _session_totals(conn, sid, finished_at, wall_override=None):
    """Item counters plus the wall clock for a session that stopped at `finished_at`.

    `wall_override` (seconds) wins when the client knows the real wall time: a
    routine can be parked on the welcome screen and resumed later, so the span
    between start and finish is not the time spent on it any more.
    """
    c = conn.execute(
        "SELECT COUNT(*) n, COALESCE(SUM(state='timed'),0) t, COALESCE(SUM(state='untimed'),0) u,"
        " COALESCE(SUM(state='skipped'),0) s, COALESCE(SUM(played_seconds),0) played,"
        " COALESCE(SUM(elapsed_seconds),0) real,"
        " COALESCE(SUM(CASE WHEN state='skipped' AND elapsed_seconds>0 THEN 1 ELSE 0 END),0) part"
        " FROM routine_session_items WHERE session_id=?", (sid,)).fetchone()
    row = conn.execute('SELECT started_at FROM routine_sessions WHERE id=?', (sid,)).fetchone()
    wall = 0
    if wall_override is not None:
        wall = max(0, int(wall_override))
    elif row and row['started_at'] and finished_at:
        try:
            start = datetime.strptime(str(row['started_at']), '%Y-%m-%d %H:%M:%S')
            end = datetime.strptime(str(finished_at), '%Y-%m-%d %H:%M:%S')
            wall = max(0, int((end - start).total_seconds()))
        except ValueError:
            wall = 0
    return c, wall


def _last_activity(conn, sid, fallback):
    """Moment the session really stopped: end of the last exercise that was played."""
    best = str(fallback or '')
    for r in conn.execute(
            'SELECT started_at, elapsed_seconds FROM routine_session_items'
            ' WHERE session_id=? AND started_at IS NOT NULL', (sid,)).fetchall():
        try:
            when = (datetime.strptime(str(r['started_at']), '%Y-%m-%d %H:%M:%S')
                    + timedelta(seconds=max(0, int(r['elapsed_seconds'] or 0))))
        except ValueError:
            continue
        when = when.strftime('%Y-%m-%d %H:%M:%S')
        if when > best:
            best = when
    return best or _utc_now()


def _abandon_session(conn, sid):
    """Closes a session that was left open. The wall clock stops at the last exercise."""
    row = conn.execute('SELECT started_at FROM routine_sessions WHERE id=?', (sid,)).fetchone()
    if row is None:
        return False
    end = _last_activity(conn, sid, row['started_at'])
    c, wall = _session_totals(conn, sid, end)
    conn.execute(
        "UPDATE routine_sessions SET status='abandoned', finished_at=?, n_timed=?, n_untimed=?,"
        " n_skipped=?, n_done=?, n_partial=?, practiced_seconds=?, real_seconds=?, wall_seconds=?"
        " WHERE id=?",
        (end, c['t'], c['u'], c['s'], c['t'] + c['u'], c['part'], c['played'], c['real'], wall, sid))
    conn.commit()
    return True


def sweep_open_sessions(conn, hours=8):
    """Auto-abandons the sessions left open for more than `hours` (no scheduler needed)."""
    limit = (datetime.now(timezone.utc).replace(tzinfo=None)
             - timedelta(hours=max(1, int(hours)))).strftime('%Y-%m-%d %H:%M:%S')
    rows = conn.execute("SELECT id FROM routine_sessions WHERE status='open' AND started_at < ?",
                        (limit,)).fetchall()
    for r in rows:
        _abandon_session(conn, r['id'])
    return len(rows)


def _close_session(conn, sid, finished_at, wall_seconds=None):
    """Recomputes the counters from the items and marks the session finished."""
    c, wall = _session_totals(conn, sid, finished_at, wall_seconds)
    conn.execute(
        "UPDATE routine_sessions SET status='finished', finished_at=?, n_total=?, n_timed=?,"
        " n_untimed=?, n_skipped=?, n_done=?, n_partial=?, practiced_seconds=?,"
        " real_seconds=?, wall_seconds=? WHERE id=?",
        (finished_at, c['n'], c['t'], c['u'], c['s'], c['t'] + c['u'], c['part'],
         c['played'], c['real'], wall, sid))
    conn.commit()


def start_session(conn, data):
    """Opens a session with a snapshot of the routine's exercises."""
    items = data.get('items') or []
    started = _iso_to_db(data.get('started_at')) or _utc_now()
    # A new routine means the previous one is over: any open row gets closed here,
    # and rows older than 8 h are swept too (a session left open never finishes).
    for row in conn.execute("SELECT id FROM routine_sessions WHERE status='open'").fetchall():
        _abandon_session(conn, row['id'])
    planned = sum(max(0, int(i.get('planned_seconds') or 0)) for i in items)
    cur = conn.execute(
        "INSERT INTO routine_sessions (routine_id, routine_name, status, started_at, planned_seconds, n_total)"
        " VALUES (?,?, 'open', ?, ?, ?)",
        (data.get('routine_id'), (data.get('routine_name') or '').strip(), started, planned, len(items)))
    sid = cur.lastrowid
    for pos, it in enumerate(items):
        conn.execute(
            'INSERT INTO routine_session_items (session_id, position, exercise_id, name, planned_seconds)'
            ' VALUES (?,?,?,?,?)',
            (sid, pos, it.get('exercise_id'), (it.get('name') or '').strip(),
             max(0, int(it.get('planned_seconds') or 0))))
    conn.commit()
    return _session_full(conn, sid)



def upsert_session_item(conn, sid, data):
    """Crash protection: one exercise changes state while the session is open."""
    row = conn.execute('SELECT status FROM routine_sessions WHERE id=?', (sid,)).fetchone()
    if row is None:
        return None
    if row['status'] != 'open':
        return {'error': 'session_closed'}
    if not _apply_item(conn, sid, data):
        return {'error': 'unknown_position'}
    conn.commit()
    return {'ok': True, 'session_id': sid,
            'position': int(data.get('position') or 0),
            'state': data.get('state') or 'pending'}


def finish_session(conn, sid, data):
    """Closes the session. The items sent here win (they are the final states)."""
    row = conn.execute('SELECT status FROM routine_sessions WHERE id=?', (sid,)).fetchone()
    if row is None:
        return None
    if row['status'] == 'finished':
        return _session_full(conn, sid)          # idempotent
    for item in (data.get('items') or []):
        _apply_item(conn, sid, item)
    # The client tracks the wall time of the routine (it can be parked on the
    # welcome screen), so its figure wins over the start -> finish span.
    wall = data.get('wall_seconds')
    try:
        wall = max(0, int(float(wall))) if wall is not None else None
    except (TypeError, ValueError):
        wall = None
    _close_session(conn, sid, _iso_to_db(data.get('finished_at')) or _utc_now(), wall)
    return _session_full(conn, sid)


def list_sessions(conn, date_from=None, date_to=None, limit=50, offset=0):
    sweep_open_sessions(conn)
    where = ' WHERE 1=1'
    args = []
    if date_from:
        where += ' AND started_at >= ?'
        args.append(_iso_to_db(date_from) or date_from)
    if date_to:
        where += ' AND started_at <= ?'
        args.append(_iso_to_db(date_to) or date_to)
    total = conn.execute('SELECT COUNT(*) n FROM routine_sessions' + where, args).fetchone()['n']
    limit = max(1, min(500, int(limit)))
    offset = max(0, int(offset))
    rows = conn.execute('SELECT * FROM routine_sessions' + where +
                        ' ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?',
                        args + [limit, offset]).fetchall()
    return {'sessions': [_session_row(r) for r in rows], 'total': total,
            'limit': limit, 'offset': offset}

def session_stats(conn, days=30, area_id=None, routine_id=None):
    """Aggregates for the History panel (one request, computed in SQL).

    `area_id` and `routine_id` only filter the derived pivot blocks (by_area,
    by_exercise, by_slot); the KPIs keep describing the whole window.
    """
    sweep_open_sessions(conn)
    days = max(1, min(365, int(days)))
    since = (datetime.now(timezone.utc).replace(tzinfo=None)
             - timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S')
    t = conn.execute(
        "SELECT COUNT(*) n, COALESCE(SUM(status='finished'),0) fin,"
        " COALESCE(SUM(status='abandoned'),0) ab, COALESCE(SUM(status='open'),0) op,"
        " COALESCE(SUM(practiced_seconds),0) secs, COALESCE(SUM(n_timed),0) nt,"
        " COALESCE(SUM(n_untimed),0) nu, COALESCE(SUM(n_skipped),0) ns,"
        " COALESCE(SUM(real_seconds),0) real, COALESCE(SUM(wall_seconds),0) wall,"
        " COALESCE(SUM(planned_seconds),0) planned, COALESCE(SUM(n_done),0) nd,"
        " COALESCE(SUM(n_partial),0) npart"
        " FROM routine_sessions WHERE started_at >= ?", (since,)).fetchone()
    daily = [{'date': r['d'], 'sessions': r['n'], 'seconds': r['sec']} for r in conn.execute(
        "SELECT date(started_at, 'localtime') d, COUNT(*) n, COALESCE(SUM(practiced_seconds),0) sec"
        " FROM routine_sessions WHERE status='finished' AND started_at >= ?"
        " GROUP BY d ORDER BY d", (since,)).fetchall()]
    # One row per calendar day with any session, whatever its status, counting
    # the real practice time: the activity calendar must light the same days
    # as the "days practised" figure below (real_seconds > 0).
    activity = [{'date': r['d'], 'sessions': r['n'], 'seconds': r['sec']} for r in conn.execute(
        "SELECT date(started_at, 'localtime') d, COUNT(*) n, COALESCE(SUM(real_seconds),0) sec"
        " FROM routine_sessions WHERE started_at >= ?"
        " GROUP BY d ORDER BY d", (since,)).fetchall()]
    # Days with real practice vs natural days of the window (never more days
    # than the log actually covers, so a 1 year range on a new log is honest).
    days_practised = conn.execute(
        "SELECT COUNT(DISTINCT date(started_at, 'localtime')) n FROM routine_sessions"
        " WHERE started_at >= ? AND real_seconds > 0", (since,)).fetchone()['n']
    first = conn.execute('SELECT MIN(started_at) f FROM routine_sessions').fetchone()['f']
    days_total = days
    if first:
        try:
            span = (datetime.now(timezone.utc).replace(tzinfo=None).date()
                    - datetime.strptime(str(first)[:10], '%Y-%m-%d').date()).days + 1
            days_total = max(1, min(days, span))
        except ValueError:
            pass
    heatmap = [{'weekday': r['w'], 'hour': r['h'], 'sessions': r['n']} for r in conn.execute(
        "SELECT CAST(strftime('%w', started_at, 'localtime') AS INTEGER) w,"
        " CAST(strftime('%H', started_at, 'localtime') AS INTEGER) h, COUNT(*) n"
        " FROM routine_sessions WHERE status='finished' AND started_at >= ?"
        " GROUP BY w, h ORDER BY w, h", (since,)).fetchall()]
    # Slot rankings group by slot id, not by the stored name: the live name comes
    # from the exercises table, so renaming a slot does not split one line in two
    # (same rule as by_slot). A deleted slot falls back to its snapshot name and
    # keeps each item separate (no exercise id to join on).
    top_skipped = [{'exercise_id': r['eid'], 'name': r['name'],
                    'skipped': r['s'], 'total': r['n']} for r in conn.execute(
        "SELECT COALESCE(i.exercise_id, -i.id) AS eid,"
        " COALESCE(MAX(e.name), MAX(i.name)) AS name,"
        " SUM(i.state='skipped') s, COUNT(*) n"
        " FROM routine_session_items i"
        " JOIN routine_sessions r ON r.id = i.session_id"
        " LEFT JOIN exercises e ON e.id = i.exercise_id"
        " WHERE r.started_at >= ? AND COALESCE(e.name, i.name, '') <> ''"
        " AND i.state <> 'pending'"
        " GROUP BY COALESCE(i.exercise_id, -i.id)"
        " HAVING n >= 2 ORDER BY (SUM(i.state='skipped') * 1.0 / COUNT(*)) DESC, s DESC LIMIT 5",
        (since,)).fetchall()]
    # Rankings. Both use the real clock (elapsed_seconds) so the slot and the
    # exercise versions mean the same thing and agree with the Breakdown.
    top_time = [{'exercise_id': r['eid'], 'name': r['name'], 'seconds': r['sec']}
                for r in conn.execute(
        "SELECT COALESCE(i.exercise_id, -i.id) AS eid,"
        " COALESCE(MAX(e.name), MAX(i.name)) AS name,"
        " COALESCE(SUM(i.elapsed_seconds),0) sec"
        " FROM routine_session_items i"
        " JOIN routine_sessions r ON r.id = i.session_id"
        " LEFT JOIN exercises e ON e.id = i.exercise_id"
        " WHERE r.started_at >= ? AND COALESCE(e.name, i.name, '') <> ''"
        " GROUP BY COALESCE(i.exercise_id, -i.id)"
        " ORDER BY sec DESC LIMIT 5", (since,)).fetchall()]
    top_time_exercise = [{'catalog_exercise_id': r['cid'], 'name': r['name'] or '',
                          'seconds': r['sec']} for r in conn.execute(
        "SELECT i.catalog_exercise_id cid,"
        " COALESCE(c.name, MAX(i.catalog_name), '') name,"
        " COALESCE(SUM(i.elapsed_seconds),0) sec"
        " FROM routine_session_items i"
        " JOIN routine_sessions r ON r.id = i.session_id"
        " LEFT JOIN catalog_exercises c ON c.id = i.catalog_exercise_id"
        " WHERE r.started_at >= ? AND i.catalog_exercise_id IS NOT NULL"
        " GROUP BY i.catalog_exercise_id ORDER BY sec DESC LIMIT 5",
        (since,)).fetchall()]
    top_skipped_exercise = [{'catalog_exercise_id': r['cid'], 'name': r['name'] or '',
                             'skipped': r['s'], 'total': r['n']}
                            for r in conn.execute(
        "SELECT i.catalog_exercise_id cid,"
        " COALESCE(c.name, MAX(i.catalog_name), '') name,"
        " SUM(i.state='skipped') s, COUNT(*) n"
        " FROM routine_session_items i"
        " JOIN routine_sessions r ON r.id = i.session_id"
        " LEFT JOIN catalog_exercises c ON c.id = i.catalog_exercise_id"
        " WHERE r.started_at >= ? AND i.catalog_exercise_id IS NOT NULL"
        " GROUP BY i.catalog_exercise_id HAVING n >= 2"
        " ORDER BY (SUM(i.state='skipped') * 1.0 / COUNT(*)) DESC, s DESC LIMIT 5",
        (since,)).fetchall()]
    finished = t['fin']
    # ---- Derived pivot: same window, split by area / exercise / slot --------
    # Only items with real clock time count, so a skipped slot adds neither
    # seconds nor a session to its area.
    filters, fargs = [], []
    if area_id is not None and str(area_id) != '':
        filters.append('AND i.area_id = ?')
        # The UI sends "_unassigned" for the pre-catalog group (empty area).
        fargs.append('' if str(area_id) == '_unassigned' else str(area_id))
    if routine_id:
        filters.append('AND s.routine_id = ?')
        fargs.append(int(routine_id))
    extra = ' '.join(filters)
    area_rows = conn.execute(
        'SELECT i.area_id AS area_id, COALESCE(SUM(i.elapsed_seconds), 0) AS seconds,'
        ' COUNT(DISTINCT i.session_id) AS sessions'
        ' FROM routine_session_items i JOIN routine_sessions s ON s.id = i.session_id'
        ' WHERE s.started_at >= ? AND i.elapsed_seconds > 0 ' + extra +
        ' GROUP BY i.area_id ORDER BY seconds DESC', [since] + fargs).fetchall()
    total_area = sum(r['seconds'] or 0 for r in area_rows)
    by_area, unassigned = [], None
    for r in area_rows:
        item = {'area_id': r['area_id'] or '',
                'seconds': r['seconds'] or 0,
                'sessions': r['sessions'] or 0,
                'share': round((r['seconds'] or 0) / total_area, 3) if total_area else 0}
        if item['area_id']:
            by_area.append(item)
        else:
            unassigned = item
    seen = {a['area_id'] for a in by_area}
    for a in areas(conn):
        if a['id'] not in seen:
            by_area.append({'area_id': a['id'], 'seconds': 0, 'sessions': 0, 'share': 0})
    if unassigned:
        by_area.append(unassigned)          # "Unassigned" always sorts last
    by_exercise = [{'catalog_exercise_id': r['cid'], 'name': r['name'] or '',
                    'seconds': r['seconds'] or 0, 'sessions': r['sessions'] or 0,
                    'last_practiced_on': r['last_on'] or ''}
                   for r in conn.execute(
                       'SELECT i.catalog_exercise_id AS cid,'
                       " COALESCE(c.name, MAX(i.catalog_name), '') AS name,"
                       ' COALESCE(SUM(i.elapsed_seconds), 0) AS seconds,'
                       ' COUNT(DISTINCT i.session_id) AS sessions,'
                       " MAX(date(s.started_at, 'localtime')) AS last_on"
                       ' FROM routine_session_items i'
                       ' JOIN routine_sessions s ON s.id = i.session_id'
                       ' LEFT JOIN catalog_exercises c ON c.id = i.catalog_exercise_id'
                       ' WHERE s.started_at >= ? AND i.catalog_exercise_id IS NOT NULL'
                       ' AND i.elapsed_seconds > 0 ' + extra +
                       ' GROUP BY i.catalog_exercise_id ORDER BY seconds DESC',
                       [since] + fargs).fetchall()]
    by_slot = [{'exercise_id': r['exercise_id'], 'name': r['name'] or '',
                'area_id': r['area_id'] or '', 'seconds': r['seconds'] or 0,
                'sessions': r['sessions'] or 0}
               for r in conn.execute(
                   'SELECT i.exercise_id AS exercise_id,'
                   ' COALESCE(MAX(e.name), MAX(i.name)) AS name,'
                   " COALESCE(MAX(e.area_id), '') AS area_id,"
                   ' COALESCE(SUM(i.elapsed_seconds), 0) AS seconds,'
                   ' COUNT(DISTINCT i.session_id) AS sessions'
                   ' FROM routine_session_items i'
                   ' JOIN routine_sessions s ON s.id = i.session_id'
                   ' LEFT JOIN exercises e ON e.id = i.exercise_id'
                   ' WHERE s.started_at >= ? AND i.elapsed_seconds > 0 ' + extra +
                   ' GROUP BY i.exercise_id ORDER BY seconds DESC',
                   [since] + fargs).fetchall()]
    return {
        'range_days': days,
        'totals': {
            'sessions': t['n'], 'finished': finished, 'abandoned': t['ab'],
            'open': t['op'], 'seconds': t['secs'], 'real_seconds': t['real'],
            'wall_seconds': t['wall'], 'planned_seconds': t['planned'],
            'avg_seconds': round(t['secs'] / finished) if finished else 0,
            'avg_real_seconds': round(t['real'] / finished) if finished else 0,
            'adherence': round(finished / (finished + t['ab']), 3) if (finished + t['ab']) else None,
            'days_practised': days_practised, 'days_total': days_total,
        },
        'states': {'timed': t['nt'], 'untimed': t['nu'], 'skipped': t['ns'],
                   'done': t['nd'], 'partial': t['npart'],
                   'total': t['nt'] + t['nu'] + t['ns']},
        'daily': daily,
        'activity': activity,
        'heatmap': heatmap,
        'top_skipped': top_skipped,
        'top_time': top_time,
        'top_skipped_exercise': top_skipped_exercise,
        'top_time_exercise': top_time_exercise,
        'by_area': by_area,
        'by_exercise': by_exercise,
        'by_slot': by_slot,
    }


# Sandbox seed material: a small catalog plus a name-prefix guess for areas, so
# the new views have something to show. Never used against the real database.
CATALOG_SEED = [
    ('Major scale, 3 notes per string', 'Seven positions, two octaves, alternate picking'),
    ('Minor pentatonic boxes', 'Five shapes, then connect them across the neck'),
    ('Spider exercise', '1-2-3-4 permutation up and down every string'),
    ('Chord transitions', 'Switch between two shapes on the click, no gaps'),
    ('Functional harmony', 'ii-V-I in all keys, arpeggios over each chord'),
    ('16th note groove', 'Single chord, accent on the backbeat'),
    ('Blues scale phrasing', 'Call and response over a twelve bar loop'),
    ('Interval recognition', 'Sing back the interval before naming it'),
]
AREA_BY_PREFIX = [
    ('theory', 'knowledge'), ('knowledge', 'knowledge'), ('functional', 'knowledge'),
    ('technique', 'technique'), ('spider', 'technique'), ('warm', 'technique'),
    ('repertoire', 'repertoire'), ('rhythm', 'rhythm'), ('groove', 'rhythm'),
    ('improv', 'improvisation'), ('blues', 'improvisation'),
    ('ear', 'ear_training'), ('interval', 'ear_training'),
]


def _seed_catalog(conn, rnd):
    """Sandbox only: fill the catalog and point the seeded slots at it."""
    if conn.execute('SELECT COUNT(*) FROM catalog_exercises').fetchone()[0] == 0:
        for name, desc in CATALOG_SEED:
            conn.execute('INSERT INTO catalog_exercises(name, description) VALUES(?, ?)',
                         (name, desc))
    catalog = conn.execute('SELECT id FROM catalog_exercises ORDER BY id').fetchall()
    if not catalog:
        return
    for slot in conn.execute('SELECT id, name, area_id, catalog_exercise_id FROM exercises'
                             ).fetchall():
        area = slot['area_id'] or ''
        if not area:
            low = (slot['name'] or '').lower()
            for prefix, aid in AREA_BY_PREFIX:
                if prefix in low:
                    area = aid
                    break
            if area:
                conn.execute('UPDATE exercises SET area_id=? WHERE id=?', (area, slot['id']))
        if area and slot['catalog_exercise_id'] is None:
            pick = catalog[rnd.randrange(len(catalog))]
            conn.execute('UPDATE exercises SET catalog_exercise_id=? WHERE id=?',
                         (pick['id'], slot['id']))
    conn.commit()


def seed_sessions(conn, days=60, sessions=40):
    """Fake but plausible history for the sandbox DB (never the real one)."""
    rnd = random.Random(7)
    routines = conn.execute('SELECT id, name FROM routines ORDER BY id').fetchall()
    if not routines:
        return {'error': 'no_routines'}
    _seed_catalog(conn, rnd)
    cat_names = {r['id']: r['name'] for r in
                 conn.execute('SELECT id, name FROM catalog_exercises').fetchall()}
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    created = 0
    for _ in range(max(1, min(500, int(sessions)))):
        routine = rnd.choice(routines)
        exs = conn.execute('SELECT id, name, duration_seconds, area_id, catalog_exercise_id'
                           ' FROM exercises WHERE routine_id=?'
                           ' ORDER BY position, id', (routine['id'],)).fetchall()
        if not exs:
            continue
        day = now - timedelta(days=rnd.randint(0, max(1, int(days))))
        started = day.replace(hour=rnd.randint(8, 21),
                              minute=rnd.choice([0, 10, 15, 30, 45]), second=0, microsecond=0)
        states, played_total, real_total, n_timed = [], 0, 0, 0
        for e in exs:
            dur = int(e['duration_seconds'] or 0)
            roll = rnd.random()
            if roll < 0.62:
                state, played = 'timed', dur
                elapsed = dur + rnd.randint(0, 90)          # a bit of extra after 00:00
            elif roll < 0.80:
                state, played = 'untimed', int(dur * rnd.choice([0.1, 0.2, 0.35]))
                elapsed = dur                               # declared: the plan counts
            elif roll < 0.95:
                state, played = 'skipped', 0
                elapsed = int(dur * rnd.choice([0, 0, 0.15, 0.3, 0.45]))
            else:
                state, played, elapsed = 'pending', 0, 0
            played_total += played
            real_total += elapsed
            if state == 'timed':
                n_timed += 1
            states.append((e, state, played, elapsed))
        abandoned = rnd.random() < 0.12
        wall = real_total + rnd.randint(120, 900)            # pauses / browsing
        finished = started + timedelta(seconds=wall)         # even when left open, it stopped there
        cur = conn.execute(
            'INSERT INTO routine_sessions (routine_id, routine_name, status, started_at, finished_at,'
            ' planned_seconds, practiced_seconds, real_seconds, wall_seconds) VALUES (?,?,?,?,?,?,?,?,?)',
            (routine['id'], routine['name'], 'abandoned' if abandoned else 'finished',
             started.strftime('%Y-%m-%d %H:%M:%S'),
             finished.strftime('%Y-%m-%d %H:%M:%S'),
             sum(int(e['duration_seconds'] or 0) for e in exs), played_total,
             real_total, wall))
        sid = cur.lastrowid
        for pos, (e, state, played, elapsed) in enumerate(states):
            touched = state != 'pending'
            cid = e['catalog_exercise_id'] if touched else None
            conn.execute(
                'INSERT INTO routine_session_items (session_id, position, exercise_id, name, state,'
                ' planned_seconds, played_seconds, elapsed_seconds, area_id,'
                ' catalog_exercise_id, catalog_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (sid, pos, e['id'], e['name'], state, int(e['duration_seconds'] or 0), played,
                 elapsed, (e['area_id'] or '') if touched else '', cid,
                 cat_names.get(cid, '') if cid else ''))
        conn.execute(
            'UPDATE routine_sessions SET n_total=?, n_timed=?, n_untimed=?, n_skipped=?,'
            ' n_done=?, n_partial=? WHERE id=?',
            (len(states), n_timed,
             sum(1 for _e, s, _p, _el in states if s == 'untimed'),
             sum(1 for _e, s, _p, _el in states if s == 'skipped'),
             n_timed + sum(1 for _e, s, _p, _el in states if s == 'untimed'),
             sum(1 for _e, s, _p, el in states if s == 'skipped' and el > 0), sid))
        created += 1
    conn.commit()
    return {'sessions': created, 'days': days}


def active_session(conn, hours=8):
    """The session still open from the last few hours.

    Used by the app to recover a routine in progress after the browser storage
    was cleared, instead of leaving the row open until it is auto-abandoned.
    """
    limit = (datetime.now(timezone.utc).replace(tzinfo=None)
             - timedelta(hours=max(1, int(hours)))).strftime('%Y-%m-%d %H:%M:%S')
    sweep_open_sessions(conn, hours)
    row = conn.execute(
        "SELECT id FROM routine_sessions WHERE status='open' AND started_at >= ?"
        " ORDER BY started_at DESC LIMIT 1", (limit,)).fetchone()
    return _session_full(conn, row['id']) if row else None


def get_settings_prefix(conn, prefix):
    """All settings whose key starts with `prefix` (the app's prefs mirror)."""
    out = {}
    for r in conn.execute('SELECT key, value FROM settings WHERE key LIKE ?',
                          (str(prefix) + '%',)).fetchall():
        out[r['key']] = r['value']
    return out

