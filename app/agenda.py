"""Composing agenda output: day grouping, the overview grid, landscape days.

Nothing here parses .ics — `ics_import.parse_ics` is untouched and stays the
only thing that reads a calendar file. What it hands back has no machine
readable date on it (it formats one into `when` and drops the sort key), so
the day for grouping and for grid dots is recovered from that string here, in
the *composition* layer where the rest of the layout decisions already live.
"""

import calendar
import re
from datetime import date, timedelta

from PIL import Image, ImageDraw, ImageFont

# `when` is built by ics_import._format_when and always starts with the ISO
# date when the event has a start at all.
_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")

# Marks a day that has at least one event. ASCII on purpose: the printer's
# default code page is not guaranteed to carry a middle dot or a bullet.
DOT = "*"

WEEKDAYS = ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")


def event_date(event: dict) -> date | None:
    """The event's day, or None for an event with no usable start."""
    match = _DATE_RE.match(event.get("when") or "")
    if not match:
        return None
    try:
        return date(int(match[1]), int(match[2]), int(match[3]))
    except ValueError:
        return None


def group_by_day(events: list[dict]) -> list[tuple[date | None, list[dict]]]:
    """Events bucketed by day, in chronological order.

    Undated events end up in a single trailing `None` bucket rather than being
    dropped — a calendar with a malformed entry should still print.
    """
    buckets: dict[date | None, list[dict]] = {}
    for event in events:
        buckets.setdefault(event_date(event), []).append(event)
    dated = sorted((day for day in buckets if day is not None))
    ordered: list[tuple[date | None, list[dict]]] = [(day, buckets[day]) for day in dated]
    if None in buckets:
        ordered.append((None, buckets[None]))
    return ordered


def _cell(text: str, marked: bool) -> str:
    """One 4-column grid cell: right-aligned label, then the dot slot."""
    return f"{text:>2}{DOT if marked else ' '} "


def overview_lines(events: list[dict], scope: str) -> list[str]:
    """The week or month grid, as monospace lines with a dot on busy days.

    Text rather than a bitmap: it stays crisp, costs almost nothing to send,
    and shows up in previews for free because Recorder already handles text.
    Four columns per day is 28 characters, which fits 58mm paper (32) as well
    as 80mm (48).
    """
    days = {day for day in (event_date(event) for event in events) if day}
    if not days:
        return []

    anchor = min(days)
    header = "".join(_cell(name, False) for name in WEEKDAYS).rstrip()

    if scope == "week":
        start = anchor - timedelta(days=anchor.weekday())
        week = [start + timedelta(days=offset) for offset in range(7)]
        title = f"Week of {start.isoformat()}"
        rows = ["".join(_cell(str(day.day), day in days) for day in week).rstrip()]
    else:
        title = anchor.strftime("%B %Y")
        rows = []
        for week in calendar.Calendar(firstweekday=0).monthdatescalendar(
            anchor.year, anchor.month
        ):
            cells = []
            for day in week:
                # Days bleeding in from the neighbouring month are blanked, so
                # the grid reads as one month rather than a rolling window.
                if day.month != anchor.month:
                    cells.append(_cell("", False))
                else:
                    cells.append(_cell(str(day.day), day in days))
            rows.append("".join(cells).rstrip())

    return [title, "", header, *rows]


def day_title(day: date | None) -> str:
    return day.strftime("%A %d %B %Y") if day else "Undated"


# --- landscape day receipts -------------------------------------------------

_LINE_HEIGHT = 30
_TITLE_HEIGHT = 40
_MARGIN = 12


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1 has no sized default font
        return ImageFont.load_default()


def render_day_landscape(title: str, lines: list[str], paper_width: int) -> Image.Image:
    """A day's plan turned sideways, for sticking on a wall.

    Laid out into a canvas whose *height* is the paper width and whose width
    grows with the content, then rotated a quarter turn. The rotated image is
    therefore exactly `paper_width` across and needs no rescaling — scaling it
    afterwards is what would make the text soft.

    Content taller than the paper width is clipped rather than shrunk: an
    unreadable full day is worse than a readable partial one, and the vertical
    mode is right there for a day with dozens of events.
    """
    title_font = _font(28)
    body_font = _font(20)

    probe = ImageDraw.Draw(Image.new("L", (1, 1), 255))
    widest = max(
        [probe.textlength(title, font=title_font)]
        + [probe.textlength(line, font=body_font) for line in lines]
        or [1]
    )
    length = int(widest) + _MARGIN * 2

    canvas = Image.new("L", (max(1, length), paper_width), 255)
    draw = ImageDraw.Draw(canvas)
    draw.text((_MARGIN, _MARGIN), title, font=title_font, fill=0)
    draw.line(
        [(_MARGIN, _MARGIN + _TITLE_HEIGHT - 6), (length - _MARGIN, _MARGIN + _TITLE_HEIGHT - 6)],
        fill=0, width=2,
    )

    y = _MARGIN + _TITLE_HEIGHT
    for line in lines:
        if y + _LINE_HEIGHT > paper_width - _MARGIN:
            break
        draw.text((_MARGIN, y), line, font=body_font, fill=0)
        y += _LINE_HEIGHT

    # Quarter turn clockwise: the strip is read by turning it the same way.
    return canvas.transpose(Image.ROTATE_270)
