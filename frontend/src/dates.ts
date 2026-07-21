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
