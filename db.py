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
CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    duration_seconds INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    resource_kind TEXT DEFAULT '',
    resource_url TEXT DEFAULT '',
    resource_bpm INTEGER DEFAULT 0,
    resource_label TEXT DEFAULT '',
    resources_json TEXT DEFAULT ''
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
    UNIQUE(session_id, position)
);
CREATE INDEX IF NOT EXISTS idx_routine_sessions_started ON routine_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_session_items_session ON routine_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_session_items_name ON routine_session_items(name);
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
                      'planned_seconds', 'played_seconds'])
        rows = conn.execute(
            'SELECT i.session_id, s.started_at, s.routine_name, i.position, i.name, i.state,'
            ' i.planned_seconds, i.played_seconds'
            ' FROM routine_session_items i JOIN routine_sessions s ON s.id = i.session_id'
            ' ORDER BY s.started_at, i.position').fetchall()
        for r in rows:
            out.writerow([r['session_id'], _csv_local(r['started_at']), r['routine_name'],
                          r['position'], r['name'], r['state'],
                          r['planned_seconds'], r['played_seconds']])
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
    cols = [r[1] for r in conn.execute('PRAGMA table_info(exercises)').fetchall()]
    wanted = [
        ('resource_kind', "TEXT DEFAULT ''"),
        ('resource_url', "TEXT DEFAULT ''"),
        ('resource_bpm', 'INTEGER DEFAULT 0'),
        ('resource_label', "TEXT DEFAULT ''"),
        ('resources_json', "TEXT DEFAULT ''"),
    ]
    for name, ddl in wanted:
        if name not in cols:
            conn.execute('ALTER TABLE exercises ADD COLUMN %s %s' % (name, ddl))
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
                'INSERT INTO exercises(routine_id, name, description, duration_seconds, position) '
                'VALUES(?,?,?,?,?)',
                (rid, e.get('name', ''), e.get('description', ''),
                 int(e.get('duration_seconds', 0)), i),
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
    """url -> label shown for a section item ("Section: TAG - label").

    ``exercises.resource_label`` is only a snapshot taken when the exercise was
    saved, so it misses later edits of the section/item (the tag above all).
    The live section data wins, so already saved exercises get the full title.
    """
    out = {}
    try:
        rows = conn.execute(
            'SELECT s.title AS sec_title, i.kind, i.label, i.tag, i.url '
            'FROM section_items i JOIN sections s ON s.id = i.section_id'
        ).fetchall()
    except Exception:  # noqa: BLE001
        return out
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
        full = ((r['sec_title'] + ': ') if r['sec_title'] else '') + text
        out[url] = full
        if r['kind'] == 'song':
            # Same encoding the panel uses (encodeURIComponent) for /api/media.
            out['/api/media?path=' + quote(url, safe="!'()*")] = full
    return out


def _label_for(labels, url, fallback):
    return labels.get((url or '').strip()) or (fallback or '')


def _exercise_resources(e):
    """Resources of an exercise as a list.

    `resources_json` holds the list; the old single-resource columns are used as
    a fallback so databases created before this feature keep working.
    """
    arr = []
    try:
        raw = json.loads(e['resources_json'] or '[]')
        if isinstance(raw, list):
            arr = raw
    except Exception:  # noqa: BLE001
        arr = []
    out = []
    for r in arr:
        if not isinstance(r, dict):
            continue
        kind = (r.get('kind') or '').strip()
        if not kind:
            continue
        out.append({
            'kind': kind,
            'url': r.get('url') or '',
            'bpm': int(r.get('bpm') or 0),
            'label': r.get('label') or '',
            'cfg': r.get('cfg') if isinstance(r.get('cfg'), dict) else {},
        })
    if not out and (e['resource_kind'] or ''):
        out = [{
            'kind': e['resource_kind'], 'url': e['resource_url'] or '',
            'bpm': e['resource_bpm'] or 0, 'label': e['resource_label'] or '',
            'cfg': {},
        }]
    return out


def _with_labels(resources, labels):
    """Same list with the labels refreshed from the live section data."""
    out = []
    for r in resources:
        url = (r.get('url') or '').strip()
        out.append({
            'kind': r.get('kind') or '',
            'url': url,
            'bpm': int(r.get('bpm') or 0),
            'label': labels.get(url) or (r.get('label') or ''),
            'cfg': r.get('cfg') if isinstance(r.get('cfg'), dict) else {},
        })
    return out


def _exercise_payload(e, labels):
    """Exercise dict for the app: `recursos` plus the legacy single-resource keys."""
    res = _with_labels(_exercise_resources(e), labels)
    first = res[0] if res else {'kind': '', 'url': '', 'bpm': 0, 'label': ''}
    return {
        'id': e['id'], 'nombre': e['name'], 'descripcion': e['description'],
        'tiempo': e['duration_seconds'],
        'recursos': res,
        'recurso_kind': first['kind'], 'recurso_url': first['url'],
        'recurso_bpm': first['bpm'], 'recurso_label': first['label'],
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
        labels = _resource_labels(conn)
        exs = conn.execute(
            'SELECT id, name, description, duration_seconds, resource_kind, resource_url, '
            'resource_bpm, resource_label, resources_json FROM exercises '
            'WHERE routine_id=? ORDER BY position, id',
            (rid,),
        ).fetchall()
        active = {
            'id': rid,
            'nombre': name,
            'descripcion': desc,
            'finish_kind': row['finish_kind'] or '',
            'finish_url': row['finish_url'] or '',
            'finish_label': _label_for(labels, row['finish_url'], row['finish_label']),
            'finish_bpm': row['finish_bpm'] or 0,
            'ejercicios': [_exercise_payload(e, labels) for e in exs],
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
    labels = _resource_labels(conn)
    exs = conn.execute(
        'SELECT id, name, description, duration_seconds, position, '
        'resource_kind, resource_url, resource_bpm, resource_label, resources_json FROM exercises '
        'WHERE routine_id=? ORDER BY position, id',
        (rid,),
    ).fetchall()
    out_exs = []
    for e in exs:
        res = _with_labels(_exercise_resources(e), labels)
        first = res[0] if res else {'kind': '', 'url': '', 'bpm': 0, 'label': ''}
        out_exs.append({
            'id': e['id'], 'name': e['name'], 'description': e['description'],
            'duration_seconds': e['duration_seconds'], 'position': e['position'],
            'resources': res,
            'resource_kind': first['kind'], 'resource_url': first['url'],
            'resource_bpm': first['bpm'], 'resource_label': first['label'],
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
    r = conn.execute('SELECT name, description FROM routines WHERE id=?', (rid,)).fetchone()
    if r is None:
        return None
    name = (r['name'] or 'Routine') + ' - copy'
    desc = r['description'] or ''
    pos = conn.execute('SELECT COALESCE(MAX(position), -1) + 1 FROM routines').fetchone()[0]
    cur = conn.execute(
        'INSERT INTO routines(name, description, is_active, position) VALUES(?,?,0,?)',
        (name, desc, pos),
    )
    nid = cur.lastrowid
    exs = conn.execute(
        'SELECT name, description, duration_seconds, position FROM exercises '
        'WHERE routine_id=? ORDER BY position, id', (rid,)
    ).fetchall()
    for e in exs:
        conn.execute(
            'INSERT INTO exercises(routine_id, name, description, duration_seconds, position) '
            'VALUES(?,?,?,?,?)',
            (nid, e['name'], e['description'], e['duration_seconds'], e['position']),
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


def _resources_from_data(data):
    """Resource list sent by the manager, or None when the key is missing."""
    if 'resources' not in data:
        return None
    return _clean_resources(data.get('resources'))


def _mirror_first(conn, eid, resources):
    """Keeps the legacy single-resource columns in sync with the first item."""
    first = resources[0] if resources else {'kind': '', 'url': '', 'bpm': 0, 'label': ''}
    conn.execute(
        'UPDATE exercises SET resource_kind=?, resource_url=?, resource_bpm=?, resource_label=? '
        'WHERE id=?',
        (first['kind'], first['url'], first['bpm'], first['label'], eid),
    )


def create_exercise(conn, rid, data):
    if conn.execute('SELECT id FROM routines WHERE id=?', (rid,)).fetchone() is None:
        return None
    name = (data.get('name') or 'New Exercise').strip()
    desc = data.get('description') or ''
    dur = int(data.get('duration_seconds') or 0)
    pos = conn.execute(
        'SELECT COALESCE(MAX(position), -1) + 1 FROM exercises WHERE routine_id=?', (rid,)
    ).fetchone()[0]
    resources = _resources_from_data(data)
    if resources is None:
        resources = _clean_resources([{
            'kind': data.get('resource_kind') or '',
            'url': data.get('resource_url') or '',
            'bpm': data.get('resource_bpm') or 0,
            'label': data.get('resource_label') or '',
        }])
    first = resources[0] if resources else {'kind': '', 'url': '', 'bpm': 0, 'label': ''}
    conn.execute(
        'INSERT INTO exercises(routine_id, name, description, duration_seconds, position, '
        'resource_kind, resource_url, resource_bpm, resource_label, resources_json) '
        'VALUES(?,?,?,?,?,?,?,?,?,?)',
        (rid, name, desc, dur, pos,
         first['kind'], first['url'], first['bpm'], first['label'],
         json.dumps(resources, ensure_ascii=False)),
    )
    conn.commit()
    return _routine_full(conn, rid)


def update_exercise(conn, eid, data):
    if conn.execute('SELECT id FROM exercises WHERE id=?', (eid,)).fetchone() is None:
        return None
    if data.get('name') is not None:
        conn.execute('UPDATE exercises SET name=? WHERE id=?', (data['name'], eid))
    if data.get('description') is not None:
        conn.execute('UPDATE exercises SET description=? WHERE id=?', (data['description'], eid))
    if data.get('duration_seconds') is not None:
        conn.execute('UPDATE exercises SET duration_seconds=? WHERE id=?',
                     (int(data['duration_seconds']), eid))
    if data.get('resource_kind') is not None:
        conn.execute('UPDATE exercises SET resource_kind=? WHERE id=?', (data['resource_kind'], eid))
    if data.get('resource_url') is not None:
        conn.execute('UPDATE exercises SET resource_url=? WHERE id=?', (data['resource_url'], eid))
    if data.get('resource_bpm') is not None:
        conn.execute('UPDATE exercises SET resource_bpm=? WHERE id=?',
                     (int(data['resource_bpm'] or 0), eid))
    if data.get('resource_label') is not None:
        conn.execute('UPDATE exercises SET resource_label=? WHERE id=?', (data['resource_label'], eid))

    resources = _resources_from_data(data)
    if resources is not None:
        conn.execute('UPDATE exercises SET resources_json=? WHERE id=?',
                     (json.dumps(resources, ensure_ascii=False), eid))
        _mirror_first(conn, eid, resources)
    elif any(k in data for k in ('resource_kind', 'resource_url', 'resource_bpm', 'resource_label')):
        # Legacy single-resource update: keep the list in sync with the columns
        # (otherwise the stale list would win when the app reads the exercise).
        row = conn.execute(
            'SELECT resource_kind, resource_url, resource_bpm, resource_label FROM exercises WHERE id=?',
            (eid,),
        ).fetchone()
        res = _clean_resources([{
            'kind': row['resource_kind'] or '', 'url': row['resource_url'] or '',
            'bpm': row['resource_bpm'] or 0, 'label': row['resource_label'] or '',
        }])
        conn.execute('UPDATE exercises SET resources_json=? WHERE id=?',
                     (json.dumps(res, ensure_ascii=False), eid))
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
        ' elapsed_seconds, started_at, finished_at'
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
    """Writes one item state; False when the position does not exist."""
    state = item.get('state') or 'pending'
    if state not in SESSION_STATES:
        return False
    cur = conn.execute(
        'UPDATE routine_session_items SET state=?, played_seconds=?, elapsed_seconds=?,'
        ' started_at=?, finished_at=? WHERE session_id=? AND position=?',
        (state, max(0, int(item.get('played_seconds') or 0)),
         max(0, int(item.get('elapsed_seconds') or 0)),
         _iso_to_db(item.get('started_at')),
         _iso_to_db(item.get('finished_at')), sid, int(item.get('position') or 0)))
    return cur.rowcount > 0


def _session_totals(conn, sid, finished_at):
    """Item counters plus the wall clock for a session that stopped at `finished_at`."""
    c = conn.execute(
        "SELECT COUNT(*) n, COALESCE(SUM(state='timed'),0) t, COALESCE(SUM(state='untimed'),0) u,"
        " COALESCE(SUM(state='skipped'),0) s, COALESCE(SUM(played_seconds),0) played,"
        " COALESCE(SUM(elapsed_seconds),0) real,"
        " COALESCE(SUM(CASE WHEN state='skipped' AND elapsed_seconds>0 THEN 1 ELSE 0 END),0) part"
        " FROM routine_session_items WHERE session_id=?", (sid,)).fetchone()
    row = conn.execute('SELECT started_at FROM routine_sessions WHERE id=?', (sid,)).fetchone()
    wall = 0
    if row and row['started_at'] and finished_at:
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


def _close_session(conn, sid, finished_at):
    """Recomputes the counters from the items and marks the session finished."""
    c, wall = _session_totals(conn, sid, finished_at)
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
    _close_session(conn, sid, _iso_to_db(data.get('finished_at')) or _utc_now())
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

def session_stats(conn, days=30):
    """Aggregates for the History panel (one request, computed in SQL)."""
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
    top_skipped = [{'name': r['name'], 'skipped': r['s'], 'total': r['n']} for r in conn.execute(
        "SELECT i.name, SUM(i.state='skipped') s, COUNT(*) n FROM routine_session_items i"
        " JOIN routine_sessions r ON r.id = i.session_id"
        " WHERE r.started_at >= ? AND i.name <> '' GROUP BY i.name"
        " HAVING n >= 2 ORDER BY (SUM(i.state='skipped') * 1.0 / COUNT(*)) DESC, s DESC LIMIT 5",
        (since,)).fetchall()]
    top_time = [{'name': r['name'], 'seconds': r['sec']} for r in conn.execute(
        "SELECT i.name, COALESCE(SUM(i.played_seconds),0) sec FROM routine_session_items i"
        " JOIN routine_sessions r ON r.id = i.session_id"
        " WHERE r.started_at >= ? AND i.name <> '' GROUP BY i.name"
        " ORDER BY sec DESC LIMIT 5", (since,)).fetchall()]
    finished = t['fin']
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
    }


def seed_sessions(conn, days=60, sessions=40):
    """Fake but plausible history for the sandbox DB (never the real one)."""
    rnd = random.Random(7)
    routines = conn.execute('SELECT id, name FROM routines ORDER BY id').fetchall()
    if not routines:
        return {'error': 'no_routines'}
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    created = 0
    for _ in range(max(1, min(500, int(sessions)))):
        routine = rnd.choice(routines)
        exs = conn.execute('SELECT id, name, duration_seconds FROM exercises WHERE routine_id=?'
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
            conn.execute(
                'INSERT INTO routine_session_items (session_id, position, exercise_id, name, state,'
                ' planned_seconds, played_seconds, elapsed_seconds) VALUES (?,?,?,?,?,?,?,?)',
                (sid, pos, e['id'], e['name'], state, int(e['duration_seconds'] or 0), played, elapsed))
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

