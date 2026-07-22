import {
  Accordion,
  Chip,
  Group,
  MultiSelect,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { DateTimePicker, TimeInput } from "@mantine/dates";
import { IconClock } from "@tabler/icons-react";
import { useCallback, useState } from "react";

import { useBootstrap, useStrings } from "../../AppContext";
import type { QueueOptions, Recurrence } from "../../api/types";
import { displayTimestamp, toNaiveDateTime, weekdayLabel } from "../../dates";
import type { Translate } from "../../i18n/strings";
import { ICON_SIZE, ICON_STROKE } from "../../theme";

const DEFAULT_TIME = "08:00";

/**
 * The three ways a print can be timed. Modelled as one exclusive choice
 * because the previous UI wasn't: it offered a "Print on" datetime *and* a
 * separate "At time", which both answered "when", and the server quietly
 * derived one from the other. A job is now either manual, or once, or
 * repeating — never a mixture, and only the relevant fields are rendered.
 */
export type ScheduleMode = "queue" | "once" | "repeat";

export type QueueOptionsState = {
  mode: ScheduleMode;
  runAt: Date | null;
  recurrence: Recurrence;
  /** Weekdays 1-7 when recurrence is weekly; days of month when monthly. */
  recurrenceDays: number[];
  recurrenceTime: string;
};

const EMPTY: QueueOptionsState = {
  mode: "queue",
  runAt: null,
  recurrence: "daily",
  recurrenceDays: [],
  recurrenceTime: DEFAULT_TIME,
};

/** Whether the chosen mode has everything it needs to be scheduled. */
export function isScheduleComplete(state: QueueOptionsState): boolean {
  if (state.mode === "once") return state.runAt !== null;
  if (state.mode === "repeat" && state.recurrence !== "daily") {
    return state.recurrenceDays.length > 0;
  }
  return true;
}

/**
 * Schedule state for one print form. Every tab owns its own instance, which is
 * what the old markup did by prefixing element ids (`text-run-at`, `pdf-run-at`
 * and so on).
 */
export function useQueueOptions() {
  const [state, setState] = useState<QueueOptionsState>(EMPTY);

  const toPayload = useCallback((): QueueOptions => {
    if (state.mode === "once") {
      return {
        queue: true,
        run_at: state.runAt ? toNaiveDateTime(state.runAt) : null,
      };
    }
    if (state.mode === "repeat") {
      return {
        queue: true,
        recurrence: state.recurrence,
        recurrence_time: state.recurrenceTime || DEFAULT_TIME,
        recurrence_days:
          state.recurrence === "daily" ? null : state.recurrenceDays,
      };
    }
    return { queue: true };
  }, [state]);

  const reset = useCallback(() => setState(EMPTY), []);

  return {
    state,
    setState,
    toPayload,
    reset,
    complete: isScheduleComplete(state),
  };
}

/** A one-line description of the current mode, shown on the collapsed control. */
function summarize(state: QueueOptionsState, t: Translate, lang: string): string {
  if (state.mode === "once") {
    return state.runAt
      ? `${t("schedule_mode_once")} · ${displayTimestamp(toNaiveDateTime(state.runAt))}`
      : t("schedule_datetime_hint");
  }
  if (state.mode === "repeat") {
    return `${describeRecurrence(state, t, lang)} · ${state.recurrenceTime || DEFAULT_TIME}`;
  }
  return t("schedule_mode_queue");
}

function describeRecurrence(
  state: QueueOptionsState,
  t: Translate,
  lang: string,
): string {
  if (state.recurrence === "daily") return t("recurrence_daily");
  if (!state.recurrenceDays.length) return t("schedule_days_hint");
  if (state.recurrence === "weekly") {
    const names = state.recurrenceDays.map((day) => weekdayLabel(day, lang));
    return `${t("schedule_every")} ${names.join(", ")}`;
  }
  return `${t("schedule_monthly_on")} ${state.recurrenceDays.join(", ")}`;
}

type Props = {
  value: QueueOptionsState;
  onChange: (next: QueueOptionsState) => void;
};

/**
 * The collapsible schedule panel. Uses Mantine's date/time pickers rather than
 * native `<input type="datetime-local">`/`type="time"`, which rendered an
 * OS-default widget that ignored the app's theme.
 */
export function QueueOptionsFields({ value, onChange }: Props) {
  const t = useStrings();
  const { lang } = useBootstrap();
  const patch = (next: Partial<QueueOptionsState>) =>
    onChange({ ...value, ...next });

  return (
    <Accordion variant="contained" chevronPosition="left">
      <Accordion.Item value="schedule">
        <Accordion.Control
          icon={<IconClock size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          <Group gap="xs" wrap="nowrap" justify="space-between">
            <Text size="sm">{t("schedule_options")}</Text>
            <Text size="xs" c="dimmed" truncate>
              {summarize(value, t, lang)}
            </Text>
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <SegmentedControl
              fullWidth
              value={value.mode}
              onChange={(mode) => patch({ mode: mode as ScheduleMode })}
              data={[
                { value: "queue", label: t("schedule_mode_queue") },
                { value: "once", label: t("schedule_mode_once") },
                { value: "repeat", label: t("schedule_mode_repeat") },
              ]}
            />

            {value.mode === "queue" && (
              <Text size="xs" c="dimmed">
                {t("queue_manual_hint")}
              </Text>
            )}

            {/* Mantine renders DateTimePicker and FileInput as <button>, which
                a visible <label> does not name the way it names an <input> —
                hence the explicit aria-label on every one of them. */}
            {value.mode === "once" && (
              <DateTimePicker
                label={t("run_at_label")}
                aria-label={t("run_at_label")}
                placeholder="—"
                clearable
                valueFormat="YYYY-MM-DD HH:mm"
                leftSection={
                  <IconClock size={ICON_SIZE.md} stroke={ICON_STROKE} />
                }
                value={value.runAt}
                onChange={(runAt) => patch({ runAt })}
                error={value.runAt ? null : t("schedule_datetime_hint")}
              />
            )}

            {value.mode === "repeat" && (
              <>
                <SegmentedControl
                  fullWidth
                  value={value.recurrence}
                  onChange={(next) =>
                    // Weekday numbers and day-of-month numbers occupy the same
                    // field but mean different things, so switching clears it
                    // rather than reinterpreting "3" as the 3rd of the month.
                    patch({ recurrence: next as Recurrence, recurrenceDays: [] })
                  }
                  data={[
                    { value: "daily", label: t("recurrence_daily") },
                    { value: "weekly", label: t("recurrence_weekly") },
                    { value: "monthly", label: t("recurrence_monthly") },
                  ]}
                />

                {value.recurrence === "weekly" && (
                  <Stack gap={6}>
                    <Text size="sm">{t("schedule_days_label")}</Text>
                    <Chip.Group
                      multiple
                      value={value.recurrenceDays.map(String)}
                      onChange={(days) =>
                        patch({ recurrenceDays: days.map(Number).sort((a, b) => a - b) })
                      }
                    >
                      <Group gap={6}>
                        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                          <Chip key={day} value={String(day)} size="sm">
                            {weekdayLabel(day, lang)}
                          </Chip>
                        ))}
                      </Group>
                    </Chip.Group>
                    {!value.recurrenceDays.length && (
                      <Text size="xs" c="red">
                        {t("schedule_days_hint")}
                      </Text>
                    )}
                  </Stack>
                )}

                {value.recurrence === "monthly" && (
                  <MultiSelect
                    label={t("schedule_monthly_days_label")}
                    description={t("schedule_monthly_hint")}
                    placeholder={t("schedule_days_hint")}
                    data={Array.from({ length: 31 }, (_, i) => String(i + 1))}
                    value={value.recurrenceDays.map(String)}
                    onChange={(days) =>
                      patch({ recurrenceDays: days.map(Number).sort((a, b) => a - b) })
                    }
                    error={
                      value.recurrenceDays.length ? null : t("schedule_days_hint")
                    }
                    searchable
                    clearable
                  />
                )}

                <TimeInput
                  label={t("recurrence_time_label")}
                  leftSection={
                    <IconClock size={ICON_SIZE.md} stroke={ICON_STROKE} />
                  }
                  value={value.recurrenceTime}
                  onChange={(event) =>
                    patch({ recurrenceTime: event.currentTarget.value })
                  }
                />
              </>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
