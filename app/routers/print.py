from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app import auth, content, printer

router = APIRouter(prefix="/print", tags=["print"])


class TextPrintRequest(BaseModel):
    text: str


class RandomPrintRequest(BaseModel):
    kind: Optional[str] = None


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
def print_random(body: RandomPrintRequest, _: None = Depends(auth.require_api_auth)):
    if body.kind and body.kind not in ("joke", "recipe", "fortune"):
        raise HTTPException(400, "kind must be 'joke', 'recipe', or 'fortune'")
    printer.print_text(content.random_surprise(body.kind))
    return {"status": "printed"}
