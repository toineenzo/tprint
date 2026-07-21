import { FileInput, Stack } from "@mantine/core";
import { IconFileTypePdf, IconPhoto } from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api, appendQueueOptions } from "../../api/client";
import type { PrintResponse, SnippetKind } from "../../api/types";
import { usePrint } from "../../hooks/usePrint";
import { useQuickSave } from "../../hooks/useQuickSave";
import type { StringKey } from "../../i18n/strings";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { NamePromptModal } from "../ui/PromptModals";
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
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const options = useQueueOptions();
  const { print, busy } = usePrint();
  const { quickSave } = useQuickSave();

  const send = async (queue: boolean) => {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    if (queue) appendQueueOptions(form, options.toPayload());
    const ok = await print(() => api.postForm<PrintResponse>(config.url, form));
    if (ok) {
      setFile(null);
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
        placeholder={t(config.kind === "image" ? "kind_image" : "kind_pdf")}
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
        onQuickSave={() => setNamePromptOpen(true)}
      />

      <NamePromptModal
        opened={namePromptOpen}
        title={t("quick_save_hint")}
        onClose={() => setNamePromptOpen(false)}
        onSubmit={async (name) => {
          setNamePromptOpen(false);
          if (!file) return;
          await quickSave(name, (form) => {
            form.set("kind", config.kind);
            form.set("files", file);
          });
          setFile(null);
        }}
      />
    </Stack>
  );
}
