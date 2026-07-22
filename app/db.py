import json
import os
import sqlite3
from contextlib import contextmanager

from app import config

NEW_SNIPPETS_TABLE = """
CREATE TABLE snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'pdf', 'checklist', 'ics')),
    text_content TEXT,
    file_paths TEXT,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

# Columns carried across every snippets-table rebuild below. `payload` is
# deliberately absent: it's the column being added, and older rows have no
# value for it.
_CARRIED_COLUMNS = ("id", "name", "kind", "text_content", "created_at", "updated_at")

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    header_text TEXT,
    footer_text TEXT,
    header_logo_path TEXT,
    default_align TEXT NOT NULL DEFAULT 'left',
    default_bold INTEGER NOT NULL DEFAULT 0,
    default_double_width INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS print_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    preview_text TEXT,
    preview_image_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS print_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    label TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    run_at TEXT,
    recurrence TEXT,
    recurrence_time TEXT,
    last_run_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def _rebuild_snippets(conn: sqlite3.Connection, file_paths_for) -> None:
    """Rename the snippets table aside, recreate it, copy rows across, drop it.

    SQLite can neither ALTER a CHECK constraint nor change a column's meaning in
    place, so every structural change to this table goes through here.
    `file_paths_for(old_row)` returns the new `file_paths` value for a row, which
    is the only field whose representation has ever differed between versions.
    """
    conn.execute("ALTER TABLE snippets RENAME TO snippets_old")
    conn.executescript(NEW_SNIPPETS_TABLE)
    placeholders = ", ".join("?" for _ in (*_CARRIED_COLUMNS, "file_paths"))
    columns = ", ".join((*_CARRIED_COLUMNS, "file_paths"))
    for row in conn.execute("SELECT * FROM snippets_old").fetchall():
        old = dict(row)
        # The oldest shape has no `updated_at` at all; a row that has never been
        # edited is fairly described as updated when it was created.
        old.setdefault("updated_at", old["created_at"])
        conn.execute(
            f"INSERT INTO snippets ({columns}) VALUES ({placeholders})",
            (*(old[name] for name in _CARRIED_COLUMNS), file_paths_for(old)),
        )
    conn.execute("DROP TABLE snippets_old")


def _migrate_snippets(conn: sqlite3.Connection) -> None:
    """Bring the snippets table up to the current shape, whatever it's on.

    Two structural changes have shipped so far:
      1. one `image_path` column -> a `file_paths` JSON list (multi-image + PDF)
      2. adding `payload`, and widening the `kind` CHECK to allow the
         'checklist' and 'ics' kinds saved by the "Save as snippet" checkbox

    Files on disk are never touched by either — only how they're referenced.
    """
    existing = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'snippets'"
    ).fetchone()
    if not existing:
        conn.executescript(NEW_SNIPPETS_TABLE)
        return

    cols = [row["name"] for row in conn.execute("PRAGMA table_info(snippets)").fetchall()]

    if "file_paths" not in cols:
        # Pre-multi-file: wrap the single image_path into a one-element list.
        # The rebuilt table is already the newest shape, so nothing follows.
        _rebuild_snippets(
            conn,
            lambda old: json.dumps([old["image_path"]]) if old.get("image_path") else None,
        )
        return

    # `payload` and the widened CHECK shipped together, but they're tested
    # separately: a DB could have been created by either half during dev.
    current_sql = existing["sql"] or ""
    if "payload" in cols and "checklist" in current_sql:
        return

    _rebuild_snippets(conn, lambda old: old["file_paths"])


def init_db() -> None:
    os.makedirs(config.DATA_DIR, exist_ok=True)
    os.makedirs(config.SNIPPET_FILES_DIR, exist_ok=True)
    os.makedirs(config.QUEUE_UPLOAD_DIR, exist_ok=True)
    os.makedirs(config.HISTORY_THUMB_DIR, exist_ok=True)
    with get_conn() as conn:
        _migrate_snippets(conn)
        conn.executescript(SCHEMA)
        conn.execute("INSERT OR IGNORE INTO settings (id) VALUES (1)")


# Every directory the app writes user content into. Reset empties all of them,
# so a new one added later must be listed here or its files will outlive a reset.
_CONTENT_DIRS = (
    config.SNIPPET_FILES_DIR,
    config.QUEUE_UPLOAD_DIR,
    config.HISTORY_THUMB_DIR,
)


def reset_all() -> None:
    """Drop every user-created row and file, then rebuild the empty schema.

    Deliberately destructive and deliberately total: snippets, history, the
    queue and the printer settings (including the logo) all go. The tables are
    dropped rather than DELETEd so AUTOINCREMENT counters restart and the result
    is indistinguishable from a fresh volume.
    """
    with get_conn() as conn:
        for table in ("snippets", "print_history", "print_jobs", "settings"):
            conn.execute(f"DROP TABLE IF EXISTS {table}")

    for directory in _CONTENT_DIRS:
        if not os.path.isdir(directory):
            continue
        for entry in os.listdir(directory):
            path = os.path.join(directory, entry)
            if os.path.isfile(path):
                os.remove(path)

    # The settings logo is written straight into DATA_DIR (as `logo-<uuid>.<ext>`,
    # see settings.set_logo) rather than into one of the content dirs above.
    for entry in os.listdir(config.DATA_DIR):
        path = os.path.join(config.DATA_DIR, entry)
        if os.path.isfile(path) and entry.startswith("logo-"):
            os.remove(path)

    init_db()


@contextmanager
def get_conn():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
