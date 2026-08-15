# Printing

Six tabs, one printer.

## Text

Plain text goes out on the printer's own font — crisp and tiny to send. Turn
**Formatting** on for per-line bold, italic, underline, heading size, shade and
alignment.

Italic and shade don't exist in ESC/POS, so a line using either is rendered as
an image; everything else stays on the native path. Turning the switch on and
changing nothing still prints natively.

## Compose

One canvas for images, PDF pages, text blocks and codes. Scale, crop, rotate,
draw on and arrange them; a grid layout or free positioning, with separate
horizontal and vertical spacing. Selected items get a resize grip.

Two ways to print it:

- **Canvas** — flattened to one image. Exactly what you arranged; text is a bitmap.
- **Flow** — items sent as ordered parts, so text stays real ESC/POS text.
  Sharper and far smaller, but positions are ignored (ESC/POS streams
  top-to-bottom and has no cursor).

Images are offered a crop before they land on the canvas.

## PDF

Prints a whole document, page after page. A preview shows each page as it will
print, and **Crop** applies one box to every page — handy for chopping the
letterhead off an invoice.

Use Compose instead when you want one page placed among other things.

## Tasks

A checklist with optional due dates and times. Drag the grip to reorder.
Prints as one receipt, or one per item to tear off individually.

## Calendar

Upload an `.ics`. Choose one agenda receipt, one per event, or one per day —
optionally with a week/month dot grid above it, and sideways day receipts for
pinning up.

## Code

A QR code or barcode at full paper width, with a live preview. Codes are
rendered as images rather than left to the printer, so previews work and a
barcode the symbology can't encode fails before any paper moves.

## Save as snippet

Tick it on any tab: the thing you just printed is kept for reprinting. Past
prints can also be saved from the history list.
