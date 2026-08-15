import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from app import about, auth, db, preview, printer
from app import help as help_docs
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


@router.get("/help")
def read_help(page: str = "Home", _: None = Depends(auth.require_api_auth)):
    """A wiki page as Markdown — live if reachable, bundled otherwise."""
    try:
        return {**help_docs.page(page), "pages": list(help_docs.PAGES), "url": help_docs.WIKI_WEB_URL}
    except KeyError:
        raise HTTPException(404, "no such help page") from None


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
    queue_auto_clear: bool = Form(False),
    header_style: Optional[str] = Form(None),
    footer_style: Optional[str] = Form(None),
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
        queue_auto_clear=queue_auto_clear,
        header_style=header_style,
        footer_style=footer_style,
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


@router.post("/connection")
def save_connection(
    printer_backend: Optional[str] = Form(None),
    printer_device: Optional[str] = Form(None),
    _: None = Depends(auth.require_session_auth),
):
    """Point the app at a different printer without editing docker-compose.

    Session auth rather than the print token: redirecting every print to a
    different device is configuration, not printing.
    """
    try:
        settings_store.set_connection(printer_backend, printer_device)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return settings_store.public_settings()


@router.post("/printer-test")
def test_printer(
    do_print: bool = Form(False),
    _: None = Depends(auth.require_api_auth),
):
    """Diagnose the printer connection, one check at a time.

    Written to answer "why is nothing printing" without a shell on the host:
    each check is reported separately so the answer is "the device node isn't
    there" or "the container can't write to it", rather than one opaque
    failure. Optionally prints a test receipt, which is the only check that
    proves the whole path end to end.
    """
    backend = settings_store.printer_backend()
    device = settings_store.printer_device()
    checks: list[dict] = [
        {
            "label": "backend",
            "ok": True,
            "detail": backend,
        }
    ]

    if backend == "dummy":
        checks.append(
            {
                "label": "device",
                "ok": True,
                "detail": "dummy backend: jobs are built but never sent to hardware",
            }
        )
        return {"ok": True, "device": device, "checks": checks}

    exists = os.path.exists(device)
    checks.append({"label": "device", "ok": exists, "detail": device})
    if not exists:
        checks.append(
            {
                "label": "hint",
                "ok": False,
                "detail": (
                    "The device node does not exist. The printer is probably off or "
                    "unplugged; if it is on, check the container's device mapping."
                ),
            }
        )
        return {"ok": False, "device": device, "checks": checks}

    writable = os.access(device, os.W_OK)
    checks.append(
        {
            "label": "writable",
            "ok": writable,
            "detail": "yes" if writable else "no permission to write to the device",
        }
    )
    if not writable:
        return {"ok": False, "device": device, "checks": checks}

    # The check that actually answers "is the printer on". The node exists and
    # is writable whenever the cable is in — a switched-off printer only shows
    # up when something opens it, which is why a test that stopped at `access`
    # reported a healthy connection to a printer that was off.
    try:
        fd = os.open(device, os.O_WRONLY | os.O_NONBLOCK)
        os.close(fd)
        checks.append({"label": "open", "ok": True, "detail": "the printer responded"})
    except OSError as exc:
        checks.append(
            {
                "label": "open",
                "ok": False,
                "detail": (
                    f"could not open {device}: {exc.strerror or exc} — "
                    "the printer is switched off or asleep"
                ),
            }
        )
        return {"ok": False, "device": device, "checks": checks}

    if do_print:
        try:
            printer.print_text("tprint connection test")
            checks.append({"label": "test_print", "ok": True, "detail": "sent"})
        except printer.PrinterUnavailable as exc:
            checks.append({"label": "test_print", "ok": False, "detail": str(exc)})
            return {"ok": False, "device": device, "checks": checks}

    return {"ok": True, "device": device, "checks": checks}


@router.post("/auth")
def save_auth(
    enabled: bool = Form(True),
    password: Optional[str] = Form(None),
    _: None = Depends(auth.require_session_auth),
):
    """Turn the login on/off and set the password, from the setup wizard.

    Session auth only, for the obvious reason: the print token must not be
    able to change how the app is protected.
    """
    try:
        settings_store.set_auth(enabled, (password or "").strip() or None)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return settings_store.public_settings()


@router.post("/setup-done")
def finish_setup(_: None = Depends(auth.require_session_auth)):
    """Mark the first-run wizard as completed. Reset turns this back off."""
    settings_store.mark_setup_done(True)
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
