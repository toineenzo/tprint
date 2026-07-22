# tprint

A self-hosted web app + REST API for driving an ESC/POS USB thermal receipt
printer. Upload a PDF, paste text, or drop in an image and print it from any
device on your network (or anywhere, behind your own auth); save reusable
snippets (a wifi password receipt for guests, a recurring note); print a
random joke, recipe, or fortune; build and print task/checklists (one receipt
or one per item); import an `.ics` calendar file and print an agenda (or one
receipt per event); and hit the same REST API from Home Assistant or n8n for
automations like a daily "today's agenda + weather" receipt.

Built for a hobby home-server setup, but the app itself has no dependency on
any particular platform beyond Docker (or a plain Python environment).

## Features

- **Print anything**: plain text, images, multi-page PDFs (rasterized page
  by page).
- **Snippets**: tick **"Save as snippet"** next to Print or Queue on any tab
  and whatever you just printed is kept for re-printing later — text, one-or-more
  images (printed in sequence on one receipt), a PDF, a checklist, or a
  calendar. Preview any snippet before printing, and edit it later (rename,
  change the text, add/remove images, or replace the PDF) without recreating
  it. Saved checklists and calendars keep their structure, so re-printing one
  reproduces the original receipt exactly — due dates, list title and the
  one-receipt/separate-receipts choice included.
- **Surprise me**: a bundled, curated list of jokes, recipes, and fortunes in
  English and Dutch — **editable from Settings**, and recipes can be filtered
  by category (breakfast, lunch, dinner, dessert, snack, drink; two of each
  ship in both languages). Add, edit and delete entries
  per language; your changes are stored with your data, so they survive app
  updates. Deliberately no external API: see **Why no content API** below.
- **Composer**: build one receipt out of several pieces — text blocks, images,
  PDF pages and QR/barcodes together on a single canvas, dragged into place.
  Two ways to print it: **Canvas** prints exactly as arranged (text becomes part
  of the image), **Flow** prints the items top to bottom using the printer's own
  crisp text. A composition can be saved as a reusable **template** and reopened
  later, not just reprinted.
- **Image editing**: uploads land on a receipt-width canvas you can arrange
  before printing — **scale**, **crop**, **rotate** in 90° steps, **draw** on
  freehand in black or two greys, and **position** items by hand. A **grid**
  mode arranges several at once with configurable items-per-row and spacing
  (one per row by default, so images simply stack). PDF pages can be dropped in
  alongside images — page 1 by default, with a page selector per item. What you
  see on the canvas is exactly what prints.
- **QR codes and barcodes**: paste a link, an ID or any text and print it as a
  scannable QR code, or as a barcode in one of eight symbologies (code128 by
  default, which accepts any text).
- **Formatted text**: an optional per-line formatting mode for text prints —
  bold, italic, underline, three heading sizes, alignment, and black / dark
  grey / light grey shading. Greys are dithered, since thermal printers are
  one-bit. Leave formatting off and text prints with the printer's own crisp
  font exactly as before.
- **Task/checklists**: build a list of items with optional due dates, print
  as one combined receipt or as separate torn-off receipts per item. **Paste a
  multi-line list and it splits into one task per line** (leading `-` or `*`
  bullets are stripped).
- **Calendar import**: upload an `.ics` file and print it as one agenda, as
  **one consolidated receipt per day**, or as separate receipts per event.
  Optionally print a **week or month overview grid** first, with a dot on every
  day that has an event, and the events listed underneath. Per-day receipts can
  print **upright or sideways** — turn a day's plan a quarter turn and pin it to
  the wall as part of a weekly set.
- **Queue and Scheduled, kept separate**: the **Queue** holds prints that wait
  for you to press "Run queue now". **Scheduled** holds prints that fire on
  their own — either once at a date and time, or on a repeating rule like
  *every Wednesday at 08:00* or *Mon/Wed/Fri at 07:30*. Running the queue never
  touches scheduled prints. The Scheduled list is ordered by what's coming up
  next and counts down to each one.
- **Cancel mid-print**: a big print already in progress can be canceled
  mid-transfer.
- **Visible feedback**: printing or queueing animates a small marker from the
  button you pressed into the panel the item landed in — the history sidebar
  for a print, the queue for a queued job — so the action feels connected
  rather than a list silently changing. Honours your system's reduced-motion
  setting: nothing flies, the destination just highlights.
- **Print history**: a sidebar showing what's been printed recently, with a
  timestamp and a text/image preview of each job — including ones fired by
  the queue/schedule while you weren't looking.
- **Printer settings**: a configurable header/footer "frame" (text and/or an
  image at the top *and* bottom, with a `{datetime}` placeholder) applied to
  every receipt, plus default text style, **paper size** (80mm/58mm/custom),
  auto-cut, and a live preview showing exactly what your settings produce — all
  from the gear icon instead of the printer's own paper self-test menu.
- **Confirm before printing** (optional): shows a rendered preview of the
  receipt and asks before anything is sent.
- **Retention**: cap how many history entries and finished queue jobs are kept,
  and/or drop them after a number of days. Waiting and scheduled prints are
  never removed.
- **Localization**: UI and surprise-me content available in English or Dutch,
  switchable per browser (cookie-based, no account needed). Set
  `DEFAULT_LANGUAGE` to pick which one new visitors get.
- **REST API**: every print action is an HTTP endpoint, usable from Home
  Assistant `rest_command`, n8n, curl, or anything else.
- **Optional auth**: a simple shared-password login for the web UI (skip it
  if you're gating access at the network/reverse-proxy layer instead), plus
  an independent bearer-token option for machine callers.

## Supported printers

Built and tested against an **Epson TM-T88V over USB**. It should work with
most Epson TM-series and other ESC/POS-compatible thermal receipt printers
that present as a standard USB printer-class device — i.e. Linux's `usblp`
kernel driver binds them (typically as `/dev/usb/lp0`). All the actual
ESC/POS command generation goes through
[python-escpos](https://github.com/python-escpos/python-escpos), which has
broad Epson/ESC-POS printer support — see its
[printer profiles](https://github.com/python-escpos/python-escpos/tree/master/src/escpos/capabilities.json)
for a sense of coverage.

Not currently wired up (the library supports it, this app doesn't expose it
yet): printers that only work over raw USB (no `usblp` binding, needs
`pyusb`), network/Ethernet-connected printers, or serial-connected printers.
If you need one of these, `app/printer.py` is a small, single-file place to
add another backend.

## How it talks to the printer

The printer connects over USB. Linux's `usblp` kernel driver binds it
automatically as a device node (commonly `/dev/usb/lp0`); the app writes raw
ESC/POS bytes directly to that device node. Only one container/VM can hold a
given USB device at a time — see **Deployment** below for passing it through
to wherever you run this app.

If your printer has (or can take) an Ethernet interface, network printing
would remove the USB-passthrough requirement entirely — not implemented yet,
see **Supported printers** above.

## Quickstart (Docker)

Prebuilt images are published to GHCR for **linux/amd64 and linux/arm64**, so
this runs on an x86 box, a Raspberry Pi, or an ARM server without building
anything. Docker picks the right architecture automatically.

```sh
git clone https://github.com/toineenzo/tprint.git
cd tprint
cp .env.example .env   # edit: at minimum set APP_PASSWORD, SESSION_SECRET, PRINT_API_TOKEN
docker compose up -d
```

The compose file pulls `ghcr.io/toineenzo/tprint:latest`. To build from source
instead, comment out the `image:`/`pull_policy:` lines in `docker-compose.yml`
and uncomment `build: .` — that needs Node and a few minutes, and is only
worth it if you're changing the code.

Don't want the repo at all? The image is public and self-contained:

```sh
docker run -d --name tprint \
  -p 8000:8000 \
  -e AUTH_ENABLED=false \
  -e PRINTER_BACKEND=dummy \
  -v tprint-data:/data \
  ghcr.io/toineenzo/tprint:latest
```

Swap in `-e PRINTER_BACKEND=file --device /dev/usb/lp0:/dev/usb/lp0` once a
printer is attached, and set `AUTH_ENABLED=true` with `APP_PASSWORD` and
`SESSION_SECRET` if it's reachable by anyone but you.

This starts the app on `http://localhost:8000` (or `$HOST_PORT` if you set
one), with the printer device from `PRINTER_DEVICE` (default
`/dev/usb/lp0`) mapped into the container. Set `PRINTER_BACKEND=dummy` in
`.env` first if you want to try the UI without a printer attached.

### Pinning and rolling back

`latest` follows the newest push to `main`. To pin a specific build, set
`TPRINT_TAG` to one of the `sha-xxxxxxx` tags listed on the
[package page](https://github.com/toineenzo/tprint/pkgs/container/tprint):

```sh
TPRINT_TAG=sha-4cb2ab1 docker compose up -d
```

For a full guided deployment onto Proxmox + Portainer specifically
(passing the USB printer through to a container, exposing it via a reverse
proxy, etc.), see **Deployment on Proxmox** below — the same general shape
(pass the USB device to whatever runs Docker, deploy the compose stack, set
env vars) applies to any Docker host.

## Local development (no printer required)

The web UI is a React app that has to be built before the server can serve
it. Docker does this for you; running from source needs both halves:

```sh
# backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # PRINTER_BACKEND=dummy by default — no hardware needed
set -a; source .env; set +a
uvicorn app.main:app --reload
```

```sh
# frontend, in a second shell (Node 20+)
cd frontend && npm install
npm run dev            # rebuilds into app/static/dist on every change
```

Visit http://127.0.0.1:8000. With `PRINTER_BACKEND=dummy`, "prints" are
captured in memory instead of sent to hardware, so you can exercise the full
UI/API without the printer attached.

If the page loads blank, the frontend hasn't been built yet — run
`npm run build` in `frontend/` once.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DEFAULT_LANGUAGE` | `en` | UI language (`en` or `nl`) shown before a visitor picks one via the footer switcher (which then sets a cookie, overriding this). |
| `AUTH_ENABLED` | `true` | Gate the web UI behind a shared password. Set `false` if you're relying on a reverse proxy / access policy (e.g. Cloudflare Access) in front of the app instead. |
| `APP_PASSWORD` | _(empty)_ | The shared password, used when `AUTH_ENABLED=true`. |
| `SESSION_SECRET` | random per-process | Signs session cookies. Set a fixed value in production or everyone gets logged out on every restart. |
| `PRINT_API_TOKEN` | _(empty)_ | Optional bearer token required on `/print/*` and `/snippets/*` for callers without a browser session (n8n, Home Assistant). Independent of `AUTH_ENABLED`. |
| `PRINTER_BACKEND` | `file` | `file` for real hardware, `dummy` for local development/testing without a printer attached. |
| `PRINTER_DEVICE` | `/dev/usb/lp0` | Device node the app writes ESC/POS bytes to. |
| `PRINTER_WIDTH_PX` | `576` | *Initial* print width in dots, used until a paper size is chosen in Settings — after that the stored setting wins. 576 suits a typical 80mm roll; 384 a 58mm one. |
| `DATA_DIR` | `/data` | Where the SQLite DB, saved snippet images, and settings logo live — mount a volume here. |
| `HOST_PORT` | `8000` | Host-side port for `docker-compose.yml`, in case 8000 is already taken on your Docker host. |

`docker-compose.yml` references `APP_PASSWORD`, `SESSION_SECRET`, and
`PRINT_API_TOKEN` as required (`${VAR:?...}`) — Docker Compose/Portainer will
refuse to start the stack until they're set, so real values never need to be
hardcoded into the committed file. Set them via a local `.env` file (Docker
Compose picks it up automatically) or Portainer's stack "Environment
variables" fields — not by editing the YAML.

## Deployment on Proxmox

This is the setup this app was originally built against: Proxmox VE running
Portainer-managed Docker in an LXC (or VM), with the printer physically
connected to the Proxmox host via USB.

1. **Bring up the printer.** Plug the printer into the host. From the
   Proxmox host shell: `lsusb` (is it listed?) and `dmesg | grep -i usblp`
   (did the kernel bind it as `/dev/usb/lp0`?). Then run
   `scripts/test_printer.sh` against that path to confirm a real test print
   comes out before doing anything else.

2. **Pass the printer through to wherever Docker runs.** Find the LXC or VM
   that runs your Docker engine.
   - **LXC:** in the Proxmox GUI, select it → *Resources* → *Add* →
     *Device Passthrough* → type the device path (`/dev/usb/lp0`) → *Add* →
     restart the container.
   - **VM:** select it → *Hardware* → *Add* → *USB Device* → "Use USB
     Vendor/Device ID" → pick the printer → restart the VM (Linux inside
     will bind it as `/dev/usb/lp0` automatically).

   Re-run `scripts/test_printer.sh` from inside that LXC/VM (`pct enter
   <id>` for an LXC) to confirm the device is visible and writable there too.

3. **Deploy via Portainer.** Add a new Stack, either pointing Portainer at
   this repo (so future updates are a "pull and redeploy" click away) or
   pasting `docker-compose.yml` directly, and fill in the environment
   variables (see table above — Portainer can also import a local `.env`
   file here). `docker-compose.yml` already maps `/dev/usb/lp0` into the
   container — adjust the `devices:` line if your device path differs, and
   set `HOST_PORT` if 8000 is already taken on that host (Portainer itself
   commonly uses it).

4. **Expose it.**
   - *Internal:* point your internal reverse proxy (Caddy, nginx, etc.) at
     the Docker host's IP and the app's port, e.g. for a manually-managed
     Caddyfile:
     ```
     print.example.com {
         reverse_proxy 192.168.1.16:8000
     }
     ```
   - *External:* if you use something like Cloudflare Tunnel, add a public
     hostname pointed at this container's port. Optionally add an access
     policy there (e.g. Cloudflare Access) and set `AUTH_ENABLED=false` to
     skip the app's own login screen.

## Printer settings

Open these with the **gear icon** in the top right. They appear as a dialog
over the main page, so you don't lose whatever you were about to print — press
`Esc` or click away to dismiss. (The old `/settings` address still works and
opens the same dialog, so existing bookmarks are fine.)

A configurable "frame" applied to every receipt the app prints, regardless
of source (text, image, PDF, checklist, calendar, snippet):

- **Header/footer text**, with a `{datetime}` placeholder for the current
  date and time.
- **Header logo** — an image printed above the header text.
- **Default text style** — bold, double-width, and alignment defaults for
  printed text.

This is deliberately scoped to *application-level* formatting, not the
printer's own persistent memory switches (paper width, auto-cutter behavior,
etc.) — those still require the physical self-test menu (hold Feed while
powering on) or the manufacturer's own configuration utility. Reprogramming
memory switches over USB is possible in principle but uses undocumented,
model-specific vendor commands that aren't safe to guess at without the
exact printer in hand to verify against.

### Danger zone: reset all data

At the bottom of the same dialog, **Reset all data** deletes every snippet,
the entire print history, anything queued, and these printer settings
(including the logo) — leaving the app exactly as it was on first run. It asks
for confirmation first, and there is **no undo and no backup**: if you want to
keep the data, copy your `DATA_DIR` volume before pressing it.

## Why no content API

The jokes, recipes and fortunes are bundled and editable in-app rather than
fetched from a public API. That was a deliberate choice after surveying the
options in July 2026 (full notes in `docs/`):

- **No free API in any category serves Dutch**, so switching would have
  regressed half the app's content.
- **The well-known options keep dying.** `quotable.io`'s domain no longer
  resolves; `forismatic` returns 522; RecipePuppy is a 404; `type.fit` still
  answers but now returns 5 quotes instead of ~1600.
- **Recipe APIs don't fit receipts.** A random TheMealDB meal wraps to a median
  of ~37 lines — roughly 16cm of paper, up to 28cm.
- **The terms rule out offline use.** Spoonacular's free tier caps caching at
  one hour, after which cached data must be deleted; Edamam dropped its free
  tier and returns no cooking instructions on affordable plans.

The app therefore makes no outbound calls and works with no internet at all.
If you want more variety, import a dataset into Settings once rather than
taking on a runtime dependency.

## Licence

tprint is released under the **GNU Affero General Public License v3.0 or
later** (see `LICENSE`). The same information is shown in **Settings → About**,
along with the libraries it's built on.

It is AGPL rather than a permissive licence for one concrete reason: tprint
renders PDFs with [PyMuPDF](https://pymupdf.readthedocs.io/), which is itself
AGPL-3.0. Linking it means the combined work must be AGPL-3.0 too, so MIT was
not available. Every other dependency, in both the Python and JavaScript trees,
is MIT/BSD/Apache/ISC.

Practical consequence worth knowing if you fork this: under AGPL §13, if you
run a **modified** version and let other people reach it over a network, you
have to offer those users its source.

## REST API

All endpoints below require either a logged-in browser session or, if
`PRINT_API_TOKEN` is set, an `Authorization: Bearer <token>` header.

**One exception:** `POST /api/settings/reset` accepts a browser session only,
never the bearer token. The token exists so automations can *print*; being able
to print shouldn't also mean being able to wipe the database, so a token that
leaks out of an n8n or Home Assistant config costs you paper rather than your
snippets and history. (In a deployment with `AUTH_ENABLED=false` there are no
sessions at all, so reset falls back to the same network-level trust as
everything else.)

| Method & path | Body | Purpose |
|---|---|---|
| `POST /print/text` | `{"text": "..."}` | Print plain text. |
| `POST /print/image` | multipart `file` | Print an image. |
| `POST /print/pdf` | multipart `file` | Rasterize and print each PDF page. |
| `POST /print/random` | `{"kind": "joke"\|"recipe"\|"fortune", "lang": "en"\|"nl"}` (both optional) | Print a surprise. `lang` defaults to the caller's `lang` cookie, then English. |
| `POST /print/ics` | multipart `file`, `mode` (`single`\|`day`\|`separate`), `overview` (`none`\|`week`\|`month`), `orientation` (`vertical`\|`horizontal`) | Print a calendar. `day` consolidates each day into one receipt; `orientation` applies to those day receipts. |
| `POST /print/composition` | multipart `payload` (JSON: `parts`, optional `layout`) + `files` | Print several items as one job. `parts` is an ordered list of `{"type":"text","blocks":[…]}`, `{"type":"image","file_index":N}` and `{"type":"code","data":…}`. Text prints as real printer text where the styling allows. |
| `POST /print/code-image` | multipart `data`, `format`, `symbology` | A bare QR/barcode PNG with no receipt frame — used by the composer. |
| `POST /print/pdf-page` | multipart `file`, `page` (1-based, clamped) | One PDF page as a PNG, for the image editor. Page count is returned in the `X-Page-Count` header. |
| `POST /print/code` | `{"data": "...", "format": "qr"\|"barcode", "symbology": "code128"}` | Print a QR code or barcode. Rejects data that doesn't fit the symbology with a specific message. |
| `POST /print/richtext` | `{"blocks": [{"text", "level", "bold", "italic", "underline", "tint", "align"}]}` | Print styled text. `level` 0-3, `tint` `black`\|`dark`\|`light`. |
| `POST /print/checklist` | `{"title": "...", "items": [{"text": "...", "due": "2026-01-01"}], "mode": "single"\|"separate"}` | Print a task/checklist. |
| `GET /snippets` | — | List saved snippets. |
| `GET /snippets/{id}` | — | Get a single snippet (name, kind, text, file list). |
| `POST /snippets` | multipart `name`, `kind` (`text`\|`image`\|`pdf`\|`checklist`\|`ics`), plus `text_content` (text), one-or-more `files` (image/pdf/ics), `payload` JSON (checklist), `mode` (ics) | Save a snippet. |
| `PUT /snippets/{id}` | multipart `name`, `text_content`, `add_files`, `remove_files` | Edit a snippet (fields used depend on its kind; `checklist` and `ics` accept `name` only). |
| `DELETE /snippets/{id}` | — | Delete a snippet. |
| `POST /snippets/{id}/print` | — | Print a saved snippet. |
| `GET /history` | — | Recent print history (kind, preview text, has-image flag, timestamp). |
| `GET /history/{id}/image` | — | Thumbnail image for a history entry. |
| `GET /queue` | — | List queued/scheduled/recurring jobs and their status. Each job carries `scheduled` (false = waits for `/queue/run`, true = fires on its own) and `recurrence_days`. |
| `POST /queue/run` | — | Run the **manual queue only** — jobs with no `run_at` and no `recurrence`. Scheduled and recurring jobs are never pulled forward by this. |
| `DELETE /queue/{id}` | — | Cancel a job that hasn't started yet. |
| `GET /queue/current` | — | What's printing right now, if anything. |
| `POST /queue/cancel-current` | — | Abort whatever's currently printing (works mid-transfer on a big job). |
| `GET /api/settings` | — | Current header/footer/logo/text-style settings. |
| `POST /api/settings` | multipart `header_text`, `footer_text`, `default_align`, `default_bold`, `default_double_width`, `remove_logo`, `logo`, `footer_logo`, `remove_footer_logo`, `paper_width_px`, `auto_cut`, `confirm_before_print`, `surprise_preview`, `print_delay_seconds`, `retention_max_items`, `retention_max_age_days` | Replace the printer settings. Sends every field — omitted fields reset to their default. |
| `GET /api/settings/preview` | — | PNG of a sample receipt as the current settings would print it. |
| `GET /api/settings/about` | — | Licence and the list of libraries tprint is built on. |
| `GET /api/settings/footer-logo` | — | The configured footer image. |
| `POST /print/preview` | multipart `kind` + the same fields the matching `/print/*` endpoint takes | PNG of what that job would print, without printing it. |
| `GET /print/surprise/peek` | `?kind=` | Draw a joke/recipe/fortune **without** printing it. Print the drawn one by passing its `text` back to `POST /print/random`. |
| `GET /api/content` | `?kind=&lang=` | List surprise-me entries, plus per-kind/language counts. |
| `POST /api/content` | `{kind, lang, text}` or `{kind, lang, title, ingredients[], steps[]}` | Add an entry. |
| `PUT /api/content/{id}` | same body minus `kind`/`lang` | Edit an entry. |
| `DELETE /api/content/{id}` | — | Delete an entry. |
| `POST /api/settings/reset` | — | **Destructive, no undo.** Deletes every snippet, all history, the queue and the printer settings, returning the app to a fresh install. Requires a browser session — see the note below. |

`/print/*` and `/snippets/{id}/print` also accept `queue` (bool), `run_at`
(ISO datetime), `recurrence` (`daily`\|`weekly`\|`monthly`),
`recurrence_time` (`HH:MM`) and `recurrence_days` — set any of these instead
of printing immediately to queue/schedule/repeat the job.

- `run_at` is interpreted as **naive local time** in the server's `TZ`, with
  no timezone conversion.
- `recurrence_time` is required whenever `recurrence` is set.
- `recurrence_days` picks *which* days a rule fires on: ISO weekdays `1`–`7`
  (Mon–Sun) for `weekly`, days of the month `1`–`31` for `monthly`. Send it as
  a JSON list (`[1,3,5]`) or a comma-separated string (`1,3,5`) — form fields
  and query params can't express a list. Omit it and it's derived from the
  start time, so `recurrence=weekly` alone still means "the same weekday every
  week" exactly as it always did.
- A monthly day the month doesn't have is **skipped, not clamped**: a rule for
  the 31st prints in January and March, and not at all in February.

```sh
# Every Wednesday and Friday at 08:00
curl -X POST http://localhost:8080/print/text \
  -H 'Content-Type: application/json' \
  -d '{"text":"Bin day","recurrence":"weekly","recurrence_time":"08:00","recurrence_days":[3,5]}'
```

### Home Assistant

Add to `configuration.yaml` (adjust host and token):

```yaml
rest_command:
  tprint_text:
    url: "https://print.example.com/print/text"
    method: POST
    headers:
      Authorization: "Bearer !secret tprint_api_token"
      Content-Type: application/json
    payload: '{"text": "{{ text }}"}'

  tprint_random:
    url: "https://print.example.com/print/random"
    method: POST
    headers:
      Authorization: "Bearer !secret tprint_api_token"
      Content-Type: application/json
    payload: "{}"
```

Call `rest_command.tprint_text` with a `text` field, or `rest_command.tprint_random`,
from any HA automation/script/dashboard button.

### n8n (e.g. an 8am calendar + weather receipt)

n8n owns the scheduling and data-fetching — this app just prints text:

1. **Schedule Trigger** — 8:00 daily.
2. **Google Calendar node** — get today's events.
3. **HTTP Request node** — `GET https://api.open-meteo.com/v1/forecast?...`
   (no API key required).
4. **Set/Function node** — format events + weather into a plain-text receipt.
5. **HTTP Request node** — `POST https://print.example.com/print/text` with
   `Authorization: Bearer <PRINT_API_TOKEN>` and `{"text": "<formatted text>"}`.

Alternatively, POST an `.ics` export straight to `/print/ics` if your
scheduling source can produce one.

## Contributing / development

See [`CLAUDE.md`](./CLAUDE.md) for the architecture map, key design
decisions (and why), hardware-specific gotchas learned against real
hardware, database migration conventions, and how to add a new language or
a new print type. It's written for AI coding assistants but is equally
useful for a human making changes.
