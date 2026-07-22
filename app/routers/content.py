from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import auth, content, i18n

router = APIRouter(prefix="/api/content", tags=["content"])

MAX_TEXT = 2000


class ContentItemRequest(BaseModel):
    """One joke/fortune (`text`) or one recipe (`title`/`ingredients`/`steps`).

    Both shapes share a model rather than having two endpoints, because the UI
    edits them through one list and the only real difference is which fields
    are required for a given kind.
    """

    text: Optional[str] = None
    title: Optional[str] = None
    ingredients: Optional[list[str]] = None
    steps: Optional[list[str]] = None


class ContentCreateRequest(ContentItemRequest):
    kind: str
    lang: str


def _value(kind: str, body: ContentItemRequest):
    """Validate for `kind` and return exactly what gets stored."""
    if kind in ("joke", "fortune"):
        text = (body.text or "").strip()
        if not text:
            raise HTTPException(400, f"text is required for a {kind}")
        if len(text) > MAX_TEXT:
            raise HTTPException(400, f"text must be at most {MAX_TEXT} characters")
        return text

    title = (body.title or "").strip()
    ingredients = [line.strip() for line in (body.ingredients or []) if line.strip()]
    steps = [line.strip() for line in (body.steps or []) if line.strip()]
    if not title:
        raise HTTPException(400, "title is required for a recipe")
    if not ingredients:
        raise HTTPException(400, "a recipe needs at least one ingredient")
    if not steps:
        raise HTTPException(400, "a recipe needs at least one step")
    return {"title": title, "ingredients": ingredients, "steps": steps}


@router.get("")
def list_content(
    kind: Optional[str] = None,
    lang: Optional[str] = None,
    _: None = Depends(auth.require_api_auth),
):
    if kind and kind not in content.KINDS:
        raise HTTPException(400, f"kind must be one of {', '.join(content.KINDS)}")
    return {"items": content.list_items(kind, lang), "counts": content.counts()}


@router.post("")
def create_content(
    body: ContentCreateRequest, _: None = Depends(auth.require_api_auth)
):
    if body.kind not in content.KINDS:
        raise HTTPException(400, f"kind must be one of {', '.join(content.KINDS)}")
    if body.lang not in i18n.LANGUAGES:
        raise HTTPException(400, f"lang must be one of {', '.join(i18n.LANGUAGES)}")
    item_id = content.create_item(body.kind, body.lang, _value(body.kind, body))
    return {"id": item_id}


@router.put("/{item_id}")
def update_content(
    item_id: int, body: ContentItemRequest, _: None = Depends(auth.require_api_auth)
):
    existing = content.get_item(item_id)
    if not existing:
        raise HTTPException(404, "content item not found")
    content.update_item(item_id, _value(existing["kind"], body))
    return {"status": "updated"}


@router.delete("/{item_id}")
def delete_content(item_id: int, _: None = Depends(auth.require_api_auth)):
    if not content.delete_item(item_id):
        raise HTTPException(404, "content item not found")
    return {"status": "deleted"}
