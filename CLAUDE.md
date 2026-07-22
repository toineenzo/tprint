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
  db.py                 SQLite schema + migrations + reset_all() — see "Database" below
  printer.py             ESC/POS byte building, the single physical-write choke point, cancellation
  actions.py               Shared "print this + log history" logic — instant AND queued paths both call these
  print_queue.py             Queue/schedule/recurrence + the background asyncio worker
  schemas.py                  Shared pydantic request models + queue-option validation (see below)
  history.py                   Print history persistence + thumbnail generation
  settings.py                   Printer "settings" (header/footer/logo/text style) — app-level only, see printer.py docstring
  snippets.py                    Snippet CRUD (text/image/pdf/checklist/ics, multi-file)
  files.py                        Upload filename/extension handling shared by every upload path
  content.py                       Surprise-me (joke/recipe/fortune) loader + formatter, language-aware
  content/*.json                    Per-language joke/fortune/recipe data (see i18n section below)
  i18n.py                            Translation strings + language list
  ics_import.py                       .ics calendar parsing
  templating.py                        Jinja2Templates instance + global template vars (build_date, asset_version)
  routers/                              One file per resource: pages, print, snippets, settings, history, queue
  templates/shell.html                   The one page template: mounts React + injects window.__TPRINT__
  static/dist/                            Vite build output (gitignored — built by the Dockerfile's frontend stage)

frontend/                 React + Mantine UI. See frontend/README.md for UI conventions.
  src/theme.ts              The only file that names a colour — semantic roles live here
  src/constants/            contentTypes.ts: kind -> icon + colour + label, used by history/queue/snippets
  src/components/ui/        Shared primitives (Buttons, IconActionButton, SectionCard, TypeBadge, PromptModals, …)
  src/components/settings/  SettingsModal + SettingsForm — the printer settings, as a modal
  src/pages/                IndexPage, LoginPage — picked by __TPRINT__.page
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

**A snippet is only ever created by printing something with "Save as snippet"
ticked.** There is no separate snippet-creation form and no separate save
button — both existed once and were removed. `PrintActions` renders the one
checkbox, each tab passes its own state, and the tab's `usePrint` closure calls
`useSaveAsSnippet` *before* the print request so the two produce a single
outcome toast instead of two that can disagree. Names are derived from the
content (first line / filename / list title) because the checkbox deliberately
asks for nothing else; renaming afterwards is what the edit modal is for.

**Checklist and agenda snippets store structure, not rendered text.** A
`checklist` snippet keeps `{title, items, mode}` in the `payload` column; an
`ics` snippet keeps the uploaded `.ics` file in `file_paths` and only `{mode}`
in `payload`, so printing re-parses the calendar. Both then reprint through the
*same* `printer.print_checklist` / `print_ics_events` as the original — verified
byte-identical at `_send`. Don't "simplify" either into a flattened text
snippet: that silently loses the bold centred title, the per-item due dates and
the single/separate receipt mode. These two kinds are structured data with no
coherent edit form, so `routers/snippets.py` makes them rename-only
(`snippets_store.STRUCTURED_KINDS`).

**Settings is a modal, and `/settings` is only kept alive for bookmarks.**
There is exactly one React page behind auth (`index`), so changing a header
never costs you the page you were printing from. `GET /settings` still exists
but renders the *index* shell with `open_settings: true`, which
`MainPageActions` uses as the modal's initial state — old bookmarks land on
settings instead of a 404 or a silent redirect. If you add another
settings-like surface, make it a modal too rather than reintroducing a second
`PageName`; the shell/bootstrap machinery assumes one authed page.

**Every confirmation goes through `ui/PromptModals.tsx`'s `ConfirmModal`.**
There are no `window.confirm`/`alert` calls anywhere and there should never be
one — the browser's own dialogs are OS chrome that ignore the app's theme
entirely. `ConfirmModal` takes `tone` (`danger`/`primary`) and `confirmIcon`
so a non-destructive confirmation (logout) reuses it rather than growing a
second component. Modals close on Escape by the `Modal` defaults in
`theme.ts`, which state `closeOnEscape` explicitly because it's a guarantee
the app makes rather than an incidental Mantine default.

**Printer "settings" are app-level formatting only, not real memory
switches.** `settings.py` / the settings modal control a header/footer "frame"
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
throughout (the browser sends a naive local string and the server compares
against `datetime.now()`) — there's no timezone conversion, so this only
behaves correctly when the server's `TZ` matches the user's expectation
(it's a `docker-compose.yml` env var for exactly this reason).

**That naive-local contract is a trap on the frontend.** The date picker holds
a JS `Date`, and `toISOString()` would serialize it as UTC — silently shifting
every scheduled job by the server's UTC offset. `frontend/src/dates.ts`'s
`toNaiveDateTime()` is the only correct way to serialize `run_at`; use it.

**Queue options are validated in one place: `app/schemas.py`.** The same four
options (`queue`, `run_at`, `recurrence`, `recurrence_time`) arrive as a JSON
body, as multipart form fields, and as query params, so one `QueueOptions`
model validates all three via the `queue_options_form` / `queue_options_query`
dependencies. This matters beyond tidiness: an unvalidated `recurrence` used to
reach `_next_occurrence()`, match none of its branches, and return a time in
the *past* — leaving the job pending-and-due so the worker reprinted it every
15 seconds forever. Keep new scheduling options in that model rather than
adding per-endpoint checks.

## Database & migrations

SQLite, one file (`DATA_DIR/tprint.db`). `db.py`'s `init_db()` runs on
every startup. Two different patterns are used, depending on whether a
change is additive or structural:

- **New table, or a column with a safe default:** plain
  `CREATE TABLE IF NOT EXISTS` / the schema is just re-run every startup.
  This is safe because it's idempotent and doesn't touch existing data.
- **Changing an existing table's shape:** SQLite can't `ALTER` a `CHECK`
  constraint or safely change column semantics in place, so `db.py`'s
  `_migrate_snippets()` detects the old shape via `PRAGMA table_info` (and, for
  the `CHECK` itself, the table's SQL in `sqlite_master`), then hands off to
  `_rebuild_snippets()`: rename the old table aside, create the new one, copy
  rows across with the transformation applied, drop the old one. Two structural
  changes have shipped through it so far — one `image_path` column becoming a
  JSON `file_paths` list, and the later addition of `payload` alongside a
  widened `kind` CHECK for the `checklist`/`ics` snippet kinds. Both hops still
  run, in order, on a DB old enough to need them.

  **If you need another structural change, follow this pattern** — and test it
  against a synthetic copy of *every* old shape with real-looking data before
  shipping, the way both of the above were. Note the trap the second one hit:
  the oldest table has no `updated_at` column at all, so a generic
  copy-these-columns loop `KeyError`s on it. Never assume
  `CREATE TABLE IF NOT EXISTS` is enough once a table already has a different
  shape in the wild.

`db.py` also has **`reset_all()`** — drops every user table, empties the
content directories and the settings logo, then re-runs `init_db()`. It's
exposed as `POST /api/settings/reset` behind the settings modal's "Danger zone"
confirmation. It drops tables rather than `DELETE`ing rows so `AUTOINCREMENT`
counters restart and the result is indistinguishable from a fresh volume. If
you add a directory the app writes user content into, add it to `_CONTENT_DIRS`
or its files will outlive a reset.

## i18n

The app ships **English and Dutch**. English is the in-code default;
`DEFAULT_LANGUAGE=nl` in the environment makes a deployment come up in Dutch
(that's how the maintainer's own instance is configured). Visitors switch
per-browser via a cookie, so the env var only sets the initial language.

**Adding a UI string** — all three, and they must stay in sync:

1. `STRINGS["en"]` **and** `STRINGS["nl"]` in `app/i18n.py`. There is no
   per-key fallback to English; a key missing from one language is a `KeyError`
   at render time.
2. The `StringKey` union in `frontend/src/i18n/strings.ts`, so the frontend can
   reference it. A typo there is a compile error rather than a blank label.

**Adding a language** — additionally add the code to `LANGUAGES`, a display
name to `NATIVE_NAMES` in that language's own script (`"Nederlands"`, not
`"Dutch"`), and `content/{jokes,fortunes,recipes}_<code>.json` (20 jokes, 20
fortunes, 8 recipes — recipes are `{title, ingredients, steps}` objects).
Write idiomatic content for that language rather than translating the English
set. `content.py`'s `_load()` falls back to the English file when one is
missing, so nothing crashes — but the surprise-me button then silently serves
English inside a non-English UI, which reads as a bug. Don't rely on the
fallback.

Verify parity after editing:

```sh
python3 -c "
from app import i18n
en = set(i18n.STRINGS['en'])
for lang in i18n.LANGUAGES:
    print(lang, 'missing:', (en - set(i18n.STRINGS[lang])) or 'none')
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

The UI is a separate build. In another shell:

```sh
cd frontend && npm install
npm run dev            # vite build --watch, writes app/static/dist
```

FastAPI serves the built bundle, so there's no dev server or proxy to
configure — the session cookie and the API stay same-origin. Restart uvicorn
to pick up a new bundle (the cache-busting `asset_version` is per-process
locally). `app/static/dist/` is gitignored; **the app will not render until
you've built it at least once.**

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

For frontend changes, `cd frontend && npm run build` type-checks before it
bundles, so a type error fails the build (and therefore the Docker image)
rather than shipping. Also load the page and confirm the browser console is
clean — a React render error shows up there, not in the Python log.

For anything touching `Dockerfile`, `requirements.txt`, or
`frontend/package.json`, verify the image actually builds and the container
actually starts (`docker build` + `docker run` + hit `/health` + load `/`)
before considering the change finished — a dependency or Dockerfile typo won't
show up in a local venv/`npm run dev` test, and the image now has two build
stages that can fail independently.

## Releasing

`.github/workflows/publish.yml` builds **linux/amd64 and linux/arm64** and
pushes `ghcr.io/toineenzo/tprint` on every push to `main`, tagged `latest` and
`sha-<short>`. `docker-compose.yml` pulls that image rather than building, so
deployment hosts (and anyone running this on a Pi) never compile anything.

Consequences worth knowing before changing any of it:

- **`pull_policy: always` is load-bearing.** `latest` is a moving tag; without
  it a host keeps running whatever it pulled first and a redeploy silently
  does nothing.
- **Each architecture builds on a runner of its own architecture**, pushes by
  digest, and a merge job assembles the multi-platform tag — so a tag never
  points at a single-arch image. Don't "simplify" this to one QEMU-emulated
  job: emulating the npm/Vite stage is roughly an order of magnitude slower.
- **Rollback is `TPRINT_TAG=sha-xxxxxxx`**, not a rebuild.
- The GHCR package must stay **public**, or every puller needs credentials.

Anything that changes what the image contains still needs the local
`docker build` + smoke test above — CI proves it builds, not that it works.

## Coding conventions

- No comments except where the *why* is genuinely non-obvious (see
  `printer.py` for examples — the banding fix and the cancellation model
  both have one because the reasoning isn't derivable from the code alone).
- Python 3.14 in the image (`python:3.14-slim`); 3.12+ syntax is the floor.
  `from __future__` not needed, modern type hints
  (`str | None`, `list[dict]`) used throughout.
- FastAPI routes are grouped one-file-per-resource under `routers/`. Auth
  is a `Depends(auth.require_api_auth)` on anything that returns data or
  performs an action — it raises a real 401. The
  `auth.web_page_authed(request)` + redirect pattern is **only** for HTML page
  routes (GET `/`, `/settings`, `/login` in `routers/pages.py`); using it on a
  data endpoint hands an XHR caller a 200 with a login page in the body.
- **`auth.require_session_auth` is the stricter variant**, and `POST
  /api/settings/reset` is currently its only user. It refuses `PRINT_API_TOKEN`
  on purpose: that token is handed to n8n/Home Assistant so they can print, and
  printing must not imply the ability to destroy data. Use it for any future
  action that is destructive and has no machine-caller use case — but keep its
  `AUTH_ENABLED=false` fallback in mind, since deployments gated at the
  reverse proxy have no session to present.
- Anything an HTTP response exposes goes through a "public" projection —
  `settings.public_settings()`, `history.list_recent_public()` — so internal
  on-disk paths and SQLite's 0/1 booleans stay out of the API.
- The frontend is React + Mantine built by Vite (`frontend/`). **Read
  `frontend/README.md` before touching the UI** — it defines the semantic
  colour roles, the shared button/icon primitives, the modal conventions, and
  the content-type map, which exist so new features stay visually consistent by
  construction.
- i18n strings are always looked up through `i18n.t(lang)` server-side and
  `useStrings()` client-side, never hardcoded — see the i18n section above
  before adding any user-facing string.

## How to extend (common tasks)

- **New "print this" content type** (like checklist/ics were added): add a
  `printer.print_X()` following the existing `_print_job(content_fn)`
  pattern, add `actions.print_X()` that calls it and logs history, add a
  route in `routers/print.py` (inherit `schemas.QueueOptions`, or depend on
  `queue_options_form`, if it should be queueable), handle the new `kind` in
  `print_queue._execute()`, add the kind to
  `frontend/src/constants/contentTypes.ts` so history/queue render it with an
  icon, and add a tab in `frontend/src/components/print/`. The tab passes
  `saveAsSnippet` state to `PrintActions` and saves inside its `usePrint`
  closure — if the new type should be snippet-able, it also needs a `kind`
  branch in `POST /snippets`, a store `create_*_snippet()`, and a branch in
  `actions.print_snippet()`.
- **New setting**: add a column to the `settings` table in `db.py`
  (additive, no migration needed — it's a single-row table), read/write it
  in `settings.py` **and expose it in `public_settings()`**, add a field to
  `frontend/src/components/settings/SettingsForm.tsx`, apply it in
  `printer.py`'s `_print_job` if it affects output.
- **New confirmation prompt**: reuse `ConfirmModal` from
  `frontend/src/components/ui/PromptModals.tsx` — never `window.confirm`.
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
