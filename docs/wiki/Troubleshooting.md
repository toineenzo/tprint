# Troubleshooting

## Nothing prints, and the UI says the printer is unavailable (503)

Open **Settings → Printer → Test connection**. It checks, in order:

1. **backend** — `dummy` means nothing is ever sent to hardware. Switch to
   *USB printer*.
2. **device** — the node (`/dev/usb/lp0` by default) exists. If it doesn't,
   the printer is off, unplugged, or not mapped into the container.
3. **writable** — the container may write to it.
4. **test print** — the whole path, end to end.

### The device node doesn't exist

On the host:

```bash
ls -l /dev/usb/
dmesg | tail
```

- Nothing listed: the printer is off or the cable is out.
- Listed as `lp1`: change the device in Settings → Printer.
- Listed nowhere after plugging in: the printer isn't binding as a standard
  USB printer-class device, and this app's approach won't reach it.

### The node exists but isn't writable

The container needs the device mapped in:

```yaml
devices:
  - "/dev/usb/lp0:/dev/usb/lp0"
```

## Prints come out with faint horizontal bands

Fixed in the app itself (one controlled chunked write rather than buffered
I/O). Bands that remain are almost always a nearly-empty roll or a dirty
printhead.

## The cut goes through the text

The cutter sits a fixed distance past the printhead, so a cut needs ~6 blank
lines of feed. The app feeds before cutting; if you disabled **Cut the paper
after printing**, tear along the roll instead.

## Scheduled jobs run at the wrong time

Scheduling is naive local time with no conversion. Set `TZ` in
`docker-compose.yml` to your timezone and restart. Note that "created at"
timestamps come from SQLite and are UTC — countdowns use `run_at`, which is
local.

## A repeating job printed forever / never

- Never: check the weekday or day-of-month actually matches. A monthly job on
  the 31st is *skipped* in short months, not moved to the 28th.
- Forever: that was a bug in old versions where an unknown recurrence produced
  a time in the past. Recurrence is validated at the API boundary now.

## Surprise me says there is nothing to print (409)

Every entry of that kind was deleted. Settings → Content → **Restore
defaults** brings back the bundled jokes, fortunes and recipes.

## I forgot the password

Set `APP_PASSWORD` in `docker-compose.yml` and restart — the environment
password stays valid when no in-app password is stored. If one is stored,
clear it by deleting the `password_hash` value:

```bash
sqlite3 data/tprint.db "UPDATE settings SET password_hash = NULL"
```

## Everything is broken and I want a clean slate

Settings → **Reset all data**. It drops every table, empties uploads, and puts
you back in the setup wizard. There is no undo.
