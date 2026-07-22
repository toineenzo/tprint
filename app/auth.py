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
    if not config.AUTH_ENABLED:
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="this action requires a logged-in browser session",
    )
