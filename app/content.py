"""Surprise-me content: jokes, recipes and fortunes.

These used to be read straight from `app/content/*.json`. They now live in
SQLite so they can be edited from Settings — those JSON files are baked into
the Docker image and only `/data` is a volume, so anything written back to
them would be erased by the next `docker compose pull`. The files remain as
read-only seed data: they populate the database once per (kind, language) and
are never written to.

Deliberately no network calls. Surveying the free joke/recipe/fortune APIs
found that none serve Dutch, several had already shut down, and recipe APIs
return 15-30cm of thermal paper per item — bundled content is both more
reliable and better suited to the hardware. See README.
"""

import json
import random
from pathlib import Path

from app import db, i18n

CONTENT_DIR = Path(__file__).parent / "content"

KINDS = ("joke", "recipe", "fortune")

# Recipe categories the UI filters by. A recipe may have none, in which case it
# only ever turns up under "any".
CATEGORIES = ("breakfast", "lunch", "dinner", "dessert", "snack", "drink")

# The bundled file each kind seeds from. Plural because that's how they ship.
_SEED_FILES = {"joke": "jokes", "recipe": "recipes", "fortune": "fortunes"}

# Bump when the bundled JSON changes materially. Existing installs then import
# the new set, replacing only the untouched rows the previous seed created —
# user-added and user-edited entries are never discarded. v2 introduced
# categorized recipes (12 per language, two per category).
SEED_VERSION = 2


class NoContent(Exception):
    """Raised when a kind has no entries left in the requested language."""


def _seed_path(kind: str, lang: str) -> Path | None:
    stem = _SEED_FILES[kind]
    for candidate in (CONTENT_DIR / f"{stem}_{lang}.json", CONTENT_DIR / f"{stem}.json"):
        if candidate.exists():
            return candidate
    return None


def seed_defaults() -> None:
    """Import any (kind, language, seed version) that hasn't been imported yet.

    Runs on every startup but does work only once per triple, so upgrading an
    existing install imports its jokes/recipes/fortunes exactly once and never
    fights the user's own edits afterwards.

    When SEED_VERSION rises, the previous version's *untouched* rows are
    removed first and replaced by the new set. "Untouched" means `seeded = 1`,
    which `update_item` clears on the first edit — so a revised bundled set can
    ship without deleting anything the user wrote or changed.

    Note this is a flag and not a timestamp comparison: SQLite's `datetime`
    has one-second resolution, so an edit made in the same second as the
    import would leave `updated_at == created_at` and look untouched.
    """
    with db.get_conn() as conn:
        done = {row["key"] for row in conn.execute("SELECT key FROM content_seeds")}
        for kind in KINDS:
            for lang in i18n.LANGUAGES:
                key = f"{kind}:{lang}:v{SEED_VERSION}"
                if key in done:
                    continue
                path = _seed_path(kind, lang)
                if path is None:
                    continue
                with open(path, encoding="utf-8") as f:
                    entries = json.load(f)

                conn.execute(
                    "DELETE FROM content_items WHERE kind = ? AND lang = ? AND seeded = 1",
                    (kind, lang),
                )
                conn.executemany(
                    "INSERT INTO content_items (kind, lang, position, data, seeded)"
                    " VALUES (?, ?, ?, ?, 1)",
                    [
                        (kind, lang, index, json.dumps(entry, ensure_ascii=False))
                        for index, entry in enumerate(entries)
                    ],
                )
                conn.execute("INSERT INTO content_seeds (key) VALUES (?)", (key,))


def _row_to_item(row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "lang": row["lang"],
        "position": row["position"],
        "value": json.loads(row["data"]),
    }


def list_items(kind: str | None = None, lang: str | None = None) -> list[dict]:
    clauses, params = [], []
    if kind:
        clauses.append("kind = ?")
        params.append(kind)
    if lang:
        clauses.append("lang = ?")
        params.append(lang)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with db.get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM content_items {where} ORDER BY kind, lang, position, id",
            params,
        ).fetchall()
        return [_row_to_item(row) for row in rows]


def get_item(item_id: int) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM content_items WHERE id = ?", (item_id,)
        ).fetchone()
        return _row_to_item(row) if row else None


def create_item(kind: str, lang: str, value) -> int:
    with db.get_conn() as conn:
        position = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM content_items"
            " WHERE kind = ? AND lang = ?",
            (kind, lang),
        ).fetchone()["next"]
        cur = conn.execute(
            "INSERT INTO content_items (kind, lang, position, data) VALUES (?, ?, ?, ?)",
            (kind, lang, position, json.dumps(value, ensure_ascii=False)),
        )
        return cur.lastrowid


def update_item(item_id: int, value) -> bool:
    """Edit an entry, and mark it as no longer a pristine bundled row.

    Clearing `seeded` is what protects the edit from a future SEED_VERSION
    bump: `seed_defaults` only replaces rows still flagged as seeded.
    """
    with db.get_conn() as conn:
        cur = conn.execute(
            "UPDATE content_items SET data = ?, seeded = 0, updated_at = datetime('now')"
            " WHERE id = ?",
            (json.dumps(value, ensure_ascii=False), item_id),
        )
        return cur.rowcount > 0


def delete_item(item_id: int) -> bool:
    with db.get_conn() as conn:
        cur = conn.execute("DELETE FROM content_items WHERE id = ?", (item_id,))
        return cur.rowcount > 0


def counts() -> dict:
    """How many entries exist per kind and language, for the settings UI."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT kind, lang, COUNT(*) AS total FROM content_items GROUP BY kind, lang"
        ).fetchall()
        return {f"{row['kind']}:{row['lang']}": row["total"] for row in rows}


def _random_value(kind: str, lang: str, category: str | None = None):
    """One random entry, falling back to English before giving up.

    The fallback matters because a user can delete every Dutch fortune from
    the UI; printing an English one beats a 500.

    `category` filters on a field inside the stored JSON. It's matched with
    json_extract rather than in Python so the database still does the random
    pick — otherwise every recipe would be loaded just to discard most of them.
    """
    clause = ""
    extra: tuple = ()
    if category:
        clause = " AND json_extract(data, '$.category') = ?"
        extra = (category,)

    with db.get_conn() as conn:
        for candidate in (lang, i18n.DEFAULT_LANGUAGE, "en"):
            row = conn.execute(
                f"SELECT data FROM content_items WHERE kind = ? AND lang = ?{clause}"
                " ORDER BY RANDOM() LIMIT 1",
                (kind, candidate, *extra),
            ).fetchone()
            if row:
                return json.loads(row["data"])
    suffix = f" in category {category!r}" if category else ""
    raise NoContent(f"no {kind} content available{suffix}")


def _titled(body: str, header: str) -> str:
    return f"{header}\n{'-' * len(header)}\n{body}\n"


def random_surprise(
    kind: str | None = None, lang: str = "en", category: str | None = None
) -> str:
    lang = i18n.resolve_lang(lang)
    strings = i18n.t(lang)
    kind = kind or random.choice(list(KINDS))

    if kind == "joke":
        return _titled(_random_value("joke", lang), strings["joke_header"])

    if kind == "fortune":
        return _titled(_random_value("fortune", lang), strings["fortune_header"])

    if kind == "recipe":
        # Only recipes take a category; asking for one elsewhere is ignored
        # rather than erroring, since "random" may land on any kind.
        recipe = _random_value("recipe", lang, category)
        lines = [recipe["title"], "-" * len(recipe["title"]), "", strings["ingredients_label"]]
        lines += [f"- {i}" for i in recipe["ingredients"]]
        lines += ["", strings["steps_label"]]
        lines += [f"{idx}. {step}" for idx, step in enumerate(recipe["steps"], start=1)]
        return "\n".join(lines) + "\n"

    raise ValueError(f"unknown surprise kind: {kind}")
