from fastapi import APIRouter, Depends, HTTPException

from app import auth, print_queue, printer

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


@router.delete("/finished")
def clear_finished_jobs(_: None = Depends(auth.require_api_auth)):
    return {"cleared": print_queue.clear_finished()}


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
