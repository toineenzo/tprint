import hashlib
import json
import os
import secrets
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

# Enough to be slow for a guesser, fast enough that a login isn't noticeable.
_PBKDF2_ROUNDS = 200_000


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
        "queue_auto_clear": bool(current["queue_auto_clear"]),
        "header_style": _style(current["header_style"]),
        "footer_style": _style(current["footer_style"]),
        "printer_backend": printer_backend(),
        "printer_device": printer_device(),
        "setup_done": bool(current["setup_done"]),
        "auth_enabled": auth_enabled(),
        "has_password": bool(current["password_hash"] or config.APP_PASSWORD),
    }


def auth_enabled() -> bool:
    """Whether the login page is in force. Stored value wins over the env var."""
    stored = get_settings()["auth_enabled"]
    return config.AUTH_ENABLED if stored is None else bool(stored)


def _hash_password(plain: str) -> str:
    """PBKDF2-SHA256, salted, from the standard library.

    No new dependency for one password: this is a single-user self-hosted app
    whose threat model is "someone finds the URL", not an account database.
    """
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", plain.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS)
    return f"pbkdf2${_PBKDF2_ROUNDS}${salt}${digest.hex()}"


def verify_password(plain: str) -> bool:
    """Check a login attempt against the stored password, else APP_PASSWORD.

    The env var stays a valid credential when nothing is stored, so an install
    that never opens the wizard keeps logging in exactly as before.
    """
    stored = get_settings()["password_hash"]
    if stored:
        try:
            _, rounds, salt, expected = stored.split("$")
            digest = hashlib.pbkdf2_hmac(
                "sha256", plain.encode(), bytes.fromhex(salt), int(rounds)
            )
        except (ValueError, TypeError):
            return False
        return secrets.compare_digest(digest.hex(), expected)
    if config.APP_PASSWORD:
        return secrets.compare_digest(plain, config.APP_PASSWORD)
    return False


def set_auth(enabled: bool, password: str | None = None) -> None:
    """Turn the login on/off and optionally set a new password.

    Refuses to enable auth with no password anywhere — that would lock the app
    with a credential nobody holds, which is a worse outcome than leaving it
    as it was.
    """
    current = get_settings()
    has_password = bool(password) or bool(current["password_hash"]) or bool(config.APP_PASSWORD)
    if enabled and not has_password:
        raise ValueError("set a password before turning the login on")

    with db.get_conn() as conn:
        conn.execute(
            "UPDATE settings SET auth_enabled = ? WHERE id = 1", (int(enabled),)
        )
        if password:
            conn.execute(
                "UPDATE settings SET password_hash = ? WHERE id = 1",
                (_hash_password(password),),
            )


def printer_backend() -> str:
    """"file" (real hardware) or "dummy" (no device), from the DB or the env.

    Stored settings win, the env var is the fallback — so an install that was
    only ever configured through docker-compose keeps behaving identically
    until someone changes it in the app.
    """
    stored = get_settings()["printer_backend"]
    return stored or config.PRINTER_BACKEND


def printer_device() -> str:
    """The device node ESC/POS bytes are written to. Same fallback rule."""
    stored = get_settings()["printer_device"]
    return stored or config.PRINTER_DEVICE


def set_connection(backend: str | None, device: str | None) -> None:
    """Store the printer connection. Empty values mean "follow the env vars"."""
    if backend and backend not in ("file", "dummy"):
        raise ValueError("printer_backend must be 'file' or 'dummy'")
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE settings SET printer_backend = ?, printer_device = ? WHERE id = 1",
            (backend or None, (device or "").strip() or None),
        )


def mark_setup_done(done: bool = True) -> None:
    with db.get_conn() as conn:
        conn.execute("UPDATE settings SET setup_done = ? WHERE id = 1", (int(done),))


def _style(raw: str | None) -> dict | None:
    """A stored frame style as JSON, or None. Bad JSON reads as "no style"."""
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


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


def _clean_style(raw: str | None) -> str | None:
    """Keep a submitted frame style only if it parses as a JSON object.

    Anything else is stored as NULL, which prints the plain centred frame —
    a broken style must never be able to break every receipt.
    """
    return json.dumps(_style(raw)) if _style(raw) else None


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
    queue_auto_clear: bool = False,
    header_style: str | None = None,
    footer_style: str | None = None,
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
                retention_max_items = ?, retention_max_age_days = ?,
                queue_auto_clear = ?, header_style = ?, footer_style = ?
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
                int(queue_auto_clear),
                _clean_style(header_style),
                _clean_style(footer_style),
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
