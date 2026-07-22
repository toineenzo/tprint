import { useCallback } from "react";

import { useAppData } from "../AppData";
import { api } from "../api/client";

/** Long enough to stay recognisable in the snippet list, short enough not to wrap. */
const MAX_NAME = 60;

/**
 * Name a snippet after its own content, since the "Save as snippet" checkbox
 * deliberately asks for nothing else. Anything unsatisfying is fixable in the
 * snippet edit modal, which already does renaming.
 */
export function deriveName(source: string, fallback: string): string {
  const firstLine = source
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, MAX_NAME).trim() || fallback;
}

/** A file's own name, minus the extension — `holiday.ics` -> `holiday`. */
export function deriveFileName(file: File, fallback: string): string {
  return deriveName(file.name.replace(/\.[^.]+$/, ""), fallback);
}

/**
 * Create a snippet from whatever a print form currently holds.
 *
 * Callers run this *inside* their `usePrint` closure, before the print request,
 * so saving and printing produce a single outcome toast rather than two that
 * can disagree — a green "Printed!" beside a snippet that was never created is
 * worse than one honest error.
 */
export function useSaveAsSnippet() {
  const { refreshSnippets } = useAppData();

  return useCallback(
    async (name: string, fill: (form: FormData) => void) => {
      const form = new FormData();
      form.set("name", name);
      fill(form);
      await api.postForm("/snippets", form);
      await refreshSnippets();
    },
    [refreshSnippets],
  );
}
