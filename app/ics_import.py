from datetime import date, datetime

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
