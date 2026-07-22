import { FileInput, Stack } from "@mantine/core";
import { IconFileTypePdf, IconPhoto } from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api, appendQueueOptions } from "../../api/client";
import type { PrintResponse, SnippetKind } from "../../api/types";
import { usePrint } from "../../hooks/usePrint";
import { deriveFileName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import type { StringKey } from "../../i18n/strings";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrintActions } from "./PrintActions";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";

type FileTabConfig = {
  url: string;
  accept: string;
  kind: Extract<SnippetKind, "image" | "pdf">;
  printLabelKey: StringKey;
};

/**
 * The image and PDF tabs are the same form with a different accept filter and
 * endpoint, so they share one implementation rather than the two near-identical
 * copies the old markup and app.js carried.
 */
export const FILE_TABS: Record<"image" | "pdf", FileTabConfig> = {
  image: {
    url: "/print/image",
    accept: "image/*",
    kind: "image",
    printLabelKey: "print_image_btn",
  },
  pdf: {
    url: "/print/pdf",
    accept: "application/pdf",
    kind: "pdf",
    printLabelKey: "print_pdf_btn",
  },
};

export function FileTab({ config }: { config: FileTabConfig }) {
  const t = useStrings();
  const [file, setFile] = useState<File | null>(null);
  const [saveAsSnippet, setSaveAsSnippet] = useState(false);
  const options = useQueueOptions();
  const { print, busy } = usePrint();
  const saveSnippet = useSaveAsSnippet();

  const kindLabelKey = config.kind === "image" ? "kind_image" : "kind_pdf";

  const send = async (queue: boolean) => {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    if (queue) appendQueueOptions(form, options.toPayload());
    const ok = await print(async () => {
      if (saveAsSnippet) {
        await saveSnippet(deriveFileName(file, t(kindLabelKey)), (snippet) => {
          snippet.set("kind", config.kind);
          snippet.set("files", file);
        });
      }
      return api.postForm<PrintResponse>(config.url, form);
    });
    if (ok) {
      setFile(null);
      setSaveAsSnippet(false);
      options.reset();
    }
  };

  const Icon = config.kind === "image" ? IconPhoto : IconFileTypePdf;

  return (
    <Stack gap="sm">
      <FileInput
        value={file}
        onChange={setFile}
        accept={config.accept}
        clearable
        placeholder={t(kindLabelKey)}
        aria-label={t(config.printLabelKey)}
        leftSection={<Icon size={ICON_SIZE.md} stroke={ICON_STROKE} />}
      />

      <QueueOptionsFields value={options.state} onChange={options.setState} />

      <PrintActions
        printLabelKey={config.printLabelKey}
        busy={busy}
        disabled={!file}
        onPrint={() => send(false)}
        onQueue={() => send(true)}
        saveAsSnippet={saveAsSnippet}
        onSaveAsSnippetChange={setSaveAsSnippet}
      />
    </Stack>
  );
}
