"""Last.fm scrobbling helpers: ID3 tags, API client, auth and queue worker.

Everything stays on the local server: the browser never sees the API secret or
the session key.  The live queue is SQLite (lastfm_scrobbles) so a server
restart or a network failure never loses a confirmed play.
"""
import hashlib
import json
import math
import os
import random
import threading
import time
import uuid
from urllib.parse import urlencode, urlparse, parse_qs, unquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import db

API_URL = 'https://ws.audioscrobbler.com/2.0/'
AUTH_URL = 'https://www.last.fm/api/auth/'
USER_AGENT = 'GuitarPracticeHub/1.2 (https://github.com/miguelamacias/guitar-practice-assistant)'
MIN_DURATION = 120                 # "more than 1:59": a 2:00 track is eligible
MAX_BATCH = 50
AUTH_TIMEOUT = 300

SETTING_API_KEY = 'lastfm_api_key'
SETTING_API_SECRET = 'lastfm_api_secret'
SETTING_SESSION = 'lastfm_session_key'
SETTING_USERNAME = 'lastfm_username'
SETTING_ENABLED = 'lastfm_enabled'
SETTING_PENDING_TOKEN = 'lastfm_pending_token'
SETTING_PENDING_AT = 'lastfm_pending_at'
SETTING_LAST_ERROR = 'lastfm_last_error'

SECRET_SETTINGS = {
    SETTING_API_SECRET, SETTING_SESSION, SETTING_PENDING_TOKEN,
}


def _get(conn, key):
    return (db.get_setting(conn, key) or '').strip()


def _set(conn, key, value):
    db.set_setting(conn, key, '' if value is None else str(value))


def status(conn):
    api_key = _get(conn, SETTING_API_KEY)
    secret_set = bool(_get(conn, SETTING_API_SECRET))
    session = bool(_get(conn, SETTING_SESSION))
    token = bool(_get(conn, SETTING_PENDING_TOKEN))
    enabled = _get(conn, SETTING_ENABLED) != '0'
    return {
        'configured': bool(api_key and secret_set),
        'api_key': api_key,
        'api_secret_set': secret_set,
        'authenticated': session,
        'username': _get(conn, SETTING_USERNAME),
        'enabled': enabled,
        'auth_pending': token,
        'min_duration': MIN_DURATION,
        'queue': db.lastfm_queue_counts(conn),
        'last_error': _get(conn, SETTING_LAST_ERROR),
    }


def set_config(conn, data):
    api_key = str(data.get('api_key') or '').strip()
    api_secret = str(data.get('api_secret') or '').strip()
    clear_secret = bool(data.get('clear_secret'))
    enabled = data.get('enabled')
    changed = False
    current_key = _get(conn, SETTING_API_KEY)
    current_secret = _get(conn, SETTING_API_SECRET)
    if api_key and api_key != current_key:
        _set(conn, SETTING_API_KEY, api_key)
        changed = True
    if clear_secret and current_secret:
        _set(conn, SETTING_API_SECRET, '')
        changed = True
    elif api_secret and api_secret != current_secret:
        _set(conn, SETTING_API_SECRET, api_secret)
        changed = True
    if enabled is not None:
        _set(conn, SETTING_ENABLED, '1' if enabled else '0')
    if changed:
        # A new key/secret invalidates the previous Last.fm session.
        _set(conn, SETTING_SESSION, '')
        _set(conn, SETTING_USERNAME, '')
        _set(conn, SETTING_PENDING_TOKEN, '')
        _set(conn, SETTING_PENDING_AT, '')
        _set(conn, SETTING_LAST_ERROR, '')
    return status(conn)


def disconnect(conn):
    _set(conn, SETTING_SESSION, '')
    _set(conn, SETTING_USERNAME, '')
    _set(conn, SETTING_PENDING_TOKEN, '')
    _set(conn, SETTING_PENDING_AT, '')
    _set(conn, SETTING_LAST_ERROR, '')
    return status(conn)

# ----------------------------- ID3 tags -----------------------------

_TAG_CACHE = {}
_TAG_LOCK = threading.Lock()
_MAX_TAG_BYTES = 4 * 1024 * 1024

# ID3v2.2 PIC stores a three-letter format instead of a MIME string.
_PIC_MIME = {'JPG': 'image/jpeg', 'JPEG': 'image/jpeg', 'PNG': 'image/png',
             'GIF': 'image/gif', 'BMP': 'image/bmp'}


def _syncsafe(raw):
    if len(raw) != 4:
        return 0
    return ((raw[0] & 0x7f) << 21) | ((raw[1] & 0x7f) << 14) | \
        ((raw[2] & 0x7f) << 7) | (raw[3] & 0x7f)


def _decode_text(payload):
    if not payload:
        return ''
    enc = payload[0]
    raw = payload[1:]
    try:
        if enc == 0:
            text = raw.decode('latin-1', errors='replace')
        elif enc == 1:
            try:
                text = raw.decode('utf-16', errors='replace')
            except UnicodeError:
                text = raw.decode('utf-16-le', errors='replace')
        elif enc == 2:
            text = raw.decode('utf-16-be', errors='replace')
        elif enc == 3:
            text = raw.decode('utf-8', errors='replace')
        else:
            text = raw.decode('latin-1', errors='replace')
    except Exception:  # noqa: BLE001
        return ''
    text = text.replace('\ufeff', '')
    parts = [p.strip() for p in text.split('\x00') if p.strip()]
    return parts[0] if parts else ''


def _read_id3(path):
    tags = {'artist': '', 'title': '', 'album': ''}
    try:
        with open(path, 'rb') as f:
            head = f.read(10)
            if len(head) == 10 and head[:3] == b'ID3':
                version = head[3]
                flags = head[5]
                size = _syncsafe(head[6:10])
                data = f.read(min(size, _MAX_TAG_BYTES))
                if flags & 0x80:
                    data = data.replace(b'\xff\x00', b'\xff')
                pos = 0
                if flags & 0x40 and len(data) >= 4:
                    pos = _syncsafe(data[:4]) if version == 4 else \
                        4 + int.from_bytes(data[:4], 'big')
                ids = {'TIT2': 'title', 'TPE1': 'artist', 'TALB': 'album',
                       'TT2': 'title', 'TP1': 'artist', 'TAL': 'album'}
                while pos + 6 <= len(data):
                    if data[pos] == 0:
                        break
                    if version == 2:
                        fid = data[pos:pos + 3].decode('latin-1', errors='replace')
                        fsize = int.from_bytes(data[pos + 3:pos + 6], 'big')
                        hdr = 6
                    else:
                        fid = data[pos:pos + 4].decode('latin-1', errors='replace')
                        if version == 4:
                            fsize = _syncsafe(data[pos + 4:pos + 8])
                        else:
                            fsize = int.from_bytes(data[pos + 4:pos + 8], 'big')
                        hdr = 10
                    if fsize <= 0 or pos + hdr + fsize > len(data):
                        break
                    key = ids.get(fid)
                    if key:
                        tags[key] = _decode_text(data[pos + hdr:pos + hdr + fsize])
                    pos += hdr + fsize
            if not all(tags.values()):
                f.seek(-128, os.SEEK_END)
                tail = f.read(128)
                if len(tail) == 128 and tail[:3] == b'TAG':
                    if not tags['title']:
                        tags['title'] = tail[3:33].decode('latin-1', errors='replace').strip('\x00 ')
                    if not tags['artist']:
                        tags['artist'] = tail[33:63].decode('latin-1', errors='replace').strip('\x00 ')
                    if not tags['album']:
                        tags['album'] = tail[63:93].decode('latin-1', errors='replace').strip('\x00 ')
    except Exception:  # noqa: BLE001
        return tags
    return tags


def read_mp3_tags(path):
    """Read artist/title/album from ID3v2 (or ID3v1) with a small cache."""
    try:
        st = os.stat(path)
        key = (os.path.abspath(path), st.st_size, st.st_mtime_ns)
    except OSError:
        return {'artist': '', 'title': '', 'album': ''}
    with _TAG_LOCK:
        cached = _TAG_CACHE.get(key)
    if cached is not None:
        return dict(cached)
    tags = _read_id3(path)
    with _TAG_LOCK:
        if len(_TAG_CACHE) > 2000:
            _TAG_CACHE.clear()
        _TAG_CACHE[key] = dict(tags)
    return tags


def _cover_description_end(data, start, encoding):
    """Offset of the null terminator of an APIC description."""
    if encoding in (1, 2):          # UTF-16 / UTF-16BE: 2-byte terminator
        i = start
        while i + 1 < len(data):
            if data[i] == 0 and data[i + 1] == 0:
                return i
            i += 2
        return -1
    return data.find(b'\x00', start)


def _cover_mime(declared, data):
    """Prefer the image magic bytes; fall back to the declared MIME."""
    if data[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if data[:2] == b'BM':
        return 'image/bmp'
    mime = (declared or '').strip().lower().split(';', 1)[0]
    if mime in ('image/jpg', 'image/pjpeg'):
        mime = 'image/jpeg'
    return mime if mime.startswith('image/') else 'image/jpeg'


def _parse_cover_frame(payload, version):
    """Return (picture_type, mime, image_bytes) from an APIC/PIC frame."""
    if not payload or len(payload) < 4:
        return None
    encoding = payload[0]
    if version == 2:                # PIC: encoding, 3-byte format, type, desc, data
        declared = _PIC_MIME.get(
            payload[1:4].decode('latin-1', errors='replace').strip('\x00 ').upper(), '')
        if len(payload) < 5:
            return None
        picture_type = payload[4]
        desc_start = 5
    else:                           # APIC: encoding, MIME\0, type, desc, data
        mime_end = payload.find(b'\x00', 1)
        if mime_end < 0 or mime_end + 1 >= len(payload):
            return None
        declared = payload[1:mime_end].decode('latin-1', errors='replace').strip()
        picture_type = payload[mime_end + 1]
        desc_start = mime_end + 2
    desc_end = _cover_description_end(payload, desc_start, encoding)
    if desc_end < 0:
        return None
    image_start = desc_end + (2 if encoding in (1, 2) else 1)
    image = payload[image_start:]
    if not image:
        return None
    return picture_type, _cover_mime(declared, image), image


def read_mp3_cover(path):
    """Return {'mime', 'data'} for an embedded ID3 cover, or None.

    A front-cover APIC (type 3) wins; otherwise the first embedded picture is
    used. ID3v2.2 PIC and ID3v2.3/v2.4 APIC are supported. ID3v1 has no art.
    """
    try:
        with open(path, 'rb') as f:
            head = f.read(10)
            if len(head) != 10 or head[:3] != b'ID3':
                return None
            version = head[3]
            flags = head[5]
            size = _syncsafe(head[6:10])
            data = f.read(min(size, _MAX_TAG_BYTES))
            if flags & 0x80:
                data = data.replace(b'\xff\x00', b'\xff')
            pos = 0
            if flags & 0x40 and len(data) >= 4:
                pos = _syncsafe(data[:4]) if version == 4 else \
                    4 + int.from_bytes(data[:4], 'big')
            fallback = None
            while pos + 6 <= len(data):
                if data[pos] == 0:
                    break
                if version == 2:
                    fid = data[pos:pos + 3].decode('latin-1', errors='replace')
                    fsize = int.from_bytes(data[pos + 3:pos + 6], 'big')
                    hdr = 6
                else:
                    fid = data[pos:pos + 4].decode('latin-1', errors='replace')
                    if version == 4:
                        fsize = _syncsafe(data[pos + 4:pos + 8])
                    else:
                        fsize = int.from_bytes(data[pos + 4:pos + 8], 'big')
                    hdr = 10
                if fsize <= 0 or pos + hdr + fsize > len(data):
                    break
                if fid in ('APIC', 'PIC'):
                    parsed = _parse_cover_frame(data[pos + hdr:pos + hdr + fsize], version)
                    if parsed:
                        picture_type, mime, image = parsed
                        if picture_type == 3:       # front cover
                            return {'mime': mime, 'data': image}
                        if fallback is None:
                            fallback = {'mime': mime, 'data': image}
                pos += hdr + fsize
            return fallback
    except Exception:  # noqa: BLE001
        return None


def media_path(value):
    """Extract an absolute local file from /api/media?path=... or a path."""
    value = (value or '').strip()
    if not value:
        return ''
    if value.startswith('/api/media'):
        parsed = urlparse(value)
        qs = parse_qs(parsed.query)
        return unquote((qs.get('path') or [''])[0])
    if value.startswith('http://') or value.startswith('https://'):
        parsed = urlparse(value)
        if parsed.path == '/api/media':
            qs = parse_qs(parsed.query)
            return unquote((qs.get('path') or [''])[0])
        return ''
    # Windows drive paths (urlparse would treat "D:" as a scheme).
    if len(value) >= 3 and value[1] == ':' and value[2] in ('\\', '/'):
        return value
    if value.startswith('\\\\'):
        return value
    if os.path.isabs(value):
        return value
    return ''


def validate_mp3(conn, path):
    if not path or not path.lower().endswith('.mp3'):
        return ''
    ap = os.path.abspath(path)
    if not os.path.isfile(ap):
        return ''
    try:
        if not db._is_media_allowed(conn, ap):
            return ''
    except Exception:  # noqa: BLE001
        return ''
    return ap


def track_meta(conn, value, duration=None):
    path = validate_mp3(conn, media_path(value))
    if not path:
        return {'ok': False, 'reason': 'not_local_mp3'}
    tags = read_mp3_tags(path)
    missing = [k for k in ('artist', 'title', 'album') if not tags.get(k)]
    out = {'ok': not missing, 'path': path, 'artist': tags['artist'],
           'title': tags['title'], 'album': tags['album'],
           'missing': missing, 'min_duration': MIN_DURATION}
    if missing:
        out['reason'] = 'missing_tags'
        return out
    if duration is not None:
        try:
            if float(duration) < MIN_DURATION:
                out.update({'ok': False, 'reason': 'duration_lt_min'})
        except (TypeError, ValueError):
            pass
    return out


# ----------------------------- Last.fm API -----------------------------

def build_api_sig(params, secret):
    signed = {k: str(v) for k, v in params.items()
              if k not in ('format', 'callback')}
    payload = ''.join(k + signed[k] for k in sorted(signed)) + secret
    return hashlib.md5(payload.encode('utf-8')).hexdigest()


def _error_text(data):
    if isinstance(data, dict):
        msg = data.get('message') or data.get('error') or ''
        code = data.get('error')
        if code is not None:
            return ('error %s: %s' % (code, msg)).strip()
        return str(msg)
    return ''


def _call(params, secret=None, http_method='GET', timeout=15):
    params = dict(params)
    params.setdefault('format', 'json')
    if secret is not None:
        params['api_sig'] = build_api_sig(params, secret)
    body = urlencode(params).encode('utf-8')
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    try:
        if http_method == 'POST':
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
            req = Request(API_URL, data=body, headers=headers, method='POST')
        else:
            req = Request(API_URL + '?' + body.decode('utf-8'), headers=headers)
        with urlopen(req, timeout=timeout) as r:
            raw = r.read().decode('utf-8') or 'null'
            try:
                return r.status, json.loads(raw)
            except Exception:  # noqa: BLE001
                return r.status, None
    except HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8') or 'null')
        except Exception:  # noqa: BLE001
            return e.code, None
    except Exception as e:  # noqa: BLE001
        return 0, {'error': 'network', 'message': str(e)}


def auth_start(conn):
    api_key = _get(conn, SETTING_API_KEY)
    api_secret = _get(conn, SETTING_API_SECRET)
    if not api_key or not api_secret:
        return {'ok': False, 'error': 'not_configured'}
    status_code, body = _call({'method': 'auth.getToken', 'api_key': api_key})
    token = (body or {}).get('token') if isinstance(body, dict) else None
    if status_code != 200 or not token:
        err = _error_text(body) or ('HTTP %s' % status_code)
        return {'ok': False, 'error': 'auth_start_failed', 'detail': err}
    _set(conn, SETTING_PENDING_TOKEN, token)
    _set(conn, SETTING_PENDING_AT, int(time.time()))
    auth_url = AUTH_URL + '?' + urlencode({'api_key': api_key, 'token': token})
    return {'ok': True, 'auth_url': auth_url}


def auth_status(conn):
    api_key = _get(conn, SETTING_API_KEY)
    api_secret = _get(conn, SETTING_API_SECRET)
    token = _get(conn, SETTING_PENDING_TOKEN)
    if not token:
        out = status(conn)
        out['auth_state'] = 'connected' if out['authenticated'] else 'none'
        return out
    try:
        started = int(_get(conn, SETTING_PENDING_AT) or 0)
    except ValueError:
        started = 0
    if not started or int(time.time()) - started > AUTH_TIMEOUT:
        _set(conn, SETTING_PENDING_TOKEN, '')
        _set(conn, SETTING_PENDING_AT, '')
        out = status(conn)
        out['auth_state'] = 'expired'
        return out
    status_code, body = _call({
        'method': 'auth.getSession',
        'api_key': api_key,
        'token': token,
    }, secret=api_secret)
    session = (body or {}).get('session') if isinstance(body, dict) else None
    if status_code == 200 and isinstance(session, dict) and session.get('key'):
        _set(conn, SETTING_SESSION, session.get('key'))
        _set(conn, SETTING_USERNAME, session.get('name') or '')
        _set(conn, SETTING_PENDING_TOKEN, '')
        _set(conn, SETTING_PENDING_AT, '')
        _set(conn, SETTING_LAST_ERROR, '')
        out = status(conn)
        out['auth_state'] = 'connected'
        return out
    code = (body or {}).get('error') if isinstance(body, dict) else None
    detail = _error_text(body) or ('HTTP %s' % status_code)
    if code in (7, 10, 13, 26):
        _set(conn, SETTING_LAST_ERROR, detail)
        out = status(conn)
        out['auth_state'] = 'error'
        out['detail'] = detail
        return out
    # Before the user authorizes, Last.fm returns an error for the token. Keep
    # polling until the 5-minute window expires.
    out = status(conn)
    out['auth_state'] = 'pending'
    out['detail'] = detail
    return out


# ----------------------------- Scrobble queue -----------------------------

def prepare_scrobble(conn, data):
    """Validate a play reported by the player and queue it when eligible."""
    now = int(time.time())
    play_id = str(data.get('play_id') or '').strip()[:64]
    if not play_id:
        play_id = uuid.uuid4().hex
    path = validate_mp3(conn, media_path(data.get('url') or data.get('path')))
    if not path:
        return {'queued': False, 'reason': 'not_local_mp3'}
    tags = read_mp3_tags(path)
    missing = [k for k in ('artist', 'title', 'album') if not tags.get(k)]
    if missing:
        return {'queued': False, 'reason': 'missing_tags', 'missing': missing}
    try:
        duration = float(data.get('duration') or 0)
        played = float(data.get('played_seconds') or 0)
        started = int(float(data.get('started_at') or 0))
    except (TypeError, ValueError):
        return {'queued': False, 'reason': 'bad_numbers'}
    if not math.isfinite(duration) or not math.isfinite(played):
        return {'queued': False, 'reason': 'bad_numbers'}
    if duration < MIN_DURATION:
        return {'queued': False, 'reason': 'duration_lt_min',
                'min_duration': MIN_DURATION}
    threshold = min(duration * 0.5, 240)
    if played < threshold:
        return {'queued': False, 'reason': 'not_played_enough',
                'threshold': round(threshold, 1)}
    if not started:
        started = now
    if started < now - 14 * 86400:
        return {'queued': False, 'reason': 'too_old'}
    if started > now + 300:
        return {'queued': False, 'reason': 'bad_timestamp'}
    item = {
        'id': play_id, 'path': path,
        'artist': tags['artist'], 'track': tags['title'], 'album': tags['album'],
        'duration': int(round(duration)), 'started_at': started,
        'played_seconds': int(round(played)),
    }
    new = db.lastfm_enqueue_scrobble(conn, item)
    return {'queued': new, 'id': play_id, 'duplicate': not new,
            'artist': tags['artist'], 'track': tags['title'], 'album': tags['album']}


def scrobble_batch(api_key, api_secret, session_key, rows):
    params = {'method': 'track.scrobble', 'api_key': api_key, 'sk': session_key}
    for i, row in enumerate(rows[:MAX_BATCH]):
        params['artist[%d]' % i] = row.get('artist', '')
        params['track[%d]' % i] = row.get('track', '')
        params['timestamp[%d]' % i] = str(int(row.get('started_at') or 0))
        if row.get('album'):
            params['album[%d]' % i] = row['album']
        if row.get('duration'):
            params['duration[%d]' % i] = str(int(row['duration']))
    return _call(params, secret=api_secret, http_method='POST')


def _text_field(value):
    if isinstance(value, dict):
        return str(value.get('#text') or '')
    return str(value or '')


def _backoff(attempts):
    base = min(2 ** max(1, int(attempts)), 300)
    return base * (0.7 + random.random() * 0.6)


class LastfmWorker(threading.Thread):
    """Daemon that sends pending scrobbles and persists retries in SQLite."""

    def __init__(self, sandbox=False):
        super().__init__(name='lastfm-worker', daemon=True)
        self.sandbox = bool(sandbox)
        self._stop = threading.Event()
        self._wake = threading.Event()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def wake(self):
        self._wake.set()

    def _wait(self, seconds):
        self._wake.wait(timeout=max(0.1, seconds))
        self._wake.clear()

    def _set_error(self, conn, text):
        _set(conn, SETTING_LAST_ERROR, text or '')

    def run(self):
        while not self._stop.is_set():
            delay = 30
            try:
                if not self.sandbox:
                    delay = self._tick()
            except Exception as exc:  # noqa: BLE001
                delay = 30
                try:
                    conn = db.db_connect()
                    try:
                        self._set_error(conn, 'worker: %s' % exc)
                    finally:
                        conn.close()
                except Exception:  # noqa: BLE001
                    pass
            self._wait(delay)

    def _tick(self):
        conn = db.db_connect()
        try:
            api_key = _get(conn, SETTING_API_KEY)
            api_secret = _get(conn, SETTING_API_SECRET)
            session_key = _get(conn, SETTING_SESSION)
            enabled = _get(conn, SETTING_ENABLED) != '0'
            if not (api_key and api_secret and session_key and enabled):
                return 30
            rows = db.lastfm_pending(conn, MAX_BATCH)
            if not rows:
                return 30
            code, body = scrobble_batch(api_key, api_secret, session_key, rows)
            self._apply(conn, rows, code, body)
            return 0.4
        finally:
            conn.close()

    def _transient(self, conn, rows, message):
        now = int(time.time())
        for row in rows:
            attempts = int(row.get('attempts') or 0) + 1
            status = 'failed' if attempts >= 5 else 'pending'
            next_at = 0 if status == 'failed' else int(now + _backoff(attempts))
            db.lastfm_update_scrobble(conn, row['id'], status, message,
                                      attempts, next_at)
        self._set_error(conn, message)

    def _permanent(self, conn, rows, message):
        for row in rows:
            db.lastfm_update_scrobble(conn, row['id'], 'failed', message,
                                      int(row.get('attempts') or 0) + 1, 0)
        self._set_error(conn, message)

    def _apply(self, conn, rows, code, body):
        error = (body or {}).get('error') if isinstance(body, dict) else None
        if error == 9:
            _set(conn, SETTING_SESSION, '')
            _set(conn, SETTING_USERNAME, '')
            self._set_error(conn, 'Last.fm session expired; reconnect')
            for row in rows:
                db.lastfm_update_scrobble(conn, row['id'], 'needs_auth',
                                          'Last.fm session expired',
                                          int(row.get('attempts') or 0), 0)
            return
        if error == 29 or code == 429:
            now = int(time.time())
            for row in rows:
                attempts = int(row.get('attempts') or 0) + 1
                db.lastfm_update_scrobble(conn, row['id'], 'pending',
                                          'rate limited', attempts, now + 60)
            self._set_error(conn, 'Last.fm rate limit; waiting')
            return
        if error in (3, 4, 5, 6, 7, 10, 13, 26):
            self._permanent(conn, rows, _error_text(body) or ('error %s' % error))
            return
        if code != 200 or not isinstance(body, dict) or 'scrobbles' not in body:
            self._transient(conn, rows, _error_text(body) or ('HTTP %s' % code))
            return
        scrobbles = body.get('scrobbles') or {}
        attr = scrobbles.get('@attr') or {}
        items = scrobbles.get('scrobble') or []
        if isinstance(items, dict):
            items = [items]
        by_time = {}
        for item in items:
            ts = str(item.get('timestamp') or '')
            if ts:
                by_time.setdefault(ts, []).append(item)
        accepted = int(attr.get('accepted') or 0)
        ignored = int(attr.get('ignored') or 0)
        for row in rows:
            candidates = by_time.get(str(row.get('started_at')), [])
            match = candidates[0] if candidates else None
            if match:
                msg = match.get('ignoredMessage') or {}
                ign = str(msg.get('code') or '0')
                if ign != '0':
                    detail = _text_field(msg) or ('ignored code %s' % ign)
                    db.lastfm_update_scrobble(conn, row['id'], 'ignored',
                                              detail, int(row.get('attempts') or 0), 0)
                else:
                    db.lastfm_update_scrobble(conn, row['id'], 'sent')
            elif accepted > 0:
                db.lastfm_update_scrobble(conn, row['id'], 'sent')
            elif ignored > 0:
                db.lastfm_update_scrobble(conn, row['id'], 'ignored',
                                          'Last.fm ignored the scrobble',
                                          int(row.get('attempts') or 0), 0)
            else:
                self._transient(conn, [row], 'empty Last.fm response')
        self._set_error(conn, '')
