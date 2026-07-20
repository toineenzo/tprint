import io
import os

import fitz  # PyMuPDF
from escpos.printer import Dummy
from PIL import Image

from app import config


def _fit_to_width(image: Image.Image) -> Image.Image:
    image = image.convert("L")
    if image.width != config.PRINTER_WIDTH_PX:
        ratio = config.PRINTER_WIDTH_PX / image.width
        new_height = max(1, int(image.height * ratio))
        image = image.resize((config.PRINTER_WIDTH_PX, new_height), Image.LANCZOS)
    return image


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
    fd = os.open(config.PRINTER_DEVICE, os.O_WRONLY)
    try:
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            view = view[n:]
    finally:
        os.close(fd)


def print_text(text: str) -> None:
    def build(p):
        p.set(align="left")
        p.text(text if text.endswith("\n") else text + "\n")
        p.cut()

    _send(_build(build))


def print_image(image: Image.Image) -> None:
    image = _fit_to_width(image)

    def build(p):
        p.image(image)
        p.cut()

    _send(_build(build))


def print_pdf(pdf_bytes: bytes) -> None:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        images = []
        for page in doc:
            pix = page.get_pixmap(dpi=180)
            mode = "RGBA" if pix.alpha else "RGB"
            image = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
            images.append(_fit_to_width(image))
    finally:
        doc.close()

    def build(p):
        for image in images:
            p.image(image)
        p.cut()

    _send(_build(build))


def image_from_upload(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))
