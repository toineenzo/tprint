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

  postForm: <T>(url: string, body: FormData) =>
    request<T>(url, { method: "POST", body }),

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
  },
): FormData {
  form.set("queue", "true");
  if (options.run_at) form.set("run_at", options.run_at);
  if (options.recurrence) {
    form.set("recurrence", options.recurrence);
    form.set("recurrence_time", options.recurrence_time || "08:00");
  }
  return form;
}
