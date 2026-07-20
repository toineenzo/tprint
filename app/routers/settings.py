import os
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse

from app import auth, config, i18n
from app import settings as settings_store
from app.templating import templates

router = APIRouter()


@router.get("/settings/logo")
def settings_logo(request: Request):
    if not auth.web_page_authed(request):
        return RedirectResponse("/login")
    current = settings_store.get_settings()
    if not current["header_logo_path"]:
        raise HTTPException(404, "no logo set")
    path = os.path.join(config.DATA_DIR, current["header_logo_path"])
    if not os.path.exists(path):
        raise HTTPException(404, "logo file missing")
    return FileResponse(path)


@router.get("/settings")
def settings_page(request: Request):
    if not auth.web_page_authed(request):
        return RedirectResponse("/login")
    lang = i18n.from_request(request)
    return templates.TemplateResponse(
        request,
        "settings.html",
        {
            "strings": i18n.t(lang),
            "lang": lang,
            "settings": settings_store.get_settings(),
        },
    )


@router.post("/settings")
async def settings_save(
    request: Request,
    header_text: str = Form(""),
    footer_text: str = Form(""),
    default_align: str = Form("left"),
    default_bold: Optional[str] = Form(None),
    default_double_width: Optional[str] = Form(None),
    remove_logo: Optional[str] = Form(None),
    logo: Optional[UploadFile] = File(None),
):
    if not auth.web_page_authed(request):
        return RedirectResponse("/login")

    settings_store.update_settings(
        header_text=header_text.strip(),
        footer_text=footer_text.strip(),
        default_align=default_align,
        default_bold=bool(default_bold),
        default_double_width=bool(default_double_width),
    )

    if remove_logo:
        settings_store.remove_logo()
    elif logo is not None and logo.filename:
        data = await logo.read()
        ext = (logo.filename or "png").rsplit(".", 1)[-1]
        settings_store.set_logo(data, ext)

    return RedirectResponse("/settings", status_code=303)
