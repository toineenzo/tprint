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
  settings.py                   Printer "settings" (frame, paper, behaviour, retention) — app-level only, see printer.py docstring
  preview.py                     Recorder + PNG/PDF renderer — previews reuse the real print path
  export.py                       Snippet -> the receipts it prints -> a PDF (one page each)
  codes.py                        QR / barcode -> PIL image (not escpos's native qr/barcode)
  richtext.py                      Styled lines -> PIL image (ESC/POS has no italic or grey)
  about.py                        Licence + library list shown in Settings > About
  snippets.py                    Snippet CRUD (text/image/pdf/checklist/ics, multi-file)
  files.py                        Upload filename/extension handling shared by every upload path
  content.py                       Surprise-me CRUD + formatter, DB-backed, language-aware
  content/*.json                    Read-only SEED data for content.py — not the live source
  i18n.py                            Translation strings + language list
  ics_import.py                       .ics calendar parsing (read-only: agenda.py composes, this only parses)
  agenda.py                            Day grouping, overview grid, landscape day receipts
  templating.py                        Jinja2Templates instance + global template vars (build_date, asset_version)
  routers/                              One file per resource: pages, print, snippets, settings, history, queue
  templates/shell.html                   The one page template: mounts React + injects window.__TPRINT__
  static/dist/                            Vite build output (gitignored — built by the Dockerfile's frontend stage)

frontend/                 React + Mantine UI. See frontend/README.md for UI conventions.
  src/theme.ts              The only file that names a colour — semantic roles live here
  src/flight.ts             The print/queue "it went over there" animation (no React context)
  src/constants/            contentTypes.ts: kind -> icon + colour + label, used by history/queue/snippets
  src/components/ui/        Shared primitives (Buttons, IconActionButton, SectionCard, TypeBadge, PromptModals, …)
  src/components/settings/  SettingsModal + SettingsForm — the printer settings, as a modal
  src/components/queue/     QueueCard (manual) + ScheduledCard (own trigger) + shared jobDisplay
  src/components/print/imageEditor/  the composer: compose.ts (model + draw) + ImageEditor.tsx (tools)
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

**Surprise-me content lives in the database; `content/*.json` is seed data.**
`app/content/*.json` is baked into the image by `COPY app ./app`, and only
`/data` is a volume — so anything written back to those files is destroyed by
the next `docker compose pull`, which with `pull_policy: always` is every
redeploy. `content.seed_defaults()` therefore imports each `(kind, language)`
into `content_items` **once**, tracked in `content_seeds`. Consequences:

- Editing a bundled JSON file changes what *new* installs get, not existing
  ones. To change live content, use Settings or the `/api/content` endpoints.
- Deleting every joke does not resurrect the shipped ones on restart — the
  seed marker is per `(kind, lang)` and survives an empty table. A language
  added later still gets seeded, because its marker doesn't exist yet.
- `reset_all()` drops both tables, so a reset re-seeds rather than leaving the
  app with no surprise content at all.

**No live content APIs, deliberately.** A 2026 survey (`docs/`) found that no
free joke/recipe/fortune API serves Dutch, that several well-known ones had
already shut down (`quotable.io`'s domain no longer resolves), that recipe APIs
return 15–30cm of thermal paper per item, and that Spoonacular's terms forbid
caching beyond an hour — which rules out offline use outright. Bundled content
is both more reliable and better suited to the hardware. If you want more
variety, import a dataset once rather than adding a runtime dependency.

**The print animation flies from the last pointerdown, not from `activeElement`.**
`flight.ts` animates a ghost from the control you pressed to the panel the item
landed in — history for a print, the queue card for a queued job, chosen from
the server's own response so it can't disagree with where the item actually
went. It hooks into `usePrint`, the single choke point, so every print button
in the app animates with no per-component wiring.

The origin is captured on a global `pointerdown` **because reading
`document.activeElement` when the flight starts is wrong**: a print is async,
`useSubmit` disables the button while it runs, and a disabled button drops
focus to `<body>` — so every flight launched from the centre of the page, which
is exactly the connection the animation exists to draw. That was measured, not
theorised: ghosts were appearing at the body's centre point.

Reduced motion is honoured in JS *and* CSS, and degrades rather than
disappearing: no ghost is created at all, and the destination gets a
shadow-only pulse instead. Nothing there moves or scales, which is the part
that causes vestibular trouble. The ghost is cleaned up by both the animation's
`finished` promise and a timeout — it is decoration appended to `<body>`, and
must never outlive its animation or be able to break a print.

**Agenda composition reads dates back out of `when`, on purpose.**
`ics_import.parse_ics` formats a date into the `when` string and then deletes
its sort key, so its output carries no machine-readable date. Rather than widen
the parser, `agenda.event_date()` recovers the day from that string — parsing
stays the one thing that reads a calendar file, and every layout decision
stays in the composition layer. `when` is produced by `_format_when`, so its
`YYYY-MM-DD` prefix is a contract between those two functions: if you ever
change that format, `agenda.py` is what breaks.

**The agenda overview grid is text, not a bitmap.** A month is four columns per
day = 28 characters, which fits 58mm paper (32 columns) as well as 80mm (48).
Text keeps it crisp, costs almost nothing to send, and previews for free
because `Recorder` already handles text. The dot marker is ASCII `*` because
the printer's default code page isn't guaranteed to carry a bullet.

**Landscape day receipts rotate a pre-sized canvas, they don't scale one.**
`agenda.render_day_landscape` lays the day out into an image whose *height* is
the paper width and whose width grows with the content, then turns it a quarter
turn — so the result is exactly paper-width and never resampled. Rendering
first and scaling afterwards is what would make it soft. Content taller than
the paper width is clipped rather than shrunk; the upright mode is the answer
for a day with dozens of events.

**The composer is one canvas for every content type.** `ItemSource` is a union
— image, PDF page, text blocks, QR/barcode — and *every* source resolves to a
bitmap before it reaches the page. That is why growing the image editor into a
multi-type composer needed no change at all to `layoutPage`, `drawPage`,
`hitTest`, crop, rotation or `exportPng`: they only ever knew about bitmaps.
Adding a source kind means adding a `resolve()` branch, nothing else.

Two sources are resolved *by the server* on purpose: a PDF page via
`/print/pdf-page` and a code via `/print/code-image`. That keeps pdf.js and a QR
library out of the frontend, and guarantees a composed code is byte-identical
to a standalone one.

**A composition prints one of two ways, and they are genuinely different.**
`EditorState.mode`:

- **`canvas`** flattens the page to a PNG and posts it to `/print/image`. Free
  positioning, exact WYSIWYG — but text is a bitmap.
- **`flow`** posts the items as ordered *parts* to `/print/composition`, where
  `printer.composition_content` emits text as real ESC/POS text. Sharper and far
  smaller, but positions are ignored: ESC/POS streams top-to-bottom and has no
  cursor to place them with.

Flow decides **per part**: `_text_needs_bitmap` falls back to `richtext.render`
for a block using italic or a tint, because the printer has neither. Nothing is
silently dropped, and plain text still takes the crisp path.

**Only flow mode needed a new print-job kind.** Canvas mode is an image print
like any other, which is why the "richer print job format" this feature could
have demanded stayed confined to `composition`.

**The image editor composes client-side; the backend sees a plain image.**
Scale/crop/rotate/draw/position/grid all happen on a canvas authored at
`settings.paper_width_px`, and `exportPng` hands the result to the unchanged
`POST /print/image`. There is no editor-specific print kind, no new queue kind
and no server-side transform pipeline — because the composition *is* the image
being printed, `/print/preview` already previews it correctly with the
header/footer frame.

Freehand drawing is why this can't be server-side: strokes would have to
round-trip per pointer move. Two things follow that are worth knowing:

- **Strokes belong to the page, not to an item.** They're drawn over the
  finished composition, so moving an item afterwards doesn't drag its
  annotation along. Simpler, and predictable.
- **Selection chrome is drawn after `drawPage` and never exported** —
  `exportPng` calls `drawPage` directly, so the marquee can't leak onto paper.

The **PDF tab is deliberately not the editor**: it stays a whole-document
printer. PDFs dropped *into* the editor are rasterized one page at a time by
`POST /print/pdf-page`, which reuses `printer.pdf_page_image` rather than
adding pdf.js to the frontend.

**QR codes, barcodes and styled text are images, not native commands.**
python-escpos offers `p.qr()` and `p.barcode()`, and `set()` covers bold,
underline and double width/height. All of that was rejected for two concrete
reasons:

- Native codes are drawn *by the printer*, so `preview.Recorder` has nothing to
  record and the preview comes out blank. Rendering to a PIL image sends them
  through the same `p.image()` path as a photo, so previews work for free.
- ESC/POS has **no italic and no per-run grey**. Tint is only possible as
  dithering, which is what happens when a greyscale image is converted to
  1-bit — so styled text has to be a bitmap to support what the UI offers.

`codes.py` and `richtext.py` therefore both return PIL images, and
`printer.code_content` / `printer.richtext_content` hand them to the existing
`images_content`. Neither needed a new dependency: `qrcode` and
`python-barcode` ship as python-escpos dependencies already.

**Plain text stays on the native path.** `TextTab`'s formatting switch sends
`/print/text` when nothing is styled and `/print/richtext` only when it is —
and `isUnstyled()` means turning the switch on without changing anything still
takes the crisp native route. Don't "simplify" by routing all text through the
bitmap renderer: the printer's own font is sharper and the payload far smaller.

**Previews run the real print path, not a second renderer.** Every
`printer.print_*` builds its content by calling `.set()/.text()/.image()/.cut()`
on a python-escpos object, so `preview.Recorder` implements that same small
interface and captures the calls instead. `printer.frame_job()` — the framing
logic split out of `_print_job` — then wraps a Recorder exactly as it wraps a
real printer, and `preview.render()` draws the result to a PNG. A new content
type gets an accurate preview for free, and there is no second layout engine to
drift out of step. **If you add a content type, add a `*_content()` factory** in
`printer.py` rather than building content inline, so preview and print keep
sharing it. Anything a `content_fn` might call must exist on `Recorder`, or
previewing that type raises.

**Downloading a snippet as PDF is the preview renderer, not a new one.**
`GET /snippets/{id}/pdf` records the job through that same `Recorder` and saves
the rendered strip as a PDF page. It is deliberately a **raster, not selectable
text**: re-typesetting the recorded blocks into PDF text would be a *third*
layout engine to keep in step with the print path and the preview, and it still
couldn't use the printer's ROM font. Pages are embedded at `preview.DPI` (203,
the printers' actual dot density), so a page comes out the physical size of the
receipt — 576 dots is 72mm — instead of stretched to fill A4.

Two things follow from a receipt not being one page:

- **`export.snippet_jobs()` yields every receipt a snippet prints**, so a
  checklist in `separate` mode exports as one page per item and an agenda in
  `day` mode as one page per day. It's a generator because `printer.ics_jobs`
  is: a year of landscape days built eagerly is hundreds of megabytes of
  bitmaps held while the first one is still printing.
- **It is also what `/print/preview` uses for `kind=snippet`**, taking job
  `[0]`. That replaced a second kind-dispatch in `routers/print.py` which had
  already fallen a feature behind — it couldn't preview a composition at all
  and didn't know the agenda had overview or orientation options. If you add a
  snippet kind, teach `snippet_jobs` about it and both surfaces follow.

`printer.checklist_jobs()` / `ics_jobs()` exist for the same reason: the
mode-to-receipts split used to be spelled out inside `print_checklist` /
`print_ics_events`, where the exporter couldn't reach it. Those functions are
now loops over the job list, so there is one answer to "what does this print
as" — verified byte-identical at `_send` across 23 mode/overview/orientation
combinations when it was extracted.

**Paper width is a setting, and `PRINTER_WIDTH_PX` is now only its default.**
`settings.paper_width_px()` returns the stored value, falling back to the env
var when unset — so an install that never opens the setting keeps the width it
had. Everything that measures paper (`_fit_to_width`, the preview renderer)
reads it from there; don't reach for `config.PRINTER_WIDTH_PX` directly.

**The "delay after printing" setting is a minimum gap, not a trailing sleep.**
`_await_gap` holds a new job until `print_delay_seconds` have passed since the
last one finished. An isolated print therefore never waits, while a burst —
"Run queue now" firing five jobs — comes out spaced. It runs inside the print
lock so the wait can't be raced, and it slices its sleep so a cancel still
lands promptly.

**Printer "settings" are app-level formatting only, not real memory
switches.** `settings.py` / the settings modal control a header/footer "frame"
and default text style, applied in `printer.py`'s `_print_job`. This is
deliberately *not* wired to the printer's actual persistent memory switches
(paper width, auto-cutter behavior, etc.) — those use undocumented,
model-specific vendor ESC/POS commands that aren't safe to guess at without
the exact printer in hand to verify against. If asked to expose "real"
printer settings, push back on this distinction rather than guessing at
raw command bytes.

**The queue and the schedule are one table but two things.** `print_jobs`
holds both, split by `print_queue.is_scheduled()`:

- **Manual queue** — `run_at IS NULL AND recurrence IS NULL`. Sits until
  `POST /queue/run` is called explicitly.
- **Scheduled** — anything with a `run_at` or a `recurrence`. Runs on its own
  when due, checked by the background worker every `POLL_SECONDS`.

`run_manual_queue()` has always excluded scheduled jobs, but the UI used to
render both in one list under one button, which read as though "Run queue"
fired everything. The two are now separate cards (`components/queue/`), only
the manual one carries the Run button, and `list_jobs()` sends a computed
`scheduled` flag so the UI and that `WHERE` clause can't drift apart. **Don't
let the frontend re-derive that split** — it's one predicate, server-side.

**Recurrence is a rule, not an interval.** `recurrence` (`daily`/`weekly`/
`monthly`) pairs with `recurrence_days`: a JSON list of ISO weekdays 1-7 for
weekly, days of the month for monthly. "Every Wednesday" is `weekly` + `[3]`.
`_next_occurrence()` walks forward to the first matching slot rather than
adding a fixed delta. A monthly day the month doesn't have (the 31st in
February) is **skipped, not clamped** — printing on the 28th instead is a
worse answer than waiting.

`enqueue()` normalizes: a caller that omits `recurrence_days` (the API before
weekday rules existed) gets them derived from the anchor, because "+7 days"
already meant "the same weekday". So there is exactly one rule shape in the
database and no legacy branch in the worker. Keep it that way.

Scheduling uses naive local time throughout (the browser sends a naive local
string and the server compares against `datetime.now()`) — there's no timezone
conversion, so this only behaves correctly when the server's `TZ` matches the
user's expectation (it's a `docker-compose.yml` env var for exactly this
reason). Note the inconsistency to watch for: `run_at` is naive *local*, while
`created_at`/`last_run_at` come from SQLite's `datetime('now')` and are *UTC*.
Countdowns must only ever be computed from `run_at`.

**That naive-local contract is a trap on the frontend, in both directions.**
The date picker holds a JS `Date`, and `toISOString()` would serialize it as
UTC — silently shifting every scheduled job by the server's UTC offset.
`frontend/src/dates.ts`'s `toNaiveDateTime()` is the only correct way to
serialize `run_at`, and `parseNaiveDateTime()` the only correct way to read one
back. Don't reach for `new Date(string)` there: it reads a date-only string as
UTC but a date-*time* string without an offset as local, so it silently shifts
by the UTC offset depending on the input's shape.

**Queue options are validated in one place: `app/schemas.py`.** The same five
options (`queue`, `run_at`, `recurrence`, `recurrence_time`, `recurrence_days`)
arrive as a JSON body, as multipart form fields, and as query params, so one
`QueueOptions` model validates all three via the `queue_options_form` /
`queue_options_query` dependencies. `recurrence_days` accepts a real list or
`"1,3,5"`, because form fields and query params can't express a list natively.

This matters beyond tidiness: an unvalidated `recurrence` used to reach
`_next_occurrence()`, match none of its branches, and return a time in the
*past* — leaving the job pending-and-due so the worker reprinted it every 15
seconds forever. The same trap is why `recurrence_days` is range-checked here:
a weekday of `9` would simply never match, and the job would sit pending
forever with nothing anywhere saying why. Keep new scheduling options in that
model rather than adding per-endpoint checks.

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

`content_items` + `content_seeds` are plain `CREATE TABLE IF NOT EXISTS`, but
their *population* is a migration of a sort: `content.seed_defaults()` imports
`app/content/*.json` once per `(kind, language)`. An install upgrading into
this scheme imports its current jokes/recipes/fortunes on first boot and never
again. Never seed by "is the table empty" — that would resurrect content a user
deliberately deleted.

`print_jobs` needed a third variant: a **purely additive column**
(`recurrence_days`). That's an `ALTER TABLE ADD COLUMN` guarded by
`PRAGMA table_info`, in `_migrate_print_jobs()` — no rebuild, since nothing
about the existing columns changed. It still can't be left to
`CREATE TABLE IF NOT EXISTS`, which is a no-op on an existing table and would
leave the column missing on every upgraded install. Its backfill derives each
recurring job's weekday/day-of-month from its own `run_at`, which is
behaviour-preserving by construction rather than a guess.

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
set. Those files are *seeds*: `content.seed_defaults()` imports them into the
database on the next startup, once, and existing installs pick the new language
up automatically. If a language has no file, `random_surprise` falls back to
the deployment default and then English — nothing crashes, but the surprise-me
button then serves English inside a non-English UI, which reads as a bug.
Don't rely on the fallback.

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
  `print_queue._execute()`, add a branch to the `/print/preview` dispatch, add
  the kind to
  `frontend/src/constants/contentTypes.ts` so history/queue render it with an
  icon, and add a tab in `frontend/src/components/print/`. To make it available
  *inside the composer* instead, add a variant to `ItemSource` and a branch to
  `FileTab`'s `resolve()` — the canvas needs nothing else. The tab passes
  `saveAsSnippet` state to `PrintActions` and saves inside its `usePrint`
  closure — if the new type should be snippet-able, it also needs a `kind`
  branch in `POST /snippets`, a store `create_*_snippet()`, a branch in
  `actions.print_snippet()`, and one in `export.snippet_jobs()` — the last of
  which buys both the PDF download and the snippet preview at once.
- **New setting**: add the column to the `settings` table in `db.py` **and to
  `_SETTINGS_COLUMNS`** so existing databases get it too (`CREATE TABLE IF NOT
  EXISTS` won't), read/write it in `settings.py` **and expose it in
  `public_settings()`**, add the field to
  `frontend/src/components/settings/SettingsForm.tsx` *and* to its `save()`
  body, and apply it in `printer.py`'s `frame_job`/`_print_job` if it affects
  output. Pick a default that leaves an existing deployment behaving exactly as
  it did before.
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
