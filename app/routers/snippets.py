import json
import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError

from app import actions, auth, i18n, print_queue
from app import snippets as snippets_store
from app.schemas import ChecklistPrintRequest, QueueOptions, queue_options_query

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
    payload: Optional[str] = Form(None),
    mode: str = Form("single"),
    overview: str = Form("none"),
    orientation: str = Form("vertical"),
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
    elif kind == "checklist":
        # Validated through the same model the /print/checklist route uses, so a
        # saved checklist can't be shaped differently from a printed one.
        try:
            parsed = ChecklistPrintRequest.model_validate_json(payload or "")
        except ValidationError as exc:
            raise HTTPException(400, f"invalid checklist payload: {exc.error_count()} error(s)")
        items = [item.model_dump() for item in parsed.items]
        if not items:
            raise HTTPException(400, "at least one item is required for checklist snippets")
        snippet_id = snippets_store.create_checklist_snippet(
            name, parsed.title, items, parsed.mode
        )
    elif kind == "composition":
        try:
            parsed = json.loads(payload or "")
        except ValueError as exc:
            raise HTTPException(400, f"invalid composition payload: {exc}") from exc
        if not parsed.get("parts"):
            raise HTTPException(400, "a composition needs at least one part")
        uploads = [f for f in files if f.filename]
        loaded = [(await f.read(), f.filename) for f in uploads]
        snippet_id = snippets_store.create_composition_snippet(name, parsed, loaded)
    elif kind == "ics":
        uploads = [f for f in files if f.filename]
        if not uploads:
            raise HTTPException(400, "a file is required for ics snippets")
        data = await uploads[0].read()
        snippet_id = snippets_store.create_ics_snippet(
            name, data, uploads[0].filename, mode, overview, orientation
        )
    else:
        raise HTTPException(
            400,
            "kind must be 'text', 'image', 'pdf', 'checklist', 'ics', or 'composition'",
        )
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

    if snippet["kind"] in snippets_store.STRUCTURED_KINDS:
        # Checklist/agenda content is structured data captured at print time;
        # there's no text or file form that could edit it coherently, so the
        # name is the only thing that changes.
        snippets_store.rename_snippet(snippet_id, name)
    elif snippet["kind"] == "text":
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
    else:
        # Unreachable while the snippets table's CHECK constraint holds, but
        # without it an unknown kind reported success having done nothing.
        raise HTTPException(500, f"snippet {snippet_id} has an unknown kind")

    return {"status": "updated"}


@router.delete("/{snippet_id}")
def delete_snippet(snippet_id: int, _: None = Depends(auth.require_api_auth)):
    snippets_store.delete_snippet(snippet_id)
    return {"status": "deleted"}


@router.post("/{snippet_id}/print")
def print_snippet(
    snippet_id: int,
    request: Request,
    options: QueueOptions = Depends(queue_options_query),
    _: None = Depends(auth.require_api_auth),
):
    snippet = snippets_store.get_snippet(snippet_id)
    if not snippet:
        raise HTTPException(404, "snippet not found")

    # Checklist snippets render a localized "due" label, so the language is
    # captured with the job rather than read when the worker happens to run it.
    lang = i18n.from_request(request)

    if print_queue.should_queue(options.queue, options.run_at, options.recurrence):
        job_id = print_queue.enqueue(
            "snippet",
            {"snippet_id": snippet_id, "lang": lang},
            label=snippet["name"],
            run_at=options.run_at,
            recurrence=options.recurrence,
            recurrence_time=options.recurrence_time,
            recurrence_days=options.recurrence_days,
        )
        return {"status": "queued", "job_id": job_id}

    actions.print_snippet(snippet_id, lang)
    return {"status": "printed"}
