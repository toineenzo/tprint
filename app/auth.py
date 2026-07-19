from fastapi import HTTPException, Request, status

from app import config


def has_valid_session(request: Request) -> bool:
    return bool(request.session.get("authed"))


def has_valid_token(request: Request) -> bool:
    if not config.PRINT_API_TOKEN:
        return False
    return request.headers.get("Authorization") == f"Bearer {config.PRINT_API_TOKEN}"


def web_page_authed(request: Request) -> bool:
    """Whether a browser page request should render, vs. redirect to /login."""
    if not config.AUTH_ENABLED:
        return True
    return has_valid_session(request)


def require_api_auth(request: Request) -> None:
    """Dependency for /print/* and /snippets/* endpoints.

    Accepts a logged-in browser session, or (if PRINT_API_TOKEN is set) a
    matching bearer token for machine callers like n8n/Home Assistant. If
    AUTH_ENABLED is off and no token is configured, access relies entirely
    on network-level protection (Cloudflare Access, Twingate).
    """
    if has_valid_session(request):
        return
    if has_valid_token(request):
        return
    if not config.AUTH_ENABLED and not config.PRINT_API_TOKEN:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
