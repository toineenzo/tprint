import { Badge, Divider, Group, Stack, Text } from "@mantine/core";
import { IconPlayerPlay, IconRepeat, IconStack2, IconX } from "@tabler/icons-react";

import { useStrings } from "../AppContext";
import { useAppData } from "../AppData";
import { api } from "../api/client";
import type { QueueJob, QueueStatus } from "../api/types";
import { displayTimestamp } from "../dates";
import { useSubmit } from "../hooks/useSubmit";
import type { StringKey } from "../i18n/strings";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../theme";
import { SecondaryButton } from "./ui/Buttons";
import { EmptyState } from "./ui/EmptyState";
import { IconActionButton } from "./ui/IconActionButton";
import { SectionCard } from "./ui/SectionCard";
import { TypeBadge } from "./ui/TypeBadge";

const STATUS_LABEL: Record<QueueStatus, StringKey> = {
  pending: "queue_status_pending",
  running: "queue_status_running",
  done: "queue_status_done",
  failed: "queue_status_failed",
  canceled: "queue_status_canceled",
};

/** Only a failure is coloured; the rest stay neutral so they don't compete. */
const STATUS_COLOR: Record<QueueStatus, string> = {
  pending: ROLE.muted,
  running: ROLE.primary,
  done: ROLE.muted,
  failed: ROLE.danger,
  canceled: ROLE.muted,
};

const RECURRENCE_LABEL = {
  daily: "recurrence_daily",
  weekly: "recurrence_weekly",
  monthly: "recurrence_monthly",
} as const satisfies Record<string, StringKey>;

function QueueRow({ job, onCancel }: { job: QueueJob; onCancel: () => void }) {
  const t = useStrings();

  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
      <Stack gap={4} miw={0}>
        <Text size="sm" fw={600} truncate>
          {job.label || job.kind}
        </Text>
        <Group gap="xs" wrap="wrap">
          <TypeBadge kind={job.kind} />
          <Badge variant="light" color={STATUS_COLOR[job.status]} size="sm">
            {t(STATUS_LABEL[job.status] ?? "queue_status_pending")}
          </Badge>
          {job.run_at && (
            <Text size="xs" c="dimmed">
              {displayTimestamp(job.run_at)}
            </Text>
          )}
          {job.recurrence && (
            <Group gap={4} wrap="nowrap">
              <IconRepeat size={ICON_SIZE.sm} stroke={ICON_STROKE} />
              <Text size="xs" c="dimmed">
                {t(RECURRENCE_LABEL[job.recurrence])} {job.recurrence_time}
              </Text>
            </Group>
          )}
        </Group>
        {job.error && (
          <Text size="xs" c={ROLE.danger}>
            {job.error}
          </Text>
        )}
      </Stack>

      {job.status === "pending" && (
        <IconActionButton label={t("cancel")} tone="danger" onClick={onCancel}>
          <IconX size={ICON_SIZE.md} stroke={ICON_STROKE} />
        </IconActionButton>
      )}
    </Group>
  );
}

export function QueueCard() {
  const t = useStrings();
  const { queue, refreshAll } = useAppData();
  const { submit, busy } = useSubmit();

  return (
    <SectionCard
      title={t("queue_panel_title")}
      icon={<IconStack2 size={ICON_SIZE.lg} stroke={ICON_STROKE} />}
      action={
        <SecondaryButton
          size="xs"
          loading={busy}
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
      {queue.length === 0 ? (
        <EmptyState>{t("queue_empty")}</EmptyState>
      ) : (
        <Stack gap="xs">
          {queue.map((job, index) => (
            <div key={job.id}>
              {index > 0 && <Divider mb="xs" />}
              <QueueRow
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
      )}
    </SectionCard>
  );
}
