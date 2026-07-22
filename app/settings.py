import os
import uuid

from app import config, db, files

LOGO_EXTS = ("png", "jpg", "jpeg", "gif", "bmp", "webp")

# Printable width in dots for the paper sizes the UI offers. These are the
# printable area, not the paper width: an 80mm roll prints 72mm wide, a
# 58mm roll (also sold as 57mm) prints 48mm. Anything else is set as raw dots.
PAPER_WIDTHS = {"80mm": 576, "58mm": 384}

# Guard rails for the free-form width field. Below ~100 dots nothing legible
# fits; above 2048 an image resize starts costing real memory for no printer
# that exists.
MIN_PAPER_WIDTH = 100
MAX_PAPER_WIDTH = 2048

# A print can be spaced out by at most a minute. Longer would hold the print
# lock — and therefore every other print — for an unreasonable time.
MAX_PRINT_DELAY_SECONDS = 60


def get_settings() -> dict:
    """The raw settings row, including the on-disk logo filenames.

    For internal use (printer.py needs the logo paths). Anything reaching an
    HTTP response should use public_settings() instead.
    """
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        return dict(row)


def paper_width_px() -> int:
    """The printable width every renderer measures against.

    Falls back to the PRINTER_WIDTH_PX env var when unset, which is what that
    variable used to control outright — so an install that never touches the
    paper-size setting keeps its existing width.
    """
    configured = get_settings()["paper_width_px"]
    return int(configured) if configured else config.PRINTER_WIDTH_PX


def public_settings() -> dict:
    """The settings as the API exposes them: no internal storage paths, and
    real booleans rather than SQLite's 0/1 integers."""
    current = get_settings()
    return {
        "header_text": current["header_text"],
        "footer_text": current["footer_text"],
        "has_logo": bool(current["header_logo_path"]),
        "has_footer_logo": bool(current["footer_logo_path"]),
        "default_align": current["default_align"],
        "default_bold": bool(current["default_bold"]),
        "default_double_width": bool(current["default_double_width"]),
        "paper_width_px": paper_width_px(),
        "auto_cut": bool(current["auto_cut"]),
        "confirm_before_print": bool(current["confirm_before_print"]),
        "surprise_preview": bool(current["surprise_preview"]),
        "print_delay_seconds": int(current["print_delay_seconds"]),
        "retention_max_items": int(current["retention_max_items"]),
        "retention_max_age_days": int(current["retention_max_age_days"]),
    }


def _logo_path(column: str) -> str | None:
    current = get_settings()
    if not current[column]:
        return None
    path = os.path.join(config.DATA_DIR, current[column])
    return path if os.path.exists(path) else None


def logo_path() -> str | None:
    """Absolute path of the configured header logo, or None if unset/missing."""
    return _logo_path("header_logo_path")


def footer_logo_path() -> str | None:
    """Absolute path of the configured footer logo, or None if unset/missing."""
    return _logo_path("footer_logo_path")


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def update_settings(
    header_text: str,
    footer_text: str,
    default_align: str,
    default_bold: bool,
    default_double_width: bool,
    paper_width_px: int | None = None,
    auto_cut: bool = True,
    confirm_before_print: bool = False,
    surprise_preview: bool = False,
    print_delay_seconds: int = 0,
    retention_max_items: int = 50,
    retention_max_age_days: int = 0,
) -> None:
    if default_align not in ("left", "center", "right"):
        raise ValueError("default_align must be 'left', 'center', or 'right'")

    # Clamped rather than rejected: these arrive from number inputs where a
    # stray keystroke is far more likely than a considered 9999, and a 422 in
    # the middle of saving eleven other settings is a poor trade.
    width = (
        _clamp(int(paper_width_px), MIN_PAPER_WIDTH, MAX_PAPER_WIDTH)
        if paper_width_px
        else None
    )
    delay = _clamp(int(print_delay_seconds), 0, MAX_PRINT_DELAY_SECONDS)
    max_items = max(0, int(retention_max_items))
    max_age = max(0, int(retention_max_age_days))

    with db.get_conn() as conn:
        conn.execute(
            """
            UPDATE settings
            SET header_text = ?, footer_text = ?, default_align = ?,
                default_bold = ?, default_double_width = ?,
                paper_width_px = ?, auto_cut = ?, confirm_before_print = ?,
                surprise_preview = ?, print_delay_seconds = ?,
                retention_max_items = ?, retention_max_age_days = ?
            WHERE id = 1
            """,
            (
                header_text or None,
                footer_text or None,
                default_align,
                int(default_bold),
                int(default_double_width),
                width,
                int(auto_cut),
                int(confirm_before_print),
                int(surprise_preview),
                delay,
                max_items,
                max_age,
            ),
        )


def _set_logo(column: str, image_bytes: bytes, original_filename: str | None) -> None:
    _remove_logo(column)
    ext = files.allowed_extension(original_filename, LOGO_EXTS)
    filename = f"logo-{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(config.DATA_DIR, filename), "wb") as f:
        f.write(image_bytes)
    with db.get_conn() as conn:
        conn.execute(f"UPDATE settings SET {column} = ? WHERE id = 1", (filename,))


def _remove_logo(column: str) -> None:
    current = get_settings()
    if current[column]:
        path = os.path.join(config.DATA_DIR, current[column])
        if os.path.exists(path):
            os.remove(path)
    with db.get_conn() as conn:
        conn.execute(f"UPDATE settings SET {column} = NULL WHERE id = 1")


def set_logo(image_bytes: bytes, original_filename: str | None) -> None:
    _set_logo("header_logo_path", image_bytes, original_filename)


def remove_logo() -> None:
    _remove_logo("header_logo_path")


def set_footer_logo(image_bytes: bytes, original_filename: str | None) -> None:
    _set_logo("footer_logo_path", image_bytes, original_filename)


def remove_footer_logo() -> None:
    _remove_logo("footer_logo_path")
