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
- **Snippets**: save and re-print recurring content — text, one-or-more
  images (printed in sequence on one receipt), or a PDF. Preview any
  snippet before printing, and edit it later (rename, change the text,
  add/remove images, or replace the PDF) without recreating it.
- **Quick save-and-print**: a small ✓ button next to the text/image/PDF
  print forms prints your current input and saves it as a snippet in one
  step, for things you'll want to print again.
- **Surprise me**: a bundled, curated (not API-dependent) list of jokes,
  recipes, and fortunes — in English or Dutch.
- **Task/checklists**: build a list of items with optional due dates, print
  as one combined receipt or as separate torn-off receipts per item.
- **Calendar import**: upload an `.ics` file, print all events as one
  agenda or as separate receipts per event.
- **Print queue & scheduling**: queue a print instead of firing it
  immediately, run the queue manually whenever you like, schedule it for a
  specific date/time, or make it recurring (daily/weekly/monthly at a set
  time). A big print already in progress can be canceled mid-transfer.
- **Print history**: a sidebar showing what's been printed recently, with a
  timestamp and a text/image preview of each job — including ones fired by
  the queue/schedule while you weren't looking.
- **Printer settings**: a configurable header/footer "frame" (text and/or a
  logo image, with a `{datetime}` placeholder) applied to every receipt, plus
  default text style (bold/double-width/alignment) — all editable from the
  web UI instead of the printer's own paper self-test menu.
- **Localization**: UI and surprise-me content available in English or Dutch
  (Dutch by default), switchable per browser (cookie-based, no account
  needed).
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

```sh
git clone https://github.com/toineenzo/tprint.git
cd tprint
cp .env.example .env   # edit: at minimum set APP_PASSWORD, SESSION_SECRET, PRINT_API_TOKEN
docker compose up -d --build
```

This starts the app on `http://localhost:8000` (or `$HOST_PORT` if you set
one), with the printer device from `PRINTER_DEVICE` (default
`/dev/usb/lp0`) mapped into the container. Set `PRINTER_BACKEND=dummy` in
`.env` first if you want to try the UI without a printer attached.

For a full guided deployment onto Proxmox + Portainer specifically
(passing the USB printer through to a container, exposing it via a reverse
proxy, etc.), see **Deployment on Proxmox** below — the same general shape
(pass the USB device to whatever runs Docker, deploy the compose stack, set
env vars) applies to any Docker host.

## Local development (no printer required)

```sh
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # PRINTER_BACKEND=dummy by default — no hardware needed
set -a; source .env; set +a
uvicorn app.main:app --reload
```

Visit http://127.0.0.1:8000. With `PRINTER_BACKEND=dummy`, "prints" are
captured in memory instead of sent to hardware, so you can exercise the full
UI/API without the printer attached.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DEFAULT_LANGUAGE` | `nl` | UI language (`nl` or `en`) shown before a visitor picks one via the footer switcher (which then sets a cookie, overriding this). |
| `AUTH_ENABLED` | `true` | Gate the web UI behind a shared password. Set `false` if you're relying on a reverse proxy / access policy (e.g. Cloudflare Access) in front of the app instead. |
| `APP_PASSWORD` | _(empty)_ | The shared password, used when `AUTH_ENABLED=true`. |
| `SESSION_SECRET` | random per-process | Signs session cookies. Set a fixed value in production or everyone gets logged out on every restart. |
| `PRINT_API_TOKEN` | _(empty)_ | Optional bearer token required on `/print/*` and `/snippets/*` for callers without a browser session (n8n, Home Assistant). Independent of `AUTH_ENABLED`. |
| `PRINTER_BACKEND` | `file` | `file` for real hardware, `dummy` for local development/testing without a printer attached. |
| `PRINTER_DEVICE` | `/dev/usb/lp0` | Device node the app writes ESC/POS bytes to. |
| `PRINTER_WIDTH_PX` | `576` | Print width in pixels (matches a typical 80mm-roll ESC/POS printer at 180dpi; adjust for other paper widths). |
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

## Printer settings (`/settings`)

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

## REST API

All endpoints below require either a logged-in browser session or, if
`PRINT_API_TOKEN` is set, an `Authorization: Bearer <token>` header.

| Method & path | Body | Purpose |
|---|---|---|
| `POST /print/text` | `{"text": "..."}` | Print plain text. |
| `POST /print/image` | multipart `file` | Print an image. |
| `POST /print/pdf` | multipart `file` | Rasterize and print each PDF page. |
| `POST /print/random` | `{"kind": "joke"\|"recipe"\|"fortune", "lang": "en"\|"nl"}` (both optional) | Print a surprise. `lang` defaults to the caller's `lang` cookie, then English. |
| `POST /print/checklist` | `{"title": "...", "items": [{"text": "...", "due": "2026-01-01"}], "mode": "single"\|"separate"}` | Print a task/checklist. |
| `POST /print/ics` | multipart `file` (.ics), form field `mode` (`single`\|`separate`) | Print calendar events from an ICS file. |
| `GET /snippets` | — | List saved snippets. |
| `GET /snippets/{id}` | — | Get a single snippet (name, kind, text, file list). |
| `POST /snippets` | multipart `name`, `kind` (`text`\|`image`\|`pdf`), `text_content` or one-or-more `files` | Save a snippet. |
| `PUT /snippets/{id}` | multipart `name`, `text_content`, `add_files`, `remove_files` | Edit a snippet (fields used depend on its kind). |
| `DELETE /snippets/{id}` | — | Delete a snippet. |
| `POST /snippets/{id}/print` | — | Print a saved snippet. |
| `GET /history` | — | Recent print history (kind, preview text, has-image flag, timestamp). |
| `GET /history/{id}/image` | — | Thumbnail image for a history entry. |
| `GET /queue` | — | List queued/scheduled/recurring jobs and their status. |
| `POST /queue/run` | — | Run every job that's queued with no scheduled time. |
| `DELETE /queue/{id}` | — | Cancel a job that hasn't started yet. |
| `GET /queue/current` | — | What's printing right now, if anything. |
| `POST /queue/cancel-current` | — | Abort whatever's currently printing (works mid-transfer on a big job). |

`/print/*` and `/snippets/{id}/print` also accept `queue` (bool), `run_at`
(ISO datetime), `recurrence` (`daily`\|`weekly`\|`monthly`), and
`recurrence_time` (`HH:MM`) — set any of these instead of printing
immediately to queue/schedule/repeat the job.

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
