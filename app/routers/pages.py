from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

from app import auth, config, snippets as snippets_store
from app.templating import templates

router = APIRouter()


@router.get("/login")
def login_page(request: Request):
    if auth.web_page_authed(request):
        return RedirectResponse("/")
    return templates.TemplateResponse(request, "login.html", {"error": None})


@router.post("/login")
def login_submit(request: Request, password: str = Form(...)):
    if config.APP_PASSWORD and password == config.APP_PASSWORD:
        request.session["authed"] = True
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(
        request, "login.html", {"error": "Incorrect password"}, status_code=401
    )


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@router.get("/")
def index(request: Request):
    if not auth.web_page_authed(request):
        return RedirectResponse("/login")
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "snippets": snippets_store.list_snippets(),
            "auth_enabled": config.AUTH_ENABLED,
        },
    )
