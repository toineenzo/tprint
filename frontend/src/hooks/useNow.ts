import { useEffect, useState } from "react";

/**
 * The current time, re-rendering the caller on every tick.
 *
 * Used by the Scheduled panel's clock and its per-item countdowns. It's a
 * separate concern from `usePolled`: the countdowns have to move every second,
 * but the underlying jobs only change when the worker runs one, so this ticks
 * locally instead of pulling the API 60× more often than it used to.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
