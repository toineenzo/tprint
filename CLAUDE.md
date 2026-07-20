# CLAUDE.md

This file is the single source of truth for AI coding assistants working on
this project (Claude Code, ChatGPT/Codex, Cursor, and others — see the
bottom of this file for the alias files that point here). Human
contributors should read it too; the `README.md` is for *users* deploying
the app, this file is for anyone *changing* it.

## What this is

`tprint` is a self-hosted FastAPI app that drives an ESC/POS USB thermal
receipt printer (built against an Epson TM-T88V). It's a single Docker
container: FastAPI + SQLite + a background asyncio worker, no external
services required. See `README.md` for the user-facing feature list and
deployment instructions — this file covers how the code is put together and
why, so you can extend it without re-deriving decisions that were already
made (often the hard way, against real hardware).

## Architecture map

```
app/
  main.py            FastAPI app, lifespan (db.init_db + queue worker startup), routers
  config.py           Env vars, get_build_date()
  auth.py              Session-cookie auth (web pages) + bearer-token auth (API/machine callers)
  db.py                 SQLite schema + migrations — see "Database" below
  printer.py             ESC/POS byte building, the single physical-write choke point, cancellation
  actions.py               Shared "print this + log history" logic — instant AND queued paths both call these
  print_queue.py             Queue/schedule/recurrence + the background asyncio worker
  history.py                  Print history persistence + thumbnail generation
  settings.py                  Printer "settings" (header/footer/logo/text style) — app-level only, see printer.py docstring
  snippets.py                   Snippet CRUD (text/image/pdf, multi-file)
  content.py                     Surprise-me (joke/recipe/fortune) loader + formatter, language-aware
  content/*.json                  Per-language joke/fortune/recipe data (see i18n section below)
  i18n.py                          Translation strings + language list
  ics_import.py                     .ics calendar parsing
  templating.py                      Jinja2Templates instance + global template vars (build_date, all_languages, native_names)
  routers/                            One file per resource: pages, print, snippets, settings, history, queue
  templates/*.html                     base.html (shell + footer/lang-switch) extended by login/index/settings
  static/{app.js,style.css}             All client-side logic in one app.js — no build step, no framework
```

## Key design decisions (and why)

**One physical-write choke point.** Every `print_*` function in
`printer.py` funnels through `_print_job()` → `_send()`. This is
deliberate: it's where header/footer wrapping, the print lock, and
cancellation all live in one place. If you add a new thing that prints
something, call an existing `printer.print_*` function or add a new one
that follows the same `content_fn(p)` → `_print_job(content_fn)` pattern —
don't write directly to the device elsewhere.

**`actions.py` is the shared entry point for "print + remember it
happened."** Both instant prints (`routers/print.py`) and deferred ones
(`print_queue.py`'s worker) call the *same* `actions.print_*` functions, so
history logging and the actual printing can never drift apart between the
two code paths. When adding a new kind of printable thing, add one function
to `actions.py`, not two call sites.

**Print jobs are built via `escpos.printer.Dummy`, then sent as one
controlled write.** `python-escpos`'s own `File` backend opens the device
with Python's default ~8KB buffered I/O. On real hardware this produced
visible horizontal banding on printed images: the buffered writer split a
large image payload into several separate `write()` syscalls, each becoming
a distinct USB transfer with a small timing gap, and the printhead is
timing-sensitive enough that each gap became a blank line. The fix: build
the whole job's bytes via `Dummy()` (same command generation, just
captured), then write it ourselves via `_send()`'s own chunked loop. This
also happens to be what makes cancellation possible (see below) — don't
"simplify" this back to using `File` directly.

**Cancellation is a global flag, not per-job.** There is exactly one
physical printer, so exactly one job can ever be printing at a time.
`printer.py` has one `threading.Lock` (serializes writes) and one
`threading.Event` (checked between 32KB write chunks in `_send()`).
`POST /queue/cancel-current` sets the event; whatever's currently
mid-transfer — instant or queued — raises `PrintCancelled`. Don't build a
per-job cancellation token system; the hardware constraint makes the global
flag correct, not a shortcut.

**Printer "settings" are app-level formatting only, not real memory
switches.** `settings.py` / `/settings` control a header/footer "frame"
and default text style, applied in `printer.py`'s `_print_job`. This is
deliberately *not* wired to the printer's actual persistent memory switches
(paper width, auto-cutter behavior, etc.) — those use undocumented,
model-specific vendor ESC/POS commands that aren't safe to guess at without
the exact printer in hand to verify against. If asked to expose "real"
printer settings, push back on this distinction rather than guessing at
raw command bytes.

**Print queue: `run_at IS NULL` means "manual queue only."** A job with no
`run_at` sits until `POST /queue/run` is called explicitly. A job with
`run_at` set runs automatically once due (checked by the background worker
every `POLL_SECONDS`). Recurring jobs (`recurrence` set) reschedule
themselves to the next occurrence on success instead of completing — see
`print_queue._next_occurrence()`. Scheduling uses naive local time
throughout (both the browser's `datetime-local` input and the server's
`datetime.now()`) — there's no timezone conversion, so this only behaves
correctly when the server's `TZ` matches the user's expectation (it's a
`docker-compose.yml` env var for exactly this reason).

## Database & migrations

SQLite, one file (`DATA_DIR/tprint.db`). `db.py`'s `init_db()` runs on
every startup. Two different patterns are used, depending on whether a
change is additive or structural:

- **New table, or a column with a safe default:** plain
  `CREATE TABLE IF NOT EXISTS` / the schema is just re-run every startup.
  This is safe because it's idempotent and doesn't touch existing data.
- **Changing an existing table's shape** (the `snippets` table went from
  one `image_path` column to a JSON `file_paths` list, to support multiple
  images and PDFs): SQLite can't `ALTER` a `CHECK` constraint or safely
  change column semantics in place, so `db.py`'s `_migrate_snippets()`
  detects the old shape via `PRAGMA table_info`, renames the old table,
  creates the new one, copies rows across with the transformation applied,
  and drops the old table. **If you need another structural change,
  follow this pattern** — and test it against a synthetic copy of the old
  schema with real-looking data before shipping, the way `_migrate_snippets`
  was verified against a reconstructed copy of production data before it
  shipped. Never assume `CREATE TABLE IF NOT EXISTS` is enough once a table
  already has a different shape in the wild.

## i18n: adding a new language

Two things, both required, and they must stay in sync:

1. **`i18n.py`**: add the language code to `LANGUAGES`, a display name to
   `NATIVE_NAMES` (in that language's own script, e.g. `"中文"` not
   `"Chinese"`), and a full `STRINGS["<code>"]` dict — every key that
   exists in `STRINGS["en"]` must exist in the new dict. There's no
   fallback-to-English for individual missing keys.
2. **`content/{jokes,fortunes,recipes}_<code>.json`**: 20 jokes, 20
   fortunes, 8 recipes (recipes are `{title, ingredients, steps}` objects).
   Write natural, idiomatic content for that language — not a literal
   translation of the English set. `content.py`'s `_load()` falls back to
   the English file if a language-specific one is missing, so the app
   won't crash if you forget one, but the surprise-me button will silently
   serve English content in that language's UI, which reads as a bug to a
   user — don't rely on the fallback, always add the file.

Verify parity after editing (this exact check caught nothing wrong across
10 languages when last run, but it's the way to be sure):

```sh
python3 -c "
from app import i18n
en = set(i18n.STRINGS['en'])
for lang in i18n.LANGUAGES:
    missing = en - set(i18n.STRINGS[lang])
    print(lang, 'missing:', missing or 'none')
"
```

## Hardware gotchas (learned against real hardware, not guessed)

- **Shell escaping**: Debian's `/bin/sh` (`dash`) printf builtin does not
  support `\xHH` hex escapes — they get sent as literal text. Use octal
  (`\033`, `\035`) in any raw ESC/POS shell script (`scripts/test_printer.sh`
  had this bug; fixed).
- **Cutter feed distance**: the TM-T88V's auto-cutter is a fixed distance
  past the print head. Cutting with less than ~6 blank lines of feed cuts
  through text instead of clean margin. `python-escpos`'s own `cut()`
  defaults to `print_and_feed(6)` before cutting — match that if you ever
  bypass it.
- **USB device path**: the printer is accessed via the kernel `usblp`
  driver's device node (`/dev/usb/lp0` by default), not raw `pyusb`. This
  avoids libusb/udev permission complexity in containers. If a printer
  doesn't bind as a standard USB-printer-class device, this whole approach
  needs rethinking, not just a config tweak.

## Local development

```sh
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # PRINTER_BACKEND=dummy — no hardware needed
set -a; source .env; set +a
uvicorn app.main:app --reload
```

`PRINTER_BACKEND=dummy` makes `printer._send()` a no-op — everything else
(job building, history logging, the queue worker) still runs normally, so
this is sufficient for testing anything except actual physical print
timing/layout.

There is no automated test suite. Changes have been verified by running the
app locally (dummy backend) and exercising the relevant endpoints with
`curl`/small Python scripts — including, for anything touching the DB
schema, seeding a synthetic old-shape DB and confirming the app boots and
the data survives. Follow the same approach for new changes: there's
nothing to run, but there is a bar to clear before calling something done.

For anything touching `Dockerfile` or `requirements.txt`, verify the image
actually builds and the container actually starts (`docker build` +
`docker run` + hit `/health`) before considering the change finished — a
requirements or Dockerfile typo won't show up in a local venv test.

## Coding conventions

- No comments except where the *why* is genuinely non-obvious (see
  `printer.py` for examples — the banding fix and the cancellation model
  both have one because the reasoning isn't derivable from the code alone).
- Python 3.12+, `from __future__` not needed, modern type hints
  (`str | None`, `list[dict]`) used throughout.
- FastAPI routes are grouped one-file-per-resource under `routers/`. Auth
  is a `Depends(auth.require_api_auth)` (session or bearer token) on
  machine-callable endpoints, or a manual `auth.web_page_authed(request)`
  check + redirect on browser page routes (GET `/`, `/settings`).
- No JS framework, no build step — `app.js` is one file, vanilla DOM APIs.
  Keep it that way unless the app's complexity genuinely outgrows it.
- i18n strings are always looked up through `i18n.t(lang)`, never
  hardcoded in templates or Python — see the i18n section above before
  adding any new user-facing string.

## How to extend (common tasks)

- **New "print this" content type** (like checklist/ics were added): add a
  `printer.print_X()` following the existing `_print_job(content_fn)`
  pattern, add `actions.print_X()` that calls it and logs history, add a
  route in `routers/print.py` (reuse the `QueueOptions` base model if it
  should be queueable), add UI in `index.html` + `app.js`.
- **New setting**: add a column to the `settings` table in `db.py`
  (additive, no migration needed — it's a single-row table), read/write it
  in `settings.py`, add a form field in `templates/settings.html`, apply it
  in `printer.py`'s `_print_job` if it affects output.
- **New language**: see the i18n section above.

## Alias files for other AI assistants

This file (`CLAUDE.md`) is canonical. The following files exist only so
other tools pick up context automatically via their own conventions — they
all just point back here rather than duplicating content:

- `AGENTS.md` — Codex CLI / ChatGPT and other AGENTS.md-aware tools
- `.cursorrules` — Cursor
- `.github/copilot-instructions.md` — GitHub Copilot
- `.windsurfrules` — Windsurf
- `.clinerules` — Cline

If you're an assistant reading one of those files: go read this file in
full before making changes.
