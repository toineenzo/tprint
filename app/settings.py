import os
import uuid

from app import config, db

LOGO_EXTS = ("png", "jpg", "jpeg", "gif", "bmp", "webp")


def get_settings() -> dict:
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        return dict(row)


def update_settings(
    header_text: str,
    footer_text: str,
    default_align: str,
    default_bold: bool,
    default_double_width: bool,
) -> None:
    if default_align not in ("left", "center", "right"):
        raise ValueError("default_align must be 'left', 'center', or 'right'")
    with db.get_conn() as conn:
        conn.execute(
            """
            UPDATE settings
            SET header_text = ?, footer_text = ?, default_align = ?,
                default_bold = ?, default_double_width = ?
            WHERE id = 1
            """,
            (header_text or None, footer_text or None, default_align, int(default_bold), int(default_double_width)),
        )


def set_logo(image_bytes: bytes, ext: str) -> None:
    ext = ext.lower() if ext.lower() in LOGO_EXTS else "png"
    remove_logo()
    filename = f"logo-{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(config.DATA_DIR, filename), "wb") as f:
        f.write(image_bytes)
    with db.get_conn() as conn:
        conn.execute("UPDATE settings SET header_logo_path = ? WHERE id = 1", (filename,))


def remove_logo() -> None:
    current = get_settings()
    if current["header_logo_path"]:
        path = os.path.join(config.DATA_DIR, current["header_logo_path"])
        if os.path.exists(path):
            os.remove(path)
    with db.get_conn() as conn:
        conn.execute("UPDATE settings SET header_logo_path = NULL WHERE id = 1")
