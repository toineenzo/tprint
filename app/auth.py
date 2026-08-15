from fastapi import HTTPException, Request, status

from app import config
from app import settings as settings_store


def has_valid_session(request: Request) -> bool:
    return bool(request.session.get("authed"))


def has_valid_token(request: Request) -> bool:
    if not config.PRINT_API_TOKEN:
        return False
    return request.headers.get("Authorization") == f"Bearer {config.PRINT_API_TOKEN}"


def auth_enabled() -> bool:
    """The effective setting: the stored one if set, else the env var.

    Read through here rather than from config directly, so turning the login
    on or off in the setup wizard takes effect everywhere at once.
    """
    return settings_store.auth_enabled()


def web_page_authed(request: Request) -> bool:
    """Whether a browser page request should render, vs. redirect to /login."""
    if not auth_enabled():
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
    if not auth_enabled() and not config.PRINT_API_TOKEN:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")


def require_session_auth(request: Request) -> None:
    """Dependency for destructive actions only the web UI should be able to take.

    Deliberately does *not* accept PRINT_API_TOKEN. That token exists so machine
    callers (n8n, Home Assistant) can print; being able to print must not imply
    being able to wipe the database. A token that leaks out of an automation
    should cost you some paper, not your snippets and history.

    When AUTH_ENABLED is off there is no login and therefore no session to hold,
    so this falls back to the same network-level trust require_api_auth relies
    on — otherwise the reset button would be permanently unusable for the
    reverse-proxy-protected deployments the README documents.
    """
    if has_valid_session(request):
        return
    if not auth_enabled():
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="this action requires a logged-in browser session",
    )
