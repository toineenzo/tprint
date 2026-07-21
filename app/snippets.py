import json
import os
import uuid

from app import config, db, files

ALLOWED_IMAGE_EXTS = ("png", "jpg", "jpeg", "gif", "bmp", "webp")
ALLOWED_PDF_EXTS = ("pdf",)


def _parse_row(row) -> dict:
    """A snippet with its stored filenames decoded into a `files` list.

    The raw `file_paths` JSON column is dropped rather than passed through —
    it's the same data in a less usable form, and nothing downstream reads it.
    """
    data = dict(row)
    raw = data.pop("file_paths", None)
    data["files"] = json.loads(raw) if raw else []
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
