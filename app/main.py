import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app import config, db
from app.routers import pages, print as print_router, snippets


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


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


@app.get("/health")
def health():
    return {"status": "ok", "printer_backend": config.PRINTER_BACKEND}
