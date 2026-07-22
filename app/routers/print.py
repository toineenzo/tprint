from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from PIL import Image
from pydantic import ValidationError

from app import actions, agenda, auth, codes, content, i18n, ics_import, preview, print_queue, printer, richtext
from app import settings
from app import snippets as snippets_store
from app.schemas import (
    AgendaOrientation,
    AgendaOverview,
    ChecklistPrintRequest,
    Composition,
    IcsMode,
    CodePrintRequest,
    RichTextPrintRequest,
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
        recurrence_days=body.recurrence_days,
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


@router.post("/code")
def print_code(body: CodePrintRequest, _: None = Depends(auth.require_api_auth)):
    if not body.data.strip():
        raise HTTPException(400, "data is empty")
    # Encoded up front so an EAN-13 with the wrong digit count fails here with
    # a usable message, rather than inside the queue worker an hour later.
    try:
        codes.render(body.data, body.format, body.symbology, settings.paper_width_px())
    except codes.CodeError as exc:
        raise HTTPException(400, str(exc)) from exc

    payload = {"data": body.data, "format": body.format, "symbology": body.symbology}
    queued = _queued_response(body, "code", payload, label=body.data[:60])
    if queued:
        return queued
    actions.print_code(body.data, body.format, body.symbology)
    return {"status": "printed"}


@router.post("/richtext")
def print_richtext(body: RichTextPrintRequest, _: None = Depends(auth.require_api_auth)):
    blocks = [block.model_dump() for block in body.blocks]
    if not richtext.plain_text(blocks):
        raise HTTPException(400, "text is empty")
    queued = _queued_response(
        body, "richtext", {"blocks": blocks}, label=richtext.plain_text(blocks)[:60]
    )
    if queued:
        return queued
    actions.print_richtext(blocks)
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
    try:
        actions.print_random(body.kind, lang, body.text, body.category)
    except content.NoContent as exc:
        # Reachable by deleting every entry of a kind in Settings, so it needs
        # to read as "you emptied this list", not as a server fault.
        raise HTTPException(409, str(exc)) from exc
    return {"status": "printed"}


@router.get("/surprise/peek")
def peek_surprise(
    request: Request,
    kind: Optional[str] = None,
    category: Optional[str] = None,
    _: None = Depends(auth.require_api_auth),
):
    """Draw a surprise without printing it, for the preview-before-print flow.

    The drawn text comes back so the caller can print *this* item via
    /print/random with `text` set — asking again would roll a different one.
    """
    lang = _resolve_lang(request, None)
    try:
        return {"kind": kind, "text": content.random_surprise(kind, lang, category)}
    except content.NoContent as exc:
        raise HTTPException(409, str(exc)) from exc


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
    mode: IcsMode = Form("single"),
    overview: AgendaOverview = Form("none"),
    orientation: AgendaOrientation = Form("vertical"),
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
            options,
            "ics",
            {"file": saved, "mode": mode, "overview": overview, "orientation": orientation},
            label=f"{len(events)} events",
        )
    actions.print_ics(events, mode, overview, orientation)
    return {"status": "printed", "count": len(events)}


@router.post("/code-image")
def code_image(
    data: str = Form(...),
    format: str = Form("qr"),
    symbology: str = Form("code128"),
    _: None = Depends(auth.require_api_auth),
):
    """A bare QR/barcode PNG, with no receipt frame around it.

    /print/preview would wrap it in the header/footer and cut line; the editor
    needs just the code so it can place it as one item among others. Reuses
    codes.render, so a composed code is byte-identical to a standalone one.
    """
    try:
        image = codes.render(data, format, symbology, settings.paper_width_px())
    except codes.CodeError as exc:
        raise HTTPException(400, str(exc)) from exc
    return Response(preview.to_png(image), media_type="image/png")


@router.post("/composition")
async def print_composition(
    payload: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    options: QueueOptions = Depends(queue_options_form),
    _: None = Depends(auth.require_api_auth),
):
    """Flow-mode composition: parts printed in order, natively where possible.

    Canvas-mode compositions do *not* come here — they flatten to one PNG in the
    browser and print through /print/image like any other picture. This endpoint
    exists purely so flow mode can keep text as real ESC/POS text.
    """
    try:
        parsed = Composition.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(400, f"invalid composition: {exc.error_count()} error(s)")
    if not parsed.parts:
        raise HTTPException(400, "a composition needs at least one part")

    uploads = [f for f in files if f.filename]
    blobs = [await f.read() for f in uploads]
    parts = [part.model_dump() for part in parsed.parts]

    # Codes are encoded up front for the same reason /print/code does it: a bad
    # barcode should fail the request, not the worker an hour later.
    for part in parts:
        if part["type"] == "code":
            try:
                codes.render(
                    part["data"], part["format"], part["symbology"],
                    settings.paper_width_px(),
                )
            except codes.CodeError as exc:
                raise HTTPException(400, str(exc)) from exc

    if _is_queued(options):
        saved = [print_queue.save_upload(blob, f.filename or "part") for blob, f in zip(blobs, uploads)]
        return _queued_response(
            options, "composition", {"parts": parts, "files": saved}, label="composition"
        )

    images = {index: printer.image_from_upload(blob) for index, blob in enumerate(blobs)}
    actions.print_composition(parts, images)
    return {"status": "printed"}


@router.post("/pdf-page")
async def pdf_page(
    file: UploadFile = File(...),
    page: int = Form(1),
    _: None = Depends(auth.require_api_auth),
):
    """One PDF page as a PNG, for placing into the image editor.

    The page count comes back in a header rather than a JSON envelope so the
    image itself stays a plain image the browser can load directly.
    """
    data = await file.read()
    try:
        image, count = printer.pdf_page_image(data, page)
    except Exception as exc:
        raise HTTPException(400, f"could not read PDF: {exc}") from exc
    return Response(
        preview.to_png(image),
        media_type="image/png",
        headers={"X-Page-Count": str(count), "Access-Control-Expose-Headers": "X-Page-Count"},
    )


@router.post("/preview")
async def preview_job(
    kind: str = Form(...),
    text: Optional[str] = Form(None),
    payload: Optional[str] = Form(None),
    mode: str = Form("single"),
    overview: str = Form("none"),
    orientation: str = Form("vertical"),
    snippet_id: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None),
    request: Request = None,
    _: None = Depends(auth.require_api_auth),
):
    """Render what a job would print, as a PNG, without printing it.

    Mirrors the inputs of the print endpoints rather than inventing its own
    shape, so "preview this" and "print this" are the same request twice. For
    the multi-receipt modes (checklist/ics "separate") this previews the first
    receipt — the rest are identical in form.
    """
    lang = _resolve_lang(request, None) if request else "en"
    data = await file.read() if file is not None and file.filename else None

    if kind == "text":
        content_fn = printer.text_content(text or "")
    elif kind == "random":
        content_fn = printer.text_content(text or content.random_surprise(None, lang))
    elif kind == "code":
        try:
            spec = CodePrintRequest.model_validate_json(payload or "")
        except ValidationError as exc:
            raise HTTPException(400, f"invalid code payload: {exc.error_count()} error(s)")
        try:
            image = codes.render(
                spec.data, spec.format, spec.symbology, settings.paper_width_px()
            )
        except codes.CodeError as exc:
            raise HTTPException(400, str(exc)) from exc
        content_fn = printer.images_content([image])
    elif kind == "richtext":
        try:
            parsed = RichTextPrintRequest.model_validate_json(payload or "")
        except ValidationError as exc:
            raise HTTPException(400, f"invalid richtext payload: {exc.error_count()} error(s)")
        content_fn = printer.richtext_content([b.model_dump() for b in parsed.blocks])
    elif kind == "image":
        if not data:
            raise HTTPException(400, "a file is required to preview an image")
        content_fn = printer.images_content([printer.image_from_upload(data)])
    elif kind == "pdf":
        if not data:
            raise HTTPException(400, "a file is required to preview a PDF")
        content_fn = printer.images_content(printer._render_pdf_pages(data))
    elif kind == "checklist":
        try:
            parsed = ChecklistPrintRequest.model_validate_json(payload or "")
        except ValidationError as exc:
            raise HTTPException(400, f"invalid checklist payload: {exc.error_count()} error(s)")
        items = [item.model_dump() for item in parsed.items]
        if parsed.mode == "separate":
            items = items[:1]
        content_fn = printer.checklist_content(parsed.title, items, lang)
    elif kind == "ics":
        if not data:
            raise HTTPException(400, "a file is required to preview a calendar")
        try:
            events = ics_import.parse_ics(data)
        except Exception as exc:
            raise HTTPException(400, f"could not parse .ics file: {exc}") from exc
        # Previews the first receipt of whichever mode was chosen, framed the
        # same way the real print frames it.
        if mode == "day":
            groups = agenda.group_by_day(events)
            day, group = groups[0] if groups else (None, events)
            content_fn = printer.day_content(day, group, orientation == "horizontal")
        elif mode == "separate":
            content_fn = printer.ics_content(events[:1])
        elif overview in ("week", "month"):
            def content_fn(p, _events=events, _scope=overview):
                printer.overview_content(_events, _scope)(p)
                p.text("\n")
                printer.ics_content(_events)(p)
        else:
            content_fn = printer.ics_content(events)
    elif kind == "snippet":
        content_fn = _snippet_content(snippet_id, lang)
    else:
        raise HTTPException(400, f"cannot preview kind {kind!r}")

    return Response(preview.to_png(preview.render_job(content_fn)), media_type="image/png")


def _snippet_content(snippet_id: Optional[int], lang: str):
    """The same content a snippet would print, for preview purposes."""
    snippet = snippets_store.get_snippet(snippet_id) if snippet_id else None
    if not snippet:
        raise HTTPException(404, "snippet not found")

    if snippet["kind"] == "text":
        return printer.text_content(snippet["text_content"] or "")
    if snippet["kind"] == "image":
        images = [Image.open(snippets_store.file_path(fn)) for fn in snippet["files"]]
        return printer.images_content(images)
    if snippet["kind"] == "pdf":
        with open(snippets_store.file_path(snippet["files"][0]), "rb") as f:
            return printer.images_content(printer._render_pdf_pages(f.read()))
    if snippet["kind"] == "checklist":
        data = snippet["payload"] or {}
        items = data.get("items") or []
        if data.get("mode") == "separate":
            items = items[:1]
        return printer.checklist_content(data.get("title"), items, lang)
    if snippet["kind"] == "ics":
        data = snippet["payload"] or {}
        with open(snippets_store.file_path(snippet["files"][0]), "rb") as f:
            events = ics_import.parse_ics(f.read())
        return printer.ics_content(events[:1] if data.get("mode") == "separate" else events)
    raise HTTPException(400, f"cannot preview snippet kind {snippet['kind']!r}")
