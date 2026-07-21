from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app import auth, history

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
def list_history(_: None = Depends(auth.require_api_auth)):
    return history.list_recent_public()


@router.get("/{entry_id}/image")
def history_image(entry_id: int, _: None = Depends(auth.require_api_auth)):
    path = history.thumb_path(entry_id)
    if not path:
        raise HTTPException(404, "no image for this history entry")
    return FileResponse(path)
