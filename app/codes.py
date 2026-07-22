"""QR codes and barcodes, rendered as images.

Deliberately *not* python-escpos's own `p.qr()` / `p.barcode()`. Those emit
native printer commands, which means the printer draws the code itself — so it
never appears in a preview (preview.Recorder has nothing to record but an
opaque command), and the supported symbologies vary by printer model.

Rendering to a PIL image instead means the code goes out through the same
`p.image()` path as every other picture: previews work for free, output is
identical on any printer, and the two libraries needed are already installed
as python-escpos dependencies — no new requirements.
"""

import barcode
from barcode.writer import ImageWriter
from PIL import Image
import qrcode

# code128 first: it accepts arbitrary ASCII, so it's the only symbology that
# can encode a URL or a free-form ID without validation surprises.
SYMBOLOGIES = (
    "code128",
    "code39",
    "ean13",
    "ean8",
    "upca",
    "isbn13",
    "issn",
    "itf",
)

DEFAULT_SYMBOLOGY = "code128"
FORMATS = ("qr", "barcode")


class CodeError(ValueError):
    """The data doesn't fit the chosen symbology (EAN-13 needs 12-13 digits …)."""


def render_qr(data: str, width: int) -> Image.Image:
    """A QR code sized to fill the paper width.

    box_size is computed from the finished module count rather than fixed, so
    a long URL (more modules) still lands on exactly the paper width instead of
    overflowing and being scaled back down by _fit_to_width.
    """
    code = qrcode.QRCode(border=2, error_correction=qrcode.constants.ERROR_CORRECT_M)
    code.add_data(data)
    code.make(fit=True)

    modules = code.modules_count + code.border * 2
    box = max(1, width // modules)
    code.box_size = box
    image = code.make_image(fill_color="black", back_color="white").convert("L")

    # Whatever's left over after integer division, so the result is exactly
    # `width` and never a fraction of a module off.
    if image.width != width:
        image = image.resize((width, width), Image.NEAREST)
    return image


def render_barcode(data: str, symbology: str, width: int) -> Image.Image:
    if symbology not in SYMBOLOGIES:
        raise CodeError(f"unsupported barcode type {symbology!r}")
    try:
        writer = ImageWriter()
        drawn = barcode.get(symbology, data, writer=writer).render(
            {
                # Tuned for thermal output: a quiet zone the cutter won't eat,
                # and a bar height that scans reliably at 180-203 dpi.
                "module_height": 12.0,
                "quiet_zone": 2.0,
                "font_size": 8,
                "text_distance": 3.0,
            }
        )
    except barcode.errors.BarcodeError as exc:
        raise CodeError(str(exc)) from exc
    except Exception as exc:  # python-barcode raises bare ValueErrors too
        raise CodeError(f"could not encode {data!r} as {symbology}: {exc}") from exc

    image = drawn.convert("L")
    if image.width != width:
        ratio = width / image.width
        image = image.resize((width, max(1, int(image.height * ratio))), Image.LANCZOS)
    return image


def render(data: str, code_format: str, symbology: str, width: int) -> Image.Image:
    if not data.strip():
        raise CodeError("nothing to encode")
    if code_format == "qr":
        return render_qr(data, width)
    if code_format == "barcode":
        return render_barcode(data, symbology, width)
    raise CodeError(f"unknown code format {code_format!r}")
