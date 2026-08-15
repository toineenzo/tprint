"""The in-app help: the project wiki, fetched live, with the bundled copy as
a fallback.

Live because the wiki is where the documentation is maintained and a running
container can be months old; bundled because a printer on a network with no
outbound internet must still be able to open its own help. The fallback is the
same Markdown the wiki is generated from — `docs/wiki/` is what gets pushed to
it — so the two only differ by how recently they were edited.
"""

import urllib.error
import urllib.request
from pathlib import Path

WIKI_URL = "https://raw.githubusercontent.com/wiki/toineenzo/tprint"
WIKI_WEB_URL = "https://github.com/toineenzo/tprint/wiki"
DOCS_DIR = Path(__file__).parent.parent / "docs" / "wiki"

PAGES = (
    "Home",
    "Getting-Started",
    "API",
    "Automation",
    "Printing",
    "Settings",
    "Troubleshooting",
)

# Short: this is a modal opening, not a background job. If the wiki is slow or
# unreachable the bundled copy is right there.
_TIMEOUT_SECONDS = 4


def page(name: str) -> dict:
    """One help page as Markdown, plus where it came from."""
    if name not in PAGES:
        raise KeyError(name)

    try:
        with urllib.request.urlopen(f"{WIKI_URL}/{name}.md", timeout=_TIMEOUT_SECONDS) as response:
            return {
                "name": name,
                "source": "wiki",
                "markdown": response.read().decode("utf-8"),
            }
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return {"name": name, "source": "bundled", "markdown": _bundled(name)}


def _bundled(name: str) -> str:
    path = DOCS_DIR / f"{name}.md"
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return f"# {name}\n\nThis page is not available offline."
