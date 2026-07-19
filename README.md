# tprint

A small self-hosted web app for driving an Epson TM-T88V USB thermal printer:
upload PDFs/images or paste text to print, save reusable snippets (e.g. a
wifi receipt for guests), print a random joke/recipe/fortune, and expose a
REST API for Home Assistant and n8n (e.g. an 8am calendar + weather receipt).

## How it talks to the printer

The TM-T88V is USB-only in this setup. Linux's `usblp` kernel driver binds
it automatically as `/dev/usb/lp0`; the app writes raw ESC/POS bytes to that
device node via [python-escpos](https://github.com/python-escpos/python-escpos).
Only one container/VM can hold the USB device at a time — see **Deployment**
below for passing it through to wherever you run this app.

If you ever add Epson's optional UB-E04 Ethernet interface card to the
printer, switch `PRINTER_BACKEND` to a network backend and give it a static
IP — this removes the USB passthrough requirement entirely. Not needed today.

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
| `AUTH_ENABLED` | `true` | Gate the web UI behind a shared password. Set `false` if you're relying on Cloudflare Access (or similar) in front of the app instead. |
| `APP_PASSWORD` | _(empty)_ | The shared password, used when `AUTH_ENABLED=true`. |
| `SESSION_SECRET` | random per-process | Signs session cookies. Set a fixed value in production or everyone gets logged out on every restart. |
| `PRINT_API_TOKEN` | _(empty)_ | Optional bearer token required on `/print/*` and `/snippets/*` for callers without a browser session (n8n, Home Assistant). Independent of `AUTH_ENABLED`. |
| `PRINTER_BACKEND` | `file` | `file` for real hardware, `dummy` for local development. |
| `PRINTER_DEVICE` | `/dev/usb/lp0` | Device node the app writes ESC/POS bytes to. |
| `PRINTER_WIDTH_PX` | `576` | Print width in pixels (TM-T88V @ 180dpi on 80mm paper). |
| `DATA_DIR` | `/data` | Where the SQLite DB and saved snippet images live — mount a volume here. |

## Deployment

1. **Bring up the printer.** Plug the TM-T88V into the Proxmox mini PC.
   From the Proxmox host shell: `lsusb` (is it listed?) and
   `dmesg | grep -i usblp` (did the kernel bind it as `/dev/usb/lp0`?). Then
   run `scripts/test_printer.sh` against that path to confirm a real test
   print comes out before doing anything else.

2. **Pass the printer through to wherever Docker runs.** Find the LXC or VM
   that runs the Docker engine behind Portainer.
   - **LXC:** in the Proxmox GUI, select it → *Resources* → *Add* →
     *Device Passthrough* → pick the Epson device → restart the container.
   - **VM:** select it → *Hardware* → *Add* → *USB Device* → "Use USB
     Vendor/Device ID" → pick the Epson device → restart the VM (Linux
     inside will bind it as `/dev/usb/lp0` automatically).

   Re-run `scripts/test_printer.sh` from inside that LXC/VM to confirm the
   device is visible and writable there too.

3. **Deploy via Portainer.** Add a new Stack, paste `docker-compose.yml` (or
   point Portainer at this repo), fill in the environment variables (see
   table above), and deploy. `docker-compose.yml` already maps
   `/dev/usb/lp0` into the container — adjust the `devices:` line here if
   your device path differs.

4. **Expose it.**
   - *Internal:* the compose file includes example `caddy:` labels for
     caddy-docker-proxy — update the hostname to match your other stacks so
     it's reachable over Twingate.
   - *External:* add `print.toine.dev` as a public hostname on your existing
     Cloudflare Tunnel, pointed at this container's port 8000. Optionally
     add a Cloudflare Access policy here and set `AUTH_ENABLED=false`.

## REST API

All endpoints below require either a logged-in browser session or, if
`PRINT_API_TOKEN` is set, an `Authorization: Bearer <token>` header.

| Method & path | Body | Purpose |
|---|---|---|
| `POST /print/text` | `{"text": "..."}` | Print plain text. |
| `POST /print/image` | multipart `file` | Print an image. |
| `POST /print/pdf` | multipart `file` | Rasterize and print each PDF page. |
| `POST /print/random` | `{"kind": "joke"\|"recipe"\|"fortune"}` (omit for random) | Print a surprise. |
| `GET /snippets` | — | List saved snippets. |
| `POST /snippets` | multipart `name`, `kind`, `text_content` or `file` | Save a snippet. |
| `DELETE /snippets/{id}` | — | Delete a snippet. |
| `POST /snippets/{id}/print` | — | Print a saved snippet. |

### Home Assistant

Add to `configuration.yaml` (adjust host and token):

```yaml
rest_command:
  tprint_text:
    url: "https://print.toine.dev/print/text"
    method: POST
    headers:
      Authorization: "Bearer !secret tprint_api_token"
      Content-Type: application/json
    payload: '{"text": "{{ text }}"}'

  tprint_random:
    url: "https://print.toine.dev/print/random"
    method: POST
    headers:
      Authorization: "Bearer !secret tprint_api_token"
      Content-Type: application/json
    payload: "{}"
```

Call `rest_command.tprint_text` with a `text` field, or `rest_command.tprint_random`,
from any HA automation/script/dashboard button.

### n8n (8am calendar + weather receipt)

n8n owns the scheduling and data-fetching — this app just prints text:

1. **Schedule Trigger** — 8:00 daily.
2. **Google Calendar node** — get today's events.
3. **HTTP Request node** — `GET https://api.open-meteo.com/v1/forecast?...`
   (no API key required).
4. **Set/Function node** — format events + weather into a plain-text receipt.
5. **HTTP Request node** — `POST https://print.toine.dev/print/text` with
   `Authorization: Bearer <PRINT_API_TOKEN>` and `{"text": "<formatted text>"}`.
