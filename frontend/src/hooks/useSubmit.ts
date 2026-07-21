import { useCallback, useState } from "react";

import { useStrings } from "../AppContext";
import { ApiError } from "../api/client";
import { notifyError, notifySuccess } from "../notify";
import type { StringKey } from "../i18n/strings";

/**
 * Runs an API call with the shared feedback contract: a success or error
 * toast, and a busy flag so the triggering button can show a loader and
 * refuse a double submit.
 *
 * Every mutating action in the app goes through this, so feedback can't drift
 * between one form and the next the way it did when each handler set the
 * status string itself.
 */
export function useSubmit() {
  const t = useStrings();
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async <T,>(
      action: () => Promise<T>,
      successMessage: StringKey | ((result: T) => string),
    ): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await action();
        notifySuccess(
          typeof successMessage === "function"
            ? successMessage(result)
            : t(successMessage),
        );
        return result;
      } catch (error) {
        notifyError(
          error instanceof ApiError ? error.message : t("status_error"),
        );
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  return { submit, busy };
}
