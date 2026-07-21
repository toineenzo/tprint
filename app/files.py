"""Filename handling shared by every upload path.

Stored filenames are always `<uuid>.<ext>`, so the user-supplied name never
reaches the filesystem — only its extension does, and only after passing
through here. Deriving that extension with a bare `rsplit(".", 1)[-1]` returns
the *whole* name when there is no dot (and something containing a slash for a
name like `"a.b/../c"`), which is why it lives in one place instead of being
re-derived at each call site.
"""

import re

_SAFE_EXT = re.compile(r"^[a-z0-9]{1,8}$")


def _raw_extension(filename: str | None) -> str:
    name = filename or ""
    if "." not in name:
        return ""
    return name.rsplit(".", 1)[-1].strip().lower()


def allowed_extension(filename: str | None, allowed: tuple[str, ...]) -> str:
    """The file's extension if it's in `allowed`, else `allowed[0]`."""
    ext = _raw_extension(filename)
    return ext if ext in allowed else allowed[0]


def safe_extension(filename: str | None, default: str = "bin") -> str:
    """The file's extension when it's a plausible one, else `default`.

    Used where any type is acceptable (queued uploads), so there's no allowlist
    to check against — only a sanity check that it can't affect the path.
    """
    ext = _raw_extension(filename)
    return ext if _SAFE_EXT.match(ext) else default
