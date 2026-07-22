import json
import os
import uuid

from app import config, db, files

ALLOWED_IMAGE_EXTS = ("png", "jpg", "jpeg", "gif", "bmp", "webp")
ALLOWED_PDF_EXTS = ("pdf",)
ALLOWED_ICS_EXTS = ("ics",)

# Kinds whose content is structured data rather than something the edit form can
# meaningfully show as text or files — these are rename-only once saved.
STRUCTURED_KINDS = ("checklist", "ics", "composition")


def _parse_row(row) -> dict:
    """A snippet with its stored filenames decoded into a `files` list.

    The raw `file_paths` JSON column is dropped rather than passed through —
    it's the same data in a less usable form, and nothing downstream reads it.
    `payload` gets the same treatment: checklist items and the agenda's print
    mode come back as real objects, never as a JSON string the caller re-parses.
    """
    data = dict(row)
    raw = data.pop("file_paths", None)
    data["files"] = json.loads(raw) if raw else []
    payload = data.get("payload")
    data["payload"] = json.loads(payload) if payload else None
    return data


def list_snippets() -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM snippets ORDER BY created_at DESC").fetchall()
        return [_parse_row(row) for row in rows]


def get_snippet(snippet_id: int) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM snippets WHERE id = ?", (snippet_id,)).fetchone()
        return _parse_row(row) if row else None


def file_path(filename: str) -> str:
    return os.path.join(config.SNIPPET_FILES_DIR, filename)


def _save_file(data: bytes, filename: str, allowed_exts: tuple[str, ...]) -> str:
    saved_name = f"{uuid.uuid4().hex}.{files.allowed_extension(filename, allowed_exts)}"
    with open(file_path(saved_name), "wb") as f:
        f.write(data)
    return saved_name


def _delete_file(filename: str) -> None:
    path = file_path(filename)
    if os.path.exists(path):
        os.remove(path)


def create_text_snippet(name: str, text_content: str) -> int:
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO snippets (name, kind, text_content) VALUES (?, 'text', ?)",
            (name, text_content),
        )
        return cur.lastrowid


def create_image_snippet(name: str, files: list[tuple[bytes, str]]) -> int:
    saved = [_save_file(data, filename, ALLOWED_IMAGE_EXTS) for data, filename in files]
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO snippets (name, kind, file_paths) VALUES (?, 'image', ?)",
            (name, json.dumps(saved)),
        )
        return cur.lastrowid


def create_pdf_snippet(name: str, data: bytes, filename: str) -> int:
    saved = _save_file(data, filename, ALLOWED_PDF_EXTS)
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO snippets (name, kind, file_paths) VALUES (?, 'pdf', ?)",
            (name, json.dumps([saved])),
        )
        return cur.lastrowid


def create_checklist_snippet(name: str, title: str | None, items: list[dict], mode: str) -> int:
    """Store the checklist's structure, not its rendered text.

    Printing it later goes back through `printer.print_checklist`, so a saved
    checklist reprints identically — bold centred title, per-item due dates and
    the single/separate receipt mode all intact.
    """
    payload = json.dumps({"title": title, "items": items, "mode": mode})
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO snippets (name, kind, payload) VALUES (?, 'checklist', ?)",
            (name, payload),
        )
        return cur.lastrowid


def create_ics_snippet(
    name: str,
    data: bytes,
    filename: str,
    mode: str,
    overview: str = "none",
    orientation: str = "vertical",
) -> int:
    """Store the original .ics file, not the events parsed out of it.

    Re-parsing on print keeps a saved agenda faithful to the uploaded calendar
    rather than freezing one rendering of it. The presentation options travel
    with it so a saved agenda reprints the way it was set up; snippets written
    before they existed simply have no keys and fall back to the defaults.
    """
    saved = _save_file(data, filename, ALLOWED_ICS_EXTS)
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO snippets (name, kind, file_paths, payload) VALUES (?, 'ics', ?, ?)",
            (
                name,
                json.dumps([saved]),
                json.dumps({"mode": mode, "overview": overview, "orientation": orientation}),
            ),
        )
        return cur.lastrowid


def create_composition_snippet(
    name: str, payload: dict, files: list[tuple[bytes, str]]
) -> int:
    """Save a composition as a reusable template.

    `payload` carries both what to print (`parts`, or a flattened image for
    canvas mode) and the editor's own `layout`, so the template can be reopened
    and edited rather than only reprinted.
    """
    saved = [_save_file(data, filename, ALLOWED_IMAGE_EXTS) for data, filename in files]
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO snippets (name, kind, file_paths, payload)"
            " VALUES (?, 'composition', ?, ?)",
            (name, json.dumps(saved), json.dumps(payload)),
        )
        return cur.lastrowid


def rename_snippet(snippet_id: int, name: str) -> None:
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE snippets SET name = ?, updated_at = datetime('now') WHERE id = ?",
            (name, snippet_id),
        )


def update_snippet(
    snippet_id: int,
    name: str,
    text_content: str | None = None,
    add_image_files: list[tuple[bytes, str]] | None = None,
    remove_filenames: list[str] | None = None,
    replace_pdf: tuple[bytes, str] | None = None,
) -> None:
    snippet = get_snippet(snippet_id)
    if not snippet:
        raise ValueError("snippet not found")

    files = list(snippet["files"])

    for fn in remove_filenames or []:
        if fn in files:
            files.remove(fn)
            _delete_file(fn)

    for data, filename in add_image_files or []:
        files.append(_save_file(data, filename, ALLOWED_IMAGE_EXTS))

    if replace_pdf:
        for fn in files:
            _delete_file(fn)
        files = [_save_file(replace_pdf[0], replace_pdf[1], ALLOWED_PDF_EXTS)]

    with db.get_conn() as conn:
        conn.execute(
            """
            UPDATE snippets
            SET name = ?, text_content = ?, file_paths = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (name, text_content, json.dumps(files) if files else None, snippet_id),
        )


def delete_snippet(snippet_id: int) -> None:
    snippet = get_snippet(snippet_id)
    if snippet:
        for fn in snippet["files"]:
            _delete_file(fn)
    with db.get_conn() as conn:
        conn.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
