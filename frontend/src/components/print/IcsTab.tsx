import { Checkbox, FileInput, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { IconCalendarEvent } from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api, appendQueueOptions } from "../../api/client";
import type {
  AgendaOrientation,
  AgendaOverview,
  IcsMode,
  PrintResponse,
} from "../../api/types";
import { deriveFileName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import { usePrintGate } from "./PrintGate";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrintActions } from "./PrintActions";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";

export function IcsTab() {
  const t = useStrings();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<IcsMode>("single");
  const [overview, setOverview] = useState<AgendaOverview>("none");
  const [orientation, setOrientation] = useState<AgendaOrientation>("vertical");
  const [saveAsSnippet, setSaveAsSnippet] = useState(false);
  const options = useQueueOptions();
  const { runPrint, busy } = usePrintGate();
  const saveSnippet = useSaveAsSnippet();

  const send = async (queue: boolean) => {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);
    form.set("overview", overview);
    form.set("orientation", orientation);
    if (queue) appendQueueOptions(form, options.toPayload());
    const ok = await runPrint(
      async () => {
      if (saveAsSnippet) {
        // Stores the .ics itself, so reprinting re-parses the calendar rather
        // than replaying one frozen rendering of it.
        await saveSnippet(deriveFileName(file, t("kind_ics")), (snippet) => {
          snippet.set("kind", "ics");
          snippet.set("files", file);
          snippet.set("mode", mode);
          snippet.set("overview", overview);
          snippet.set("orientation", orientation);
        });
      }
        return api.postForm<PrintResponse>("/print/ics", form);
      },
      { kind: "ics", file, mode, overview, orientation },
      { queued: queue },
    );
    if (ok) {
      setFile(null);
      setSaveAsSnippet(false);
      options.reset();
    }
  };

  return (
    <Stack gap="sm">
      <FileInput
        label={t("ics_upload_label")}
        aria-label={t("ics_upload_label")}
        value={file}
        onChange={setFile}
        accept=".ics,text/calendar"
        clearable
        leftSection={
          <IconCalendarEvent size={ICON_SIZE.md} stroke={ICON_STROKE} />
        }
      />

      <Select
        aria-label={t("print_ics_btn")}
        value={mode}
        onChange={(value) => setMode((value as IcsMode) ?? "single")}
        allowDeselect={false}
        data={[
          { value: "single", label: t("ics_mode_single") },
          { value: "day", label: t("ics_mode_day") },
          { value: "separate", label: t("ics_mode_separate") },
        ]}
      />

      <Stack gap={4}>
        <Checkbox
          label={t("agenda_overview")}
          description={t("agenda_overview_hint")}
          checked={overview !== "none"}
          onChange={(event) =>
            setOverview(event.currentTarget.checked ? "month" : "none")
          }
        />
        {overview !== "none" && (
          <SegmentedControl
            size="xs"
            value={overview}
            onChange={(value) => setOverview(value as AgendaOverview)}
            data={[
              { value: "week", label: t("agenda_overview_week") },
              { value: "month", label: t("agenda_overview_month") },
            ]}
          />
        )}
      </Stack>

      {/* Orientation only means anything for a per-day slip: an agenda that
          runs to several receipts has nothing to turn sideways. */}
      {mode === "day" && (
        <Stack gap={4}>
          <Text size="sm">{t("agenda_orientation")}</Text>
          <SegmentedControl
            size="xs"
            value={orientation}
            onChange={(value) => setOrientation(value as AgendaOrientation)}
            data={[
              { value: "vertical", label: t("agenda_vertical") },
              { value: "horizontal", label: t("agenda_horizontal") },
            ]}
          />
          <Text size="xs" c="dimmed">
            {orientation === "horizontal"
              ? t("agenda_horizontal_hint")
              : t("agenda_vertical_hint")}
          </Text>
        </Stack>
      )}

      <QueueOptionsFields value={options.state} onChange={options.setState} />

      <PrintActions
        printLabelKey="print_ics_btn"
        busy={busy}
        disabled={!file}
        onPrint={() => send(false)}
        onQueue={() => send(true)}
        saveAsSnippet={saveAsSnippet}
        onSaveAsSnippetChange={setSaveAsSnippet}
        queueDisabled={!options.complete}
      />
    </Stack>
  );
}
