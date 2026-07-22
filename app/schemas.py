"""Shared request models and validation.

Queue/schedule options arrive three different ways — a JSON body (/print/text),
multipart form fields (/print/image, /print/pdf, /print/ics) and query params
(/snippets/{id}/print) — but they mean the same thing everywhere, so they are
validated by one model here rather than by four hand-written checks.
"""

import re
from datetime import datetime
from typing import Literal, Optional, Union

from fastapi import Form
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError, field_validator, model_validator

Recurrence = Literal["daily", "weekly", "monthly"]
PrintMode = Literal["single", "separate"]
# Agendas have a third mode the checklist has no meaning for, so this is its
# own literal rather than a widening of PrintMode.
IcsMode = Literal["single", "separate", "day"]
AgendaOverview = Literal["none", "week", "month"]
AgendaOrientation = Literal["vertical", "horizontal"]
SurpriseKind = Literal["joke", "recipe", "fortune"]
RecipeCategory = Literal["breakfast", "lunch", "dinner", "dessert", "snack", "drink"]
Align = Literal["left", "center", "right"]

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class QueueOptions(BaseModel):
    queue: bool = False
    run_at: Optional[str] = None
    recurrence: Optional[Recurrence] = None
    recurrence_time: Optional[str] = None
    recurrence_days: Optional[list[int]] = None

    @field_validator("run_at", "recurrence", "recurrence_time", mode="before")
    @classmethod
    def _blank_to_none(cls, value):
        # HTML form fields submit "" for an untouched input; treat that as unset
        # rather than letting it fail the Literal/format checks below.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("recurrence_days", mode="before")
    @classmethod
    def _parse_days(cls, value):
        """Accept a real list (JSON body) or "1,3,5" (form field / query param).

        The three transports can't all express a list natively, and the whole
        point of this model is that they mean the same thing everywhere.
        """
        if value is None:
            return None
        if isinstance(value, str):
            parts = [part.strip() for part in value.split(",") if part.strip()]
            if not parts:
                return None
            try:
                value = [int(part) for part in parts]
            except ValueError as exc:
                raise ValueError("must be comma-separated whole numbers, e.g. 1,3,5") from exc
        if isinstance(value, list):
            deduped = sorted({int(day) for day in value})
            return deduped or None
        return value

    @field_validator("run_at")
    @classmethod
    def _normalize_run_at(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        try:
            return datetime.fromisoformat(value).isoformat(timespec="seconds")
        except ValueError as exc:
            raise ValueError("must be an ISO-8601 datetime, e.g. 2026-01-31T08:00") from exc

    @field_validator("recurrence_time")
    @classmethod
    def _check_time(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not _TIME_RE.match(value):
            raise ValueError("must be HH:MM in 24-hour form, e.g. 08:00")
        return value

    @model_validator(mode="after")
    def _check_recurrence(self):
        # Without this a recurring job reaches print_queue._next_occurrence with
        # recurrence_time=None, which used to crash the worker with a 500.
        if self.recurrence and not self.recurrence_time:
            raise ValueError("recurrence_time is required when recurrence is set")

        if self.recurrence_days:
            # Range-check here rather than in _next_occurrence: a weekday of 9
            # would otherwise simply never match, and the job would sit pending
            # forever with nothing anywhere saying why.
            if self.recurrence == "weekly" and not all(
                1 <= day <= 7 for day in self.recurrence_days
            ):
                raise ValueError("recurrence_days must be 1-7 (Mon-Sun) for weekly recurrence")
            if self.recurrence == "monthly" and not all(
                1 <= day <= 31 for day in self.recurrence_days
            ):
                raise ValueError("recurrence_days must be 1-31 for monthly recurrence")
        return self


class TextPrintRequest(QueueOptions):
    text: str


class RandomPrintRequest(QueueOptions):
    kind: Optional[SurpriseKind] = None
    lang: Optional[str] = None
    # Set when the user previewed a surprise and chose to print that one.
    text: Optional[str] = None
    # Recipes only; ignored for the other kinds.
    category: Optional[RecipeCategory] = None


CodeFormat = Literal["qr", "barcode"]
Tint = Literal["black", "dark", "light"]


class CodePrintRequest(QueueOptions):
    data: str
    format: CodeFormat = "qr"
    symbology: str = "code128"


class RichTextBlock(BaseModel):
    """One styled line. Receipts are line-oriented, so styling is per block."""

    text: str = ""
    level: int = 0
    bold: bool = False
    italic: bool = False
    underline: bool = False
    tint: Tint = "black"
    align: Align = "left"

    @field_validator("level")
    @classmethod
    def _check_level(cls, value: int) -> int:
        if not 0 <= value <= 3:
            raise ValueError("level must be 0 (body) or 1-3 (heading)")
        return value


class RichTextPrintRequest(QueueOptions):
    blocks: list[RichTextBlock]


class CompositionTextPart(BaseModel):
    type: Literal["text"] = "text"
    blocks: list[RichTextBlock]


class CompositionImagePart(BaseModel):
    type: Literal["image"] = "image"
    """Index into the job's file list, not a name: the caller uploads files in
    order and the server names them, so an index is the only stable reference."""
    file_index: int


class CompositionCodePart(BaseModel):
    type: Literal["code"] = "code"
    data: str
    format: CodeFormat = "qr"
    symbology: str = "code128"


CompositionPart = Union[CompositionTextPart, CompositionImagePart, CompositionCodePart]


class Composition(BaseModel):
    """A flow-mode composition: parts printed in order, natively where possible.

    `layout` is the editor's own state, carried through untouched so a saved
    composition can be reopened and edited. The server never interprets it.
    """

    parts: list[CompositionPart]
    layout: Optional[dict] = None


class CompositionPrintRequest(QueueOptions, Composition):
    pass


class TaskItem(BaseModel):
    text: str
    due: Optional[str] = None


class ChecklistPrintRequest(QueueOptions):
    title: Optional[str] = None
    items: list[TaskItem]
    mode: PrintMode = "single"


def _build_queue_options(
    queue: bool,
    run_at: Optional[str],
    recurrence: Optional[str],
    recurrence_time: Optional[str],
    recurrence_days: Optional[str],
) -> QueueOptions:
    """Validate non-JSON queue options, reporting failures the same way FastAPI
    reports a bad JSON body — so all three transports return an identical 422."""
    try:
        return QueueOptions(
            queue=queue,
            run_at=run_at,
            recurrence=recurrence,
            recurrence_time=recurrence_time,
            recurrence_days=recurrence_days,
        )
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc


def queue_options_form(
    queue: bool = Form(False),
    run_at: Optional[str] = Form(None),
    recurrence: Optional[str] = Form(None),
    recurrence_time: Optional[str] = Form(None),
    recurrence_days: Optional[str] = Form(None),
) -> QueueOptions:
    """Dependency for the multipart print endpoints."""
    return _build_queue_options(queue, run_at, recurrence, recurrence_time, recurrence_days)


def queue_options_query(
    queue: bool = False,
    run_at: Optional[str] = None,
    recurrence: Optional[str] = None,
    recurrence_time: Optional[str] = None,
    recurrence_days: Optional[str] = None,
) -> QueueOptions:
    """Dependency for POST /snippets/{id}/print, which takes query params."""
    return _build_queue_options(queue, run_at, recurrence, recurrence_time, recurrence_days)
