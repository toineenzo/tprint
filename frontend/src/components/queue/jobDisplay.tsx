import { Badge, Group, Stack, Text } from "@mantine/core";
import { IconRepeat, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { useStrings } from "../../AppContext";
import type { QueueJob, QueueStatus } from "../../api/types";
import { weekdayLabel } from "../../dates";
import type { StringKey, Translate } from "../../i18n/strings";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../../theme";
import { IconActionButton } from "../ui/IconActionButton";
import { TypeBadge } from "../ui/TypeBadge";

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

/**
 * A recurrence rule in words: "Every Wed, Fri · 08:00".
 *
 * Weekday names come from `weekdayLabel` (Intl) rather than translated
 * strings, so this stays correct in any locale the app grows into.
 */
export function describeRule(job: QueueJob, t: Translate, lang: string): string | null {
  if (!job.recurrence) return null;
  const time = job.recurrence_time ?? "";
  const days = job.recurrence_days ?? [];

  let rule: string;
  if (job.recurrence === "daily") {
    rule = t("recurrence_daily");
  } else if (job.recurrence === "weekly") {
    rule = days.length
      ? `${t("schedule_every")} ${days.map((day) => weekdayLabel(day, lang)).join(", ")}`
      : t("recurrence_weekly");
  } else {
    rule = days.length
      ? `${t("schedule_monthly_on")} ${days.join(", ")}`
      : t("recurrence_monthly");
  }
  return time ? `${rule} · ${time}` : rule;
}

export function StatusBadge({ status }: { status: QueueStatus }) {
  const t = useStrings();
  return (
    <Badge variant="light" color={STATUS_COLOR[status]} size="sm">
      {t(STATUS_LABEL[status] ?? "queue_status_pending")}
    </Badge>
  );
}

/**
 * The shared shape of a row in either panel: title, type/status badges, then
 * whatever timing detail that panel wants, then the cancel control.
 */
export function JobRow({
  job,
  detail,
  onCancel,
}: {
  job: QueueJob;
  detail?: ReactNode;
  onCancel: () => void;
}) {
  const t = useStrings();

  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
      <Stack gap={4} miw={0}>
        <Text size="sm" fw={600} truncate>
          {job.label || job.kind}
        </Text>
        <Group gap="xs" wrap="wrap">
          <TypeBadge kind={job.kind} />
          <StatusBadge status={job.status} />
          {job.recurrence && (
            <IconRepeat size={ICON_SIZE.sm} stroke={ICON_STROKE} />
          )}
          {detail}
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
