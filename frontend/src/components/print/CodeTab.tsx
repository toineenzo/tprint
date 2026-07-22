import { SegmentedControl, Select, Stack, Textarea } from "@mantine/core";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type { CodeFormat, PrintResponse } from "../../api/types";
import { deriveName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import { PrintActions } from "./PrintActions";
import { usePrintGate } from "./PrintGate";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";

/**
 * code128 first because it's the only one that takes arbitrary text — a URL or
 * a free-form ID. The rest have strict length/character rules and will be
 * rejected by the server with a specific message if the data doesn't fit.
 */
const SYMBOLOGIES = ["code128", "code39", "ean13", "ean8", "upca", "isbn13", "issn", "itf"];

export function CodeTab() {
  const t = useStrings();
  const [data, setData] = useState("");
  const [format, setFormat] = useState<CodeFormat>("qr");
  const [symbology, setSymbology] = useState("code128");
  const [saveAsSnippet, setSaveAsSnippet] = useState(false);
  const options = useQueueOptions();
  const { runPrint, busy } = usePrintGate();
  const saveSnippet = useSaveAsSnippet();

  const empty = !data.trim();

  const send = async (queue: boolean) => {
    const body = {
      data,
      format,
      symbology,
      ...(queue ? options.toPayload() : {}),
    };
    const ok = await runPrint(
      async () => {
        if (saveAsSnippet) {
          // Stored as text: a snippet keeps what you typed, and reprinting it
          // re-encodes rather than storing a picture of a code.
          await saveSnippet(deriveName(data, t("kind_code")), (form) => {
            form.set("kind", "text");
            form.set("text_content", data.trim());
          });
        }
        return api.postJson<PrintResponse>("/print/code", body);
      },
      { kind: "code", payload: JSON.stringify({ data, format, symbology }) },
      { queued: queue },
    );
    if (ok) {
      setData("");
      setSaveAsSnippet(false);
      options.reset();
    }
  };

  return (
    <Stack gap="sm">
      <Textarea
        value={data}
        onChange={(event) => setData(event.currentTarget.value)}
        placeholder={t("code_placeholder")}
        description={t("code_hint")}
        autosize
        minRows={2}
        maxRows={6}
      />

      <SegmentedControl
        fullWidth
        value={format}
        onChange={(value) => setFormat(value as CodeFormat)}
        data={[
          { value: "qr", label: t("code_format_qr") },
          { value: "barcode", label: t("code_format_barcode") },
        ]}
      />

      {format === "barcode" && (
        <Select
          label={t("code_symbology")}
          description={t("code_symbology_hint")}
          value={symbology}
          allowDeselect={false}
          onChange={(value) => setSymbology(value ?? "code128")}
          data={SYMBOLOGIES}
        />
      )}

      <QueueOptionsFields value={options.state} onChange={options.setState} />

      <PrintActions
        printLabelKey="print_code_btn"
        busy={busy}
        disabled={empty}
        onPrint={() => send(false)}
        onQueue={() => send(true)}
        saveAsSnippet={saveAsSnippet}
        onSaveAsSnippetChange={setSaveAsSnippet}
        queueDisabled={!options.complete}
      />
    </Stack>
  );
}
