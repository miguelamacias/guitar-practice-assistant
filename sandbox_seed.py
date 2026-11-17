"""Fill practice_sandbox.db with demo data for UI checks.

Never touches practice.db. Run:
    python sandbox_seed.py [--force] [--days 120] [--sessions 100] [--free 20]

The sandbox launcher keeps this database because it has a catalog; only
ReiniciarPracticeHubSandbox.vbs /fresh recreates it from practice.db and wipes
the demo. Use --force to replace a previous demo without touching the original
three sessions copied from the real database.
"""
import argparse
import json
import os
import random
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import db

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, 'practice_sandbox.db')
MARKER = 'sandbox_demo_seed_v1'
INTENTS = [
    'Technique focus', 'Song work', 'Improv over ii-V-I', 'Fretboard notes',
    'Rhythm and groove', 'Ear training', 'Clean chord changes',
    'Speed burst', 'Repertoire run-through', 'Warm-up and review',
]
MODES = ['identify', 'locate', 'zone']
STYLES = ['rock', 'funk', 'blues', 'shuffle', 'ballad', 'pop']
GRIDS = ['8ths', '16ths', 'triplets']


def _db_text(dt):
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def _iso_z(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def _cfg(value):
    try:
        got = json.loads(value or '{}')
    except (TypeError, ValueError):
        return {}
    return got if isinstance(got, dict) else {}


def _media_ref(res):
    """Mirror js/players.js: audio stores the inner path, YouTube the video id."""
    kind = res.get('kind')
    url = str(res.get('url') or '')
    if kind == 'audio':
        path = (parse_qs(urlparse(url).query).get('path') or [''])[0]
        if path:
            return path
    elif kind == 'youtube':
        match = re.search(r'(?:v=|youtu\.be/|embed/)([A-Za-z0-9_-]{11})', url)
        if match:
            return match.group(1)
    return url


def backup_sandbox():
    """Consistent copy of the live sandbox (the server may be running)."""
    if not os.path.exists(DB):
        return None
    folder = os.path.join(HERE, 'backups')
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, 'practice_sandbox-pre-demo-%s.db'
                        % datetime.now().strftime('%Y%m%d-%H%M%S'))
    src = sqlite3.connect(DB)
    out = sqlite3.connect(dest)
    try:
        src.backup(out)
    finally:
        out.close()
        src.close()
    check = sqlite3.connect(dest)
    try:
        integrity = check.execute('PRAGMA integrity_check').fetchone()[0]
        counts = {t: check.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0]
                  for t in ('routines', 'exercises', 'routine_sessions',
                            'routine_session_items', 'fretboard_stats')}
    finally:
        check.close()
    if integrity != 'ok':
        raise SystemExit('sandbox backup failed integrity_check')
    print('BACKUP : %s %s' % (os.path.basename(dest), counts))
    return dest

def add_demo_resources(conn, rnd):
    """Add a metronome/drum preset to exercises that do not have one yet.

    These are sandbox-only resources: `demo://` marks them so --force can
    remove exactly the ones this script created.
    """
    added = 0
    catalog = conn.execute('SELECT id FROM catalog_exercises ORDER BY id').fetchall()
    for row in catalog:
        cid = row['id']
        kinds = {r['kind'] for r in conn.execute(
            'SELECT r.kind FROM catalog_exercise_resources x'
            ' JOIN resources r ON r.id = x.resource_id'
            ' WHERE x.catalog_exercise_id = ?', (cid,)).fetchall()}
        pos = conn.execute(
            'SELECT COALESCE(MAX(position), -1) + 1 FROM catalog_exercise_resources'
            ' WHERE catalog_exercise_id = ?', (cid,)).fetchone()[0]
        if 'metronome' not in kinds and rnd.random() < 0.6:
            bpm = rnd.choice([60, 70, 80, 90, 100, 110, 120, 130])
            cfg = {'sig': rnd.choice(['4/4', '3/4', '6/8']),
                   'pattern': rnd.choice(['1', '2', '3', 'shuffle']),
                   'accent': rnd.random() < 0.6}
            rid = conn.execute(
                "INSERT INTO resources(kind, url, bpm, label, cfg)"
                " VALUES('metronome', 'demo://metronome', ?, 'Metronome', ?)",
                (bpm, json.dumps(cfg))).lastrowid
            conn.execute(
                'INSERT OR IGNORE INTO catalog_exercise_resources'
                '(catalog_exercise_id, resource_id, position) VALUES(?,?,?)',
                (cid, rid, pos))
            pos += 1
            added += 1
        if 'drums' not in kinds and rnd.random() < 0.5:
            bpm = rnd.choice([70, 80, 90, 100, 110, 120])
            cfg = {'sig': rnd.choice(['4/4', '3/4', '6/8']),
                   'style': rnd.choice(STYLES),
                   'res': rnd.choice(GRIDS),
                   'swing': rnd.random() < 0.3}
            rid = conn.execute(
                "INSERT INTO resources(kind, url, bpm, label, cfg)"
                " VALUES('drums', 'demo://drums', ?, 'Drum machine', ?)",
                (bpm, json.dumps(cfg))).lastrowid
            conn.execute(
                'INSERT OR IGNORE INTO catalog_exercise_resources'
                '(catalog_exercise_id, resource_id, position) VALUES(?,?,?)',
                (cid, rid, pos))
            added += 1
    conn.commit()
    print('RESOURCES: +%d demo metronome/drum presets' % added)
    return added


def load_context(conn):
    routines = [dict(r) for r in conn.execute(
        'SELECT id, name FROM routines ORDER BY id').fetchall()]
    slots = {}
    for r in conn.execute(
            'SELECT id, routine_id, name, duration_seconds, area_id,'
            ' catalog_exercise_id, catalog_path_id'
            ' FROM exercises ORDER BY routine_id, position, id').fetchall():
        slots.setdefault(r['routine_id'], []).append(dict(r))
    catalog = [dict(r) for r in conn.execute(
        'SELECT id, name, area_id FROM catalog_exercises ORDER BY id').fetchall()]
    areas = db.area_map(conn)
    resources = {}
    for r in conn.execute(
            'SELECT x.catalog_exercise_id AS cid, r.kind, r.url, r.bpm, r.label, r.cfg'
            ' FROM catalog_exercise_resources x'
            ' JOIN resources r ON r.id = x.resource_id'
            ' ORDER BY x.catalog_exercise_id, x.position').fetchall():
        resources.setdefault(r['cid'], []).append(dict(r))
    return {'routines': routines, 'slots': slots, 'catalog': catalog,
            'areas': areas, 'resources': resources}


def clear_demo(conn):
    conn.execute("DELETE FROM routine_sessions WHERE note LIKE 'sandbox demo%'")
    conn.execute('DELETE FROM media_plays')
    conn.execute('DELETE FROM practice_events')
    conn.execute('DELETE FROM fretboard_cell_attempts')
    conn.execute("DELETE FROM fretboard_stats WHERE run_uid LIKE 'demo-fb-%'")
    conn.execute('DELETE FROM fretboard_cell_stats')
    conn.execute("DELETE FROM resources WHERE url LIKE 'demo://%'")
    conn.execute('DELETE FROM settings WHERE key = ?', (MARKER,))
    conn.commit()

def make_item(spec, rnd, ctx, start_dt, free):
    """One session item with plausible telemetry and tool usage."""
    planned = 0 if free else int(spec.get('duration_seconds') or 0)
    roll = rnd.random()
    if free:
        state = 'timed' if roll < 0.82 else 'untimed'
        played = 0
        elapsed = rnd.randint(120, 900)
    elif roll < 0.62:
        state, played = 'timed', planned
        elapsed = planned + rnd.randint(0, 100)
    elif roll < 0.80:
        state = 'untimed'
        played = int(planned * rnd.choice([0.1, 0.2, 0.35]))
        elapsed = planned
    elif roll < 0.93:
        state, played = 'skipped', 0
        elapsed = int(planned * rnd.choice([0, 0, 0.15, 0.3]))
    else:
        state, played, elapsed = 'pending', 0, 0
    touched = state != 'pending'
    started = None
    finished = None
    if touched:
        started = start_dt + timedelta(seconds=rnd.randint(0, 45))
        finished = started + timedelta(seconds=max(1, elapsed) + rnd.randint(0, 90))

    if free:
        exercise_id = None
        cid = spec.get('id')
        cname = spec.get('name') or ''
        area_id = spec.get('area_id') or ''
        path_id = None
        name = cname
    else:
        exercise_id = spec.get('id')
        cid = spec.get('catalog_exercise_id')
        cname = ctx['catalog_names'].get(cid, '')
        area_id = spec.get('area_id') or ''
        path_id = spec.get('catalog_path_id')
        name = spec.get('name') or cname

    tool_cfg = {}
    used = {'metronome': 0, 'drums': 0, 'audio': 0, 'youtube': 0, 'fretboard': 0}
    metro_start = metro_end = drums_start = drums_end = bpm_target = 0
    media = None
    trainer = None
    if touched:
        for res in ctx['resources'].get(cid, []):
            kind = res.get('kind')
            cfg = _cfg(res.get('cfg'))
            if kind == 'metronome':
                bpm = int(res.get('bpm') or 0) or rnd.choice([60, 70, 80, 90, 100, 120])
                used['metronome'] = 1
                metro_start = max(40, bpm - rnd.randint(0, 15))
                metro_end = min(240, bpm + rnd.randint(0, 12))
                bpm_target = bpm_target or bpm
                tool_cfg['metro_sig'] = cfg.get('sig') or rnd.choice(['4/4', '3/4', '6/8'])
                tool_cfg['metro_pattern'] = cfg.get('pattern') or rnd.choice(['1', '2', '3'])
                tool_cfg['metro_accent'] = bool(cfg.get('accent', rnd.random() < 0.6))
            elif kind == 'drums':
                bpm = int(res.get('bpm') or 0) or rnd.choice([70, 80, 90, 100, 110])
                used['drums'] = 1
                drums_start = max(40, bpm - rnd.randint(0, 12))
                drums_end = min(240, bpm + rnd.randint(0, 10))
                bpm_target = bpm_target or bpm
                tool_cfg['drums_sig'] = cfg.get('sig') or rnd.choice(['4/4', '3/4', '6/8'])
                tool_cfg['drums_style'] = cfg.get('style') or rnd.choice(STYLES)
                tool_cfg['drums_res'] = cfg.get('res') or rnd.choice(GRIDS)
                tool_cfg['drums_swing'] = bool(cfg.get('swing', rnd.random() < 0.3))
            elif kind == 'audio' and media is None:
                used['audio'] = 1
                media = {'kind': 'audio', 'ref': _media_ref(res),
                         'label': res.get('label') or cname, 'started_at': started}
            elif kind == 'youtube' and media is None:
                used['youtube'] = 1
                media = {'kind': 'youtube', 'ref': _media_ref(res),
                         'label': res.get('label') or cname, 'started_at': started}
            elif kind == 'fretboard' and trainer is None:
                used['fretboard'] = 1
                trainer = {'started_at': started, 'duration': max(60, elapsed),
                           'catalog_exercise_id': cid}

    if touched:
        play_count = rnd.randint(1, 4)
        pause_count = rnd.randint(0, 2)
        reset_count = rnd.randint(0, 2 if state in ('untimed', 'skipped') else 1)
        repeat_count = rnd.randint(0, 2 if state in ('timed', 'untimed') else 0)
    else:
        play_count = pause_count = reset_count = repeat_count = 0
    completed_by = {'timed': 'timer', 'untimed': 'manual',
                    'skipped': 'skip', 'pending': ''}[state]

    item = {
        'exercise_id': exercise_id,
        'name': name,
        'state': state,
        'planned_seconds': planned,
        'played_seconds': played,
        'elapsed_seconds': elapsed,
        'started_at': _iso_z(started) if started else None,
        'finished_at': _iso_z(finished) if finished else None,
        'area_id': area_id,
        'area_label': ctx['areas'].get(area_id, ''),
        'catalog_exercise_id': cid,
        'catalog_name': cname,
        'catalog_path_id': path_id,
        'metro_bpm_start': metro_start,
        'metro_bpm_end': metro_end,
        'drums_bpm_start': drums_start,
        'drums_bpm_end': drums_end,
        'bpm_target': bpm_target,
        'tool_cfg': tool_cfg,
        'used_metronome': used['metronome'],
        'used_drums': used['drums'],
        'used_audio': used['audio'],
        'used_youtube': used['youtube'],
        'used_fretboard': used['fretboard'],
        'play_count': play_count,
        'pause_count': pause_count,
        'reset_count': reset_count,
        'repeat_count': repeat_count,
        'completed_by': completed_by,
    }
    return item, media, trainer

def insert_session(conn, routine, items, started, finished, status, free,
                   note, rnd):
    planned = sum(i['planned_seconds'] for i in items)
    played = sum(i['played_seconds'] for i in items)
    real = sum(i['elapsed_seconds'] for i in items)
    wall = max(1, int((finished - started).total_seconds()))
    n_timed = sum(1 for i in items if i['state'] == 'timed')
    n_untimed = sum(1 for i in items if i['state'] == 'untimed')
    n_skipped = sum(1 for i in items if i['state'] == 'skipped')
    n_partial = sum(1 for i in items
                    if i['state'] == 'skipped' and i['elapsed_seconds'] > 0)
    abandon = ''
    if status == 'abandoned':
        abandon = rnd.choice(['new_session', 'sweep'])
    cur = conn.execute(
        "INSERT INTO routine_sessions (routine_id, routine_name, kind, note,"
        " tz_offset_min, resume_count, abandon_reason, status, started_at,"
        " finished_at, planned_seconds, practiced_seconds, real_seconds,"
        " wall_seconds, n_total, n_timed, n_untimed, n_skipped, n_done, n_partial)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (None if free else routine['id'],
         'Free practice' if free else routine['name'],
         'free' if free else 'routine', note, 60,
         rnd.choice([0, 0, 0, 1, 1, 2, 3]),
         abandon, status, _db_text(started), _db_text(finished),
         planned, played, real, wall, len(items), n_timed, n_untimed,
         n_skipped, n_timed + n_untimed, n_partial))
    sid = cur.lastrowid
    for pos, item in enumerate(items):
        db._insert_session_item(conn, sid, pos, item)
    conn.commit()
    return sid

def seed(conn, days, n_sessions, n_free, rnd):
    ctx = load_context(conn)
    ctx['catalog_names'] = {c['id']: c['name'] for c in ctx['catalog']}
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    n_sessions = max(1, min(300, int(n_sessions)))
    n_free = max(0, min(n_sessions, int(n_free)))
    media_candidates = []
    trainer_candidates = []
    sessions = []
    for i in range(n_sessions):
        free = i < n_free or (rnd.random() < 0.12 and i < n_sessions - 1)
        offset = rnd.randint(1, 14) if rnd.random() < 0.5 else rnd.randint(1, max(1, days))
        started = (now - timedelta(days=offset)).replace(
            hour=rnd.randint(7, 21), minute=rnd.choice([0, 5, 10, 15, 30, 45]),
            second=0, microsecond=0)
        if free:
            routine = None
            picks = rnd.sample(ctx['catalog'],
                               k=min(len(ctx['catalog']), rnd.randint(1, 3)))
            items = []
            local_media = []
            local_trainer = []
            cursor = started
            for cat in picks:
                item, media, trainer = make_item(cat, rnd, ctx, cursor, True)
                items.append(item)
                if media:
                    local_media.append((len(items) - 1, media))
                if trainer:
                    local_trainer.append((len(items) - 1, trainer))
                cursor += timedelta(seconds=item['elapsed_seconds'] + rnd.randint(100, 200))
            status = 'abandoned' if rnd.random() < 0.10 else 'finished'
            finished = cursor + timedelta(seconds=rnd.randint(60, 420))
            note = 'sandbox demo \u00b7 ' + rnd.choice(INTENTS)
        else:
            if not ctx['routines']:
                continue
            routine = rnd.choice(ctx['routines'])
            slots = ctx['slots'].get(routine['id'], [])
            if not slots:
                continue
            keep = slots
            if rnd.random() < 0.35 and len(slots) > 3:
                keep = slots[:rnd.randint(max(2, len(slots) - 3), len(slots))]
            items = []
            local_media = []
            local_trainer = []
            cursor = started
            for slot in keep:
                item, media, trainer = make_item(slot, rnd, ctx, cursor, False)
                items.append(item)
                if media:
                    local_media.append((len(items) - 1, media))
                if trainer:
                    local_trainer.append((len(items) - 1, trainer))
                cursor += timedelta(seconds=item['elapsed_seconds'] + rnd.randint(90, 180))
            status = 'abandoned' if rnd.random() < 0.12 else 'finished'
            finished = cursor + timedelta(seconds=rnd.randint(60, 600))
            note = 'sandbox demo'
        sid = insert_session(conn, routine, items, started, finished, status,
                             free, note, rnd)
        sessions.append((sid, started, items))
        for pos, media in local_media:
            media_candidates.append((sid, pos, media))
        for pos, trainer in local_trainer:
            trainer_candidates.append((sid, pos, trainer))
    seed_fretboard(conn, rnd, trainer_candidates, now)
    seed_media(conn, rnd, media_candidates, now)
    seed_events(conn, rnd, sessions)
    return {'sessions': len(sessions), 'free': n_free,
            'media_candidates': len(media_candidates),
            'trainer_candidates': len(trainer_candidates)}

def _as_dt(value, fallback):
    if isinstance(value, datetime):
        return value
    if value:
        try:
            dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
        except ValueError:
            pass
    return fallback


def seed_fretboard(conn, rnd, candidates, now):
    total = 70
    linked = candidates[:40]
    cell_agg = {}
    attempts = 0
    for i in range(total):
        if i < len(linked):
            sid, pos, cand = linked[i]
            when = _as_dt(cand.get('started_at'),
                          now - timedelta(days=rnd.randint(1, 120)))
            duration = max(60, min(1800, int(cand.get('duration') or 120)))
            cid = cand.get('catalog_exercise_id')
            session_id, item_pos = sid, pos
        else:
            when = now - timedelta(days=rnd.randint(1, 120),
                                   hours=rnd.randint(0, 6))
            duration = rnd.randint(60, 180)
            cid, session_id, item_pos = None, None, None
        mode = rnd.choices(MODES, weights=[4, 3, 2], k=1)[0]
        hits = rnd.randint(12, 40)
        misses = rnd.randint(0, 8)
        score = hits - misses
        # Build the real answer sequence: the best streak is the longest run of
        # hits in it, so a 100% run gets best == hits and the raw cell attempts
        # add up to the same hits/misses as the run.
        outcomes = ['hit'] * hits + ['miss'] * misses
        rnd.shuffle(outcomes)
        best = 0
        streak = 0
        for outcome in outcomes:
            if outcome == 'hit':
                streak += 1
                if streak > best:
                    best = streak
            else:
                streak = 0
        if mode == 'identify':
            avg_ms = rnd.randint(600, 1100)
        elif mode == 'locate':
            avg_ms = rnd.randint(900, 1600)
        else:
            avg_ms = rnd.randint(1800, 2800)
        normalized = round(hits / (duration / 60.0), 1)
        run_uid = 'demo-fb-%03d' % (i + 1)
        conn.execute(
            'INSERT OR IGNORE INTO fretboard_stats(duration_seconds, normalized,'
            ' played_at, mode, hits, misses, score, best_streak, avg_ms, run_uid,'
            ' session_id, item_position, catalog_exercise_id)'
            ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (duration, normalized, _iso_z(when), mode, hits, misses, score,
             best, avg_ms, run_uid, session_id, item_pos, cid))
        for outcome in outcomes:
            string_no = rnd.randint(1, 6)
            fret = rnd.randint(0, 12)
            hit = outcome == 'hit'
            time_ms = rnd.randint(350, 2600) if hit else 0
            at = _db_text(when + timedelta(seconds=rnd.randint(0, duration)))
            conn.execute(
                'INSERT INTO fretboard_cell_attempts(run_uid, at, string_no,'
                ' fret, mode, kind, time_ms) VALUES(?,?,?,?,?,?,?)',
                (run_uid, at, string_no, fret, mode,
                 'hit' if hit else 'miss', time_ms))
            agg = cell_agg.setdefault((string_no, fret, mode), [0, 0, 0])
            if hit:
                agg[0] += 1
                agg[2] += time_ms
            else:
                agg[1] += 1
            attempts += 1
    for (string_no, fret, mode), (cell_hits, cell_misses, time_sum) in cell_agg.items():
        conn.execute(
            'INSERT INTO fretboard_cell_stats(string_no, fret, mode, hits,'
            ' misses, time_sum_ms) VALUES(?,?,?,?,?,?)'
            ' ON CONFLICT(string_no, fret, mode) DO UPDATE SET'
            ' hits=fretboard_cell_stats.hits+excluded.hits,'
            ' misses=fretboard_cell_stats.misses+excluded.misses,'
            ' time_sum_ms=fretboard_cell_stats.time_sum_ms+excluded.time_sum_ms',
            (string_no, fret, mode, cell_hits, cell_misses, time_sum))
    conn.commit()
    print('TRAINER: %d runs, %d raw attempts, %d cells'
          % (total, attempts, len(cell_agg)))

def seed_media(conn, rnd, candidates, now):
    made = 0
    for sid, pos, media in candidates:
        if rnd.random() > 0.72 or made >= 60:
            continue
        started = _as_dt(media.get('started_at'),
                         now - timedelta(days=rnd.randint(1, 60)))
        duration = rnd.choice([30, 45, 60, 90, 120, 180, 240])
        played = rnd.randint(20, duration)
        loops = rnd.randint(0, 12)
        if loops and rnd.random() < 0.65:
            ab_start = rnd.randint(0, max(0, duration - 30))
            ab_end = min(duration, ab_start + rnd.randint(10, 60))
        else:
            ab_start = ab_end = 0
        completed = 1 if rnd.random() < 0.55 else 0
        measured = 0 if media.get('kind') == 'youtube' else 1
        ended = started + timedelta(seconds=played + loops * 7
                                    + rnd.randint(10, 60))
        conn.execute(
            'INSERT OR IGNORE INTO media_plays(play_uid, session_id,'
            ' item_position, kind, ref, label, duration_seconds, played_seconds,'
            ' loops, ab_start, ab_end, completed, measured, started_at, ended_at)'
            ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            ('demo-media-%03d' % (made + 1), sid, pos, media.get('kind') or 'audio',
             media.get('ref') or '', media.get('label') or 'Practice loop',
             duration, played, loops, ab_start, ab_end, completed, measured,
             _db_text(started), _db_text(ended)))
        made += 1
    conn.commit()
    print('MEDIA  : %d plays' % made)


def seed_events(conn, rnd, sessions):
    recent = sorted(sessions, key=lambda x: x[1], reverse=True)[:15]
    made = 0
    for sid, started, items in recent:
        def add(at, etype, pos=None, num=0, text='', payload=None):
            nonlocal made
            made += 1
            conn.execute(
                'INSERT OR IGNORE INTO practice_events(event_uid, session_id,'
                ' item_position, at, type, value_num, value_text, payload)'
                ' VALUES(?,?,?,?,?,?,?,?)',
                ('demo-evt-%04d' % made, sid, pos, _db_text(at), etype,
                 num, str(text or '')[:200],
                 json.dumps(payload or {}, ensure_ascii=False)[:2000]))
        add(started, 'session_start', None, 0, 'sandbox demo')
        for pos, item in enumerate(items):
            if item['state'] == 'pending':
                continue
            st = _as_dt(item.get('started_at'), started + timedelta(minutes=pos * 5))
            en = _as_dt(item.get('finished_at'),
                        st + timedelta(seconds=item['elapsed_seconds']))
            add(st, 'item_play', pos, item['play_count'], item['name'])
            if item['pause_count']:
                add(st + (en - st) / 2, 'item_pause', pos, item['pause_count'])
            if item['reset_count']:
                add(st + (en - st) / 3, 'item_reset', pos, item['reset_count'])
            if item['repeat_count']:
                add(st + (en - st) / 4, 'item_repeat', pos, item['repeat_count'])
            if item['completed_by'] in ('timer', 'manual'):
                add(en, 'item_done', pos, 0, item['completed_by'])
            elif item['completed_by'] == 'skip':
                add(en, 'item_skip', pos, 0, 'skip')
            if item['used_audio'] or item['used_youtube']:
                add(st + timedelta(seconds=20), 'media_start', pos, 0,
                    'backing track')
                add(en - timedelta(seconds=20), 'media_stop', pos, 0,
                    'backing track')
            if item['used_metronome'] or item['used_drums']:
                add(st + timedelta(seconds=30), 'bpm_set', pos,
                    max(item['metro_bpm_end'], item['drums_bpm_end']), '')
    conn.commit()
    print('EVENTS : %d' % made)

def main():
    parser = argparse.ArgumentParser(description='Seed practice_sandbox.db with demo data')
    parser.add_argument('--force', action='store_true',
                        help='replace a previous demo seed')
    parser.add_argument('--days', type=int, default=120,
                        help='history window (default 120 days)')
    parser.add_argument('--sessions', type=int, default=110,
                        help='number of routine/free sessions (default 110)')
    parser.add_argument('--free', type=int, default=20,
                        help='minimum number of free-practice sessions (default 20)')
    args = parser.parse_args()
    if os.path.basename(DB) != 'practice_sandbox.db':
        raise SystemExit('refusing to seed %s' % DB)
    if not os.path.isfile(DB):
        raise SystemExit('missing %s' % DB)
    backup_sandbox()
    db.set_db_path(DB)
    db.init_db()
    conn = db.db_connect()
    try:
        existing = conn.execute(
            "SELECT COUNT(*) FROM routine_sessions WHERE note LIKE 'sandbox demo%'"
        ).fetchone()[0]
        if existing and not args.force:
            print('KEEP   : %d demo sessions already present; use --force to replace'
                  % existing)
            return 0
        if args.force:
            clear_demo(conn)
        rnd = random.Random(17)
        add_demo_resources(conn, rnd)
        summary = seed(conn, args.days, args.sessions, args.free, rnd)
        conn.execute('INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)',
                     (MARKER, datetime.now(timezone.utc).isoformat(timespec='seconds')))
        conn.commit()
        tables = ('routine_sessions', 'routine_session_items', 'fretboard_stats',
                  'fretboard_cell_attempts', 'fretboard_cell_stats', 'media_plays',
                  'practice_events', 'resources', 'catalog_exercise_resources')
        counts = {t: conn.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0]
                  for t in tables}
        print('DONE   : %s' % summary)
        print('COUNTS : %s' % counts)
        print('INFO   : restart the sandbox (IniciarPracticeHubSandbox.vbs) so the'
              ' server loads the latest Python code; the database is kept.')
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
