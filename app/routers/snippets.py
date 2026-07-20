import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import actions, auth, print_queue
from app import snippets as snippets_store

router = APIRouter(prefix="/snippets", tags=["snippets"])


@router.get("")
def list_snippets(_: None = Depends(auth.require_api_auth)):
    return snippets_store.list_snippets()


@router.get("/files/{filename}")
def snippet_file(filename: str, _: None = Depends(auth.require_api_auth)):
    path = snippets_store.file_path(filename)
    if not os.path.exists(path):
        raise HTTPException(404, "file not found")
    return FileResponse(path)


@router.post("")
async def create_snippet(
    name: str = Form(...),
    kind: str = Form(...),
    text_content: Optional[str] = Form(None),
    files: list[UploadFile] = File(default=[]),
    _: None = Depends(auth.require_api_auth),
):
    if not name.strip():
        raise HTTPException(400, "name is required")

    if kind == "text":
        if not text_content or not text_content.strip():
            raise HTTPException(400, "text_content is required for text snippets")
        snippet_id = snippets_store.create_text_snippet(name, text_content)
    elif kind == "image":
        uploads = [f for f in files if f.filename]
        if not uploads:
            raise HTTPException(400, "at least one file is required for image snippets")
        loaded = [(await f.read(), f.filename) for f in uploads]
        snippet_id = snippets_store.create_image_snippet(name, loaded)
    elif kind == "pdf":
        uploads = [f for f in files if f.filename]
        if not uploads:
            raise HTTPException(400, "a file is required for pdf snippets")
        data = await uploads[0].read()
        snippet_id = snippets_store.create_pdf_snippet(name, data, uploads[0].filename)
    else:
        raise HTTPException(400, "kind must be 'text', 'image', or 'pdf'")
    return {"id": snippet_id}


@router.get("/{snippet_id}")
def get_snippet(snippet_id: int, _: None = Depends(auth.require_api_auth)):
    snippet = snippets_store.get_snippet(snippet_id)
    if not snippet:
        raise HTTPException(404, "snippet not found")
    return snippet


@router.put("/{snippet_id}")
async def update_snippet(
    snippet_id: int,
    name: str = Form(...),
    text_content: Optional[str] = Form(None),
    add_files: list[UploadFile] = File(default=[]),
    remove_files: list[str] = Form(default=[]),
    _: None = Depends(auth.require_api_auth),
):
    snippet = snippets_store.get_snippet(snippet_id)
    if not snippet:
        raise HTTPException(404, "snippet not found")
    if not name.strip():
        raise HTTPException(400, "name is required")

    uploads = [f for f in add_files if f.filename]

    if snippet["kind"] == "text":
        if not text_content or not text_content.strip():
            raise HTTPException(400, "text_content is required for text snippets")
        snippets_store.update_snippet(snippet_id, name, text_content=text_content)
    elif snippet["kind"] == "image":
        add_image_files = [(await f.read(), f.filename) for f in uploads]
        snippets_store.update_snippet(
            snippet_id, name, add_image_files=add_image_files, remove_filenames=remove_files
        )
    elif snippet["kind"] == "pdf":
        replace_pdf = None
        if uploads:
            replace_pdf = (await uploads[0].read(), uploads[0].filename)
        snippets_store.update_snippet(snippet_id, name, replace_pdf=replace_pdf)

    return {"status": "updated"}


@router.delete("/{snippet_id}")
def delete_snippet(snippet_id: int, _: None = Depends(auth.require_api_auth)):
    snippets_store.delete_snippet(snippet_id)
    return {"status": "deleted"}


@router.post("/{snippet_id}/print")
def print_snippet(
    snippet_id: int,
    queue: bool = False,
    run_at: Optional[str] = None,
    recurrence: Optional[str] = None,
    recurrence_time: Optional[str] = None,
    _: None = Depends(auth.require_api_auth),
):
    snippet = snippets_store.get_snippet(snippet_id)
    if not snippet:
        raise HTTPException(404, "snippet not found")

    if print_queue.should_queue(queue, run_at, recurrence):
        job_id = print_queue.enqueue(
            "snippet",
            {"snippet_id": snippet_id},
            label=snippet["name"],
            run_at=run_at,
            recurrence=recurrence,
            recurrence_time=recurrence_time,
        )
        return {"status": "queued", "job_id": job_id}

    actions.print_snippet(snippet_id)
    return {"status": "printed"}
