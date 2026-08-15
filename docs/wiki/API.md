# API

Everything the UI does goes through this HTTP API, so anything that can make a
request can print.

## Authentication

Two ways in:

| Caller | How | Reaches |
|---|---|---|
| Browser | Session cookie from `POST /login` | Everything |
| Machine (n8n, Home Assistant, a script) | `Authorization: Bearer <PRINT_API_TOKEN>` | Everything except destructive actions |

Set the token in `docker-compose.yml`:

```yaml
environment:
  PRINT_API_TOKEN: "a-long-random-string"
```

The token deliberately **cannot** reach `POST /api/settings/reset`,
`DELETE /history`, `POST /api/settings/auth` or `POST /api/settings/connection`.
A token handed to an automation should cost you paper if it leaks, not your
data or your login.

If `AUTH_ENABLED=false` and no token is set, the API is open — put a reverse
proxy, VPN or Cloudflare Access in front of it.

## Printing

All print endpoints return `{"status": "printed"}`, or
`{"status": "queued", "job_id": N}` when queue/schedule options are included.

### Text

```bash
curl -X POST $HOST/print/text -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Line one\nLine two"}'
```

### Styled text

Per-line styling. `level` 0 is body, 1–3 are headings; `tint` is
`black`/`dark`/`light`.

```bash
curl -X POST $HOST/print/richtext -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"blocks": [
        {"text": "SHOPPING", "level": 1, "bold": true, "align": "center"},
        {"text": "with a quiet note", "italic": true, "tint": "light"}
      ]}'
```

### Image / PDF

Multipart, one file:

```bash
curl -X POST $HOST/print/image -H "Authorization: Bearer $TOKEN" -F file=@photo.jpg
curl -X POST $HOST/print/pdf   -H "Authorization: Bearer $TOKEN" -F file=@invoice.pdf
```

`POST /print/pdf` also takes an optional `crop` field: a JSON box in
*fractions* of the page, applied to every page.

```bash
-F 'crop={"x":0.05,"y":0.1,"w":0.9,"h":0.4}'
```

### Checklist

`due` is free text; the UI sends `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`.
`mode` is `single` (one receipt) or `separate` (one per item).

```bash
curl -X POST $HOST/print/checklist -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Today", "mode": "single",
       "items": [{"text": "Bins", "due": "2026-08-16 07:30"},
                 {"text": "Call the plumber", "due": null}]}'
```

### Calendar (.ics)

```bash
curl -X POST $HOST/print/ics -H "Authorization: Bearer $TOKEN" \
  -F file=@week.ics -F mode=day -F overview=week -F orientation=horizontal
```

- `mode`: `single` | `separate` | `day`
- `overview`: `none` | `week` | `month` — a dot grid above the events
- `orientation`: `vertical` | `horizontal` — sideways day receipts

### QR / barcode

```bash
curl -X POST $HOST/print/code -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data": "https://example.com", "format": "qr"}'
```

`format` is `qr` or `barcode`; barcodes take `symbology`
(`code128`, `code39`, `ean13`, `ean8`, `upca`, `isbn13`, `issn`, `itf`).
An invalid payload for the symbology fails with 400 *before* anything prints.

### Surprise me

```bash
curl -X POST $HOST/print/random -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"kind": "joke"}'
```

`kind`: `joke` | `recipe` | `fortune`, or omit it for a random pick.

### Preview without printing

`POST /print/preview` mirrors the print endpoints and returns a PNG of what
would come out — same code path, so it can't drift from the real thing.

## Queue and schedule

Any print endpoint accepts these extra fields (JSON body, form field or query
param, depending on the endpoint):

| Field | Meaning |
|---|---|
| `queue` | `true` → wait in the manual queue until "Run queue now" |
| `run_at` | naive **local** ISO datetime, e.g. `2026-08-16T08:00` — run once, then |
| `recurrence` | `daily` \| `weekly` \| `monthly` |
| `recurrence_time` | `HH:MM` or `HH:MM:SS` |
| `recurrence_days` | `[1,3,5]` or `"1,3,5"` — ISO weekdays for weekly, days of month for monthly |
| `ends_after` | stop after this many runs |
| `ends_at` | stop once the next run would fall after this datetime |

```bash
# Every weekday at 07:30, twenty times, then stop
curl -X POST $HOST/print/text -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Good morning", "recurrence": "weekly",
       "recurrence_days": [1,2,3,4,5], "recurrence_time": "07:30",
       "ends_after": 20}'
```

Times are **naive local**: the server compares them against its own clock with
no timezone conversion. Set `TZ` in `docker-compose.yml` to match yours.

Queue management:

```bash
GET    /queue                  # every job, with a `scheduled` flag
POST   /queue/run              # run the manual queue now
DELETE /queue/{id}             # cancel a pending job
DELETE /queue/finished         # clear done/failed/canceled jobs
GET    /queue/current          # what's printing right now
POST   /queue/cancel-current   # abort it mid-transfer
```

## Snippets

Saved things you print again.

```bash
GET    /snippets
POST   /snippets/{id}/print      # accepts the same queue/schedule params
GET    /snippets/{id}/pdf        # download as a PDF of what it would print
DELETE /snippets/{id}
```

## History

```bash
GET    /history
GET    /history/{id}/image       # the thumbnail kept at print time
POST   /history/{id}/snippet     # keep a past print as a snippet
DELETE /history                  # session auth only
```

## Settings

```bash
GET  /api/settings
POST /api/settings               # multipart, all fields at once
POST /api/settings/printer-test  # diagnose the connection
GET  /api/settings/preview       # sample receipt as a PNG
```

## Status codes worth knowing

| Code | Meaning |
|---|---|
| 400 | The request itself is wrong (empty text, unencodable barcode) |
| 401 | Missing or wrong credentials |
| 409 | Nothing to do (no content of that kind, nothing printing to cancel) |
| 422 | A queue/schedule option failed validation |
| **503** | **The printer could not be written to — off, unplugged, or misconfigured.** The body's `detail` says which |
