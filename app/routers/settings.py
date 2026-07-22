from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from app import about, auth, db, preview, printer
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


@router.get("/about")
def read_about(_: None = Depends(auth.require_api_auth)):
    return about.payload()


@router.get("/logo")
def read_logo(_: None = Depends(auth.require_api_auth)):
    path = settings_store.logo_path()
    if not path:
        raise HTTPException(404, "no logo set")
    return FileResponse(path)


@router.get("/footer-logo")
def read_footer_logo(_: None = Depends(auth.require_api_auth)):
    path = settings_store.footer_logo_path()
    if not path:
        raise HTTPException(404, "no footer logo set")
    return FileResponse(path)


@router.get("/preview")
def preview_settings(_: None = Depends(auth.require_api_auth)):
    """A sample receipt showing what the current settings produce.

    Runs through the same framing code a real print does, so the header,
    footer, logos, default text style, paper width and auto-cut on show here
    are the actual ones — not a mock-up that has to be kept in step.
    """
    sample = printer.text_content(
        "Sample receipt body.\nThis is what your settings look like."
    )
    return Response(preview.to_png(preview.render_job(sample)), media_type="image/png")


@router.post("")
async def save_settings(
    header_text: str = Form(""),
    footer_text: str = Form(""),
    default_align: Align = Form("left"),
    default_bold: bool = Form(False),
    default_double_width: bool = Form(False),
    remove_logo: bool = Form(False),
    remove_footer_logo: bool = Form(False),
    paper_width_px: Optional[int] = Form(None),
    auto_cut: bool = Form(True),
    confirm_before_print: bool = Form(False),
    surprise_preview: bool = Form(False),
    print_delay_seconds: int = Form(0),
    retention_max_items: int = Form(50),
    retention_max_age_days: int = Form(0),
    logo: Optional[UploadFile] = File(None),
    footer_logo: Optional[UploadFile] = File(None),
    _: None = Depends(auth.require_api_auth),
):
    settings_store.update_settings(
        header_text=header_text.strip(),
        footer_text=footer_text.strip(),
        default_align=default_align,
        default_bold=default_bold,
        default_double_width=default_double_width,
        paper_width_px=paper_width_px,
        auto_cut=auto_cut,
        confirm_before_print=confirm_before_print,
        surprise_preview=surprise_preview,
        print_delay_seconds=print_delay_seconds,
        retention_max_items=retention_max_items,
        retention_max_age_days=retention_max_age_days,
    )

    if remove_logo:
        settings_store.remove_logo()
    elif logo is not None and logo.filename:
        settings_store.set_logo(await logo.read(), logo.filename)

    if remove_footer_logo:
        settings_store.remove_footer_logo()
    elif footer_logo is not None and footer_logo.filename:
        settings_store.set_footer_logo(await footer_logo.read(), footer_logo.filename)

    return settings_store.public_settings()


@router.post("/reset")
def reset_data(_: None = Depends(auth.require_session_auth)):
    """Wipe every snippet, history entry, queued job and printer setting.

    There is no undo and nothing is backed up first — the UI gates this behind a
    confirmation modal, and that is the only safeguard by design.

    Note the dependency: require_session_auth, not require_api_auth. This is the
    one endpoint a PRINT_API_TOKEN may not reach.
    """
    db.reset_all()
    return settings_store.public_settings()
