const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Serialize a Date as a *naive local* ISO string, e.g. "2026-01-31T08:00".
 *
 * This must not be `toISOString()`, which converts to UTC. Scheduling is naive
 * local throughout — the browser used to send `<input type="datetime-local">`
 * values verbatim and app/print_queue.py compares them against
 * `datetime.now()` with no timezone conversion (see the scheduling note in
 * CLAUDE.md). Sending UTC here would silently shift every scheduled job by the
 * server's UTC offset.
 */
export function toNaiveDateTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Serialize a Date as a local "YYYY-MM-DD", for checklist due dates. */
export function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Render a stored timestamp for display, tolerating the "T" separator. */
export function displayTimestamp(value: string): string {
  return value.replace("T", " ");
}

/**
 * Same, without the seconds — for scheduled times, which are only ever set to
 * the minute. Showing ":00" on every row implies a precision the UI can't set.
 */
export function displayMinute(value: string): string {
  return displayTimestamp(value).slice(0, 16);
}

const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * The inverse of `toNaiveDateTime`: read a `run_at` back as a local Date.
 *
 * Built field-by-field rather than via `new Date(string)` on purpose. The
 * parsing rules there are a trap — a date-only string is read as UTC while a
 * date-*time* string without an offset is read as local — so the same helper
 * would shift by the UTC offset depending on the input's shape. Countdowns are
 * only correct if this stays exactly as naive-local as the server's comparison.
 *
 * Returns null on anything unparseable rather than an Invalid Date, so callers
 * have to decide what to render instead of silently showing "NaN".
 */
export function parseNaiveDateTime(value: string | null): Date | null {
  if (!value) return null;
  const match = NAIVE_RE.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0,
  );
}

/** Unit suffixes for `formatCountdown`, so this module stays i18n-free. */
export type CountdownUnits = { d: string; h: string; m: string; s: string };

/**
 * A coarse "time remaining" string: `2d 17h`, `28m 04s`, `45s`.
 *
 * Only ever shows two units. A countdown three days out that ticks its seconds
 * digit is just noise — the precision is spent where it's actually watched.
 * Returns null once the target has passed; the caller renders "due" instead.
 */
export function formatCountdown(
  ms: number,
  units: CountdownUnits,
): string | null {
  if (ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}${units.d} ${hours}${units.h}`;
  if (hours > 0) return `${hours}${units.h} ${pad(minutes)}${units.m}`;
  if (minutes > 0) return `${minutes}${units.m} ${pad(seconds)}${units.s}`;
  return `${seconds}${units.s}`;
}

/** Wall-clock `HH:MM:SS` in the viewer's locale-independent 24h form. */
export function formatClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * The short weekday name for an ISO weekday (1 = Monday … 7 = Sunday).
 *
 * Derived from Intl rather than seven translated strings per language: it's
 * correct for any locale the app grows into, and can't fall out of sync with
 * `app/i18n.py`. 2026-01-04 is a Sunday, so `4 + iso` lands on the right day.
 */
export function weekdayLabel(iso: number, lang: string): string {
  const date = new Date(2026, 0, 4 + iso);
  return new Intl.DateTimeFormat(lang, { weekday: "short" }).format(date);
}
