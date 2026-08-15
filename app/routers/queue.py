from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app import auth, preview, print_queue, printer

router = APIRouter(prefix="/queue", tags=["queue"])


@router.get("")
def list_queue(_: None = Depends(auth.require_api_auth)):
    return print_queue.list_jobs()


@router.post("/run")
def run_queue(_: None = Depends(auth.require_api_auth)):
    ran = print_queue.run_manual_queue()
    return {"ran": ran}


@router.post("/{job_id}/run")
def run_single_job(job_id: int, _: None = Depends(auth.require_api_auth)):
    """Print one job now, leaving the rest of the queue where it is.

    A scheduled job keeps its schedule — see print_queue.run_job_now.
    """
    if not print_queue.run_job_now(job_id):
        raise HTTPException(404, "job not found or not pending")
    return {"status": "printed"}


@router.get("/{job_id}/preview")
def preview_job(job_id: int, _: None = Depends(auth.require_api_auth)):
    """What this queued job would print, as a PNG.

    Rendered through the same content factories the job itself uses, so the
    preview and the eventual receipt can't disagree — see
    print_queue.job_content.
    """
    try:
        content_fn = print_queue.job_preview_content(job_id)
    except Exception as exc:  # a job whose upload or snippet is gone
        raise HTTPException(400, f"could not render this job: {exc}") from exc
    if content_fn is None:
        raise HTTPException(404, "job not found")
    return Response(preview.to_png(preview.render_job(content_fn)), media_type="image/png")


@router.delete("/finished")
def clear_finished_jobs(
    scope: str = "all", _: None = Depends(auth.require_api_auth)
):
    """Clear finished jobs — all of them, or just one panel's.

    `scope` is `all`, `manual` or `scheduled`. The split itself stays in
    print_queue with `is_scheduled`, so the UI never re-derives it.
    """
    if scope not in print_queue.CLEAR_SCOPES:
        raise HTTPException(400, f"scope must be one of {', '.join(print_queue.CLEAR_SCOPES)}")
    return {"cleared": print_queue.clear_finished(scope)}


@router.delete("/{job_id}")
def cancel_queued(job_id: int, _: None = Depends(auth.require_api_auth)):
    if not print_queue.cancel_job(job_id):
        raise HTTPException(404, "job not found, not pending, or already running")
    return {"status": "canceled"}


@router.get("/current")
def current_print(_: None = Depends(auth.require_api_auth)):
    return printer.get_current() or {}


@router.post("/cancel-current")
def cancel_current_print(_: None = Depends(auth.require_api_auth)):
    if not printer.cancel_current():
        raise HTTPException(409, "nothing is printing right now")
    return {"status": "canceling"}
