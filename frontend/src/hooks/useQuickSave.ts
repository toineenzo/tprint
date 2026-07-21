import { useCallback } from "react";

import { useAppData } from "../AppData";
import { api } from "../api/client";
import type { PrintResponse } from "../api/types";
import { usePrint } from "./usePrint";

/**
 * Save-and-print: create a snippet from what's currently in the form, then
 * print it. Both steps run inside one usePrint call so the user sees a single
 * outcome toast, and a failure in either step surfaces the same way.
 */
export function useQuickSave() {
  const { refreshSnippets } = useAppData();
  const { print, busy } = usePrint();

  const quickSave = useCallback(
    async (name: string, fill: (form: FormData) => void) => {
      await print(async () => {
        const form = new FormData();
        form.set("name", name);
        fill(form);
        const created = await api.postForm<{ id: number }>("/snippets", form);
        await refreshSnippets();
        return api.post<PrintResponse>(`/snippets/${created.id}/print`);
      });
    },
    [print, refreshSnippets],
  );

  return { quickSave, busy };
}
