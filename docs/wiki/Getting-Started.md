# Getting Started

## 1. Run it

`docker-compose.yml`:

```yaml
services:
  tprint:
    image: ghcr.io/toineenzo/tprint:${TPRINT_TAG:-latest}
    pull_policy: always
    restart: unless-stopped
    ports: ["8000:8000"]
    devices:
      - "/dev/usb/lp0:/dev/usb/lp0"   # the printer
    volumes:
      - ./data:/data                  # database, uploads, logos
    environment:
      TZ: Europe/Amsterdam            # scheduling uses local time
      SESSION_SECRET: "change-me"
      APP_PASSWORD: "change-me"
      PRINT_API_TOKEN: "a-long-random-string"
      DEFAULT_LANGUAGE: "en"
```

```bash
docker compose up -d
```

Open `http://<host>:8000`.

## 2. First run

A setup wizard appears on a fresh install (and after **Reset all data**). It
covers:

1. **Printer connection** — USB device or test mode, with a connection test.
2. **Language** — English or Dutch.
3. **Access** — whether a password is required, and what it is.

Everything is skippable and changeable later in Settings.

## 3. Plug the printer in

The app writes ESC/POS bytes to the kernel USB-printer device node, normally
`/dev/usb/lp0`. It does **not** use libusb, which keeps container permissions
simple.

Check the node exists on the host:

```bash
ls -l /dev/usb/lp0
```

Nothing there? The printer is off, unplugged, or isn't binding as a standard
USB printer. See [Troubleshooting](Troubleshooting).

## 4. Test mode

No printer to hand? Set the backend to **No printer (test mode)** in the setup
wizard or Settings → Printer (or `PRINTER_BACKEND=dummy`). Jobs are built,
queued, logged and previewed exactly as normal — nothing is sent to hardware.

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `TZ` | UTC | Timezone for all scheduling |
| `DATA_DIR` | `/data` | Database, uploads, logos |
| `AUTH_ENABLED` | `true` | Login page on/off (overridden by the in-app setting) |
| `APP_PASSWORD` | — | Login password (overridden by the in-app one) |
| `SESSION_SECRET` | random | Set it, or everyone is logged out on restart |
| `PRINT_API_TOKEN` | — | Bearer token for machine callers |
| `PRINTER_BACKEND` | `file` | `file` or `dummy` (overridden by the in-app setting) |
| `PRINTER_DEVICE` | `/dev/usb/lp0` | Device node (overridden by the in-app setting) |
| `PRINTER_WIDTH_PX` | `576` | Default printable width; the paper setting wins |
| `DEFAULT_LANGUAGE` | `en` | Language a new visitor gets |

Settings changed in the app are stored in the database and take precedence
over the matching environment variable.

## Updating

`latest` is a moving tag and `pull_policy: always` is load-bearing:

```bash
docker compose pull && docker compose up -d
```

Roll back with `TPRINT_TAG=sha-xxxxxxx`.
