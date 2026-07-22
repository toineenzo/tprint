# tprint frontend — conventions

React + Mantine + `@tabler/icons-react`, built by Vite into
`app/static/dist/`, served by FastAPI through the Jinja shell in
`app/templates/base.html`.

Read `../CLAUDE.md` first — this file only covers UI conventions.

## Architecture: server shell, React islands

There is no client-side router. `base.html` renders `<div id="root">` plus a
`window.__TPRINT__` bootstrap payload, and `src/main.tsx` mounts the page named
in `__TPRINT__.page` (`index` | `login`). This keeps the existing auth model
intact: `/` and `/settings` still 302 to `/login` server-side via
`auth.web_page_authed`, and no auth API had to be invented.

There is only **one page behind auth**. Settings used to be a second one; it's
a modal now, and `/settings` serves the index shell with `open_settings: true`
so bookmarks still work. Prefer a modal over a new `PageName` for anything
similar.

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

## Print tabs

Every tab in `src/components/print/` ends with the same `<PrintActions>` row:
one `PrimaryButton` (Print), one `SecondaryButton` (Queue), and the
**"Save as snippet"** checkbox — which applies to whichever of the two you
press. Don't add a second save control; the checkbox replaced both a separate
save button and a whole snippet-creation form, and it is now the only way a
snippet gets made.

A tab owns its own `saveAsSnippet` boolean and does the save *inside* its
`usePrint` closure, before the print call:

```tsx
const ok = await print(async () => {
  if (saveAsSnippet) await saveSnippet(deriveName(text, t("kind_text")), fill);
  return api.postJson<PrintResponse>("/print/text", body);
});
```

That ordering matters: one closure means one outcome toast, so a save failure
can't leave the user with a green "Printed!" next to a snippet that doesn't
exist. Reset the checkbox alongside the form on success. Names come from
`deriveName`/`deriveFileName` in `src/hooks/useSaveAsSnippet.ts` — the checkbox
never prompts for one.

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

## Modals

Anything that would otherwise be a browser dialog is a Mantine `Modal`. The
native `window.confirm`/`alert`/`prompt` are OS-chrome windows that ignore the
theme entirely, so there are **zero** calls to them in this codebase — keep it
that way.

`src/components/ui/PromptModals.tsx` holds the two generic ones:

| Component | Replaces | Notes |
|---|---|---|
| `ConfirmModal` | `window.confirm` | `tone="danger"` (default) or `"primary"`; pass `confirmIcon` and an optional `title` |

Every confirmation in the app routes through `ConfirmModal` — snippet delete,
logout and the settings "Reset all data" all do — so they can't visually drift
apart. A new one is a call site, not a new component.

`theme.ts` sets the `Modal` defaults (`radius`, `centered`, `withCloseButton`,
`closeOnEscape`), so **Escape dismisses every modal** and each one has a close
button. `closeOnEscape` is Mantine's default anyway; it's written out because
it's a guarantee the app makes, not an incidental inherited one.

Modals don't render their children while closed (no `keepMounted`), so form
state resets on each open for free. Where the *reopened* content must reflect
the last save rather than the server's original seed — `SettingsModal` — keep
that value in the always-mounted wrapper and pass it down.

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
