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


def within_days(events: list[dict], days_ahead: int | None) -> list[dict]:
    """Events from today up to `days_ahead` days from now.

    A *relative* window, evaluated when the job runs rather than when it was
    created — which is the whole point for a recurring print: "every Monday,
    the week ahead" has to mean the week that is ahead *then*. None means no
    window at all, i.e. the whole calendar.
    """
    if days_ahead is None:
        return events

    from app import agenda

    today = date.today()
    last = today + timedelta(days=max(0, days_ahead))
    kept = []
    for event in events:
        day = agenda.event_date(event)
        # An event with no usable date can't be placed in a window; it is
        # dropped rather than printed by accident on every run.
        if day is not None and today <= day <= last:
            kept.append(event)
    return kept


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
