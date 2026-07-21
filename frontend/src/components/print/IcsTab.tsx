import { FileInput, Select, Stack } from "@mantine/core";
import { IconCalendarEvent } from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api, appendQueueOptions } from "../../api/client";
import type { PrintMode, PrintResponse } from "../../api/types";
import { usePrint } from "../../hooks/usePrint";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrintActions } from "./PrintActions";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";

export function IcsTab() {
  const t = useStrings();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<PrintMode>("single");
  const options = useQueueOptions();
  const { print, busy } = usePrint();

  const send = async (queue: boolean) => {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);
    if (queue) appendQueueOptions(form, options.toPayload());
    const ok = await print(() => api.postForm<PrintResponse>("/print/ics", form));
    if (ok) {
      setFile(null);
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
        onChange={(value) => setMode((value as PrintMode) ?? "single")}
        allowDeselect={false}
        data={[
          { value: "single", label: t("ics_mode_single") },
          { value: "separate", label: t("ics_mode_separate") },
        ]}
      />

      <QueueOptionsFields value={options.state} onChange={options.setState} />

      <PrintActions
        printLabelKey="print_ics_btn"
        busy={busy}
        disabled={!file}
        onPrint={() => send(false)}
        onQueue={() => send(true)}
      />
    </Stack>
  );
}
