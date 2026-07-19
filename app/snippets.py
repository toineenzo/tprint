import os
import uuid

from app import config, db


def list_snippets() -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, kind, text_content, image_path, created_at "
            "FROM snippets ORDER BY created_at DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def get_snippet(snippet_id: int) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM snippets WHERE id = ?", (snippet_id,)).fetchone()
        return dict(row) if row else None


def create_text_snippet(name: str, text_content: str) -> int:
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO snippets (name, kind, text_content) VALUES (?, 'text', ?)",
            (name, text_content),
        )
        return cur.lastrowid


def create_image_snippet(name: str, image_bytes: bytes, ext: str) -> int:
    ext = ext.lower() if ext.lower() in ("png", "jpg", "jpeg", "gif", "bmp", "webp") else "png"
    filename = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(config.SNIPPET_IMAGE_DIR, filename), "wb") as f:
        f.write(image_bytes)
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO snippets (name, kind, image_path) VALUES (?, 'image', ?)",
            (name, filename),
        )
        return cur.lastrowid


def delete_snippet(snippet_id: int) -> None:
    snippet = get_snippet(snippet_id)
    if snippet and snippet["kind"] == "image" and snippet["image_path"]:
        path = os.path.join(config.SNIPPET_IMAGE_DIR, snippet["image_path"])
        if os.path.exists(path):
            os.remove(path)
    with db.get_conn() as conn:
        conn.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
