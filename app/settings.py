import os
import uuid

from app import config, db, files

LOGO_EXTS = ("png", "jpg", "jpeg", "gif", "bmp", "webp")


def get_settings() -> dict:
    """The raw settings row, including the on-disk logo filename.

    For internal use (printer.py needs the logo path). Anything reaching an
    HTTP response should use public_settings() instead.
    """
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        return dict(row)


def public_settings() -> dict:
    """The settings as the API exposes them: no internal storage path, and
    real booleans rather than SQLite's 0/1 integers."""
    current = get_settings()
    return {
        "header_text": current["header_text"],
        "footer_text": current["footer_text"],
        "has_logo": bool(current["header_logo_path"]),
        "default_align": current["default_align"],
        "default_bold": bool(current["default_bold"]),
        "default_double_width": bool(current["default_double_width"]),
    }


def logo_path() -> str | None:
    """Absolute path of the configured logo, or None if unset/missing."""
    current = get_settings()
    if not current["header_logo_path"]:
        return None
    path = os.path.join(config.DATA_DIR, current["header_logo_path"])
    return path if os.path.exists(path) else None


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


def set_logo(image_bytes: bytes, original_filename: str | None) -> None:
    remove_logo()
    ext = files.allowed_extension(original_filename, LOGO_EXTS)
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
