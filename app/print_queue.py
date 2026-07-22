import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta

from app import actions, config, db, files, ics_import, printer

logger = logging.getLogger("tprint.queue")

RECURRENCES = ("daily", "weekly", "monthly")
DEFAULT_RECURRENCE_TIME = "08:00"
POLL_SECONDS = 15


def save_upload(data: bytes, filename: str) -> str:
    saved_name = f"{uuid.uuid4().hex}.{files.safe_extension(filename)}"
    with open(os.path.join(config.QUEUE_UPLOAD_DIR, saved_name), "wb") as f:
        f.write(data)
    return saved_name


def _read_upload(saved_name: str) -> bytes:
    with open(os.path.join(config.QUEUE_UPLOAD_DIR, saved_name), "rb") as f:
        return f.read()


def _delete_upload(saved_name: str | None) -> None:
    if not saved_name:
        return
    path = os.path.join(config.QUEUE_UPLOAD_DIR, saved_name)
    if os.path.exists(path):
        os.remove(path)


def _normalize_run_at(run_at: str | None) -> str | None:
    if not run_at:
        return None
    return datetime.fromisoformat(run_at).isoformat(timespec="seconds")


def should_queue(queue: bool, run_at: str | None, recurrence: str | None) -> bool:
    return bool(queue or run_at or recurrence)


def enqueue(
    kind: str,
    payload: dict,
    label: str,
    run_at: str | None = None,
    recurrence: str | None = None,
    recurrence_time: str | None = None,
    recurrence_days: list[int] | None = None,
) -> int:
    run_at = _normalize_run_at(run_at)
    days = parse_days(recurrence_days)

    if recurrence:
        # A caller that sends `recurrence=weekly` with no days — the documented
        # API before weekday rules existed — gets them derived from the anchor.
        # That's what the old arithmetic did implicitly ("+7 days" is the same
        # weekday), so the contract is unchanged and there is one rule format
        # in the database rather than a legacy shape the worker must special-case.
        if not days:
            anchor = datetime.fromisoformat(run_at) if run_at else datetime.now()
            if recurrence == "weekly":
                days = [anchor.isoweekday()]
            elif recurrence == "monthly":
                days = [anchor.day]
        if not run_at:
            # No explicit start time — anchor to the next matching occurrence
            # rather than running immediately.
            run_at = _next_occurrence(
                recurrence, days, recurrence_time, datetime.now()
            ).isoformat(timespec="seconds")

    with db.get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO print_jobs
                (kind, payload, label, run_at, recurrence, recurrence_time, recurrence_days)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                kind,
                json.dumps(payload),
                label[:200],
                run_at,
                recurrence,
                recurrence_time,
                json.dumps(days) if days else None,
            ),
        )
        return cur.lastrowid


def prune_finished_jobs() -> None:
    """Apply the retention settings to jobs that have already run.

    Only done/failed/canceled jobs are ever considered. A pending or scheduled
    job is *upcoming work* — dropping one because the list grew long would be
    data loss dressed up as cleanup, so retention never touches them however
    old they are.
    """
    from app import settings as settings_store

    current = settings_store.get_settings()
    max_items = int(current["retention_max_items"])
    max_age_days = int(current["retention_max_age_days"])

    finished = "status IN ('done', 'failed', 'canceled')"
    conditions, params = [], []
    if max_items > 0:
        conditions.append(
            f"id NOT IN (SELECT id FROM print_jobs WHERE {finished} "
            "ORDER BY created_at DESC, id DESC LIMIT ?)"
        )
        params.append(max_items)
    if max_age_days > 0:
        conditions.append("created_at < datetime('now', ?)")
        params.append(f"-{max_age_days} days")
    if not conditions:
        return

    where = f"{finished} AND ({' OR '.join(conditions)})"
    with db.get_conn() as conn:
        for row in conn.execute(f"SELECT payload FROM print_jobs WHERE {where}", params):
            _cleanup_payload_files(json.loads(row["payload"]))
        conn.execute(f"DELETE FROM print_jobs WHERE {where}", params)


def is_scheduled(run_at: str | None, recurrence: str | None) -> bool:
    """Whether a job belongs to the Scheduled section rather than the manual queue.

    Computed here and sent to clients rather than re-derived in the UI, so the
    frontend's two lists and `run_manual_queue`'s WHERE clause can't disagree
    about which jobs "Run queue" is going to touch.
    """
    return bool(run_at or recurrence)


def list_jobs() -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, kind, label, status, run_at, recurrence, recurrence_time,
                   recurrence_days, last_run_at, error, created_at
            FROM print_jobs
            ORDER BY (status = 'pending') DESC, COALESCE(run_at, created_at) ASC, id ASC
            """
        ).fetchall()

    jobs = []
    for row in rows:
        job = dict(row)
        job["recurrence_days"] = parse_days(job["recurrence_days"]) or None
        job["scheduled"] = is_scheduled(job["run_at"], job["recurrence"])
        jobs.append(job)
    return jobs


def cancel_job(job_id: int) -> bool:
    """Cancel a job that hasn't started yet. For a job currently printing,
    use printer.cancel_current() instead — see routers/queue.py.
    """
    with db.get_conn() as conn:
        row = conn.execute("SELECT payload FROM print_jobs WHERE id = ?", (job_id,)).fetchone()
        cur = conn.execute(
            "UPDATE print_jobs SET status = 'canceled' WHERE id = ? AND status = 'pending'",
            (job_id,),
        )
        if cur.rowcount and row:
            _cleanup_payload_files(json.loads(row["payload"]))
        return cur.rowcount > 0


def _cleanup_payload_files(payload: dict) -> None:
    if payload.get("file"):
        _delete_upload(payload["file"])
    # A composition carries a list rather than a single upload.
    for name in payload.get("files") or []:
        _delete_upload(name)


def run_manual_queue() -> int:
    """Run every pending job in the manual queue, and nothing else.

    Scheduled jobs are excluded on purpose — they fire on their own trigger in
    `worker_loop`, and "Run queue" must never pull a future print forward. The
    `recurrence IS NULL` half is belt-and-braces: `enqueue` always anchors a
    recurring job's `run_at`, so the first condition already excludes it, but
    that invariant lives in another function and this is the destructive one.
    """
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id FROM print_jobs "
            "WHERE status = 'pending' AND run_at IS NULL AND recurrence IS NULL"
        ).fetchall()
    for row in rows:
        _run_job(row["id"])
    return len(rows)


def _due_job_ids() -> list[int]:
    now = datetime.now().isoformat(timespec="seconds")
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id FROM print_jobs WHERE status = 'pending' AND run_at IS NOT NULL AND run_at <= ?",
            (now,),
        ).fetchall()
        return [row["id"] for row in rows]


def _parse_time(recurrence_time: str | None) -> tuple[int, int]:
    """Hour/minute from an "HH:MM" string, falling back to a sane default.

    New jobs are validated at the API boundary (app/schemas.py), but rows
    written before that validation existed can hold NULL or junk here, and the
    background worker must not die on one of them.
    """
    try:
        hour, minute = (recurrence_time or "").split(":")[:2]
        return int(hour), int(minute)
    except (ValueError, AttributeError):
        return _parse_time(DEFAULT_RECURRENCE_TIME)


def parse_days(raw) -> list[int]:
    """The stored `recurrence_days` JSON as a sorted list of ints.

    Tolerant for the same reason `_parse_time` is: the worker reads rows that
    predate the current validation, and one bad row must not stop the queue.
    """
    if not raw:
        return []
    values = raw if isinstance(raw, list) else json.loads(raw)
    try:
        return sorted({int(value) for value in values})
    except (TypeError, ValueError):
        return []


def _next_occurrence(
    recurrence: str,
    recurrence_days: list[int] | str | None,
    recurrence_time: str | None,
    after: datetime,
) -> datetime:
    """The first moment strictly after `after` that matches the rule.

    Every branch must return a time in the *future*. An unrecognized recurrence
    used to fall through and return a time in the past, leaving the job pending
    and due — so the worker reprinted it every POLL_SECONDS, forever. Any rule
    that can't produce a future time raises instead, and `_run_job` marks the
    job failed rather than leaving it in that loop.
    """
    if recurrence not in RECURRENCES:
        raise ValueError(f"unknown recurrence: {recurrence!r}")

    hour, minute = _parse_time(recurrence_time)
    days = parse_days(recurrence_days)
    at_time = after.replace(hour=hour, minute=minute, second=0, microsecond=0)

    if recurrence == "daily":
        return at_time if at_time > after else at_time + timedelta(days=1)

    if recurrence == "weekly":
        if not days:
            raise ValueError("weekly recurrence needs at least one weekday")
        # At most 7 hops: whichever selected weekday comes round first.
        for offset in range(8):
            candidate = at_time + timedelta(days=offset)
            if candidate > after and candidate.isoweekday() in days:
                return candidate
        raise ValueError(f"no weekday in {days} within a week")

    if not days:
        raise ValueError("monthly recurrence needs at least one day of month")
    # Walk forward month by month. A day the month doesn't have (the 31st of
    # February) is skipped rather than clamped: "the 31st" means the 31st, and
    # silently printing on the 28th instead is a worse answer than waiting.
    # 63 months is a generous bound — even a 31st-only rule never waits a year.
    year, month = after.year, after.month
    for _ in range(63):
        for day in days:
            try:
                candidate = datetime(year, month, day, hour, minute)
            except ValueError:
                continue
            if candidate > after:
                return candidate
        month, year = (1, year + 1) if month == 12 else (month + 1, year)
    raise ValueError(f"no valid date for days {days} within 63 months")


def _run_job(job_id: int) -> None:
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM print_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row or row["status"] != "pending":
            return
        conn.execute("UPDATE print_jobs SET status = 'running' WHERE id = ?", (job_id,))

    job = dict(row)
    payload = json.loads(job["payload"])
    error = None
    canceled = False
    try:
        _execute(job["kind"], payload)
    except printer.PrintCancelled:
        canceled = True
    except Exception as exc:  # surfaced in the queue UI, not swallowed
        logger.exception("queue job %s failed", job_id)
        error = str(exc)

    with db.get_conn() as conn:
        if canceled:
            conn.execute(
                "UPDATE print_jobs SET status = 'canceled', last_run_at = datetime('now') WHERE id = ?",
                (job_id,),
            )
            _cleanup_payload_files(payload)
        elif error:
            conn.execute(
                "UPDATE print_jobs SET status = 'failed', error = ?, last_run_at = datetime('now') WHERE id = ?",
                (error, job_id),
            )
        elif job["recurrence"]:
            try:
                next_run = _next_occurrence(
                    job["recurrence"],
                    job["recurrence_days"],
                    job["recurrence_time"],
                    datetime.now(),
                )
            except ValueError as exc:
                # A job we can't reschedule is marked failed rather than left
                # pending-and-due, which is what made it reprint in a loop.
                logger.error("cannot reschedule job %s: %s", job_id, exc)
                conn.execute(
                    "UPDATE print_jobs SET status = 'failed', error = ?, "
                    "last_run_at = datetime('now') WHERE id = ?",
                    (str(exc), job_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE print_jobs
                    SET status = 'pending', run_at = ?, last_run_at = datetime('now'), error = NULL
                    WHERE id = ?
                    """,
                    (next_run.isoformat(timespec="seconds"), job_id),
                )
        else:
            conn.execute(
                "UPDATE print_jobs SET status = 'done', last_run_at = datetime('now') WHERE id = ?",
                (job_id,),
            )
            _cleanup_payload_files(payload)


def _execute(kind: str, payload: dict) -> None:
    if kind == "text":
        actions.print_text(payload["text"])
    elif kind == "random":
        actions.print_random(payload.get("kind"), payload.get("lang", "en"))
    elif kind == "checklist":
        actions.print_checklist(payload.get("title"), payload["items"], payload["mode"], payload.get("lang", "en"))
    elif kind == "composition":
        images = {
            index: printer.image_from_upload(_read_upload(name))
            for index, name in enumerate(payload.get("files") or [])
        }
        actions.print_composition(payload["parts"], images)
    elif kind == "code":
        actions.print_code(payload["data"], payload["format"], payload["symbology"])
    elif kind == "richtext":
        actions.print_richtext(payload["blocks"])
    elif kind == "image":
        image = printer.image_from_upload(_read_upload(payload["file"]))
        actions.print_image(image)
    elif kind == "pdf":
        actions.print_pdf(_read_upload(payload["file"]))
    elif kind == "ics":
        events = ics_import.parse_ics(_read_upload(payload["file"]))
        actions.print_ics(
            events,
            payload["mode"],
            payload.get("overview", "none"),
            payload.get("orientation", "vertical"),
        )
    elif kind == "snippet":
        actions.print_snippet(payload["snippet_id"], payload.get("lang", "en"))
    else:
        raise ValueError(f"unknown job kind: {kind}")


async def worker_loop() -> None:
    while True:
        try:
            for job_id in _due_job_ids():
                await asyncio.to_thread(_run_job, job_id)
            # Retention runs on the same tick rather than on a timer of its
            # own: it's cheap, and it means finished jobs are tidied whether
            # or not anyone has the page open.
            await asyncio.to_thread(prune_finished_jobs)
        except Exception:
            logger.exception("queue worker tick failed")
        await asyncio.sleep(POLL_SECONDS)
