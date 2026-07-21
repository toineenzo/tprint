import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useBootstrap } from "./AppContext";
import { usePolled } from "./api/hooks";
import { api } from "./api/client";
import type {
  CurrentPrint,
  HistoryEntry,
  QueueJob,
  Snippet,
} from "./api/types";

type AppDataValue = {
  snippets: Snippet[];
  history: HistoryEntry[];
  queue: QueueJob[];
  current: CurrentPrint;
  refreshSnippets: () => Promise<void>;
  /** Re-read everything a print can affect: queue, history, what's printing. */
  refreshAll: () => Promise<void>;
};

const AppDataContext = createContext<AppDataValue | null>(null);

/**
 * Owns every list on the main page.
 *
 * The queue, history and "currently printing" panels poll on the same 5s tick
 * the old app.js used, because a scheduled job can fire without any user
 * action. Snippets don't poll — they only change in response to something the
 * user did here, so they're refetched on demand instead.
 */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const boot = useBootstrap();
  const [snippets, setSnippets] = useState<Snippet[]>(boot.snippets ?? []);

  const history = usePolled<HistoryEntry[]>("/history", boot.history ?? []);
  const queue = usePolled<QueueJob[]>("/queue", []);
  const current = usePolled<CurrentPrint>("/queue/current", {});

  const refreshSnippets = useCallback(async () => {
    try {
      setSnippets(await api.get<Snippet[]>("/snippets"));
    } catch {
      /* keep the last known list */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([history.refresh(), queue.refresh(), current.refresh()]);
  }, [history.refresh, queue.refresh, current.refresh]);

  const value = useMemo(
    () => ({
      snippets,
      history: history.data,
      queue: queue.data,
      current: current.data,
      refreshSnippets,
      refreshAll,
    }),
    [
      snippets,
      history.data,
      queue.data,
      current.data,
      refreshSnippets,
      refreshAll,
    ],
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData(): AppDataValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used inside <AppDataProvider>");
  return value;
}
