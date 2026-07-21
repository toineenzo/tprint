import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";

/**
 * Fetches `url` on mount and every `intervalMs`, seeded with server-rendered
 * data so the first paint is already populated.
 *
 * Fetch failures are swallowed on purpose: this drives the queue, history and
 * "currently printing" panels, which poll continuously. The old app.js did the
 * same — a transient network hiccup should leave the last known list on screen
 * rather than blanking it or raising a toast every few seconds.
 */
export function usePolled<T>(url: string, initial: T, intervalMs = 5000) {
  const [data, setData] = useState<T>(initial);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await api.get<T>(url);
      if (mounted.current) setData(next);
    } catch {
      /* keep the last known value */
    }
  }, [url]);

  useEffect(() => {
    mounted.current = true;
    const id = window.setInterval(refresh, intervalMs);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
    };
  }, [refresh, intervalMs]);

  return { data, refresh };
}
