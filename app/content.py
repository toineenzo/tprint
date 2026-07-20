import json
import random
from pathlib import Path

from app import i18n

CONTENT_DIR = Path(__file__).parent / "content"

_CACHE: dict = {}


def _load(name: str, lang: str):
    filename = f"{name}_{lang}" if lang != "en" else name
    if filename not in _CACHE:
        path = CONTENT_DIR / f"{filename}.json"
        if not path.exists():
            path = CONTENT_DIR / f"{name}.json"
        with open(path, encoding="utf-8") as f:
            _CACHE[filename] = json.load(f)
    return _CACHE[filename]


def random_surprise(kind: str | None = None, lang: str = "en") -> str:
    lang = i18n.resolve_lang(lang)
    strings = i18n.t(lang)
    kind = kind or random.choice(["joke", "recipe", "fortune"])

    if kind == "joke":
        joke = random.choice(_load("jokes", lang))
        header = strings["joke_header"]
        return f"{header}\n{'-' * len(header)}\n{joke}\n"

    if kind == "fortune":
        fortune = random.choice(_load("fortunes", lang))
        header = strings["fortune_header"]
        return f"{header}\n{'-' * len(header)}\n{fortune}\n"

    if kind == "recipe":
        recipe = random.choice(_load("recipes", lang))
        lines = [recipe["title"], "-" * len(recipe["title"]), "", strings["ingredients_label"]]
        lines += [f"- {i}" for i in recipe["ingredients"]]
        lines += ["", strings["steps_label"]]
        lines += [f"{idx}. {step}" for idx, step in enumerate(recipe["steps"], start=1)]
        return "\n".join(lines) + "\n"

    raise ValueError(f"unknown surprise kind: {kind}")
