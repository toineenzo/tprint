import json

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

from app import auth, config, i18n
from app import snippets as snippets_store
from app.templating import templates

router = APIRouter()


@router.get("/lang/{code}")
def set_lang(code: str, request: Request):
    destination = request.headers.get("referer", "/")
    response = RedirectResponse(destination)
    response.set_cookie("lang", i18n.resolve_lang(code), max_age=60 * 60 * 24 * 365)
    return response


@router.get("/login")
def login_page(request: Request):
    lang = i18n.from_request(request)
    if auth.web_page_authed(request):
        return RedirectResponse("/")
    return templates.TemplateResponse(
        request, "login.html", {"error": None, "strings": i18n.t(lang), "lang": lang}
    )


@router.post("/login")
def login_submit(request: Request, password: str = Form(...)):
    lang = i18n.from_request(request)
    if config.APP_PASSWORD and password == config.APP_PASSWORD:
        request.session["authed"] = True
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(
        request,
        "login.html",
        {"error": i18n.t(lang)["login_error"], "strings": i18n.t(lang), "lang": lang},
        status_code=401,
    )


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@router.get("/")
def index(request: Request):
    if not auth.web_page_authed(request):
        return RedirectResponse("/login")
    lang = i18n.from_request(request)
    strings = i18n.t(lang)
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "snippets": snippets_store.list_snippets(),
            "auth_enabled": config.AUTH_ENABLED,
            "strings": strings,
            "strings_json": json.dumps(strings),
            "lang": lang,
        },
    )
