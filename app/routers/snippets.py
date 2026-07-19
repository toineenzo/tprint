import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image

from app import auth, config, printer
from app import snippets as snippets_store

router = APIRouter(prefix="/snippets", tags=["snippets"])


@router.get("")
def list_snippets(_: None = Depends(auth.require_api_auth)):
    return snippets_store.list_snippets()


@router.post("")
async def create_snippet(
    name: str = Form(...),
    kind: str = Form(...),
    text_content: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    _: None = Depends(auth.require_api_auth),
):
    if not name.strip():
        raise HTTPException(400, "name is required")
    if kind == "text":
        if not text_content or not text_content.strip():
            raise HTTPException(400, "text_content is required for text snippets")
        snippet_id = snippets_store.create_text_snippet(name, text_content)
    elif kind == "image":
        if file is None:
            raise HTTPException(400, "file is required for image snippets")
        data = await file.read()
        ext = (file.filename or "png").rsplit(".", 1)[-1]
        snippet_id = snippets_store.create_image_snippet(name, data, ext)
    else:
        raise HTTPException(400, "kind must be 'text' or 'image'")
    return {"id": snippet_id}


@router.delete("/{snippet_id}")
def delete_snippet(snippet_id: int, _: None = Depends(auth.require_api_auth)):
    snippets_store.delete_snippet(snippet_id)
    return {"status": "deleted"}


@router.post("/{snippet_id}/print")
def print_snippet(snippet_id: int, _: None = Depends(auth.require_api_auth)):
    snippet = snippets_store.get_snippet(snippet_id)
    if not snippet:
        raise HTTPException(404, "snippet not found")
    if snippet["kind"] == "text":
        printer.print_text(snippet["text_content"])
    else:
        path = os.path.join(config.SNIPPET_IMAGE_DIR, snippet["image_path"])
        printer.print_image(Image.open(path))
    return {"status": "printed"}
