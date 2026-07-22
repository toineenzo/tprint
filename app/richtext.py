"""Styled text, rendered to a bitmap.

ESC/POS `set()` gives bold, underline and double width/height natively, but it
has **no italic and no per-run grey**. Delivering both means drawing the text
ourselves, so the whole block becomes one image and goes out through the same
`p.image()` path as a photo — which also means previews render it for free.

Grey is real on a one-bit printer only through dithering: a mid-grey drawn
here becomes a dot pattern once python-escpos converts the image to 1-bit,
which reads as a lighter shade on paper. That's why tint is expressed as a
luminance rather than a colour.

Plain, unstyled text does *not* come through here — it stays on the native
crisp path in printer.text_content. This is the price of formatting, paid only
when formatting is asked for.
"""

from PIL import Image, ImageDraw, ImageFont

# Luminance per tint. Pure black stays solid; the two greys dither.
TINTS = {"black": 0, "dark": 90, "light": 160}

# Body plus three heading levels, as a multiplier on the base text size.
HEADING_SCALE = {0: 1.0, 1: 2.0, 2: 1.6, 3: 1.3}

BASE_SIZE = 22
LINE_GAP = 6
PAPER = 255

# The same bound preview.py uses: past this a runaway block is truncated
# rather than allocating an enormous canvas.
MAX_HEIGHT = 4000


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1 has no sized default font
        return ImageFont.load_default()


def _shear(image: Image.Image) -> Image.Image:
    """Fake italic: no italic face is available, so slant the drawn line.

    The same trick as the fake bold below — both are approximations of what a
    real font family would provide, and both are invisible at receipt sizes.
    """
    slant = 0.22
    extra = int(image.height * slant)
    widened = Image.new("L", (image.width + extra, image.height), PAPER)
    widened.paste(image, (0, 0))
    return widened.transform(
        widened.size, Image.AFFINE, (1, slant, -slant * image.height, 0, 1, 0),
        resample=Image.BILINEAR, fillcolor=PAPER,
    )


def _wrap(draw, text: str, font, max_width: int) -> list[str]:
    """Greedy word wrap measured against the real font metrics."""
    if not text:
        return [""]
    lines, current = [], ""
    for word in text.split(" "):
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _render_block(block: dict, width: int) -> Image.Image | None:
    """One styled paragraph as its own strip, or None when it's blank."""
    text = str(block.get("text", ""))
    level = int(block.get("level", 0) or 0)
    bold = bool(block.get("bold"))
    italic = bool(block.get("italic"))
    underline = bool(block.get("underline"))
    align = block.get("align", "left")
    fill = TINTS.get(block.get("tint", "black"), 0)

    size = max(8, int(BASE_SIZE * HEADING_SCALE.get(level, 1.0)))
    font = _font(size)

    probe = Image.new("L", (width, size * 3), PAPER)
    draw = ImageDraw.Draw(probe)
    lines = _wrap(draw, text, font, width)

    line_height = size + LINE_GAP
    strip = Image.new("L", (width, line_height * len(lines)), PAPER)
    pen = ImageDraw.Draw(strip)

    for index, line in enumerate(lines):
        y = index * line_height
        text_width = pen.textlength(line, font=font)
        if align == "center":
            x = max(0, (width - text_width) / 2)
        elif align == "right":
            x = max(0, width - text_width)
        else:
            x = 0
        pen.text((x, y), line, font=font, fill=fill)
        if bold:
            # Smear by a pixel — the same approximation the printer's own
            # emphasized mode makes in hardware.
            pen.text((x + 1, y), line, font=font, fill=fill)
        if underline:
            baseline = y + size + 1
            pen.line([(x, baseline), (x + text_width, baseline)], fill=fill, width=2)

    if italic:
        strip = _shear(strip)
        if strip.width != width:
            strip = strip.crop((0, 0, width, strip.height))
    return strip


def render(blocks: list[dict], width: int) -> Image.Image:
    """Draw styled blocks onto one paper-width image."""
    strips = [s for s in (_render_block(b, width) for b in blocks) if s is not None]
    if not strips:
        strips = [Image.new("L", (width, 1), PAPER)]

    height = min(sum(s.height for s in strips), MAX_HEIGHT)
    canvas = Image.new("L", (width, height), PAPER)
    y = 0
    for strip in strips:
        if y >= height:
            break
        canvas.paste(strip, (0, y))
        y += strip.height
    return canvas


def plain_text(blocks: list[dict]) -> str:
    """The text without styling — for history previews and job labels."""
    return "\n".join(str(block.get("text", "")) for block in blocks).strip()
