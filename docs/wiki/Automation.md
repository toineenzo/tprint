# Automation

Everything below uses the bearer token from [API](API).

## n8n

Add an **HTTP Request** node:

- Method: `POST`
- URL: `https://print.example.com/print/text`
- Authentication: *Generic → Header Auth*, name `Authorization`, value `Bearer <token>`
- Body: JSON, `{ "text": "{{$json.message}}" }`

Print a rendered template instead of raw text by building the string in a Set
node first. For a checklist, send `items` as an array of `{text, due}`.

## Home Assistant

`configuration.yaml`:

```yaml
rest_command:
  print_text:
    url: "https://print.example.com/print/text"
    method: post
    headers:
      Authorization: !secret tprint_token
      Content-Type: application/json
    payload: '{"text": "{{ message }}"}'
```

Then in an automation:

```yaml
action:
  - service: rest_command.print_text
    data:
      message: "Doorbell at {{ now().strftime('%H:%M') }}"
```

A daily agenda, printed by tprint's own scheduler rather than Home
Assistant's, needs no automation at all — queue it once with `recurrence`.

## Shell / cron

```bash
#!/bin/sh
curl -sS -X POST "$HOST/print/text" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg t "$(fortune)" '{text:$t}')"
```

Prefer tprint's own schedule over cron when the job is "print this every
morning": it survives a restart, shows a countdown in the UI, and can be
cancelled mid-print.

## Webhooks from anything

Any service that can POST JSON works — Uptime Kuma, Grafana, GitHub Actions,
an ESP32. The smallest useful call is:

```
POST /print/text
Authorization: Bearer <token>
{"text": "..."}
```

## Errors worth handling

- **503** — the printer is off or unreachable. Retry later; the message in
  `detail` is safe to surface to a human.
- **409** — nothing to print (e.g. every joke was deleted).
- **422** — a schedule option is invalid; the response says which field.
