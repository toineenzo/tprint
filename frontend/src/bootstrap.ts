import type { HistoryEntry, PrinterSettings, Snippet } from "./api/types";
import type { Strings } from "./i18n/strings";

export type PageName = "index" | "login";

/**
 * The payload app/templates/base.html injects into the page. Rendering the
 * initial snippet/history/settings data server-side (rather than fetching it
 * on mount) keeps the first paint fully populated, the way the old Jinja
 * templates did.
 */
export type Bootstrap = {
  page: PageName;
  lang: string;
  languages: string[];
  native_names: Record<string, string>;
  strings: Partial<Strings>;
  auth_enabled: boolean;
  build_date: string | null;
  /** index page only */
  snippets?: Snippet[];
  history?: HistoryEntry[];
  settings?: PrinterSettings;
  /** Set when the page was reached via `/settings` — opens the modal on load. */
  open_settings?: boolean;
  /** login page only */
  login_error?: string | null;
};

declare global {
  interface Window {
    __TPRINT__?: Bootstrap;
  }
}

export function readBootstrap(): Bootstrap {
  const data = window.__TPRINT__;
  if (!data) {
    throw new Error(
      "window.__TPRINT__ is missing — base.html did not inject the bootstrap payload",
    );
  }
  return data;
}
