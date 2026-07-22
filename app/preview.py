"""Render what a print *would* look like, without sending anything.

The trick here is that nothing in this module knows what a receipt contains.
Every `printer.print_*` function builds its content by calling `.set()`,
`.text()`, `.image()` and `.cut()` on a python-escpos printer object, so
`Recorder` implements that same small interface and captures the calls
instead. `printer.frame_job` then wraps a Recorder exactly as it wraps a real
printer, and this file draws the result.

That means a preview runs the *same* code path as the print it previews. A new
content type gets an accurate preview for free, and there is no second layout
engine to drift out of step with the first.
"""

import io
import textwrap

from PIL import Image, ImageDraw, ImageFont

from app import printer, settings

# Font A on the printers this targets is a 12x24 dot cell, so a 576-dot roll
# is 48 columns and a 384-dot roll is 32. Laying the preview out on that same
# grid is what makes wrapping match the hardware.
CHAR_WIDTH = 12
LINE_HEIGHT = 24

# A 60-page PDF would otherwise render a preview tens of thousands of pixels
# tall. Past this the preview is truncated and says so. Passing `max_height=None`
# opts out — the PDF export wants the whole receipt, however long it runs.
MAX_HEIGHT = 4000

# The dot density of the printers this targets. Embedding a page at this
# resolution gives the PDF the *physical* size of the receipt — 576 dots comes
# out 72mm wide — so it prints as a receipt-shaped strip rather than something
# stretched to fill A4.
DPI = 203

# PDF caps a page at 200 inches, and a page metres long is unreadable anyway, so
# a receipt longer than this is sliced across several pages. At 203dpi this is
# roughly a metre of paper, which no single receipt should reach.
MAX_PDF_PAGE_PX = DPI * 40

PAPER = 255
INK = 0


class Recorder:
    """The subset of python-escpos's printer interface that content builders use.

    Anything a `content_fn` might call has to exist here, or previewing that
    content type raises instead of rendering. The no-op methods at the bottom
    are the rest of the interface: harmless to ignore for layout purposes, but
    they must not be missing.
    """

    def __init__(self) -> None:
        self.blocks: list[dict] = []
        self.align = "left"
        self.bold = False
        self.double_width = False

    def set(self, align=None, bold=None, double_width=None, **kwargs) -> None:
        if align is not None:
            self.align = align
        if bold is not None:
            self.bold = bold
        if double_width is not None:
            self.double_width = double_width

    def text(self, value: str) -> None:
        self.blocks.append(
            {
                "type": "text",
                "value": value,
                "align": self.align,
                "bold": self.bold,
                "double_width": self.double_width,
            }
        )

    def image(self, image: Image.Image, **kwargs) -> None:
        self.blocks.append({"type": "image", "value": image})

    def cut(self, **kwargs) -> None:
        self.blocks.append({"type": "cut"})

    def ln(self, count: int = 1) -> None:
        self.text("\n" * max(1, count))

    def print_and_feed(self, n: int = 1) -> None:
        self.ln(n)

    def _noop(self, *args, **kwargs) -> None:
        return None

    # python-escpos exposes plenty more; none of it affects layout.
    barcode = qr = hw = control = charcode = _noop


def _wrap(value: str, columns: int) -> list[str]:
    """Split on newlines, then hard-wrap each line to the column grid."""
    lines: list[str] = []
    for raw in value.split("\n"):
        if not raw:
            lines.append("")
            continue
        lines.extend(
            textwrap.wrap(
                raw,
                width=max(1, columns),
                drop_whitespace=False,
                replace_whitespace=False,
                break_long_words=True,
                break_on_hyphens=False,
            )
            or [""]
        )
    return lines


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        # Pillow < 10.1 has no sized default font. Layout still works — every
        # glyph is placed on the fixed grid below — it just looks smaller.
        return ImageFont.load_default()


def _draw_line(
    draw: ImageDraw.ImageDraw,
    text: str,
    y: int,
    width: int,
    align: str,
    bold: bool,
    double: bool,
    font: ImageFont.ImageFont,
) -> None:
    """Draw one line character-by-character on a fixed advance.

    Stepping by a constant rather than letting the font advance naturally is
    what makes the preview monospaced like the printer, without needing to
    ship a monospace font in the image.
    """
    advance = CHAR_WIDTH * (2 if double else 1)
    line_width = len(text) * advance
    if align == "center":
        x = max(0, (width - line_width) // 2)
    elif align == "right":
        x = max(0, width - line_width)
    else:
        x = 0

    for index, char in enumerate(text):
        position = (x + index * advance, y)
        draw.text(position, char, font=font, fill=INK)
        if bold:
            # No bold face available, so smear by a pixel — the same trick the
            # printer's own emphasized mode approximates in hardware.
            draw.text((position[0] + 1, position[1]), char, font=font, fill=INK)


def render(
    blocks: list[dict], width: int, max_height: int | None = MAX_HEIGHT
) -> Image.Image:
    """Draw recorded blocks onto a paper-coloured strip `width` dots across."""
    font = _font(LINE_HEIGHT - 6)
    double_font = _font(LINE_HEIGHT - 2)
    columns = max(1, width // CHAR_WIDTH)

    # Measure first so the canvas is exactly tall enough — a receipt has no
    # fixed length, and trailing blank paper reads as a rendering bug.
    height = 8
    laid_out: list[tuple] = []
    for block in blocks:
        if block["type"] == "text":
            double = block["double_width"]
            for line in _wrap(block["value"], columns // (2 if double else 1)):
                laid_out.append(("text", line, height, block, double))
                height += LINE_HEIGHT
        elif block["type"] == "image":
            image = block["value"]
            laid_out.append(("image", image, height, block, False))
            height += image.height + 4
        else:
            height += 10
            laid_out.append(("cut", None, height, block, False))
            height += 10

    limit = max_height or height + 8
    truncated = height > limit
    canvas = Image.new("L", (width, min(height + 8, limit)), PAPER)
    draw = ImageDraw.Draw(canvas)

    for kind, value, y, block, double in laid_out:
        if y > canvas.height:
            break
        if kind == "text":
            _draw_line(
                draw, value, y, width, block["align"], block["bold"], double,
                double_font if double else font,
            )
        elif kind == "image":
            canvas.paste(value.convert("L"), (max(0, (width - value.width) // 2), y))
        else:
            for x in range(0, width, 12):
                draw.line([(x, y), (x + 6, y)], fill=INK, width=2)

    if truncated:
        draw.rectangle([0, canvas.height - LINE_HEIGHT, width, canvas.height], fill=PAPER)
        _draw_line(
            draw, "... preview truncated ...", canvas.height - LINE_HEIGHT + 2,
            width, "center", False, False, font,
        )
    return canvas


def render_job(
    content_fn, width: int | None = None, max_height: int | None = MAX_HEIGHT
) -> Image.Image:
    """Preview one job: frame it exactly as printing would, then draw it."""
    row = settings.get_settings()
    target = width or settings.paper_width_px()
    recorder = Recorder()
    printer.frame_job(content_fn, row, target)(recorder)
    return render(recorder.blocks, target, max_height)


def to_png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def to_pdf(images: list[Image.Image]) -> bytes:
    """One PDF page per rendered receipt, at the receipt's own physical size.

    Deliberately a raster rather than selectable text: these images come from
    `Recorder`, which captured the real print path, so the PDF says exactly what
    the paper would. Re-typesetting the same blocks into PDF text would be a
    third layout engine to keep in step with the other two, and it still could
    not use the printer's ROM font.
    """
    if not images:
        raise ValueError("nothing to render")

    pages: list[Image.Image] = []
    for image in images:
        for top in range(0, image.height, MAX_PDF_PAGE_PX):
            bottom = min(top + MAX_PDF_PAGE_PX, image.height)
            pages.append(image.crop((0, top, image.width, bottom)))

    buffer = io.BytesIO()
    pages[0].save(
        buffer, "PDF", save_all=True, append_images=pages[1:], resolution=DPI
    )
    return buffer.getvalue()
