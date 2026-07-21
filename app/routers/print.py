from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from app import actions, auth, i18n, ics_import, print_queue, printer
from app.schemas import (
    ChecklistPrintRequest,
    PrintMode,
    QueueOptions,
    RandomPrintRequest,
    TextPrintRequest,
    queue_options_form,
)

router = APIRouter(prefix="/print", tags=["print"])


def _resolve_lang(request: Request, override: Optional[str]) -> str:
    if override:
        return i18n.resolve_lang(override)
    return i18n.from_request(request)


def _queued_response(body: QueueOptions, kind: str, payload: dict, label: str) -> dict | None:
    if not print_queue.should_queue(body.queue, body.run_at, body.recurrence):
        return None
    job_id = print_queue.enqueue(
        kind,
        payload,
        label=label,
        run_at=body.run_at,
        recurrence=body.recurrence,
        recurrence_time=body.recurrence_time,
    )
    return {"status": "queued", "job_id": job_id}


def _is_queued(options: QueueOptions) -> bool:
    return print_queue.should_queue(options.queue, options.run_at, options.recurrence)


@router.post("/text")
def print_text(body: TextPrintRequest, _: None = Depends(auth.require_api_auth)):
    if not body.text.strip():
        raise HTTPException(400, "text is empty")
    queued = _queued_response(body, "text", {"text": body.text}, label=body.text[:60])
    if queued:
        return queued
    actions.print_text(body.text)
    return {"status": "printed"}


@router.post("/image")
async def print_image(
    file: UploadFile = File(...),
    options: QueueOptions = Depends(queue_options_form),
    _: None = Depends(auth.require_api_auth),
):
    data = await file.read()
    if _is_queued(options):
        saved = print_queue.save_upload(data, file.filename or "image")
        return _queued_response(options, "image", {"file": saved}, label="image")
    actions.print_image(printer.image_from_upload(data))
    return {"status": "printed"}


@router.post("/pdf")
async def print_pdf(
    file: UploadFile = File(...),
    options: QueueOptions = Depends(queue_options_form),
    _: None = Depends(auth.require_api_auth),
):
    data = await file.read()
    if _is_queued(options):
        saved = print_queue.save_upload(data, file.filename or "file.pdf")
        return _queued_response(options, "pdf", {"file": saved}, label="PDF")
    actions.print_pdf(data)
    return {"status": "printed"}


@router.post("/random")
def print_random(
    body: RandomPrintRequest, request: Request, _: None = Depends(auth.require_api_auth)
):
    lang = _resolve_lang(request, body.lang)
    queued = _queued_response(
        body, "random", {"kind": body.kind, "lang": lang}, label=body.kind or "surprise"
    )
    if queued:
        return queued
    actions.print_random(body.kind, lang)
    return {"status": "printed"}


@router.post("/checklist")
def print_checklist(
    body: ChecklistPrintRequest, request: Request, _: None = Depends(auth.require_api_auth)
):
    items = [item.model_dump() for item in body.items if item.text.strip()]
    if not items:
        raise HTTPException(400, "items must not be empty")
    lang = _resolve_lang(request, None)
    queued = _queued_response(
        body,
        "checklist",
        {"title": body.title, "items": items, "mode": body.mode, "lang": lang},
        label=body.title or f"{len(items)} tasks",
    )
    if queued:
        return queued
    actions.print_checklist(body.title, items, body.mode, lang)
    return {"status": "printed"}


@router.post("/ics")
async def print_ics(
    file: UploadFile = File(...),
    mode: PrintMode = Form("single"),
    options: QueueOptions = Depends(queue_options_form),
    _: None = Depends(auth.require_api_auth),
):
    data = await file.read()
    # Parsed before anything is stored, so a malformed file is rejected up
    # front instead of failing later inside the background worker (and so a
    # rejected upload leaves nothing behind in QUEUE_UPLOAD_DIR).
    try:
        events = ics_import.parse_ics(data)
    except Exception as exc:
        raise HTTPException(400, f"could not parse .ics file: {exc}") from exc
    if not events:
        raise HTTPException(400, "no events found in .ics file")

    if _is_queued(options):
        saved = print_queue.save_upload(data, file.filename or "calendar.ics")
        return _queued_response(
            options, "ics", {"file": saved, "mode": mode}, label=f"{len(events)} events"
        )
    actions.print_ics(events, mode)
    return {"status": "printed", "count": len(events)}
