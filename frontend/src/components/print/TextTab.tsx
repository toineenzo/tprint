import { Stack, Textarea } from "@mantine/core";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type { PrintResponse } from "../../api/types";
import { usePrint } from "../../hooks/usePrint";
import { deriveName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import { PrintActions } from "./PrintActions";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";

export function TextTab() {
  const t = useStrings();
  const [text, setText] = useState("");
  const [saveAsSnippet, setSaveAsSnippet] = useState(false);
  const options = useQueueOptions();
  const { print, busy } = usePrint();
  const saveSnippet = useSaveAsSnippet();

  const empty = !text.trim();

  const send = async (queue: boolean) => {
    const body = queue ? { text, ...options.toPayload() } : { text };
    const ok = await print(async () => {
      if (saveAsSnippet) {
        await saveSnippet(deriveName(text, t("kind_text")), (form) => {
          form.set("kind", "text");
          form.set("text_content", text.trim());
        });
      }
      return api.postJson<PrintResponse>("/print/text", body);
    });
    if (ok) {
      setText("");
      setSaveAsSnippet(false);
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
        saveAsSnippet={saveAsSnippet}
        onSaveAsSnippetChange={setSaveAsSnippet}
      />
    </Stack>
  );
}
