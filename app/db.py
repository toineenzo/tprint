import os
import sqlite3
from contextlib import contextmanager

from app import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
    text_content TEXT,
    image_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    header_text TEXT,
    footer_text TEXT,
    header_logo_path TEXT,
    default_align TEXT NOT NULL DEFAULT 'left',
    default_bold INTEGER NOT NULL DEFAULT 0,
    default_double_width INTEGER NOT NULL DEFAULT 0
);
"""


def init_db() -> None:
    os.makedirs(config.DATA_DIR, exist_ok=True)
    os.makedirs(config.SNIPPET_IMAGE_DIR, exist_ok=True)
    with get_conn() as conn:
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
