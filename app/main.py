import asyncio
import secrets
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app import config, db, print_queue
from app.routers import (
    content as content_router,
    history as history_router,
    pages,
    print as print_router,
    queue as queue_router,
    settings as settings_router,
    snippets,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    worker_task = asyncio.create_task(print_queue.worker_loop())
    try:
        yield
    finally:
        worker_task.cancel()
        # Awaited so cancellation actually propagates into the worker before
        # the process exits, rather than being requested and never delivered.
        with suppress(asyncio.CancelledError):
            await worker_task


app = FastAPI(title="tprint", lifespan=lifespan)

session_secret = config.SESSION_SECRET or secrets.token_hex(32)
if not config.SESSION_SECRET:
    print(
        "WARNING: SESSION_SECRET is not set; using a random secret for this "
        "process only, which means everyone will be logged out on restart. "
        "Set SESSION_SECRET in production."
    )
app.add_middleware(SessionMiddleware, secret_key=session_secret)

app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")

app.include_router(pages.router)
app.include_router(print_router.router)
app.include_router(snippets.router)
app.include_router(settings_router.router)
app.include_router(history_router.router)
app.include_router(queue_router.router)
app.include_router(content_router.router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "printer_backend": config.PRINTER_BACKEND,
        "build_date": config.get_build_date(),
    }
