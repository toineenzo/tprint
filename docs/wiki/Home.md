# tprint

A self-hosted web app for an ESC/POS USB thermal receipt printer (built and
tested against an Epson TM-T88V). Print text, images, PDFs, checklists,
calendars and codes from a browser — or from anything that can make an HTTP
request.

One Docker container: FastAPI + SQLite + a background worker. No external
services.

## Pages

- **[Getting Started](Getting-Started)** — deploy it, plug the printer in, first run.
- **[API](API)** — every endpoint, with `curl` examples. Start here to script it.
- **[Automation](Automation)** — n8n, Home Assistant, cron, shell.
- **[Printing](Printing)** — what each tab does, and what actually comes out.
- **[Settings](Settings)** — frame, paper, behaviour, retention, content, printer connection.
- **[Troubleshooting](Troubleshooting)** — when nothing prints.

## The short version

```bash
# Print a line of text
curl -X POST https://print.example.com/print/text \
  -H "Authorization: Bearer $PRINT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from the internet"}'
```

Everything the UI can do, that token can do too — except destroy data. See
[API](API) for why.
