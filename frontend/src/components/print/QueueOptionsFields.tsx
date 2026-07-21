import { Accordion, Select, Stack, Text } from "@mantine/core";
import { DateTimePicker, TimeInput } from "@mantine/dates";
import { IconClock, IconRepeat } from "@tabler/icons-react";
import { useCallback, useState } from "react";

import { useStrings } from "../../AppContext";
import type { QueueOptions, Recurrence } from "../../api/types";
import { toNaiveDateTime } from "../../dates";
import { ICON_SIZE, ICON_STROKE } from "../../theme";

const DEFAULT_TIME = "08:00";

export type QueueOptionsState = {
  runAt: Date | null;
  recurrence: Recurrence | null;
  recurrenceTime: string;
};

const EMPTY: QueueOptionsState = {
  runAt: null,
  recurrence: null,
  recurrenceTime: DEFAULT_TIME,
};

/**
 * Schedule state for one print form. Every tab owns its own instance, which is
 * what the old markup did by prefixing element ids (`text-run-at`, `pdf-run-at`
 * and so on).
 */
export function useQueueOptions() {
  const [state, setState] = useState<QueueOptionsState>(EMPTY);

  const toPayload = useCallback(
    (): QueueOptions => ({
      queue: true,
      run_at: state.runAt ? toNaiveDateTime(state.runAt) : null,
      recurrence: state.recurrence,
      recurrence_time: state.recurrence
        ? state.recurrenceTime || DEFAULT_TIME
        : null,
    }),
    [state],
  );

  const reset = useCallback(() => setState(EMPTY), []);

  return { state, setState, toPayload, reset };
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

  const recurrenceOptions = [
    { value: "", label: t("recurrence_none") },
    { value: "daily", label: t("recurrence_daily") },
    { value: "weekly", label: t("recurrence_weekly") },
    { value: "monthly", label: t("recurrence_monthly") },
  ];

  return (
    <Accordion variant="contained" chevronPosition="left">
      <Accordion.Item value="schedule">
        <Accordion.Control
          icon={<IconClock size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          <Text size="sm">{t("schedule_options")}</Text>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            {/* Mantine renders DateTimePicker and FileInput as <button>, which
                a visible <label> does not name the way it names an <input> —
                hence the explicit aria-label on every one of them. */}
            <DateTimePicker
              label={t("run_at_label")}
              aria-label={t("run_at_label")}
              description={t("run_at_hint")}
              placeholder="—"
              clearable
              valueFormat="YYYY-MM-DD HH:mm"
              leftSection={
                <IconClock size={ICON_SIZE.md} stroke={ICON_STROKE} />
              }
              value={value.runAt}
              onChange={(runAt) => onChange({ ...value, runAt })}
            />

            <Select
              label={t("recurrence_label")}
              data={recurrenceOptions}
              allowDeselect={false}
              leftSection={
                <IconRepeat size={ICON_SIZE.md} stroke={ICON_STROKE} />
              }
              value={value.recurrence ?? ""}
              onChange={(next) =>
                onChange({
                  ...value,
                  recurrence: (next || null) as Recurrence | null,
                })
              }
            />

            {value.recurrence && (
              <TimeInput
                label={t("recurrence_time_label")}
                leftSection={
                  <IconClock size={ICON_SIZE.md} stroke={ICON_STROKE} />
                }
                value={value.recurrenceTime}
                onChange={(event) =>
                  onChange({
                    ...value,
                    recurrenceTime: event.currentTarget.value,
                  })
                }
              />
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
