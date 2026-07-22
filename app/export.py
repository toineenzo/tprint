"""Turn a saved snippet into the receipts it would print, and into a PDF.

A snippet does not always print as one receipt: a checklist in "separate" mode
is one per item, an agenda in "day" mode one per day. So this module answers in
*jobs*, and the PDF gets a page per job — which is what makes an exported
checklist look like the stack of slips the printer would actually produce.

Both halves are deliberately parasitic on existing code. `snippet_jobs` builds
its content through the same `printer.*_content` factories the real print path
uses, and `snippet_pdf` renders them through `preview.Recorder`, which captures
that path rather than reinterpreting it. Nothing here knows what a receipt
looks like, so nothing here can disagree with the printer about it.
"""

import re
import unicodedata
from collections.abc import Iterator
from urllib.parse import quote

from PIL import Image

from app import ics_import, preview, printer
from app import snippets as snippets_store


def snippet_jobs(snippet: dict, lang: str = "en") -> Iterator[tuple[str, object]]:
    """Every receipt this snippet would print, in order, as (label, content_fn).

    A generator so the multi-receipt kinds stay lazy, matching what the printer
    does — `printer.ics_jobs` explains why that matters for landscape days.
    """
    kind = snippet["kind"]

    if kind == "text":
        yield snippet["name"], printer.text_content(snippet["text_content"] or "")

    elif kind == "image":
        images = [Image.open(snippets_store.file_path(fn)) for fn in snippet["files"]]
        yield snippet["name"], printer.images_content(images)

    elif kind == "pdf":
        with open(snippets_store.file_path(snippet["files"][0]), "rb") as f:
            pages = printer._render_pdf_pages(f.read())
        yield snippet["name"], printer.images_content(pages)

    elif kind == "checklist":
        payload = snippet["payload"] or {}
        yield from printer.checklist_jobs(
            payload.get("title"),
            payload.get("items") or [],
            payload.get("mode", "single"),
            lang,
        )

    elif kind == "ics":
        payload = snippet["payload"] or {}
        with open(snippets_store.file_path(snippet["files"][0]), "rb") as f:
            events = ics_import.parse_ics(f.read())
        yield from printer.ics_jobs(
            events,
            payload.get("mode", "single"),
            payload.get("overview", "none"),
            payload.get("orientation", "vertical"),
        )

    elif kind == "composition":
        payload = snippet["payload"] or {}
        images = {
            index: Image.open(snippets_store.file_path(name))
            for index, name in enumerate(snippet["files"])
        }
        yield snippet["name"], printer.composition_content(
            payload.get("parts") or [], images
        )

    else:
        raise ValueError(f"cannot render snippet kind {kind!r}")


def snippet_pdf(snippet: dict, lang: str = "en") -> bytes:
    """The snippet as a PDF facsimile of the paper it would produce."""
    pages = [
        # Uncapped: the preview panel truncates a very long receipt because it
        # has to fit a modal, but a downloaded file has no such excuse.
        preview.render_job(content_fn, max_height=None)
        for _, content_fn in snippet_jobs(snippet, lang)
    ]
    if not pages:
        raise ValueError("this snippet has nothing to print")
    return preview.to_pdf(pages)


_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def pdf_filename(name: str) -> str:
    """A snippet's name as a plain-ASCII filename.

    Names are free text and routinely contain quotes, slashes and newlines, all
    of which either break the header or the saved file. Accents are folded
    rather than replaced — "café" saving as `caf-.pdf` reads as corruption,
    where `cafe.pdf` reads as a filename.
    """
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = _UNSAFE.sub("-", folded).strip("-.")
    return f"{slug[:60] or 'snippet'}.pdf"


def content_disposition(name: str) -> str:
    """Both filename forms for the download header, as RFC 6266 defines them.

    The bare `filename` is ASCII-only, so it gets the folded version above;
    `filename*` carries the real name for anything that understands it, which
    is every browser this app will meet. A Dutch install naming a snippet
    "Boodschappen café" should get that back, accent intact.
    """
    utf8 = quote(f"{name.strip()[:60] or 'snippet'}.pdf", safe="")
    return f"attachment; filename=\"{pdf_filename(name)}\"; filename*=UTF-8''{utf8}"
