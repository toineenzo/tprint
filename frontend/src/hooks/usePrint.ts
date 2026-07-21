import { useCallback } from "react";

import { useStrings } from "../AppContext";
import { useAppData } from "../AppData";
import type { PrintResponse } from "../api/types";
import { useSubmit } from "./useSubmit";

/**
 * The one place a print request is fired.
 *
 * The endpoints answer either {"status":"printed"} or {"status":"queued"}, so
 * the toast is chosen from the response rather than from which button was
 * pressed — a request carrying a `run_at` is queued even when submitted with
 * the plain Print button.
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
      await refreshAll();
      return result !== undefined;
    },
    [submit, refreshAll, t],
  );

  return { print, busy };
}
