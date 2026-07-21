# tprint frontend — conventions

React + Mantine + `@tabler/icons-react`, built by Vite into
`app/static/dist/`, served by FastAPI through the Jinja shell in
`app/templates/base.html`.

Read `../CLAUDE.md` first — this file only covers UI conventions.

## Architecture: server shell, React islands

There is no client-side router. `base.html` renders `<div id="root">` plus a
`window.__TPRINT__` bootstrap payload, and `src/main.tsx` mounts the page named
in `__TPRINT__.page` (`index` | `settings` | `login`). This keeps the existing
auth model intact: `/` and `/settings` still 302 to `/login` server-side via
`auth.web_page_authed`, and no auth API had to be invented.

The bootstrap payload also carries the initial snippets/history/settings, so the
first paint is populated rather than flashing empty lists — matching what the
old Jinja templates did. Subsequent updates come from `usePolled`.

The login page renders a **native** `<form method="post" action="/login">`
inside Mantine controls, so it posts exactly like before with no backend change.

## Colour roles

`src/theme.ts` is the only file that names a colour. Components import `ROLE`,
never a literal. Each colour has exactly one job:

| Role | Colour | Use for |
|---|---|---|
| `primary` | indigo | The one main CTA per view (Print, Save) |
| `secondary` | gray | Supporting actions (Queue, Run now, Add item, Cancel) |
| `surprise` | orange | The "surprise me" group only |
| `success` | green | Success toasts only |
| `danger` | red | Destructive/abort actions and error toasts |
| `muted` | gray | Category badges and metadata — never an action |

**At most one `PrimaryButton` per card.** If a second action feels important,
it is still a `SecondaryButton`.

## Buttons

Use the wrappers in `src/components/ui/Buttons.tsx` — `PrimaryButton`,
`SecondaryButton`, `SurpriseButton`, `DangerButton` — rather than Mantine's
`<Button>` directly. New features then inherit the hierarchy instead of having
to re-derive it. Icon-only controls use `IconActionButton`, which forces a
tooltip and an `aria-label`.

## Icons

Every actionable control carries an icon, and the icon must reinforce meaning —
no decoration. Established pairings:

| Action | Icon |
|---|---|
| Print | `IconPrinter` |
| Add to queue | `IconPlaylistAdd` |
| Run queue now | `IconPlayerPlay` |
| Surprise me | `IconSparkles` (group), `IconArrowsShuffle` (random) |
| Schedule / run at | `IconClock` |
| Recurrence | `IconRepeat` |
| Save | `IconDeviceFloppy` |
| Delete | `IconTrash` |
| Cancel current print | `IconPlayerStop` |

Size with `ICON_SIZE` (`sm` in badges, `md` on buttons, `lg` for headers and
icon buttons) and always pass `stroke={ICON_STROKE}` so weight stays uniform.
**No emoji as UI.**

## Content types

`src/constants/contentTypes.ts` maps every backend `kind` string
(`text`/`image`/`pdf`/`checklist`/`ics`/`random`/`snippet`) to an icon, an icon
colour and an i18n label key. History, queue and snippet lists all read from it,
so a type looks identical everywhere. Adding a backend kind is one line here;
until then it renders via `FALLBACK_CONTENT_TYPE` rather than breaking.

Note the split: the badge body is always neutral grey, the *icon* carries the
type colour. That keeps category labels from competing with the primary action.

## Strings

Never hardcode user-facing text. `app/i18n.py` stays the single source of
truth; components read strings via `useStrings()`:

```tsx
const t = useStrings();
<PrimaryButton icon={<IconPrinter …/>}>{t("print_text_btn")}</PrimaryButton>
```

Adding a string: add the key to **every** language in `app/i18n.py`, then to the
`StringKey` union in `src/i18n/strings.ts`. There is no per-key fallback to
English server-side, and the union makes a typo a compile error.

## Feedback

Success and failure go through `notifySuccess` / `notifyError` in
`src/notify.tsx` (Mantine notifications — icon, colour, auto-dismiss, fixed
placement). Never write status text into the layout.

## Spacing

Mantine's scale only (`xs`…`xl`) via `gap`/`mt`/`p` props. No inline
`style={{ margin: … }}` one-offs; if something needs a value the scale lacks,
it belongs in `theme.ts`.

## Local development

```sh
cd frontend && npm install
npm run dev          # vite build --watch, writes into app/static/dist
```

…and in another shell the usual `uvicorn app.main:app --reload` with
`PRINTER_BACKEND=dummy`. Watch-build rather than Vite's dev server, so the
session cookie and the API are same-origin and no proxy is needed.

`npm run build` runs `tsc --noEmit` first — a type error fails the Docker build.
