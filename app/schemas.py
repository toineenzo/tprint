"""Shared request models and validation.

Queue/schedule options arrive three different ways — a JSON body (/print/text),
multipart form fields (/print/image, /print/pdf, /print/ics) and query params
(/snippets/{id}/print) — but they mean the same thing everywhere, so they are
validated by one model here rather than by four hand-written checks.
"""

import re
from datetime import datetime
from typing import Literal, Optional

from fastapi import Form
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError, field_validator, model_validator

Recurrence = Literal["daily", "weekly", "monthly"]
PrintMode = Literal["single", "separate"]
SurpriseKind = Literal["joke", "recipe", "fortune"]
Align = Literal["left", "center", "right"]

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class QueueOptions(BaseModel):
    queue: bool = False
    run_at: Optional[str] = None
    recurrence: Optional[Recurrence] = None
    recurrence_time: Optional[str] = None

    @field_validator("run_at", "recurrence", "recurrence_time", mode="before")
    @classmethod
    def _blank_to_none(cls, value):
        # HTML form fields submit "" for an untouched input; treat that as unset
        # rather than letting it fail the Literal/format checks below.
        if isinstance(value, str) and not value.strip():
            return None
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
    def _time_required_with_recurrence(self):
        # Without this a recurring job reaches print_queue._next_occurrence with
        # recurrence_time=None, which used to crash the worker with a 500.
        if self.recurrence and not self.recurrence_time:
            raise ValueError("recurrence_time is required when recurrence is set")
        return self


class TextPrintRequest(QueueOptions):
    text: str


class RandomPrintRequest(QueueOptions):
    kind: Optional[SurpriseKind] = None
    lang: Optional[str] = None


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
) -> QueueOptions:
    """Validate non-JSON queue options, reporting failures the same way FastAPI
    reports a bad JSON body — so all three transports return an identical 422."""
    try:
        return QueueOptions(
            queue=queue, run_at=run_at, recurrence=recurrence, recurrence_time=recurrence_time
        )
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc


def queue_options_form(
    queue: bool = Form(False),
    run_at: Optional[str] = Form(None),
    recurrence: Optional[str] = Form(None),
    recurrence_time: Optional[str] = Form(None),
) -> QueueOptions:
    """Dependency for the multipart print endpoints."""
    return _build_queue_options(queue, run_at, recurrence, recurrence_time)


def queue_options_query(
    queue: bool = False,
    run_at: Optional[str] = None,
    recurrence: Optional[str] = None,
    recurrence_time: Optional[str] = None,
) -> QueueOptions:
    """Dependency for POST /snippets/{id}/print, which takes query params."""
    return _build_queue_options(queue, run_at, recurrence, recurrence_time)
