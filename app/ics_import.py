import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

from icalendar import Calendar


def parse_ics(data: bytes) -> list[dict]:
    cal = Calendar.from_ical(data)
    events = []
    for component in cal.walk():
        if component.name != "VEVENT":
            continue
        dtstart = component.get("dtstart")
        dtend = component.get("dtend")
        start = dtstart.dt if dtstart else None
        end = dtend.dt if dtend else None
        events.append(
            {
                "summary": str(component.get("summary") or ""),
                "location": str(component.get("location") or "") or None,
                "description": str(component.get("description") or "") or None,
                "when": _format_when(start, end),
                "sort_key": start.isoformat() if start else "",
            }
        )
    events.sort(key=lambda e: e["sort_key"])
    for event in events:
        del event["sort_key"]
    return events


# A calendar subscription can be large, but not *this* large — a runaway URL
# must not be able to fill memory or the queue's upload directory.
MAX_ICS_BYTES = 8 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 15


def fetch_ics(url: str) -> bytes:
    """Download a calendar over http(s).

    Webcal subscriptions are handed out as `webcal://`, which is https in a
    trench coat, so it is rewritten rather than rejected. Any other scheme is
    refused outright: `file://` would read the container's own disk, and this
    URL arrives from a form field.
    """
    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://") :]
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("the calendar URL must start with http:// or https://")

    request = urllib.request.Request(url, headers={"User-Agent": "tprint"})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        data = response.read(MAX_ICS_BYTES + 1)
    if len(data) > MAX_ICS_BYTES:
        raise ValueError("that calendar is too large to print from")
    return data


WINDOWS = ("all", "today", "this_week", "this_weekend", "next_week", "next_weekend")


def window_range(window: str | None, today: date | None = None) -> tuple[date, date] | None:
    """The days a window covers, or None for "the whole calendar".

    Named windows are resolved against *today*, not against when the job was
    created — that is what makes "next weekend" mean the coming one on every
    run of a repeating print. Weeks start on Monday, matching
    `agenda.period_start` and the scheduler's weekday numbering.

    A window can also be a plain number of days ("7"), which is the custom
    case: today through today + N.
    """
    if window is None or window in ("", "all"):
        return None

    today = today or date.today()
    monday = today - timedelta(days=today.weekday())

    if window == "today":
        return today, today
    if window == "this_week":
        # The *rest* of this week: printing Wednesday's list shouldn't lead
        # with Monday and Tuesday, which have already happened.
        return today, monday + timedelta(days=6)
    if window == "this_weekend":
        return monday + timedelta(days=5), monday + timedelta(days=6)
    if window == "next_week":
        return monday + timedelta(days=7), monday + timedelta(days=13)
    if window == "next_weekend":
        return monday + timedelta(days=12), monday + timedelta(days=13)

    try:
        days = max(0, int(window))
    except (TypeError, ValueError):
        return None
    return today, today + timedelta(days=days)


def within_window(events: list[dict], window: str | None) -> list[dict]:
    """Events falling inside a window, evaluated at the moment this runs."""
    span = window_range(window)
    if span is None:
        return events

    from app import agenda

    first, last = span
    kept = []
    for event in events:
        day = agenda.event_date(event)
        # An event with no usable date can't be placed in a window; it is
        # dropped rather than printed by accident on every run.
        if day is not None and first <= day <= last:
            kept.append(event)
    return kept


def within_days(events: list[dict], days_ahead: int | None) -> list[dict]:
    """The numeric form of `within_window`, kept for payloads that predate it."""
    return within_window(events, None if days_ahead is None else str(days_ahead))


def select_events(events: list[dict], select: list[int] | None) -> list[dict]:
    """Keep only the chosen events, by their index in the parsed list.

    `None` means all of them, so every caller that predates event selection is
    unaffected. Out-of-range indices are ignored rather than raising: the
    selection was made against one parse of a file, and the job that prints it
    re-parses; a calendar edited in between should print what still matches
    instead of failing outright.
    """
    if select is None:
        return events
    return [events[index] for index in select if 0 <= index < len(events)]


def _format_when(start, end) -> str | None:
    if start is None:
        return None
    if isinstance(start, datetime):
        start_str = start.strftime("%Y-%m-%d %H:%M")
        if isinstance(end, datetime):
            if end.date() == start.date():
                return f"{start_str} - {end.strftime('%H:%M')}"
            return f"{start_str} - {end.strftime('%Y-%m-%d %H:%M')}"
        return start_str
    if isinstance(start, date):
        return start.strftime("%Y-%m-%d")
    return None
