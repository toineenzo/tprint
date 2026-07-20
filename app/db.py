import json
import os
import sqlite3
from contextlib import contextmanager

from app import config

NEW_SNIPPETS_TABLE = """
CREATE TABLE snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'pdf')),
    text_content TEXT,
    file_paths TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

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


def _migrate_snippets(conn: sqlite3.Connection) -> None:
    """Migrate the old single-image snippets table (image_path) to the
    multi-file/PDF-capable schema (file_paths, a JSON list). Existing files
    on disk don't move — only how they're referenced in the DB changes.
    """
    existing = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'snippets'"
    ).fetchone()
    if not existing:
        conn.executescript(NEW_SNIPPETS_TABLE)
        return

    cols = [row["name"] for row in conn.execute("PRAGMA table_info(snippets)").fetchall()]
    if "file_paths" in cols:
        return  # already on the new schema

    conn.execute("ALTER TABLE snippets RENAME TO snippets_old")
    conn.executescript(NEW_SNIPPETS_TABLE)
    old_rows = conn.execute("SELECT * FROM snippets_old").fetchall()
    for row in old_rows:
        old = dict(row)
        file_paths = json.dumps([old["image_path"]]) if old.get("image_path") else None
        conn.execute(
            """
            INSERT INTO snippets (id, name, kind, text_content, file_paths, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                old["id"],
                old["name"],
                old["kind"],
                old["text_content"],
                file_paths,
                old["created_at"],
                old["created_at"],
            ),
        )
    conn.execute("DROP TABLE snippets_old")


def init_db() -> None:
    os.makedirs(config.DATA_DIR, exist_ok=True)
    os.makedirs(config.SNIPPET_FILES_DIR, exist_ok=True)
    os.makedirs(config.QUEUE_UPLOAD_DIR, exist_ok=True)
    os.makedirs(config.HISTORY_THUMB_DIR, exist_ok=True)
    with get_conn() as conn:
        _migrate_snippets(conn)
        conn.executescript(SCHEMA)
        conn.execute("INSERT OR IGNORE INTO settings (id) VALUES (1)")


@contextmanager
def get_conn():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
