import json
import random
from pathlib import Path

CONTENT_DIR = Path(__file__).parent / "content"

_CACHE: dict = {}


def _load(name: str):
    if name not in _CACHE:
        with open(CONTENT_DIR / f"{name}.json", encoding="utf-8") as f:
            _CACHE[name] = json.load(f)
    return _CACHE[name]


def random_surprise(kind: str | None = None) -> str:
    kind = kind or random.choice(["joke", "recipe", "fortune"])

    if kind == "joke":
        joke = random.choice(_load("jokes"))
        return f"JOKE OF THE MOMENT\n------------------\n{joke}\n"

    if kind == "fortune":
        fortune = random.choice(_load("fortunes"))
        return f"YOUR FORTUNE\n------------\n{fortune}\n"

    if kind == "recipe":
        recipe = random.choice(_load("recipes"))
        lines = [recipe["title"], "-" * len(recipe["title"]), "", "Ingredients:"]
        lines += [f"- {i}" for i in recipe["ingredients"]]
        lines += ["", "Steps:"]
        lines += [f"{idx}. {step}" for idx, step in enumerate(recipe["steps"], start=1)]
        return "\n".join(lines) + "\n"

    raise ValueError(f"unknown surprise kind: {kind}")
