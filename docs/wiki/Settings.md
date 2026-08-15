# Settings

## Frame

Header and footer text printed around every receipt, each with its own styling
(bold, italic, underline, heading size, shade, alignment) and an optional
logo image. `{datetime}` is replaced with the current date and time.

Logos are offered a crop when you pick them.

## Output

- **Paper** — 80 mm (576 dots), 58 mm (384) or a custom width. Everything that
  measures paper reads this.
- **Default text style** — alignment, bold, double width.
- **Cut the paper after printing** — off keeps prints on one strip.
- **Confirm before printing** — shows a rendered preview and asks first.
- **Preview surprises** — draw a joke/recipe/fortune and approve it.
- **Delay after printing** — a *minimum gap* between jobs, so a burst comes out
  spaced. An isolated print never waits.

## Printer

Where ESC/POS bytes go: a USB device node, or test mode (nothing is sent).
**Test connection** reports each check separately — backend, device node,
writability, and optionally a test receipt.

Changing this here overrides `PRINTER_BACKEND` / `PRINTER_DEVICE`.

## History and queue

- Keep at most N items, and/or drop anything older than N days (0 = no limit).
  Applies to print history and to *finished* queue jobs only — waiting and
  scheduled prints are never removed.
- **Remove finished queue items automatically** clears done/failed/cancelled
  jobs the moment they finish. History still keeps them.

## Content

The jokes, fortunes and recipes behind Surprise me. Add, edit, delete — stored
in the database, so edits survive an update. **Restore defaults** replaces
everything with the set bundled in the image.

## About

Licence, source, and the libraries tprint is built on.

## Danger zone

**Reset all data** drops every table, empties uploads and returns you to the
setup wizard. No undo, no backup.
