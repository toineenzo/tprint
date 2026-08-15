import json
import os
import uuid
from datetime import datetime, timezone

from PIL import Image

from app import config, db

THUMB_WIDTH = 300
HISTORY_LIMIT = 50


def add_entry(
    kind: str,
    preview_text: str | None = None,
    preview_image: Image.Image | None = None,
    payload: dict | None = None,
) -> None:
    """Record a print. `payload` is what it would take to print it again.

    Only set for kinds that are pure data (text, rich text, checklist, code):
    an image or PDF print keeps a thumbnail, not the file, so there is nothing
    honest to offer as "save this as a snippet".
    """
    image_path = None
    if preview_image is not None:
        thumb = preview_image.convert("RGB")
        if thumb.width > THUMB_WIDTH:
            ratio = THUMB_WIDTH / thumb.width
            thumb = thumb.resize((THUMB_WIDTH, max(1, int(thumb.height * ratio))))
        filename = f"{uuid.uuid4().hex}.jpg"
        thumb.save(os.path.join(config.HISTORY_THUMB_DIR, filename), "JPEG", quality=80)
        image_path = filename

    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO print_history (kind, preview_text, preview_image_path, payload) "
            "VALUES (?, ?, ?, ?)",
            (
                kind,
                (preview_text or "")[:1000] or None,
                image_path,
                json.dumps(payload) if payload else None,
            ),
        )
        _prune(conn)


def _prune(conn) -> None:
    """Apply the configured retention rules, deleting thumbnails as it goes.

    Both rules are optional and independent: an entry is dropped if it falls
    outside the item cap *or* is older than the age limit. 0 disables either
    one, so retention can be turned off entirely without a separate flag.
    """
    from app import settings as settings_store

    current = settings_store.get_settings()
    max_items = int(current["retention_max_items"])
    max_age_days = int(current["retention_max_age_days"])

    conditions, params = [], []
    if max_items > 0:
        conditions.append(
            "id NOT IN (SELECT id FROM print_history "
            "ORDER BY created_at DESC, id DESC LIMIT ?)"
        )
        params.append(max_items)
    if max_age_days > 0:
        # created_at is SQLite's own UTC datetime('now'), so compare in UTC.
        conditions.append("created_at < datetime('now', ?)")
        params.append(f"-{max_age_days} days")
    if not conditions:
        return

    where = " OR ".join(conditions)
    stale = conn.execute(
        f"SELECT preview_image_path FROM print_history WHERE {where}", params
    ).fetchall()
    for row in stale:
        if row["preview_image_path"]:
            path = os.path.join(config.HISTORY_THUMB_DIR, row["preview_image_path"])
            if os.path.exists(path):
                os.remove(path)
    conn.execute(f"DELETE FROM print_history WHERE {where}", params)


def clear_all() -> int:
    """Delete every history entry and its thumbnail. Returns how many went."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT preview_image_path FROM print_history"
        ).fetchall()
        for row in rows:
            if row["preview_image_path"]:
                path = os.path.join(config.HISTORY_THUMB_DIR, row["preview_image_path"])
                if os.path.exists(path):
                    os.remove(path)
        conn.execute("DELETE FROM print_history")
    return len(rows)


def list_recent(limit: int = HISTORY_LIMIT) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id, kind, preview_text, preview_image_path, payload, created_at "
            "FROM print_history ORDER BY created_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


def to_local(stamp: str | None) -> str | None:
    """A stored UTC timestamp as naive local time, for display.

    `created_at` is SQLite's own `datetime('now')`, which is UTC — retention
    compares against it in UTC and must keep doing so. Everything the UI shows
    is local, though: a receipt printed at 04:02 listed as 02:02 next to a
    schedule that counts in local time reads as a bug, and did.

    Converted on read rather than stored differently, so rows written before
    this display correctly too.
    """
    if not stamp:
        return stamp
    try:
        parsed = datetime.fromisoformat(stamp.replace(" ", "T"))
    except ValueError:
        return stamp
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone().replace(tzinfo=None).isoformat(sep=" ", timespec="seconds")


def list_recent_public(limit: int = HISTORY_LIMIT) -> list[dict]:
    """Recent entries as the API exposes them — the stored thumbnail filename
    is replaced by a has_image flag, since the image is served by id."""
    return [
        {
            "id": entry["id"],
            "kind": entry["kind"],
            "preview_text": entry["preview_text"],
            "has_image": bool(entry["preview_image_path"]),
            # Whether "save as snippet" can be offered for this entry, rather
            # than the payload itself: the UI only needs to know if it can.
            "can_snippet": bool(entry["payload"]),
            "created_at": to_local(entry["created_at"]),
        }
        for entry in list_recent(limit)
    ]


def entry_payload(entry_id: int) -> tuple[str, dict] | None:
    """(kind, payload) for an entry that can be reprinted, else None."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT kind, payload FROM print_history WHERE id = ?", (entry_id,)
        ).fetchone()
    if not row or not row["payload"]:
        return None
    try:
        return row["kind"], json.loads(row["payload"])
    except (TypeError, ValueError):
        return None


def thumb_path(entry_id: int) -> str | None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT preview_image_path FROM print_history WHERE id = ?", (entry_id,)
        ).fetchone()
        if not row or not row["preview_image_path"]:
            return None
        return os.path.join(config.HISTORY_THUMB_DIR, row["preview_image_path"])
