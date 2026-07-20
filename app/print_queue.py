import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta

from app import actions, config, db, ics_import, printer

logger = logging.getLogger("tprint.queue")

RECURRENCES = ("daily", "weekly", "monthly")
POLL_SECONDS = 15


def save_upload(data: bytes, filename: str) -> str:
    ext = (filename or "").rsplit(".", 1)[-1].lower() or "bin"
    saved_name = f"{uuid.uuid4().hex}.{ext}"
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
) -> int:
    run_at = _normalize_run_at(run_at)
    if recurrence and not run_at:
        # No explicit start time for a recurring job — anchor it to the next
        # occurrence of recurrence_time rather than running immediately.
        run_at = _next_occurrence(recurrence, recurrence_time, datetime.now()).isoformat(
            timespec="seconds"
        )
    with db.get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO print_jobs (kind, payload, label, run_at, recurrence, recurrence_time)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (kind, json.dumps(payload), label[:200], run_at, recurrence, recurrence_time),
        )
        return cur.lastrowid


def list_jobs() -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, kind, label, status, run_at, recurrence, recurrence_time,
                   last_run_at, error, created_at
            FROM print_jobs
            ORDER BY (status = 'pending') DESC, COALESCE(run_at, created_at) ASC, id ASC
            """
        ).fetchall()
        return [dict(row) for row in rows]


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


def delete_job(job_id: int) -> bool:
    with db.get_conn() as conn:
        row = conn.execute("SELECT payload, status FROM print_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row or row["status"] == "running":
            return False
        conn.execute("DELETE FROM print_jobs WHERE id = ?", (job_id,))
        _cleanup_payload_files(json.loads(row["payload"]))
        return True


def _cleanup_payload_files(payload: dict) -> None:
    if payload.get("file"):
        _delete_upload(payload["file"])


def run_manual_queue() -> int:
    """Run every pending job that has no scheduled time (pure manual queue)."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id FROM print_jobs WHERE status = 'pending' AND run_at IS NULL"
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


def _next_occurrence(recurrence: str, recurrence_time: str, after: datetime) -> datetime:
    parts = recurrence_time.split(":")
    hour, minute = int(parts[0]), int(parts[1])
    candidate = after.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= after:
        if recurrence == "daily":
            candidate += timedelta(days=1)
        elif recurrence == "weekly":
            candidate += timedelta(weeks=1)
        elif recurrence == "monthly":
            month = candidate.month + 1
            year = candidate.year
            if month > 12:
                month = 1
                year += 1
            candidate = candidate.replace(year=year, month=month)
    return candidate


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
            next_run = _next_occurrence(job["recurrence"], job["recurrence_time"], datetime.now())
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
    elif kind == "image":
        image = printer.image_from_upload(_read_upload(payload["file"]))
        actions.print_image(image)
    elif kind == "pdf":
        actions.print_pdf(_read_upload(payload["file"]))
    elif kind == "ics":
        events = ics_import.parse_ics(_read_upload(payload["file"]))
        actions.print_ics(events, payload["mode"])
    elif kind == "snippet":
        actions.print_snippet(payload["snippet_id"])
    else:
        raise ValueError(f"unknown job kind: {kind}")


async def worker_loop() -> None:
    while True:
        try:
            for job_id in _due_job_ids():
                await asyncio.to_thread(_run_job, job_id)
        except Exception:
            logger.exception("queue worker tick failed")
        await asyncio.sleep(POLL_SECONDS)
