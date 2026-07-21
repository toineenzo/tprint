import { Stack, Textarea } from "@mantine/core";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type { PrintResponse } from "../../api/types";
import { usePrint } from "../../hooks/usePrint";
import { useQuickSave } from "../../hooks/useQuickSave";
import { NamePromptModal } from "../ui/PromptModals";
import { PrintActions } from "./PrintActions";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";

export function TextTab() {
  const t = useStrings();
  const [text, setText] = useState("");
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const options = useQueueOptions();
  const { print, busy } = usePrint();
  const { quickSave } = useQuickSave();

  const empty = !text.trim();

  const send = async (queue: boolean) => {
    const body = queue ? { text, ...options.toPayload() } : { text };
    const ok = await print(() => api.postJson<PrintResponse>("/print/text", body));
    if (ok) {
      setText("");
      options.reset();
    }
  };

  return (
    <Stack gap="sm">
      <Textarea
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        placeholder={t("text_placeholder")}
        autosize
        minRows={6}
        maxRows={16}
      />

      <QueueOptionsFields value={options.state} onChange={options.setState} />

      <PrintActions
        printLabelKey="print_text_btn"
        busy={busy}
        disabled={empty}
        onPrint={() => send(false)}
        onQueue={() => send(true)}
        onQuickSave={() => setNamePromptOpen(true)}
      />

      <NamePromptModal
        opened={namePromptOpen}
        title={t("quick_save_hint")}
        onClose={() => setNamePromptOpen(false)}
        onSubmit={async (name) => {
          setNamePromptOpen(false);
          await quickSave(name, (form) => {
            form.set("kind", "text");
            form.set("text_content", text.trim());
          });
          setText("");
        }}
      />
    </Stack>
  );
}
