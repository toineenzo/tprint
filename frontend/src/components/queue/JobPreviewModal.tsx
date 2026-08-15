import { Image, Loader, Modal, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

import { useStrings } from "../../AppContext";
import type { QueueJob } from "../../api/types";
import { ROLE } from "../../theme";

/**
 * What a queued or scheduled job would print.
 *
 * Rendered by the server from the job's stored payload — the same content
 * factories the print itself uses — rather than reconstructed from the row's
 * label, which is only ever a truncated summary. A job whose upload has since
 * been cleaned up says so instead of showing a blank sheet.
 */
export function JobPreviewModal({
  job,
  onClose,
}: {
  job: QueueJob | null;
  onClose: () => void;
}) {
  const t = useStrings();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job) {
      setUrl(null);
      setError(null);
      return;
    }
    let stale = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const response = await fetch(`/queue/${job.id}/preview`);
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          if (!stale) setError(detail?.detail ?? t("status_error"));
          return;
        }
        objectUrl = URL.createObjectURL(await response.blob());
        if (stale) return;
        setUrl(objectUrl);
        setError(null);
      } catch {
        if (!stale) setError(t("status_error"));
      }
    })();
    return () => {
      stale = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [job, t]);

  return (
    <Modal
      opened={job !== null}
      onClose={onClose}
      title={job?.label || job?.kind}
      size="md"
    >
      <Stack gap="sm">
        {error && (
          <Text size="sm" c={ROLE.danger}>
            {error}
          </Text>
        )}
        {!error && !url && <Loader size="sm" />}
        {url && (
          <Image
            src={url}
            alt={t("preview")}
            fit="contain"
            maw={320}
            style={{
              background: "#fff",
              border: "1px solid var(--mantine-color-default-border)",
            }}
          />
        )}
      </Stack>
    </Modal>
  );
}
