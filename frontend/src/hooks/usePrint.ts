import { useCallback } from "react";

import { useStrings } from "../AppContext";
import { useAppData } from "../AppData";
import type { PrintResponse } from "../api/types";
import { flyToTarget } from "../flight";
import { useSubmit } from "./useSubmit";

/**
 * The one place a print request is fired.
 *
 * The endpoints answer either {"status":"printed"} or {"status":"queued"}, so
 * the toast is chosen from the response rather than from which button was
 * pressed — a request carrying a `run_at` is queued even when submitted with
 * the plain Print button.
 *
 * The same response picks where the "it went over there" animation flies to,
 * for the same reason: a print lands in history, a queued job lands in the
 * queue, and only the server knows which happened. Hooking it here means every
 * print button in the app animates without knowing this exists.
 */
export function usePrint() {
  const t = useStrings();
  const { refreshAll } = useAppData();
  const { submit, busy } = useSubmit();

  const print = useCallback(
    async (action: () => Promise<PrintResponse>): Promise<boolean> => {
      const result = await submit(action, (response) =>
        response.status === "queued" ? t("status_queued") : t("status_printed"),
      );
      if (result !== undefined) {
        // Fired before the refresh so it starts while the button is still
        // under the pointer, rather than after the lists re-render.
        flyToTarget(result.status === "queued" ? "queue" : "history");
      }
      await refreshAll();
      return result !== undefined;
    },
    [submit, refreshAll, t],
  );

  return { print, busy };
}
