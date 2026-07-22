import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime

from app import config

NEW_SNIPPETS_TABLE = """
CREATE TABLE snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'pdf', 'checklist', 'ics', 'composition')),
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
    footer_logo_path TEXT,
    default_align TEXT NOT NULL DEFAULT 'left',
    default_bold INTEGER NOT NULL DEFAULT 0,
    default_double_width INTEGER NOT NULL DEFAULT 0,
    paper_width_px INTEGER,
    auto_cut INTEGER NOT NULL DEFAULT 1,
    confirm_before_print INTEGER NOT NULL DEFAULT 0,
    surprise_preview INTEGER NOT NULL DEFAULT 0,
    print_delay_seconds INTEGER NOT NULL DEFAULT 0,
    retention_max_items INTEGER NOT NULL DEFAULT 50,
    retention_max_age_days INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS print_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    preview_text TEXT,
    preview_image_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('joke', 'recipe', 'fortune')),
    lang TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    -- 1 for rows imported from the bundled JSON, 0 for anything the user
    -- added. Only untouched seeded rows are replaced when the bundled content
    -- is revised, so a later release can ship better defaults without ever
    -- discarding someone's own jokes or edits.
    seeded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which (kind, lang, seed version) triples have already been imported from the
-- bundled JSON. Tracked separately from the rows themselves so that deleting
-- every joke doesn't resurrect the shipped ones on the next restart, while a
-- language -- or a revised bundled set -- added in a later release still gets
-- imported.
CREATE TABLE IF NOT EXISTS content_seeds (
    key TEXT PRIMARY KEY,
    seeded_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    recurrence_days TEXT,
    last_run_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def _rebuild_snippets(
    conn: sqlite3.Connection, file_paths_for, carry_payload: bool = False
) -> None:
    """Rename the snippets table aside, recreate it, copy rows across, drop it.

    SQLite can neither ALTER a CHECK constraint nor change a column's meaning in
    place, so every structural change to this table goes through here.
    `file_paths_for(old_row)` returns the new `file_paths` value for a row, which
    is the only field whose representation has ever differed between versions.
    """
    conn.execute("ALTER TABLE snippets RENAME TO snippets_old")
    conn.executescript(NEW_SNIPPETS_TABLE)
    # `payload` only exists once revision 2 has run; carrying it when present
    # is what lets a checklist/ics snippet survive the CHECK widening below.
    carried = (*_CARRIED_COLUMNS, "file_paths") + (("payload",) if carry_payload else ())
    placeholders = ", ".join("?" for _ in carried)
    columns = ", ".join(carried)
    for row in conn.execute("SELECT * FROM snippets_old").fetchall():
        old = dict(row)
        # The oldest shape has no `updated_at` at all; a row that has never been
        # edited is fairly described as updated when it was created.
        old.setdefault("updated_at", old["created_at"])
        values = [*(old[name] for name in _CARRIED_COLUMNS), file_paths_for(old)]
        if carry_payload:
            values.append(old.get("payload"))
        conn.execute(f"INSERT INTO snippets ({columns}) VALUES ({placeholders})", values)
    conn.execute("DROP TABLE snippets_old")


def _migrate_snippets(conn: sqlite3.Connection) -> None:
    """Bring the snippets table up to the current shape, whatever it's on.

    Three structural changes have shipped so far:
      1. one `image_path` column -> a `file_paths` JSON list (multi-image + PDF)
      2. adding `payload`, and widening the `kind` CHECK to allow the
         'checklist' and 'ics' kinds saved by the "Save as snippet" checkbox
      3. widening that CHECK again for the 'composition' kind saved by the
         canvas composer

    Files on disk are never touched by any of them — only how they're referenced.
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

    # Each widening of the CHECK is detected by the newest kind it allows, so a
    # database stuck at any earlier revision is brought fully up to date in one
    # rebuild rather than one per hop.
    current_sql = existing["sql"] or ""
    if "payload" in cols and "composition" in current_sql:
        return

    _rebuild_snippets(conn, lambda old: old["file_paths"], carry_payload="payload" in cols)


def _migrate_print_jobs(conn: sqlite3.Connection) -> None:
    """Add `recurrence_days` and backfill it from each recurring job's anchor.

    Purely additive, so this is an ALTER rather than the table rebuild the
    snippets CHECK constraint needed — but it still can't be left to
    `CREATE TABLE IF NOT EXISTS`, which is a no-op on a table that already
    exists and would leave the column missing on every upgraded install.

    The backfill preserves behaviour exactly rather than guessing: 'weekly'
    used to mean "+7 days from the anchor", which is the same weekday every
    week, so recording that weekday changes nothing about when a job runs — it
    only makes the rule visible in the UI instead of implied by the anchor.
    """
    existing = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'print_jobs'"
    ).fetchone()
    if not existing:
        return  # SCHEMA below creates it already carrying the column

    cols = [row["name"] for row in conn.execute("PRAGMA table_info(print_jobs)").fetchall()]
    if "recurrence_days" in cols:
        return

    conn.execute("ALTER TABLE print_jobs ADD COLUMN recurrence_days TEXT")
    rows = conn.execute(
        "SELECT id, run_at, recurrence FROM print_jobs "
        "WHERE recurrence IN ('weekly', 'monthly')"
    ).fetchall()
    for row in rows:
        try:
            anchor = datetime.fromisoformat(row["run_at"]) if row["run_at"] else None
        except (TypeError, ValueError):
            anchor = None
        if anchor is None:
            continue
        day = anchor.isoweekday() if row["recurrence"] == "weekly" else anchor.day
        conn.execute(
            "UPDATE print_jobs SET recurrence_days = ? WHERE id = ?",
            (json.dumps([day]), row["id"]),
        )


# Columns added to `settings` after its first release, with the exact
# definition each needs. SQLite only accepts a constant DEFAULT in an ALTER,
# which every one of these has.
_SETTINGS_COLUMNS = (
    ("footer_logo_path", "TEXT"),
    # Nullable on purpose: NULL means "follow the PRINTER_WIDTH_PX env var",
    # so an install that never opens the paper-size setting keeps behaving
    # exactly as it did when that env var was the only control.
    ("paper_width_px", "INTEGER"),
    ("auto_cut", "INTEGER NOT NULL DEFAULT 1"),
    ("confirm_before_print", "INTEGER NOT NULL DEFAULT 0"),
    ("surprise_preview", "INTEGER NOT NULL DEFAULT 0"),
    ("print_delay_seconds", "INTEGER NOT NULL DEFAULT 0"),
    ("retention_max_items", "INTEGER NOT NULL DEFAULT 50"),
    ("retention_max_age_days", "INTEGER NOT NULL DEFAULT 0"),
)


def _migrate_settings(conn: sqlite3.Connection) -> None:
    """Add any settings column missing from an older database.

    Same reasoning as `_migrate_print_jobs`: these are purely additive, so an
    ALTER is enough and no table rebuild is needed — but `CREATE TABLE IF NOT
    EXISTS` is a no-op once the table exists, so without this every upgraded
    install would be missing them. Each default is chosen so an existing
    deployment behaves exactly as before until someone changes it.
    """
    if not conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'"
    ).fetchone():
        return  # SCHEMA below creates it with every column already present

    existing = {row["name"] for row in conn.execute("PRAGMA table_info(settings)").fetchall()}
    for name, definition in _SETTINGS_COLUMNS:
        if name not in existing:
            conn.execute(f"ALTER TABLE settings ADD COLUMN {name} {definition}")


def init_db() -> None:
    os.makedirs(config.DATA_DIR, exist_ok=True)
    os.makedirs(config.SNIPPET_FILES_DIR, exist_ok=True)
    os.makedirs(config.QUEUE_UPLOAD_DIR, exist_ok=True)
    os.makedirs(config.HISTORY_THUMB_DIR, exist_ok=True)
    with get_conn() as conn:
        _migrate_snippets(conn)
        _migrate_print_jobs(conn)
        _migrate_settings(conn)
        conn.executescript(SCHEMA)
        conn.execute("INSERT OR IGNORE INTO settings (id) VALUES (1)")

    # Imported here rather than at module level: content imports db, and the
    # seeding has to run after the schema above exists.
    from app import content

    content.seed_defaults()


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
        for table in (
            "snippets",
            "print_history",
            "print_jobs",
            "settings",
            # Dropped together so init_db() re-seeds the bundled jokes,
            # recipes and fortunes — a reset returns to a fresh install,
            # not to an app with no surprise content at all.
            "content_items",
            "content_seeds",
        ):
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
