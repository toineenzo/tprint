import { Image, SegmentedControl, Select, Stack, Text, Textarea } from "@mantine/core";
import { useEffect, useState } from "react";

import { useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type { CodeFormat, PrintResponse } from "../../api/types";
import { deriveName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import { ROLE } from "../../theme";
import { PrintActions } from "./PrintActions";
import { usePrintGate } from "./PrintGate";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";

/**
 * code128 first because it's the only one that takes arbitrary text — a URL or
 * a free-form ID. The rest have strict length/character rules and will be
 * rejected by the server with a specific message if the data doesn't fit.
 */
const SYMBOLOGIES = ["code128", "code39", "ean13", "ean8", "upca", "isbn13", "issn", "itf"];

/**
 * The code as the printer would render it, drawn while you type.
 *
 * Rendered by the server through `/print/code-image` — the same call the
 * composer makes — rather than by a client-side QR library, so what's on
 * screen is the exact bitmap that gets sent to the printer, and a barcode the
 * symbology can't encode surfaces its error here instead of at print time.
 */
function CodePreview({
  data,
  format,
  symbology,
}: {
  data: string;
  format: CodeFormat;
  symbology: string;
}) {
  const t = useStrings();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data.trim()) {
      setUrl(null);
      setError(null);
      return;
    }
    let stale = false;
    let objectUrl: string | null = null;
    // Debounced: every keystroke would otherwise re-render a code server-side.
    const timer = setTimeout(async () => {
      const form = new FormData();
      form.set("data", data);
      form.set("format", format);
      form.set("symbology", symbology);
      try {
        const response = await fetch("/print/code-image", { method: "POST", body: form });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          if (!stale) {
            setUrl(null);
            setError(detail?.detail ?? t("status_error"));
          }
          return;
        }
        objectUrl = URL.createObjectURL(await response.blob());
        if (stale) return;
        setUrl(objectUrl);
        setError(null);
      } catch {
        if (!stale) setError(t("status_error"));
      }
    }, 300);

    return () => {
      stale = true;
      clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data, format, symbology, t]);

  if (error) {
    return (
      <Text size="sm" c={ROLE.danger}>
        {error}
      </Text>
    );
  }
  if (!url) return null;

  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        {t("code_preview")}
      </Text>
      <Image
        src={url}
        alt={t("code_preview")}
        fit="contain"
        maw={260}
        style={{
          background: "#fff",
          border: "1px solid var(--mantine-color-default-border)",
        }}
      />
    </Stack>
  );
}

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

      <CodePreview data={data} format={format} symbology={symbology} />

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
        scheduleOnly={options.chosen}
      />
    </Stack>
  );
}
