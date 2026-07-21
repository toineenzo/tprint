import re
import secrets
from pathlib import Path

from fastapi.templating import Jinja2Templates

from app import config

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.globals["build_date"] = config.get_build_date()


def _asset_version() -> str:
    """A URL-safe cache-busting token for the frontend bundle.

    The bundle is emitted under fixed, unhashed filenames (see
    frontend/vite.config.ts), so busting rides on a query string instead. In
    production that's the image build timestamp — squashed to a safe token,
    since it contains spaces and a colon; locally it's per-process, so
    restarting uvicorn --reload picks up a fresh `npm run dev` build.
    """
    build_date = config.get_build_date()
    if not build_date:
        return secrets.token_hex(4)
    return re.sub(r"[^A-Za-z0-9]+", "-", build_date).strip("-")


templates.env.globals["asset_version"] = _asset_version()
