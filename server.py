"""Guitar Practice Hub - servidor local (solo libreria estandar).

Capa HTTP: sirve estaticos desde la carpeta padre y expone la API REST/SQLite.
La capa de datos (esquema, seed y CRUD) vive en db.py.

Uso:  python server.py [puerto]
"""
import os, sys, re, functools, mimetypes, subprocess, threading, json, unicodedata
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from datetime import datetime, timedelta

from db import (
    ROOT, DEFAULT_PORT, db_connect, init_db, _is_media_allowed,
    api_state, api_routines, _routine_full, create_routine, update_routine,
    delete_routine, activate_routine, duplicate_routine,
    create_exercise, update_exercise, delete_exercise, reorder_exercises,
    WIDGETS, api_sections, create_section, update_section, delete_section,
    reorder_sections, create_section_item, update_item, delete_item,
    reorder_items, refresh_item_folder, get_setting, set_setting,
    add_fretboard_stat, get_fretboard_stats,
    add_cell_attempt, get_cell_stats,
    get_song_cache, set_song_cache,
    table_counts, clear_tables,
    start_session, upsert_session_item, finish_session, list_sessions,
    session_stats, _session_full, seed_sessions, active_session,
    export_csv, get_settings_prefix,
    AREAS_KEY, areas, clean_areas, areas_in_use,
    list_catalog, catalog_detail,
    create_catalog_exercise, update_catalog_exercise, delete_catalog_exercise,
)
import db as dbmod
import lastfm

HERE = os.path.dirname(os.path.abspath(__file__))
MAIN_DB = os.path.join(HERE, 'practice.db')
SANDBOX_DB = os.path.join(HERE, 'practice_sandbox.db')
LASTFM_WORKER = None


def _sandbox_mode():
    """True when the server is NOT using the real practice.db."""
    try:
        return os.path.abspath(dbmod.DB_PATH) != os.path.abspath(MAIN_DB)
    except Exception:  # noqa: BLE001
        return False

# ------------------------- Song Info (FreqBlog) helpers -------------------------

FREQBLOG_BASE = 'https://api.freqblog.com'
API_KEY_SETTING = 'freqblog_api_key'


def _freqblog_get(path, params, api_key, timeout=30):
    """GET a la API de FreqBlog. Devuelve (status, headers, body|None).

    status 0 = error de red / timeout. No usa CORS: es server-to-server.
    """
    url = FREQBLOG_BASE + path
    if params:
        url += '?' + urlencode(params)
    req = Request(url, headers={'X-Api-Key': api_key, 'Accept': 'application/json'})
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read().decode('utf-8') or 'null'
            try:
                return r.status, dict(r.headers or {}), json.loads(raw)
            except Exception:  # noqa: BLE001
                return r.status, dict(r.headers or {}), None
    except HTTPError as e:
        body = None
        try:
            body = json.loads((e.read().decode('utf-8') or 'null'))
        except Exception:  # noqa: BLE001
            pass
        return e.code, dict(getattr(e, 'headers', {}) or {}), body
    except Exception as e:  # noqa: BLE001
        return 0, {}, {'error': 'network', 'detail': str(e)}


def _norm_query(s):
    """Clave de cache estable: minusculas, sin acentos, solo [a-z0-9-]."""
    s = unicodedata.normalize('NFKD', (s or '').lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'query'


def _fb_detail(body):
    if isinstance(body, dict):
        return (body.get('detail') or body.get('error_code')
                or body.get('error') or body.get('reason') or '')
    return ''


def _header(headers, name, default=None):
    for k, v in (headers or {}).items():
        if str(k).lower() == name.lower():
            return v
    return default


def _retry_seconds(headers, default=2):
    try:
        return max(1, int(float(_header(headers, 'Retry-After', default))))
    except Exception:  # noqa: BLE001
        return default


def _retry_at_iso(headers, default_days=7):
    """Fecha (UTC) hasta la que no merece la pena reintentar un 404."""
    days = default_days
    raw = _header(headers, 'Retry-After')
    if raw:
        try:
            days = max(1, int(round(float(raw) / 86400.0)))
        except Exception:  # noqa: BLE001
            pass
    return (datetime.utcnow() + timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%S')


def _now_iso():
    return datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S')


def _human_key(raw):
    """'F-Minor' -> 'Fm' · 'C-Major' -> 'C' · 'Unknown'/'' -> ''."""
    k = (raw or '').strip()
    if not k:
        return ''
    m = re.match(r'^([A-G][#b]?)\s*[- ]?\s*(Major|Minor)$', k, re.I)
    if m:
        return m.group(1) + ('m' if m.group(2).lower() == 'minor' else '')
    if k.lower() in ('unknown', 'none'):
        return ''
    return k


def _song_payload(d):
    """JSON reducido que consume el widget (nunca incluye la API key)."""
    d = d or {}
    bpm = d.get('bpm_snapped')
    if bpm is None and d.get('bpm') is not None:
        try:
            bpm = int(round(float(d['bpm'])))
        except Exception:  # noqa: BLE001
            bpm = None
    raw_key = str(d.get('key') or '')
    return {
        'status': 'ok',
        'bpm': bpm,
        'bpm_exact': d.get('bpm'),
        'bpm_alt': d.get('bpm_alt'),
        'key': _human_key(raw_key),
        'key_raw': raw_key,
        'key_confidence': d.get('key_confidence'),
        'camelot': d.get('camelot'),
        'feature_source': d.get('feature_source'),
        'matched': {
            'track': d.get('track_name') or '',
            'artist': d.get('artist_name') or '',
            'album': d.get('album_name') or '',
            'duration_ms': d.get('duration_ms'),
            'isrc': d.get('isrc') or '',
        },
    }

def pick_dialog(mode):
    if mode == 'folder':
        code = (
            "import tkinter as tk\nfrom tkinter import filedialog\n"
            "r=tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
            "p=filedialog.askdirectory(title='Select backing tracks folder')\n"
            "print(p or '')\n"
        )
    else:
        code = (
            "import tkinter as tk\nfrom tkinter import filedialog\n"
            "r=tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
            "p=filedialog.askopenfilename(title='Select file', "
            "filetypes=[('Audio','*.mp3 *.m4a *.wav *.ogg *.flac'),('All files','*.*')])\n"
            "print(p or '')\n"
        )
    flags = 0x08000000 if os.name == 'nt' else 0  # CREATE_NO_WINDOW
    try:
        out = subprocess.run([sys.executable, '-c', code],
                             capture_output=True, text=True, creationflags=flags)
        lines = (out.stdout or '').strip().splitlines()
        return lines[-1] if lines and lines[-1] else None
    except Exception:  # noqa: BLE001
        return None


def _dialog_file_payload(path):
    """Result of the native file picker, with ID3 tags when it is an MP3.

    The manager uses ``artist``/``title`` to prefill the Tag and Label inputs
    of a Local song / Local file item. Reading the file here avoids a second
    request and works even before the item exists in the database (the
    /api/media allow-list only knows saved items).
    """
    out = {'path': path}
    if path and path.lower().endswith('.mp3') and os.path.isfile(path):
        tags = lastfm.read_mp3_tags(path)
        out.update({
            'artist': (tags.get('artist') or '').strip(),
            'title': (tags.get('title') or '').strip(),
            'album': (tags.get('album') or '').strip(),
        })
    return out


class Handler(SimpleHTTPRequestHandler):
    """Sirve estaticos desde ROOT y atiende /api/* con JSON."""

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_csv(self, filename, text):
        """CSV download; the BOM makes Excel read the accents right."""
        body = ('\ufeff' + text).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/csv; charset=utf-8')
        self.send_header('Content-Disposition', 'attachment; filename="%s"' % filename)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except (TypeError, ValueError):
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:  # noqa: BLE001
            return {}

    # ------------------------- Song Info (FreqBlog) -------------------------

    def _api_key(self, conn):
        return (get_setting(conn, API_KEY_SETTING) or '').strip()

    def _song_search(self, conn):
        qs = parse_qs(urlparse(self.path).query)
        q = (qs.get('q') or [''])[0].strip()
        if not q:
            return self._send_json({'error': 'missing_q'}, 422)
        api_key = self._api_key(conn)
        if not api_key:
            return self._send_json({'error': 'no_api_key'}, 400)
        status, _h, body = _freqblog_get('/search', {'q': q, 'limit': 5}, api_key, timeout=20)
        if status != 200:
            code = status if status in (401, 429) else 502
            return self._send_json({'error': 'upstream', 'status': status,
                                    'detail': _fb_detail(body)}, code)
        cands = []
        for r in ((body or {}).get('results') or [])[:5]:
            cands.append({
                'track': r.get('track_name') or '',
                'artist': r.get('artist_name') or '',
                'album': r.get('album_name') or '',
                'duration_ms': r.get('duration_ms'),
                'isrc': r.get('isrc') or '',
                'mbid': r.get('mbid') or '',
            })
        return self._send_json({'q': q, 'candidates': cands})

    def _song_info(self, conn):
        qs = parse_qs(urlparse(self.path).query)
        track = (qs.get('track') or [''])[0].strip()
        artist = (qs.get('artist') or [''])[0].strip()
        isrc = (qs.get('isrc') or [''])[0].strip().upper()
        if not track and not isrc:
            return self._send_json({'error': 'missing_track'}, 422)
        cache_key = isrc or _norm_query(artist + ' ' + track)
        cached = get_song_cache(conn, cache_key)
        if cached:
            try:
                payload = json.loads(cached.get('payload') or '{}')
            except Exception:  # noqa: BLE001
                payload = {}
            if cached['status'] == 200:
                payload['cached'] = True
                return self._send_json(payload)
            if cached['status'] == 404 and (cached.get('retry_after') or '') > _now_iso():
                payload['cached'] = True
                return self._send_json(payload, 404)
        api_key = self._api_key(conn)
        if not api_key:
            return self._send_json({'error': 'no_api_key'}, 400)
        params = {'wait': 25}
        if track:
            params['track'] = track
        if artist:
            params['artist'] = artist
        if isrc and not track:
            params['isrc'] = isrc
        status, headers, body = _freqblog_get('/lookup', params, api_key, timeout=32)
        if status == 200:
            payload = _song_payload(body)
            set_song_cache(conn, cache_key, (track or isrc), 200, payload)
            payload['cached'] = False
            return self._send_json(payload)
        if status == 202:
            return self._send_json({'status': 'pending', 'retry_after': 3,
                                    'poll_url': (body or {}).get('poll_url') or ''}, 202)
        if status == 404:
            payload = {'status': 'not_found', 'detail': _fb_detail(body), 'terminal': True}
            set_song_cache(conn, cache_key, (track or isrc), 404, payload,
                           retry_after=_retry_at_iso(headers))
            return self._send_json(payload, 404)
        if status == 401:
            return self._send_json({'status': 'unauthorized', 'detail': _fb_detail(body)}, 401)
        if status == 429:
            return self._send_json({'status': 'rate_limited',
                                    'retry_after': _retry_seconds(headers)}, 429)
        return self._send_json({'status': 'error', 'code': status,
                                'detail': _fb_detail(body) or 'network'}, 502)

    def _song_key_check(self, conn):
        api_key = self._api_key(conn)
        if not api_key:
            return self._send_json({'ok': False, 'error': 'no_api_key'}, 400)
        status, _h, body = _freqblog_get('/me/stats', {}, api_key, timeout=15)
        if status == 200:
            return self._send_json({'ok': True, 'stats': body})
        if status == 401:
            return self._send_json({'ok': False, 'error': 'invalid_key',
                                    'detail': _fb_detail(body)}, 401)
        return self._send_json({'ok': False, 'error': 'upstream', 'status': status,
                                'detail': _fb_detail(body)}, 502)

    def end_headers(self):
        # Evita que el navegador cachee JS/CSS/HTML/API (el audio si puede cachearse)
        if not getattr(self, '_cache_ok', False):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def guess_type(self, path):
        """Static files are UTF-8: say it in the header, do not rely on <meta>."""
        guess = super().guess_type(path)
        if (guess.startswith('text/') or guess == 'application/javascript') \
                and 'charset' not in guess:
            guess += '; charset=utf-8'
        return guess

    def _route_api(self, method):
        self._cache_ok = False
        path = urlparse(self.path).path
        conn = db_connect()
        try:
            data = self._read_json() if method in ('POST', 'PUT', 'PATCH') else {}

            if path == '/api/ping':
                return self._send_json({'ok': True})
            if path == '/api/health' and method == 'GET':
                return self._send_json({
                    'ok': True,
                    'db': os.path.basename(dbmod.DB_PATH),
                    'path': dbmod.DB_PATH,
                    'sandbox': _sandbox_mode(),
                })
            # Debug endpoints: refused unless the server runs on a sandbox DB,
            # so a stray call can never touch the real practice.db.
            if path.startswith('/api/debug/'):
                if not _sandbox_mode():
                    return self._send_json({'error': 'not_sandbox'}, 403)
                if path == '/api/debug/state' and method == 'GET':
                    return self._send_json({
                        'db': os.path.basename(dbmod.DB_PATH),
                        'sandbox': True,
                        'tables': table_counts(conn),
                    })
                if path == '/api/debug/reset' and method == 'POST':
                    cleared = clear_tables(conn)
                    if all(v is None for v in cleared.values()):
                        return self._send_json({'error': 'no_session_tables'}, 409)
                    return self._send_json({'cleared': cleared})
                if path == '/api/debug/seed' and method == 'POST':
                    qs = parse_qs(urlparse(self.path).query)
                    r = seed_sessions(conn,
                                      days=int((qs.get('days') or ['60'])[0] or 60),
                                      sessions=int((qs.get('sessions') or ['40'])[0] or 40))
                    return self._send_json(r, 409 if 'error' in r else 200)
                return self._send_json({'error': 'not_found'}, 404)
            if path == '/api/state' and method == 'GET':
                return self._send_json(api_state(conn))

            # ---- Session log (practice history) ---------------------------
            if path == '/api/sessions' and method == 'GET':
                qs = parse_qs(urlparse(self.path).query)
                return self._send_json(list_sessions(
                    conn,
                    date_from=(qs.get('from') or [None])[0],
                    date_to=(qs.get('to') or [None])[0],
                    limit=int((qs.get('limit') or ['50'])[0] or 50),
                    offset=int((qs.get('offset') or ['0'])[0] or 0)))
            if path == '/api/sessions/stats' and method == 'GET':
                qs = parse_qs(urlparse(self.path).query)
                return self._send_json(session_stats(
                    conn,
                    int((qs.get('days') or ['30'])[0] or 30),
                    area_id=(qs.get('area_id') or [None])[0],
                    routine_id=(qs.get('routine_id') or [None])[0]))

            # ---- Global exercise catalog ------------------------------------
            if path == '/api/catalog':
                if method == 'GET':
                    qs = parse_qs(urlparse(self.path).query)
                    return self._send_json(
                        {'exercises': list_catalog(conn, (qs.get('q') or [''])[0])})
                if method == 'POST':
                    r = create_catalog_exercise(conn, data)
                    if 'error' in r:
                        return self._send_json(r, 422)
                    return self._send_json(r, 201)
            m = re.fullmatch(r'/api/catalog/(\d+)', path)
            if m:
                cid = int(m.group(1))
                if method == 'GET':
                    r = catalog_detail(conn, cid)
                    return self._send_json(r if r else {'error': 'not_found'},
                                           200 if r else 404)
                if method == 'PUT':
                    r = update_catalog_exercise(conn, cid, data)
                    if r is None:
                        return self._send_json({'error': 'not_found'}, 404)
                    if 'error' in r:
                        return self._send_json(r, 422)
                    return self._send_json(r)
                if method == 'DELETE':
                    r = delete_catalog_exercise(conn, cid)
                    return self._send_json(r if r else {'error': 'not_found'},
                                           200 if r else 404)
            if path == '/api/sessions/active' and method == 'GET':
                r = active_session(conn)
                return self._send_json(r if r else {'session': None})
            if path == '/api/prefs' and method == 'GET':
                return self._send_json(get_settings_prefix(conn, 'ui_'))
            m = re.fullmatch(r'/api/export/(sessions|items)\.csv', path)
            if m and method == 'GET':
                return self._send_csv('practice-' + m.group(1) + '.csv',
                                      export_csv(conn, m.group(1)))
            if path == '/api/sessions/start' and method == 'POST':
                r = start_session(conn, data)
                return self._send_json(r if r else {'error': 'bad_request'}, 201 if r else 400)
            m = re.fullmatch(r'/api/sessions/(\d+)', path)
            if m and method == 'GET':
                r = _session_full(conn, int(m.group(1)))
                return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)
            m = re.fullmatch(r'/api/sessions/(\d+)/item', path)
            if m and method == 'PUT':
                r = upsert_session_item(conn, int(m.group(1)), data)
                if r is None:
                    return self._send_json({'error': 'not_found'}, 404)
                if 'error' in r:
                    return self._send_json(r, 409)
                return self._send_json(r)
            m = re.fullmatch(r'/api/sessions/(\d+)/finish', path)
            if m and method == 'POST':
                r = finish_session(conn, int(m.group(1)), data)
                return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)
            if path == '/api/routines':
                if method == 'GET':
                    return self._send_json(api_routines(conn))
                if method == 'POST':
                    return self._send_json(create_routine(conn, data), 201)

            m = re.fullmatch(r'/api/routines/(\d+)', path)
            if m:
                rid = int(m.group(1))
                if method == 'GET':
                    r = _routine_full(conn, rid)
                    return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)
                if method == 'PUT':
                    r = update_routine(conn, rid, data)
                    return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)
                if method == 'DELETE':
                    return self._send_json(delete_routine(conn, rid))

            m = re.fullmatch(r'/api/routines/(\d+)/activate', path)
            if m and method == 'POST':
                return self._send_json(activate_routine(conn, int(m.group(1))))

            m = re.fullmatch(r'/api/routines/(\d+)/exercises', path)
            if m and method == 'POST':
                r = create_exercise(conn, int(m.group(1)), data)
                if r is None:
                    return self._send_json({'error': 'not_found'}, 404)
                if 'error' in r:
                    return self._send_json(r, 422)
                return self._send_json(r)

            m = re.fullmatch(r'/api/routines/(\d+)/reorder', path)
            if m and method == 'POST':
                r = reorder_exercises(conn, int(m.group(1)), data.get('order', []))
                return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)

            m = re.fullmatch(r'/api/exercises/(\d+)', path)
            if m:
                eid = int(m.group(1))
                if method == 'PUT':
                    r = update_exercise(conn, eid, data)
                    if r is None:
                        return self._send_json({'error': 'not_found'}, 404)
                    if 'error' in r:
                        return self._send_json(r, 422)
                    return self._send_json(r)
                if method == 'DELETE':
                    return self._send_json(delete_exercise(conn, eid))

            if path == '/api/widgets' and method == 'GET':
                return self._send_json(WIDGETS)
            if path == '/api/sections':
                if method == 'GET':
                    return self._send_json(api_sections(conn))
                if method == 'POST':
                    return self._send_json(create_section(conn, data), 201)
            if path == '/api/sections/reorder' and method == 'POST':
                return self._send_json(reorder_sections(conn, data.get('order', []),
                                                        data.get('layout')))
            m = re.fullmatch(r'/api/sections/(\d+)', path)
            if m:
                sid = int(m.group(1))
                if method == 'PUT':
                    r = update_section(conn, sid, data)
                    return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)
                if method == 'DELETE':
                    return self._send_json(delete_section(conn, sid))
            m = re.fullmatch(r'/api/sections/(\d+)/items', path)
            if m and method == 'POST':
                r = create_section_item(conn, int(m.group(1)), data)
                return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)
            m = re.fullmatch(r'/api/sections/(\d+)/items/reorder', path)
            if m and method == 'POST':
                return self._send_json(reorder_items(conn, int(m.group(1)), data.get('order', [])))
            m = re.fullmatch(r'/api/items/(\d+)', path)
            if m:
                iid = int(m.group(1))
                if method == 'PUT':
                    r = update_item(conn, iid, data)
                    return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)
                if method == 'DELETE':
                    return self._send_json(delete_item(conn, iid))
            m = re.fullmatch(r'/api/items/(\d+)/refresh', path)
            if m and method == 'POST':
                r = refresh_item_folder(conn, int(m.group(1)))
                return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)
            if path == '/api/fretboard/stats':
                if method == 'GET':
                    return self._send_json(get_fretboard_stats(conn))
                if method == 'POST':
                    return self._send_json(add_fretboard_stat(conn, data.get('duration_seconds'), data.get('normalized')))
            if path == '/api/fretboard/cell' and method == 'POST':
                return self._send_json(add_cell_attempt(conn, data.get('string_no'), data.get('fret'),
                                                        data.get('kind'), data.get('time_ms'), data.get('mode')))
            if path == '/api/fretboard/cell-stats' and method == 'GET':
                return self._send_json(get_cell_stats(conn))
            if path == '/api/dialog/folder' and method == 'POST':
                return self._send_json({'path': pick_dialog('folder')})
            if path == '/api/dialog/file' and method == 'POST':
                return self._send_json(_dialog_file_payload(pick_dialog('file')))

            m = re.fullmatch(r'/api/routines/(\d+)/duplicate', path)
            if m and method == 'POST':
                r = duplicate_routine(conn, int(m.group(1)))
                return self._send_json(r if r else {'error': 'not_found'}, 200 if r else 404)

            if path == '/api/song/search' and method == 'GET':
                return self._song_search(conn)
            if path == '/api/song/info' and method == 'GET':
                return self._song_info(conn)
            if path == '/api/song/key-check' and method == 'GET':
                return self._song_key_check(conn)

            if path == '/api/lastfm/status' and method == 'GET':
                return self._send_json(lastfm.status(conn))
            if path == '/api/lastfm/config' and method == 'POST':
                return self._send_json(lastfm.set_config(conn, data))
            if path == '/api/lastfm/auth/start' and method == 'POST':
                r = lastfm.auth_start(conn)
                return self._send_json(r, 200 if r.get('ok') else 400)
            if path == '/api/lastfm/auth/status' and method == 'GET':
                r = lastfm.auth_status(conn)
                if r.get('auth_state') == 'connected' and LASTFM_WORKER:
                    LASTFM_WORKER.wake()
                return self._send_json(r)
            if path == '/api/lastfm/disconnect' and method == 'POST':
                return self._send_json(lastfm.disconnect(conn))
            if path == '/api/lastfm/track-meta' and method == 'GET':
                qs = parse_qs(urlparse(self.path).query)
                value = (qs.get('url') or qs.get('path') or [''])[0]
                duration = (qs.get('duration') or [None])[0]
                return self._send_json(lastfm.track_meta(conn, value, duration))
            if path == '/api/lastfm/scrobble' and method == 'POST':
                r = lastfm.prepare_scrobble(conn, data)
                if r.get('queued') and LASTFM_WORKER:
                    LASTFM_WORKER.wake()
                return self._send_json(r)

            if path == '/api/shutdown' and method == 'POST':
                def _shutdown():
                    if LASTFM_WORKER:
                        LASTFM_WORKER.stop()
                    self.server.shutdown()
                threading.Thread(target=_shutdown, daemon=True).start()
                return self._send_json({'ok': True})

            m = re.fullmatch(r'/api/settings/([A-Za-z0-9_\-]+)', path)
            if m:
                key = m.group(1)
                if key in lastfm.SECRET_SETTINGS:
                    return self._send_json({'error': 'forbidden'}, 403)
                if method == 'GET':
                    if key == AREAS_KEY:
                        return self._send_json({
                            'key': key,
                            'value': json.dumps(areas(conn), ensure_ascii=False)})
                    return self._send_json({'key': key, 'value': get_setting(conn, key)})
                if method in ('PUT', 'POST'):
                    value = data.get('value', '')
                    if key == AREAS_KEY:
                        new_areas, err = clean_areas(value)
                        if err:
                            return self._send_json({'error': err}, 422)
                        keep = {a['id'] for a in new_areas}
                        used = areas_in_use(conn)
                        blocking = [aid for aid in used if aid not in keep]
                        if blocking:
                            # Removing an area that a slot still uses would leave
                            # orphan labels, so it is refused instead.
                            return self._send_json({
                                'error': 'area_in_use',
                                'slots': [s for aid in blocking for s in used[aid]]}, 409)
                    set_setting(conn, key, value)
                    return self._send_json({'ok': True})

            self._send_json({'error': 'not_found', 'method': method, 'path': path}, 404)
        except Exception as exc:  # noqa: BLE001
            self._send_json({'error': 'server_error', 'detail': str(exc)}, 500)
        finally:
            conn.close()

    def _is_blocked(self, path):
        p = unquote(path).lower()
        return p.endswith('.db') or p.endswith('.db-wal') or p.endswith('.db-shm') \
            or p.endswith('.py') or p.endswith('seed.json')

    def _serve_media(self):
        self._cache_ok = True
        qs = parse_qs(urlparse(self.path).query)
        target = (qs.get('path') or [''])[0]
        if not target:
            return self._send_json({'error': 'no_path'}, 400)
        conn = db_connect()
        try:
            allowed = _is_media_allowed(conn, target)
        finally:
            conn.close()
        if not allowed:
            return self._send_json({'error': 'forbidden'}, 403)
        if not os.path.isfile(target):
            return self._send_json({'error': 'not_found'}, 404)
        ctype = mimetypes.guess_type(target)[0] or 'application/octet-stream'
        size = os.path.getsize(target)
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            try:
                spec = rng.split('=', 1)[1].split(',')[0].strip()
                if spec.startswith('-'):
                    start = max(0, size - int(spec[1:]))
                else:
                    parts = spec.split('-')
                    start = int(parts[0])
                    if len(parts) > 1 and parts[1]:
                        end = int(parts[1])
                end = min(end, size - 1)
                if start <= end:
                    status = 206
                else:
                    start, end, status = 0, size - 1, 200
            except Exception:  # noqa: BLE001
                start, end, status = 0, size - 1, 200
        length = end - start + 1
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(length))
        if status == 206:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.end_headers()
        try:
            with open(target, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except Exception:  # noqa: BLE001
            pass

    def _serve_cover(self):
        """Serve the embedded ID3 cover for an allowed local MP3."""
        self._cache_ok = True
        qs = parse_qs(urlparse(self.path).query)
        target = (qs.get('path') or [''])[0]
        target = lastfm.media_path(target)
        if not target or not target.lower().endswith('.mp3'):
            return self._send_json({'error': 'no_path'}, 400)
        conn = db_connect()
        try:
            allowed = _is_media_allowed(conn, target)
        finally:
            conn.close()
        if not allowed:
            return self._send_json({'error': 'forbidden'}, 403)
        if not os.path.isfile(target):
            return self._send_json({'error': 'not_found'}, 404)
        cover = lastfm.read_mp3_cover(target)
        if not cover:
            return self._send_json({'error': 'no_cover'}, 404)
        body = cover['data']
        self.send_response(200)
        self.send_header('Content-Type', cover['mime'])
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'private, max-age=300')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:  # noqa: BLE001
            pass

    def do_GET(self):
        self._cache_ok = False
        path = urlparse(self.path).path
        if path == '/api/cover':
            return self._serve_cover()
        if path == '/api/media':
            return self._serve_media()
        if path.startswith('/api/'):
            return self._route_api('GET')
        if self._is_blocked(path):
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path.startswith('/api/'):
            return self._route_api('POST')
        return self.send_error(405)

    def do_PUT(self):
        if urlparse(self.path).path.startswith('/api/'):
            return self._route_api('PUT')
        return self.send_error(405)

    def do_DELETE(self):
        if urlparse(self.path).path.startswith('/api/'):
            return self._route_api('DELETE')
        return self.send_error(405)

    def log_message(self, fmt, *args):  # silencio en ventana oculta
        pass


def main():
    # `python server.py [port] [--sandbox]`
    flags = [a for a in sys.argv[1:] if a.startswith('--')]
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = int(args[0]) if args else DEFAULT_PORT

    if '--sandbox' in flags:
        dbmod.set_db_path(SANDBOX_DB)
    elif os.environ.get('GPH_DB'):
        dbmod.set_db_path(os.environ['GPH_DB'])

    init_db()
    global LASTFM_WORKER
    LASTFM_WORKER = lastfm.LastfmWorker(sandbox=_sandbox_mode())
    LASTFM_WORKER.start()
    handler = functools.partial(Handler, directory=ROOT)
    with ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        extra = '  [SANDBOX ' + os.path.basename(dbmod.DB_PATH) + ']' if _sandbox_mode() else ''
        print(f'Guitar Practice Hub en http://127.0.0.1:{port}  (root={ROOT})' + extra)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            if LASTFM_WORKER:
                LASTFM_WORKER.stop()


if __name__ == '__main__':
    main()
