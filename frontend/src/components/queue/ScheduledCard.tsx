import { Badge, Divider, Group, Stack, Text } from "@mantine/core";
import { IconCalendarClock } from "@tabler/icons-react";

import { useBootstrap, useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import { api } from "../../api/client";
import type { QueueJob } from "../../api/types";
import {
  displayMinute,
  formatClock,
  formatCountdown,
  parseNaiveDateTime,
} from "../../dates";
import { useNow } from "../../hooks/useNow";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../../theme";
import { EmptyState } from "../ui/EmptyState";
import { SectionCard } from "../ui/SectionCard";
import { JobRow, describeRule } from "./jobDisplay";

/** Sort key: soonest first. Jobs with no parseable run_at sink to the bottom. */
function dueAt(job: QueueJob): number {
  return parseNaiveDateTime(job.run_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function Countdown({ job, now }: { job: QueueJob; now: Date }) {
  const t = useStrings();
  const target = parseNaiveDateTime(job.run_at);
  if (!target || job.status !== "pending") return null;

  const remaining = formatCountdown(target.getTime() - now.getTime(), {
    d: t("countdown_days"),
    h: t("countdown_hours"),
    m: t("countdown_minutes"),
    s: t("countdown_seconds"),
  });

  // Past its run time but still pending: the worker polls every 15s, so this is
  // the normal state for a few seconds rather than something being wrong.
  if (!remaining) {
    return (
      <Badge variant="light" color={ROLE.primary} size="sm">
        {t("countdown_due")}
      </Badge>
    );
  }
  return (
    <Text size="xs" c="dimmed">
      {t("countdown_prefix")} {remaining}
    </Text>
  );
}

/**
 * Everything that runs on its own trigger: one-off times and recurring rules.
 *
 * A recurring job is one row showing its rule and its *next* run, not one row
 * per future occurrence — those occurrences don't exist as jobs, and cancelling
 * here means cancelling the rule.
 */
export function ScheduledCard() {
  const t = useStrings();
  const { lang } = useBootstrap();
  const { queue, refreshAll } = useAppData();
  const { submit } = useSubmit();
  const now = useNow();

  const scheduled = queue
    .filter((job) => job.scheduled)
    .sort((a, b) => dueAt(a) - dueAt(b));

  return (
    <SectionCard
      title={t("scheduled_panel_title")}
      icon={<IconCalendarClock size={ICON_SIZE.lg} stroke={ICON_STROKE} />}
      action={
        <Text size="sm" c="dimmed" ff="monospace" aria-live="off">
          {formatClock(now)}
        </Text>
      }
    >
      {scheduled.length === 0 ? (
        <EmptyState>{t("scheduled_empty")}</EmptyState>
      ) : (
        <>
          <Text size="xs" c="dimmed" mb="xs">
            {t("scheduled_hint")}
          </Text>
          <Stack gap="xs">
            {scheduled.map((job, index) => (
              <div key={job.id}>
                {index > 0 && <Divider mb="xs" />}
                <JobRow
                  job={job}
                  detail={
                    <Group gap="xs" wrap="wrap">
                      <Text size="xs" c="dimmed">
                        {describeRule(job, t, lang) ??
                          (job.run_at ? displayMinute(job.run_at) : "")}
                      </Text>
                      {job.recurrence && job.run_at && (
                        <Text size="xs" c="dimmed">
                          → {displayMinute(job.run_at)}
                        </Text>
                      )}
                      <Countdown job={job} now={now} />
                    </Group>
                  }
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
