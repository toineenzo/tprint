from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import auth, db
from app import settings as settings_store
from app.schemas import Align

# JSON API. The settings *page* is a browser route and lives in routers/pages.py
# with the other HTML shells.
#
# These used to be form-post endpoints that returned RedirectResponse("/login")
# when unauthenticated, which an XHR caller reads as a successful 200 with a
# login page in the body. Depends(require_api_auth) raises a real 401 instead.
router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def read_settings(_: None = Depends(auth.require_api_auth)):
    return settings_store.public_settings()


@router.get("/logo")
def read_logo(_: None = Depends(auth.require_api_auth)):
    path = settings_store.logo_path()
    if not path:
        raise HTTPException(404, "no logo set")
    return FileResponse(path)


@router.post("")
async def save_settings(
    header_text: str = Form(""),
    footer_text: str = Form(""),
    default_align: Align = Form("left"),
    default_bold: bool = Form(False),
    default_double_width: bool = Form(False),
    remove_logo: bool = Form(False),
    logo: Optional[UploadFile] = File(None),
    _: None = Depends(auth.require_api_auth),
):
    settings_store.update_settings(
        header_text=header_text.strip(),
        footer_text=footer_text.strip(),
        default_align=default_align,
        default_bold=default_bold,
        default_double_width=default_double_width,
    )

    if remove_logo:
        settings_store.remove_logo()
    elif logo is not None and logo.filename:
        settings_store.set_logo(await logo.read(), logo.filename)

    return settings_store.public_settings()


@router.post("/reset")
def reset_data(_: None = Depends(auth.require_api_auth)):
    """Wipe every snippet, history entry, queued job and printer setting.

    There is no undo and nothing is backed up first — the UI gates this behind a
    confirmation modal, and that is the only safeguard by design.
    """
    db.reset_all()
    return settings_store.public_settings()
