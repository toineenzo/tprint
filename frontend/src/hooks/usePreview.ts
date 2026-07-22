import { useCallback, useEffect, useState } from "react";

import { api } from "../api/client";
import type { PreviewRequest } from "../api/types";

/** Build the multipart body POST /print/preview expects. */
export function previewForm(request: PreviewRequest): FormData {
  const form = new FormData();
  form.set("kind", request.kind);
  if (request.text !== undefined) form.set("text", request.text);
  if (request.payload !== undefined) form.set("payload", request.payload);
  if (request.mode) form.set("mode", request.mode);
  if (request.overview) form.set("overview", request.overview);
  if (request.orientation) form.set("orientation", request.orientation);
  if (request.snippet_id !== undefined) {
    form.set("snippet_id", String(request.snippet_id));
  }
  if (request.file) form.set("file", request.file);
  return form;
}

/**
 * Fetch a preview PNG as an object URL, revoking the previous one.
 *
 * Object URLs are used rather than a data: URI because a PDF preview can be
 * megabytes; they must be revoked or the blob is pinned in memory for the life
 * of the page, which matters here since the modal can be reopened repeatedly.
 */
export function usePreviewImage(request: PreviewRequest | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (next: PreviewRequest) => {
    setLoading(true);
    setError(null);
    try {
      const blob = await api.postFormBlob("/print/preview", previewForm(next));
      setUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(blob);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (request) void load(request);
    // Intentionally keyed on the serialized request: a new object identity on
    // every render would otherwise refetch the preview in a loop.
  }, [request && JSON.stringify({ ...request, file: request.file?.name }), load]);

  useEffect(
    () => () => {
      setUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    },
    [],
  );

  return { url, error, loading };
}
