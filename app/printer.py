import io
import os
import threading
from contextlib import contextmanager
from datetime import datetime

import fitz  # PyMuPDF
from escpos.printer import Dummy
from PIL import Image

from app import config, i18n, settings


class PrintCancelled(Exception):
    """Raised when a print job is aborted mid-transfer via cancel_current()."""


# Only one physical printer, so only one job is ever actually in flight —
# this lock serializes writes to the device, and the event lets a big print
# be aborted between write chunks (see _send). _current holds a small
# descriptor of whatever's printing right now, for the "what's printing"
# status endpoint.
_print_lock = threading.Lock()
_cancel_event = threading.Event()
_current: dict | None = None


@contextmanager
def _job(label: str):
    global _current
    with _print_lock:
        _cancel_event.clear()
        _current = {"label": label}
        try:
            yield
        finally:
            _current = None


def get_current() -> dict | None:
    return dict(_current) if _current else None


def cancel_current() -> bool:
    if _current is None:
        return False
    _cancel_event.set()
    return True


def _fit_to_width(image: Image.Image) -> Image.Image:
    image = image.convert("L")
    if image.width != config.PRINTER_WIDTH_PX:
        ratio = config.PRINTER_WIDTH_PX / image.width
        new_height = max(1, int(image.height * ratio))
        image = image.resize((config.PRINTER_WIDTH_PX, new_height), Image.LANCZOS)
    return image


def _render_template(text: str) -> str:
    return text.replace("{datetime}", datetime.now().strftime("%Y-%m-%d %H:%M"))


def _build(build_fn) -> bytes:
    """Build a job's raw ESC/POS bytes via python-escpos's Dummy backend,
    so we control exactly how it's written to the device ourselves (see
    _send) instead of relying on python-escpos's own file writer.
    """
    dummy = Dummy()
    build_fn(dummy)
    return dummy.output


def _send(data: bytes) -> None:
    if config.PRINTER_BACKEND == "dummy":
        return

    # A single unbuffered write, not python-escpos's own File backend (which
    # opens the device with Python's default ~8KB buffered I/O). On real
    # hardware, a large image payload split across multiple buffered writes
    # produced a visible thin white band at every ~8KB chunk boundary — the
    # printhead is timing-sensitive and any gap between writes shows up as a
    # blank line. One raw write() avoids introducing those gaps ourselves.
    #
    # Writing in modest chunks (rather than the whole payload in one
    # os.write call) also gives cancel_current() somewhere to take effect —
    # a big job can be aborted between chunks instead of only before/after.
    chunk_size = 32 * 1024
    fd = os.open(config.PRINTER_DEVICE, os.O_WRONLY)
    try:
        for offset in range(0, len(data), chunk_size):
            if _cancel_event.is_set():
                raise PrintCancelled()
            chunk = memoryview(data)[offset : offset + chunk_size]
            while chunk:
                n = os.write(fd, chunk)
                chunk = chunk[n:]
    finally:
        os.close(fd)


def _print_job(content_fn, *, label: str = "") -> None:
    """Wrap content_fn(p) — which prints only the job's own content, no cut
    — with the configured header (logo + text) and footer, then cut, then
    send. Every print_* function below routes through this so header/footer
    settings apply everywhere consistently.
    """
    s = settings.get_settings()

    def wrapped(p):
        if s["header_logo_path"]:
            logo_path = os.path.join(config.DATA_DIR, s["header_logo_path"])
            if os.path.exists(logo_path):
                p.set(align="center")
                p.image(_fit_to_width(Image.open(logo_path)))
        if s["header_text"]:
            p.set(align="center", bold=False, double_width=False)
            p.text(_render_template(s["header_text"]) + "\n")

        p.set(
            align=s["default_align"],
            bold=bool(s["default_bold"]),
            double_width=bool(s["default_double_width"]),
        )
        content_fn(p)

        if s["footer_text"]:
            p.set(align="center", bold=False, double_width=False)
            p.text(_render_template(s["footer_text"]) + "\n")

        p.cut()

    with _job(label):
        _send(_build(wrapped))


def print_text(text: str) -> None:
    def content(p):
        p.text(text if text.endswith("\n") else text + "\n")

    _print_job(content, label=text[:60])


def print_image(image: Image.Image) -> None:
    image = _fit_to_width(image)

    def content(p):
        p.image(image)

    _print_job(content, label="image")


def print_images(images: list[Image.Image]) -> None:
    fitted = [_fit_to_width(image) for image in images]

    def content(p):
        for image in fitted:
            p.image(image)

    _print_job(content, label=f"{len(images)} image(s)")


def _render_pdf_pages(pdf_bytes: bytes) -> list[Image.Image]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        images = []
        for page in doc:
            pix = page.get_pixmap(dpi=180)
            mode = "RGBA" if pix.alpha else "RGB"
            image = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
            images.append(_fit_to_width(image))
        return images
    finally:
        doc.close()


def print_pdf(pdf_bytes: bytes) -> list[Image.Image]:
    """Prints the PDF and returns the rendered page images (used for a
    preview thumbnail by callers, so the PDF isn't rendered twice)."""
    images = _render_pdf_pages(pdf_bytes)

    def content(p):
        for image in images:
            p.image(image)

    _print_job(content, label="PDF")
    return images


def _checklist_lines(items: list[dict], lang: str) -> list[str]:
    strings = i18n.t(lang)
    lines = []
    for item in items:
        line = f"[ ] {item['text']}"
        if item.get("due"):
            line += f"  ({strings['due_label']}: {item['due']})"
        lines.append(line)
    return lines


def print_checklist(title: str | None, items: list[dict], mode: str, lang: str = "en") -> None:
    if mode == "separate":
        for item in items:
            def content(p, item=item):
                if title:
                    p.set(align="center", bold=True)
                    p.text(title + "\n")
                p.set(align="left", bold=False)
                p.text(_checklist_lines([item], lang)[0] + "\n")

            _print_job(content, label=item["text"][:60])
        return

    def content(p):
        if title:
            p.set(align="center", bold=True)
            p.text(title + "\n")
        p.set(align="left", bold=False)
        for line in _checklist_lines(items, lang):
            p.text(line + "\n")

    _print_job(content, label=title or f"{len(items)} tasks")


def _event_lines(event: dict) -> list[str]:
    lines = [event["summary"] or "(no title)"]
    if event.get("when"):
        lines.append(event["when"])
    if event.get("location"):
        lines.append(event["location"])
    if event.get("description"):
        lines.append("")
        lines.append(event["description"])
    return lines


def print_ics_events(events: list[dict], mode: str) -> None:
    if mode == "separate":
        for event in events:
            def content(p, event=event):
                p.set(align="left", bold=True)
                p.text(_event_lines(event)[0] + "\n")
                p.set(bold=False)
                for line in _event_lines(event)[1:]:
                    p.text(line + "\n")

            _print_job(content, label=event["summary"][:60])
        return

    def content(p):
        for event in events:
            lines = _event_lines(event)
            p.set(align="left", bold=True)
            p.text(lines[0] + "\n")
            p.set(bold=False)
            for line in lines[1:]:
                p.text(line + "\n")
            p.text("\n")

    _print_job(content, label=f"{len(events)} events")


def image_from_upload(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))
