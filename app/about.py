"""What the Settings > About panel shows.

The licence list is not decoration. tprint links PyMuPDF, which is AGPL-3.0,
so the project as a whole is AGPL-3.0-or-later and §5 of that licence requires
the notice to travel with the program — this module is where that obligation
is met in the running app, alongside the LICENSE file in the repository root.
Keep it in step with requirements.txt and frontend/package.json.
"""

LICENSE = "AGPL-3.0-or-later"
LICENSE_NAME = "GNU Affero General Public License v3.0 or later"
LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html"
SOURCE_URL = "https://github.com/toineenzo/tprint"

# Why AGPL rather than MIT, recorded where the next person will look for it.
LICENSE_NOTE = (
    "tprint renders PDFs with PyMuPDF, which is licensed AGPL-3.0. Linking it "
    "means the combined work must also be AGPL-3.0, so a permissive licence "
    "such as MIT is not available while that dependency is in use."
)

# Runtime dependencies a user would recognise. Build-only tooling (Vite,
# TypeScript) is deliberately left out — it isn't in the shipped image.
LIBRARIES = [
    {"name": "FastAPI", "license": "MIT", "role": "web framework"},
    {"name": "Uvicorn", "license": "BSD-3-Clause", "role": "ASGI server"},
    {"name": "Starlette", "license": "BSD-3-Clause", "role": "ASGI toolkit"},
    {"name": "Pydantic", "license": "MIT", "role": "request validation"},
    {"name": "python-escpos", "license": "MIT", "role": "ESC/POS printer driver"},
    {"name": "Pillow", "license": "MIT-CMU", "role": "image handling"},
    {"name": "PyMuPDF", "license": "AGPL-3.0", "role": "PDF rendering"},
    {"name": "icalendar", "license": "BSD-2-Clause", "role": ".ics calendar parsing"},
    {"name": "Jinja2", "license": "BSD-3-Clause", "role": "page shell templating"},
    {"name": "React", "license": "MIT", "role": "user interface"},
    {"name": "Mantine", "license": "MIT", "role": "UI components"},
    {"name": "Tabler Icons", "license": "MIT", "role": "icon set"},
    {"name": "Day.js", "license": "MIT", "role": "date handling"},
]


def payload() -> dict:
    return {
        "license": LICENSE,
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
        "license_note": LICENSE_NOTE,
        "source_url": SOURCE_URL,
        "libraries": LIBRARIES,
    }
