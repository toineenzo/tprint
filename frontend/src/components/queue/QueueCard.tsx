import { Divider, Stack, Text } from "@mantine/core";
import { IconPlayerPlay, IconStack2 } from "@tabler/icons-react";

import { useStrings } from "../../AppContext";
import { registerFlightTarget } from "../../flight";
import { useAppData } from "../../AppData";
import { api } from "../../api/client";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { SecondaryButton } from "../ui/Buttons";
import { EmptyState } from "../ui/EmptyState";
import { SectionCard } from "../ui/SectionCard";
import { JobRow } from "./jobDisplay";

/**
 * The manual queue: jobs that sit until "Run queue now" is pressed.
 *
 * Scheduled jobs deliberately do not appear here, and this is the only panel
 * carrying the Run button — the two used to share one list and one button,
 * which made it look as though running the queue also fired everything that
 * had been scheduled for later. It never did; now the UI says so.
 */
export function QueueCard() {
  const t = useStrings();
  const { queue, refreshAll } = useAppData();
  const { submit, busy } = useSubmit();

  const manual = queue.filter((job) => !job.scheduled);
  // Finished jobs stay listed as a record of what ran, but they are not what
  // the button acts on — enabling it for a list of nothing but DONE rows
  // invites a press that correctly does nothing.
  const waiting = manual.filter((job) => job.status === "pending");

  return (
    <SectionCard
      elementRef={(element) => registerFlightTarget("queue", element)}
      title={t("queue_panel_title")}
      icon={<IconStack2 size={ICON_SIZE.lg} stroke={ICON_STROKE} />}
      action={
        <SecondaryButton
          size="xs"
          loading={busy}
          disabled={waiting.length === 0}
          icon={<IconPlayerPlay size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
          onClick={async () => {
            await submit(() => api.post("/queue/run"), "status_queue_ran");
            await refreshAll();
          }}
        >
          {t("queue_run_now")}
        </SecondaryButton>
      }
    >
      {manual.length === 0 ? (
        <EmptyState>{t("queue_empty")}</EmptyState>
      ) : (
        <>
          <Text size="xs" c="dimmed" mb="xs">
            {t("queue_manual_hint")}
          </Text>
          <Stack gap="xs">
            {manual.map((job, index) => (
              <div key={job.id}>
                {index > 0 && <Divider mb="xs" />}
                <JobRow
                  job={job}
                  onCancel={async () => {
                    await submit(
                      () => api.del(`/queue/${job.id}`),
                      "status_canceled",
                    );
                    await refreshAll();
                  }}
                />
              </div>
            ))}
          </Stack>
        </>
      )}
    </SectionCard>
  );
}
