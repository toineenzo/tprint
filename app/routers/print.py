from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app import actions, auth, i18n, ics_import, print_queue, printer

router = APIRouter(prefix="/print", tags=["print"])


class QueueOptions(BaseModel):
    queue: bool = False
    run_at: Optional[str] = None
    recurrence: Optional[str] = None
    recurrence_time: Optional[str] = None


class TextPrintRequest(QueueOptions):
    text: str


class RandomPrintRequest(QueueOptions):
    kind: Optional[str] = None
    lang: Optional[str] = None


class TaskItem(BaseModel):
    text: str
    due: Optional[str] = None


class ChecklistPrintRequest(QueueOptions):
    title: Optional[str] = None
    items: list[TaskItem]
    mode: str = "single"


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
    queue: bool = Form(False),
    run_at: Optional[str] = Form(None),
    recurrence: Optional[str] = Form(None),
    recurrence_time: Optional[str] = Form(None),
    _: None = Depends(auth.require_api_auth),
):
    data = await file.read()
    options = QueueOptions(queue=queue, run_at=run_at, recurrence=recurrence, recurrence_time=recurrence_time)
    queued = _queued_response(
        options, "image", {"file": print_queue.save_upload(data, file.filename or "image")}, label="image"
    )
    if queued:
        return queued
    actions.print_image(printer.image_from_upload(data))
    return {"status": "printed"}


@router.post("/pdf")
async def print_pdf(
    file: UploadFile = File(...),
    queue: bool = Form(False),
    run_at: Optional[str] = Form(None),
    recurrence: Optional[str] = Form(None),
    recurrence_time: Optional[str] = Form(None),
    _: None = Depends(auth.require_api_auth),
):
    data = await file.read()
    options = QueueOptions(queue=queue, run_at=run_at, recurrence=recurrence, recurrence_time=recurrence_time)
    queued = _queued_response(
        options, "pdf", {"file": print_queue.save_upload(data, file.filename or "file.pdf")}, label="PDF"
    )
    if queued:
        return queued
    actions.print_pdf(data)
    return {"status": "printed"}


@router.post("/random")
def print_random(
    body: RandomPrintRequest, request: Request, _: None = Depends(auth.require_api_auth)
):
    if body.kind and body.kind not in ("joke", "recipe", "fortune"):
        raise HTTPException(400, "kind must be 'joke', 'recipe', or 'fortune'")
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
    if body.mode not in ("single", "separate"):
        raise HTTPException(400, "mode must be 'single' or 'separate'")
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
    mode: str = Form("single"),
    queue: bool = Form(False),
    run_at: Optional[str] = Form(None),
    recurrence: Optional[str] = Form(None),
    recurrence_time: Optional[str] = Form(None),
    _: None = Depends(auth.require_api_auth),
):
    if mode not in ("single", "separate"):
        raise HTTPException(400, "mode must be 'single' or 'separate'")
    data = await file.read()
    try:
        events = ics_import.parse_ics(data)
    except Exception as exc:
        raise HTTPException(400, f"could not parse .ics file: {exc}") from exc
    if not events:
        raise HTTPException(400, "no events found in .ics file")

    options = QueueOptions(queue=queue, run_at=run_at, recurrence=recurrence, recurrence_time=recurrence_time)
    queued = _queued_response(
        options,
        "ics",
        {"file": print_queue.save_upload(data, file.filename or "calendar.ics"), "mode": mode},
        label=f"{len(events)} events",
    )
    if queued:
        return queued
    actions.print_ics(events, mode)
    return {"status": "printed", "count": len(events)}
