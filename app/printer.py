import io

import fitz  # PyMuPDF
from escpos.printer import Dummy, File
from PIL import Image

from app import config


def _get_printer():
    if config.PRINTER_BACKEND == "dummy":
        return Dummy()
    return File(devfile=config.PRINTER_DEVICE, auto_flush=True)


def _finish(printer) -> None:
    if isinstance(printer, File):
        printer.close()


def _fit_to_width(image: Image.Image) -> Image.Image:
    image = image.convert("L")
    if image.width != config.PRINTER_WIDTH_PX:
        ratio = config.PRINTER_WIDTH_PX / image.width
        new_height = max(1, int(image.height * ratio))
        image = image.resize((config.PRINTER_WIDTH_PX, new_height), Image.LANCZOS)
    return image


def print_text(text: str) -> None:
    printer = _get_printer()
    try:
        printer.set(align="left")
        printer.text(text if text.endswith("\n") else text + "\n")
        printer.text("\n\n")
        printer.cut()
    finally:
        _finish(printer)


def print_image(image: Image.Image) -> None:
    image = _fit_to_width(image)
    printer = _get_printer()
    try:
        printer.image(image)
        printer.text("\n\n")
        printer.cut()
    finally:
        _finish(printer)


def print_pdf(pdf_bytes: bytes) -> None:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        printer = _get_printer()
        try:
            for page in doc:
                pix = page.get_pixmap(dpi=180)
                mode = "RGBA" if pix.alpha else "RGB"
                image = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
                printer.image(_fit_to_width(image))
            printer.text("\n\n")
            printer.cut()
        finally:
            _finish(printer)
    finally:
        doc.close()


def image_from_upload(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))
