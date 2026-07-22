import json

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

from app import auth, config, history, i18n
from app import settings as settings_store
from app import snippets as snippets_store
from app.templating import templates

router = APIRouter(tags=["pages"])


def _shell(request: Request, page: str, lang: str, status_code: int = 200, **extra):
    """Render the React shell for a browser page.

    Everything the first paint needs is serialized into `window.__TPRINT__` —
    strings, language list, and the page's seed data — so the UI comes up
    populated instead of flashing empty lists while it fetches.
    """
    strings = i18n.t(lang)
    bootstrap = {
        "page": page,
        "lang": lang,
        "languages": list(i18n.LANGUAGES),
        "native_names": i18n.NATIVE_NAMES,
        "strings": strings,
        "auth_enabled": config.AUTH_ENABLED,
        "build_date": config.get_build_date(),
        **extra,
    }
    return templates.TemplateResponse(
        request,
        "shell.html",
        {
            "lang": lang,
            "title": strings["app_title"],
            "bootstrap_json": json.dumps(bootstrap),
        },
        status_code=status_code,
    )


@router.get("/lang/{code}")
def set_lang(code: str, request: Request):
    destination = request.headers.get("referer", "/")
    response = RedirectResponse(destination)
    response.set_cookie("lang", i18n.resolve_lang(code), max_age=60 * 60 * 24 * 365)
    return response


@router.get("/login")
def login_page(request: Request):
    if auth.web_page_authed(request):
        return RedirectResponse("/")
    return _shell(request, "login", i18n.from_request(request), login_error=None)


@router.post("/login")
def login_submit(request: Request, password: str = Form(...)):
    if config.APP_PASSWORD and password == config.APP_PASSWORD:
        request.session["authed"] = True
        return RedirectResponse("/", status_code=303)
    lang = i18n.from_request(request)
    return _shell(
        request, "login", lang, status_code=401, login_error=i18n.t(lang)["login_error"]
    )


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


def _index(request: Request, open_settings: bool = False):
    return _shell(
        request,
        "index",
        i18n.from_request(request),
        snippets=snippets_store.list_snippets(),
        history=history.list_recent_public(20),
        settings=settings_store.public_settings(),
        open_settings=open_settings,
    )


@router.get("/")
def index(request: Request):
    if not auth.web_page_authed(request):
        return RedirectResponse("/login")
    return _index(request)


@router.get("/settings")
def settings_page(request: Request):
    """Settings is a modal on the main page, not a page of its own any more.

    The URL is kept so existing bookmarks still land on settings — it renders
    the same shell with the modal already open, rather than 404ing or dumping
    the visitor on the main page with no explanation.
    """
    if not auth.web_page_authed(request):
        return RedirectResponse("/login")
    return _index(request, open_settings=True)
