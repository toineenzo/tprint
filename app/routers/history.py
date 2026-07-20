from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app import auth, history

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
def list_history(_: None = Depends(auth.require_api_auth)):
    entries = history.list_recent()
    return [
        {
            "id": e["id"],
            "kind": e["kind"],
            "preview_text": e["preview_text"],
            "has_image": bool(e["preview_image_path"]),
            "created_at": e["created_at"],
        }
        for e in entries
    ]


@router.get("/{entry_id}/image")
def history_image(entry_id: int, _: None = Depends(auth.require_api_auth)):
    path = history.thumb_path(entry_id)
    if not path:
        raise HTTPException(404, "no image for this history entry")
    return FileResponse(path)
