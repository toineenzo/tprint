from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app import auth, history, richtext
from app import snippets as snippets_store

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
def list_history(_: None = Depends(auth.require_api_auth)):
    return history.list_recent_public()


@router.delete("")
def clear_history(_: None = Depends(auth.require_session_auth)):
    """Session auth: wiping the record of what was printed is destructive and
    has no machine-caller use case, the same reasoning as the settings reset.
    """
    return {"cleared": history.clear_all()}


@router.post("/{entry_id}/snippet")
def snippet_from_history(entry_id: int, _: None = Depends(auth.require_api_auth)):
    """Keep a past print as a snippet.

    Only entries with a stored payload can do this — text, rich text, a
    checklist or a code. An image or PDF print kept a thumbnail, not the file,
    so there is nothing to reprint from and the UI doesn't offer the button.
    """
    found = history.entry_payload(entry_id)
    if not found:
        raise HTTPException(404, "this history entry cannot be saved as a snippet")

    kind, payload = found
    if kind == "checklist":
        name = payload.get("title") or (payload.get("items") or [{}])[0].get("text", "checklist")
        snippet_id = snippets_store.create_checklist_snippet(
            name[:80],
            payload.get("title"),
            payload.get("items") or [],
            payload.get("mode", "single"),
        )
    elif kind == "richtext":
        text = richtext.plain_text(payload.get("blocks") or [])
        snippet_id = snippets_store.create_text_snippet(_name_from(text), text)
    elif kind == "code":
        # A code snippet reprints as its text; the codes tab re-encodes it.
        snippet_id = snippets_store.create_text_snippet(
            _name_from(payload.get("data", "")), payload.get("data", "")
        )
    else:
        text = payload.get("text", "")
        snippet_id = snippets_store.create_text_snippet(_name_from(text), text)

    return {"status": "saved", "snippet_id": snippet_id}


def _name_from(text: str) -> str:
    """First line of the content, which is what the print tabs name snippets by."""
    first = (text or "").strip().splitlines()
    return (first[0] if first else "snippet")[:80] or "snippet"


@router.get("/{entry_id}/image")
def history_image(entry_id: int, _: None = Depends(auth.require_api_auth)):
    path = history.thumb_path(entry_id)
    if not path:
        raise HTTPException(404, "no image for this history entry")
    return FileResponse(path)
