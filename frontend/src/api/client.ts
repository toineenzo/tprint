export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type FastApiValidationItem = { loc?: unknown[]; msg?: string };

/**
 * FastAPI reports 4xx two different ways: `{"detail": "some message"}` from an
 * explicit HTTPException, and `{"detail": [{loc, msg, ...}]}` from pydantic
 * validation. The old app.js only handled the first and rendered the second as
 * "[object Object]".
 */
function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail)) {
    const parts = (detail as FastApiValidationItem[])
      .map((item) => {
        const field = item.loc?.filter((p) => p !== "body").join(".");
        return field ? `${field}: ${item.msg ?? ""}` : (item.msg ?? "");
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return `Request failed (${status})`;
}

/**
 * The name the server picked, out of a Content-Disposition header.
 *
 * `filename*` is read first because it's the one that survives accents — the
 * plain `filename` is an ASCII-folded fallback (see `export.py`), so preferring
 * it would throw away the real name on exactly the installs that need it.
 */
function filenameFrom(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // A malformed escape shouldn't cost the user their download.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1] : null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(errorMessage(body, res.status), res.status);
  }
  return (await res.json().catch(() => ({}))) as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),

  postJson: <T>(url: string, body: unknown) =>
    request<T>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  putJson: <T>(url: string, body: unknown) =>
    request<T>(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  postForm: <T>(url: string, body: FormData) =>
    request<T>(url, { method: "POST", body }),

  /** For endpoints that answer with an image rather than JSON (previews). */
  postFormBlob: async (url: string, body: FormData): Promise<Blob> => {
    const res = await fetch(url, { method: "POST", body });
    if (!res.ok) {
      const parsed = await res.json().catch(() => null);
      throw new ApiError(errorMessage(parsed, res.status), res.status);
    }
    return res.blob();
  },

  /**
   * Fetch a file and hand it to the browser as a download.
   *
   * Deliberately not a plain `<a href download>`: that navigates to whatever
   * the server returns when the request fails, so a 404 replaces the app with
   * a page of raw JSON. Going through fetch keeps a failure inside the app's
   * own error handling, like every other action.
   */
  download: async (url: string, fallbackName: string): Promise<void> => {
    const res = await fetch(url);
    if (!res.ok) {
      const parsed = await res.json().catch(() => null);
      throw new ApiError(errorMessage(parsed, res.status), res.status);
    }
    const href = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = href;
    link.download =
      filenameFrom(res.headers.get("Content-Disposition")) ?? fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Deferred: revoking in the same tick has raced the download in Safari.
    setTimeout(() => URL.revokeObjectURL(href), 0);
  },

  putForm: <T>(url: string, body: FormData) =>
    request<T>(url, { method: "PUT", body }),

  post: <T>(url: string) => request<T>(url, { method: "POST" }),

  del: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};

/**
 * Appends queue/schedule options to a multipart body. Mirrors the JSON shape
 * the same options take on the JSON endpoints, so both paths hit the identical
 * QueueOptions model server-side.
 */
export function appendQueueOptions(
  form: FormData,
  options: {
    run_at?: string | null;
    recurrence?: string | null;
    recurrence_time?: string | null;
    recurrence_days?: number[] | null;
  },
): FormData {
  form.set("queue", "true");
  if (options.run_at) form.set("run_at", options.run_at);
  if (options.recurrence) {
    form.set("recurrence", options.recurrence);
    form.set("recurrence_time", options.recurrence_time || "08:00");
    if (options.recurrence_days?.length) {
      form.set("recurrence_days", options.recurrence_days.join(","));
    }
  }
  return form;
}
