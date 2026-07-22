import io
import os
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime

import fitz  # PyMuPDF
from escpos.printer import Dummy
from PIL import Image

from app import agenda, codes, config, i18n, richtext, settings


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

# When the last job finished, for the "delay after printing" setting. Monotonic
# so it survives a wall-clock change; None until the first print of the process,
# which therefore never waits.
_last_finished_at: float | None = None


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


def _fit_to_width(image: Image.Image, width: int | None = None) -> Image.Image:
    """Scale an image to the printable width.

    `width` is passed explicitly by the preview renderer so a preview and the
    print it previews can't disagree about paper size; when omitted it reads
    the configured setting.
    """
    target = width or settings.paper_width_px()
    image = image.convert("L")
    if image.width != target:
        ratio = target / image.width
        new_height = max(1, int(image.height * ratio))
        image = image.resize((target, new_height), Image.LANCZOS)
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


def frame_job(content_fn, settings_row: dict, width: int):
    """Wrap content_fn with the configured header/footer frame.

    Split out of `_print_job` so `preview.py` can drive the *identical* wrapped
    function against a recording object. The preview and the print therefore
    can't drift: there is one description of what a receipt contains, and two
    things that consume it.
    """

    def _logo(p, column: str) -> None:
        stored = settings_row[column]
        if not stored:
            return
        path = os.path.join(config.DATA_DIR, stored)
        if os.path.exists(path):
            p.set(align="center")
            p.image(_fit_to_width(Image.open(path), width))

    def wrapped(p):
        _logo(p, "header_logo_path")
        if settings_row["header_text"]:
            p.set(align="center", bold=False, double_width=False)
            p.text(_render_template(settings_row["header_text"]) + "\n")

        p.set(
            align=settings_row["default_align"],
            bold=bool(settings_row["default_bold"]),
            double_width=bool(settings_row["default_double_width"]),
        )
        content_fn(p)

        if settings_row["footer_text"]:
            p.set(align="center", bold=False, double_width=False)
            p.text(_render_template(settings_row["footer_text"]) + "\n")
        _logo(p, "footer_logo_path")

        if settings_row["auto_cut"]:
            p.cut()

    return wrapped


def _await_gap(delay_seconds: int) -> None:
    """Hold off until at least `delay_seconds` have passed since the last print.

    This is the "delay after printing" setting. It's expressed as a minimum gap
    rather than a trailing sleep so an isolated print never waits, while a burst
    — "Run queue now" firing five jobs back to back — comes out spaced. Called
    while holding the print lock, so the wait can't be raced by another job.
    """
    if delay_seconds <= 0 or _last_finished_at is None:
        return
    remaining = delay_seconds - (time.monotonic() - _last_finished_at)
    while remaining > 0:
        if _cancel_event.is_set():
            raise PrintCancelled()
        # Sliced so a cancel lands promptly instead of after the whole gap.
        time.sleep(min(remaining, 0.25))
        remaining = delay_seconds - (time.monotonic() - _last_finished_at)


def _print_job(content_fn, *, label: str = "") -> None:
    """Wrap content_fn(p) — which prints only the job's own content, no cut
    — with the configured header (logo + text) and footer, then cut, then
    send. Every print_* function below routes through this so header/footer
    settings apply everywhere consistently.
    """
    global _last_finished_at
    s = settings.get_settings()
    wrapped = frame_job(content_fn, s, settings.paper_width_px())

    with _job(label):
        _await_gap(int(s["print_delay_seconds"]))
        try:
            _send(_build(wrapped))
        finally:
            _last_finished_at = time.monotonic()


# Content builders. Each returns a `content_fn(p)` that emits only the job's
# own content — no frame, no cut. They are separate from the print_* functions
# below so preview.py can build the identical content without printing it.


def text_content(text: str):
    def content(p):
        p.text(text if text.endswith("\n") else text + "\n")

    return content


def images_content(images: list[Image.Image], width: int | None = None):
    fitted = [_fit_to_width(image, width) for image in images]

    def content(p):
        for image in fitted:
            p.image(image)

    return content


def code_content(data: str, code_format: str, symbology: str, width: int | None = None):
    """A QR code or barcode as an image — see codes.py for why it's an image."""
    target = width or settings.paper_width_px()
    return images_content([codes.render(data, code_format, symbology, target)], target)


def richtext_content(blocks: list[dict], width: int | None = None):
    """Styled text drawn to a bitmap — see richtext.py for why it's a bitmap."""
    target = width or settings.paper_width_px()
    return images_content([richtext.render(blocks, target)], target)


# ESC/POS can emit bold, underline, alignment and double width/height as real
# text. It has no italic and no per-run grey, so a block using either has to be
# drawn as a bitmap instead — decided per part so nothing is silently dropped.
def _text_needs_bitmap(blocks: list[dict]) -> bool:
    return any(block.get("italic") or block.get("tint", "black") != "black" for block in blocks)


def _emit_native_text(p, blocks: list[dict]) -> None:
    for block in blocks:
        level = int(block.get("level", 0) or 0)
        p.set(
            align=block.get("align", "left"),
            bold=bool(block.get("bold")),
            underline=1 if block.get("underline") else 0,
            # Headings are the printer's own double-size modes rather than a
            # scaled bitmap, which keeps them crisp.
            double_width=level in (1, 2),
            double_height=level in (1, 2, 3),
        )
        p.text(f"{block.get('text', '')}\n")
    p.set(align="left", bold=False, underline=0, double_width=False, double_height=False)


def composition_content(parts: list[dict], images: dict[int, Image.Image], width: int | None = None):
    """Flow-mode composition: each part printed in order, natively where it can be.

    This is the one content builder that is *not* a single bitmap. Text stays
    real ESC/POS text — sharper and far smaller than a raster — and only falls
    back to `richtext.render` for styling the printer cannot express.
    """
    target = width or settings.paper_width_px()

    def content(p):
        for part in parts:
            kind = part.get("type")
            if kind == "text":
                blocks = part.get("blocks") or []
                if _text_needs_bitmap(blocks):
                    p.image(_fit_to_width(richtext.render(blocks, target), target))
                else:
                    _emit_native_text(p, blocks)
            elif kind == "image":
                image = images.get(int(part["file_index"]))
                if image is not None:
                    p.image(_fit_to_width(image, target))
            elif kind == "code":
                p.image(
                    _fit_to_width(
                        codes.render(
                            part["data"], part.get("format", "qr"),
                            part.get("symbology", "code128"), target,
                        ),
                        target,
                    )
                )

    return content


def print_composition(parts: list[dict], images: dict[int, Image.Image]) -> None:
    _print_job(composition_content(parts, images), label="composition")


def print_text(text: str) -> None:
    _print_job(text_content(text), label=text[:60])


def print_code(data: str, code_format: str, symbology: str) -> None:
    _print_job(code_content(data, code_format, symbology), label=data[:60])


def print_richtext(blocks: list[dict]) -> None:
    _print_job(richtext_content(blocks), label=richtext.plain_text(blocks)[:60])


def print_image(image: Image.Image) -> None:
    _print_job(images_content([image]), label="image")


def print_images(images: list[Image.Image]) -> None:
    _print_job(images_content(images), label=f"{len(images)} image(s)")


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


def pdf_page_image(
    pdf_bytes: bytes, page_number: int = 1, width: int | None = None
) -> tuple[Image.Image, int]:
    """One page of a PDF as an image, plus the document's page count.

    Renders only the page asked for. `_render_pdf_pages` rasterizes the whole
    document, which is right for printing it but wasteful when the editor wants
    a single page out of a long file. `page_number` is 1-based and clamped, so
    a stale page number can't raise after the file behind it changed.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        count = doc.page_count
        index = max(0, min(page_number - 1, count - 1))
        pix = doc[index].get_pixmap(dpi=180)
        mode = "RGBA" if pix.alpha else "RGB"
        image = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
        return _fit_to_width(image, width), count
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


def checklist_content(title: str | None, items: list[dict], lang: str = "en"):
    """One receipt's worth of checklist. In "separate" mode this is called once
    per item, with a single-item list."""

    def content(p):
        if title:
            p.set(align="center", bold=True)
            p.text(title + "\n")
        p.set(align="left", bold=False)
        for line in _checklist_lines(items, lang):
            p.text(line + "\n")

    return content


def checklist_jobs(
    title: str | None, items: list[dict], mode: str, lang: str = "en"
) -> Iterator[tuple[str, object]]:
    """Every receipt a checklist prints as — one per item in "separate" mode."""
    if mode == "separate":
        for item in items:
            yield item["text"][:60], checklist_content(title, [item], lang)
        return

    yield title or f"{len(items)} tasks", checklist_content(title, items, lang)


def print_checklist(title: str | None, items: list[dict], mode: str, lang: str = "en") -> None:
    for label, content_fn in checklist_jobs(title, items, mode, lang):
        _print_job(content_fn, label=label)


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


def ics_content(events: list[dict]):
    """One receipt's worth of agenda. In "separate" mode this is called once
    per event, with a single-event list."""

    def content(p):
        for event in events:
            lines = _event_lines(event)
            p.set(align="left", bold=True)
            p.text(lines[0] + "\n")
            p.set(bold=False)
            for line in lines[1:]:
                p.text(line + "\n")
            p.text("\n")

    return content


def overview_content(events: list[dict], scope: str):
    """The week/month grid. Text, so it stays crisp and previews for free."""
    lines = agenda.overview_lines(events, scope)

    def content(p):
        if not lines:
            return
        p.set(align="center", bold=True)
        p.text(lines[0] + "\n")
        p.set(align="center", bold=False)
        for line in lines[1:]:
            p.text(line + "\n")
        p.set(align="left")

    return content


def day_content(day, events: list[dict], horizontal: bool, width: int | None = None):
    """One day's events as a single receipt, upright or turned sideways."""
    title = agenda.day_title(day)

    if not horizontal:
        def content(p):
            p.set(align="center", bold=True)
            p.text(title + "\n")
            p.set(align="left", bold=False)
            for event in events:
                for line in _event_lines(event):
                    p.text(line + "\n")
                p.text("\n")

        return content

    target = width or settings.paper_width_px()
    lines: list[str] = []
    for event in events:
        lines.extend(_event_lines(event))
        lines.append("")
    image = agenda.render_day_landscape(title, lines, target)

    def content(p):
        p.image(image)

    return content


def ics_jobs(
    events: list[dict],
    mode: str,
    overview: str = "none",
    orientation: str = "vertical",
) -> Iterator[tuple[str, object]]:
    """Every receipt an imported calendar prints as.

    `mode` is one of:
      single    one agenda receipt with every event
      separate  one receipt per event
      day       one consolidated receipt per day

    With an overview grid enabled it leads the agenda in `single` mode, and is
    its own receipt ahead of the rest otherwise — there is no sensible way to
    repeat a month grid on top of every per-day slip.

    A generator rather than a list because `day_content` rasterizes a whole
    landscape day up front: a year of them built eagerly would be hundreds of
    megabytes of images held while the first one is still printing.
    """
    scope = overview if overview in ("week", "month") else None

    if mode == "day":
        if scope:
            yield "agenda overview", overview_content(events, scope)
        for day, group in agenda.group_by_day(events):
            yield (
                agenda.day_title(day)[:60],
                day_content(day, group, orientation == "horizontal"),
            )
        return

    if mode == "separate":
        if scope:
            yield "agenda overview", overview_content(events, scope)
        for event in events:
            yield event["summary"][:60], ics_content([event])
        return

    def content(p):
        if scope:
            overview_content(events, scope)(p)
            p.text("\n")
        ics_content(events)(p)

    yield f"{len(events)} events", content


def print_ics_events(
    events: list[dict],
    mode: str,
    overview: str = "none",
    orientation: str = "vertical",
) -> None:
    for label, content_fn in ics_jobs(events, mode, overview, orientation):
        _print_job(content_fn, label=label)


def image_from_upload(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))
