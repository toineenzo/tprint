import os


def _bool_env(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


DATA_DIR = os.environ.get("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA_DIR, "tprint.db")
SNIPPET_FILES_DIR = os.path.join(DATA_DIR, "snippet_images")
QUEUE_UPLOAD_DIR = os.path.join(DATA_DIR, "queue_uploads")
HISTORY_THUMB_DIR = os.path.join(DATA_DIR, "history_thumbs")

AUTH_ENABLED = _bool_env("AUTH_ENABLED", True)
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")

# Optional shared token for machine callers (n8n, Home Assistant) that can't
# hold a browser session cookie. If unset, machine calls are not checked
# beyond whatever network-level access control (Cloudflare Access, Twingate)
# is already in front of the app.
PRINT_API_TOKEN = os.environ.get("PRINT_API_TOKEN", "")

# "file"  -> write real ESC/POS bytes to PRINTER_DEVICE (production)
# "dummy" -> use escpos.printer.Dummy, no hardware required (local dev)
PRINTER_BACKEND = os.environ.get("PRINTER_BACKEND", "file")
PRINTER_DEVICE = os.environ.get("PRINTER_DEVICE", "/dev/usb/lp0")

# Epson TM-T88V prints at 180 dpi across an 80mm roll (~576 px wide).
PRINTER_WIDTH_PX = int(os.environ.get("PRINTER_WIDTH_PX", "576"))

BUILD_INFO_PATH = "/app/build_info.txt"


def get_build_date() -> str | None:
    try:
        with open(BUILD_INFO_PATH, encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return None
