from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app import auth, content, i18n, ics_import, printer

router = APIRouter(prefix="/print", tags=["print"])


class TextPrintRequest(BaseModel):
    text: str


class RandomPrintRequest(BaseModel):
    kind: Optional[str] = None
    lang: Optional[str] = None


class TaskItem(BaseModel):
    text: str
    due: Optional[str] = None


class ChecklistPrintRequest(BaseModel):
    title: Optional[str] = None
    items: list[TaskItem]
    mode: str = "single"


def _resolve_lang(request: Request, override: Optional[str]) -> str:
    if override:
        return i18n.resolve_lang(override)
    return i18n.from_request(request)


@router.post("/text")
def print_text(body: TextPrintRequest, _: None = Depends(auth.require_api_auth)):
    if not body.text.strip():
        raise HTTPException(400, "text is empty")
    printer.print_text(body.text)
    return {"status": "printed"}


@router.post("/image")
async def print_image(file: UploadFile = File(...), _: None = Depends(auth.require_api_auth)):
    data = await file.read()
    printer.print_image(printer.image_from_upload(data))
    return {"status": "printed"}


@router.post("/pdf")
async def print_pdf(file: UploadFile = File(...), _: None = Depends(auth.require_api_auth)):
    data = await file.read()
    printer.print_pdf(data)
    return {"status": "printed"}


@router.post("/random")
def print_random(
    body: RandomPrintRequest, request: Request, _: None = Depends(auth.require_api_auth)
):
    if body.kind and body.kind not in ("joke", "recipe", "fortune"):
        raise HTTPException(400, "kind must be 'joke', 'recipe', or 'fortune'")
    lang = _resolve_lang(request, body.lang)
    printer.print_text(content.random_surprise(body.kind, lang))
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
    printer.print_checklist(body.title, items, body.mode, lang)
    return {"status": "printed"}


@router.post("/ics")
async def print_ics(
    file: UploadFile = File(...),
    mode: str = Form("single"),
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
    printer.print_ics_events(events, mode)
    return {"status": "printed", "count": len(events)}
