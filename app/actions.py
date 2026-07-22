from PIL import Image

from app import content, history, ics_import, printer, richtext
from app import snippets as snippets_store


def print_text(text: str) -> None:
    printer.print_text(text)
    history.add_entry("text", preview_text=text)


def print_image(image: Image.Image) -> None:
    printer.print_image(image)
    history.add_entry("image", preview_image=image)


def print_pdf(pdf_bytes: bytes) -> None:
    images = printer.print_pdf(pdf_bytes)
    history.add_entry("pdf", preview_image=images[0] if images else None)


def print_code(data: str, code_format: str, symbology: str) -> None:
    printer.print_code(data, code_format, symbology)
    history.add_entry("code", preview_text=f"{code_format}: {data}")


def print_richtext(blocks: list[dict]) -> None:
    printer.print_richtext(blocks)
    history.add_entry("richtext", preview_text=richtext.plain_text(blocks))


def print_composition(parts: list[dict], images: dict) -> None:
    printer.print_composition(parts, images)
    summary = " / ".join(
        richtext.plain_text(part.get("blocks") or []) if part.get("type") == "text"
        else part.get("type", "?")
        for part in parts
    )
    history.add_entry("composition", preview_text=summary[:300])


def print_random(
    kind: str | None,
    lang: str,
    text: str | None = None,
    category: str | None = None,
) -> None:
    """Print a surprise. `text` is the already-drawn item from a preview — the
    user approved *that* one, so re-rolling here would print something else."""
    text = text or content.random_surprise(kind, lang, category)
    printer.print_text(text)
    history.add_entry("random", preview_text=text)


def _checklist_preview(title: str | None, items: list[dict]) -> str:
    lines = [title] if title else []
    lines += [f"- {item['text']}" for item in items[:5]]
    if len(items) > 5:
        lines.append(f"… +{len(items) - 5} more")
    return "\n".join(lines)


def print_checklist(title: str | None, items: list[dict], mode: str, lang: str) -> None:
    printer.print_checklist(title, items, mode, lang)
    history.add_entry("checklist", preview_text=_checklist_preview(title, items))


def _ics_preview(events: list[dict], mode: str) -> str:
    lines = [f"{len(events)} event(s), {mode}"]
    lines += [f"- {e['summary']}" for e in events[:5]]
    if len(events) > 5:
        lines.append(f"… +{len(events) - 5} more")
    return "\n".join(lines)


def print_ics(
    events: list[dict],
    mode: str,
    overview: str = "none",
    orientation: str = "vertical",
) -> None:
    printer.print_ics_events(events, mode, overview, orientation)
    history.add_entry("ics", preview_text=_ics_preview(events, mode))


def print_snippet(snippet_id: int, lang: str = "en") -> None:
    snippet = snippets_store.get_snippet(snippet_id)
    if not snippet:
        raise ValueError("snippet not found")

    if snippet["kind"] == "composition":
        payload = snippet["payload"] or {}
        paths = [snippets_store.file_path(name) for name in snippet["files"]]
        images = {index: Image.open(path) for index, path in enumerate(paths)}
        parts = payload.get("parts") or []
        printer.print_composition(parts, images)
        history.add_entry(
            "snippet",
            preview_text=snippet["name"],
            preview_image=images.get(0) if images else None,
        )
        return

    if snippet["kind"] == "checklist":
        payload = snippet["payload"] or {}
        printer.print_checklist(
            payload.get("title"), payload.get("items") or [], payload.get("mode", "single"), lang
        )
        history.add_entry("snippet", preview_text=snippet["name"])
        return

    if snippet["kind"] == "ics":
        payload = snippet["payload"] or {}
        with open(snippets_store.file_path(snippet["files"][0]), "rb") as f:
            events = ics_import.parse_ics(f.read())
        printer.print_ics_events(
            events,
            payload.get("mode", "single"),
            payload.get("overview", "none"),
            payload.get("orientation", "vertical"),
        )
        history.add_entry("snippet", preview_text=snippet["name"])
        return

    if snippet["kind"] == "text":
        printer.print_text(snippet["text_content"])
        history.add_entry("snippet", preview_text=f"{snippet['name']}\n{snippet['text_content']}")
    elif snippet["kind"] == "image":
        images = [Image.open(snippets_store.file_path(fn)) for fn in snippet["files"]]
        printer.print_images(images)
        history.add_entry(
            "snippet", preview_text=snippet["name"], preview_image=images[0] if images else None
        )
    elif snippet["kind"] == "pdf":
        with open(snippets_store.file_path(snippet["files"][0]), "rb") as f:
            pdf_bytes = f.read()
        pages = printer.print_pdf(pdf_bytes)
        history.add_entry(
            "snippet",
            preview_text=snippet["name"],
            preview_image=pages[0] if pages else None,
        )
    else:
        raise ValueError(f"unknown snippet kind: {snippet['kind']}")
