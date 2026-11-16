"""Prepares the throw-away database the sandbox launcher runs on.

The sandbox has to start from the real practice.db (catalog, routines, areas,
history), because every write goes to the copy and the app must look like the
real one. Two things make a plain file copy a bad idea:

  * the real server keeps practice.db open (and in WAL mode), so a byte copy can
    miss committed data or catch a write in the middle;
  * a sandbox database that already exists may be a seed from a first start
    (default routine, no catalog), which leaves the app empty.

So the copy is made with SQLite's backup API, verified row by row, and an
existing sandbox is only kept when it really looks like a copy of the real one.
"""
import os
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(HERE, 'practice.db')
DEST = os.path.join(HERE, 'practice_sandbox.db')
TABLES = ('routines', 'exercises', 'catalog_exercises', 'catalog_paths',
          'routine_sessions', 'routine_session_items')


def _uri(path):
    return 'file:' + path.replace('\\', '/') + '?mode=ro'


def _counts(path):
    conn = sqlite3.connect(path)
    try:
        return {t: conn.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0]
                for t in TABLES}
    finally:
        conn.close()


def _has_real_data(path):
    """A copy of the real DB has a catalog; a seeded one has none."""
    try:
        got = _counts(path)
    except sqlite3.Error:
        return False
    return got['routines'] > 0 and got['catalog_exercises'] > 0


def copy_main_to_sandbox():
    # A server that is still shutting down keeps the file: retry briefly.
    for suffix in ('', '-wal', '-shm'):
        path = DEST + suffix
        for attempt in range(6):
            try:
                os.remove(path)
                break
            except FileNotFoundError:
                break
            except OSError:
                if attempt == 5:
                    raise SystemExit('cannot remove %s (is the sandbox server still'
                                     ' running?)' % os.path.basename(path))
                time.sleep(0.5)
    src = sqlite3.connect(_uri(MAIN), uri=True)
    dst = sqlite3.connect(DEST)
    try:
        src.backup(dst)                      # consistent even while it is open
    finally:
        dst.close()
        src.close()

    want, got = _counts(MAIN), _counts(DEST)
    if want != got:
        raise SystemExit('copy mismatch: real %s vs sandbox %s' % (want, got))
    conn = sqlite3.connect(DEST)
    try:
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('sandbox copy failed integrity_check')
    finally:
        conn.close()
    return got


def main():
    force = '--force' in sys.argv
    if not os.path.isfile(MAIN):
        print('MISSING: %s' % MAIN)
        return 1
    if not force and _has_real_data(DEST):
        print('KEEP   : %s (already a copy of the real database)' % os.path.basename(DEST))
        return 0
    reason = 'recreated' if os.path.isfile(DEST) else 'created'
    try:
        got = copy_main_to_sandbox()
    except (sqlite3.Error, SystemExit) as exc:
        print('FAILED : %s' % exc)
        return 1
    print('COPIED : %s %s -> %s' % (reason, os.path.basename(MAIN),
                                    ', '.join('%s=%d' % (k, v) for k, v in got.items())))
    return 0


if __name__ == '__main__':
    sys.exit(main())
