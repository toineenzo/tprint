import { FileInput, Stack, Text } from "@mantine/core";
import { IconFileTypePdf, IconPhoto } from "@tabler/icons-react";
import { useCallback, useState } from "react";

import { useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import { api, appendQueueOptions } from "../../api/client";
import type { PrintResponse, SnippetKind } from "../../api/types";
import { deriveFileName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import type { StringKey } from "../../i18n/strings";
import { notifyError } from "../../notify";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrintActions } from "./PrintActions";
import { usePrintGate } from "./PrintGate";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";
import {
  EMPTY_STATE,
  dropCache,
  exportPng,
  loadRendered,
  renderTextBlocks,
  toFlowParts,
  type EditorState,
  type ItemSource,
  type Rendered,
} from "./imageEditor/compose";
import { ImageEditor, newItem } from "./imageEditor/ImageEditor";

type FileTabConfig = {
  url: string;
  accept: string;
  kind: Extract<SnippetKind, "image" | "pdf">;
  printLabelKey: StringKey;
};

/**
 * Two tabs, one implementation: the composer and the plain PDF printer.
 *
 * **Compose** (the old Image tab) is the multi-type canvas. Images, PDF pages,
 * text blocks and codes all become items on a receipt-width page that can be
 * scaled, cropped, rotated, drawn on and dragged. It prints one of two ways —
 * see `EditorState.mode`:
 *
 * - `canvas` flattens the page to a PNG and posts it to /print/image, so what
 *   was arranged is exactly what prints, at the cost of text being a bitmap.
 * - `flow` posts the items as ordered parts to /print/composition, where text
 *   stays real ESC/POS text. Positions are ignored — ESC/POS has no cursor.
 *
 * **PDF** stays a plain whole-document printer: the composer works a page at a
 * time, which is the wrong tool for a ten-page report.
 */
export const FILE_TABS: Record<"image" | "pdf", FileTabConfig> = {
  image: {
    url: "/print/image",
    accept: "image/*",
    kind: "image",
    printLabelKey: "print_compose_btn",
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
  const { settings } = useAppData();
  const [file, setFile] = useState<File | null>(null);
  const [saveAsSnippet, setSaveAsSnippet] = useState(false);
  const options = useQueueOptions();
  const { runPrint, busy } = usePrintGate();
  const saveSnippet = useSaveAsSnippet();

  const editing = config.kind === "image";
  const pageWidth = settings?.paper_width_px ?? 576;

  const [state, setState] = useState<EditorState>(EMPTY_STATE);
  const [images] = useState(() => new Map<string, Rendered>());
  const [loading, setLoading] = useState(false);
  // Bumped whenever the image map changes, since a Map mutation is invisible
  // to React's identity check and the canvas would otherwise not redraw.
  const [, bump] = useState(0);

  const kindLabelKey = config.kind === "image" ? "kind_image" : "kind_pdf";

  /** Rasterize one page of a PDF server-side, reusing the existing renderer. */
  const rasterizePdf = useCallback(
    async (source: File, page: number) => {
      const form = new FormData();
      form.set("file", source);
      form.set("page", String(page));
      const response = await fetch("/print/pdf-page", { method: "POST", body: form });
      if (!response.ok) throw new Error(t("editor_pdf_failed"));
      const pageCount = Number(response.headers.get("X-Page-Count") ?? "1");
      return { blob: await response.blob(), pageCount };
    },
    [t],
  );

  /** Turn any source into the bitmap the canvas draws. */
  const resolve = useCallback(
    async (source: ItemSource): Promise<Rendered> => {
      if (source.kind === "text") return renderTextBlocks(source.blocks, pageWidth);
      if (source.kind === "code") {
        const form = new FormData();
        form.set("data", source.data);
        form.set("format", source.format);
        form.set("symbology", source.symbology);
        // Rendered by the server so a composed code is byte-identical to a
        // standalone one, and the browser needs no QR library.
        const response = await fetch("/print/code-image", { method: "POST", body: form });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.detail ?? t("status_error"));
        }
        return loadRendered(await response.blob());
      }
      if (source.kind === "pdf") {
        const { blob } = await rasterizePdf(source.file, source.page);
        return loadRendered(blob);
      }
      return loadRendered(source.file);
    },
    [pageWidth, rasterizePdf, t],
  );

  const addFiles = useCallback(
    async (incoming: File[]) => {
      if (!incoming.length) return;
      setLoading(true);
      try {
        for (const file of incoming) {
          const source: ItemSource =
            file.type === "application/pdf"
              ? { kind: "pdf", file, page: 1, pageCount: (await rasterizePdf(file, 1)).pageCount }
              : { kind: "image", file };
          const item = newItem(file.name, source);
          images.set(item.id, await resolve(source));
          setState((current) => ({ ...current, items: [...current.items, item] }));
        }
        bump((n) => n + 1);
      } catch (error) {
        notifyError(error instanceof Error ? error.message : t("status_error"));
      } finally {
        setLoading(false);
      }
    },
    [images, rasterizePdf, resolve, t],
  );

  const addSource = useCallback(
    async (source: ItemSource, name: string) => {
      setLoading(true);
      try {
        const item = newItem(name, source);
        images.set(item.id, await resolve(source));
        setState((current) => ({ ...current, items: [...current.items, item] }));
        bump((n) => n + 1);
      } catch (error) {
        notifyError(error instanceof Error ? error.message : t("status_error"));
      } finally {
        setLoading(false);
      }
    },
    [images, resolve, t],
  );

  const updateSource = useCallback(
    async (itemId: string, source: ItemSource) => {
      // Text re-renders instantly; a code needs the server, so failures here
      // leave the previous bitmap in place rather than blanking the item.
      try {
        const rendered = await resolve(source);
        dropCache(itemId);
        images.set(itemId, rendered);
      } catch (error) {
        notifyError(error instanceof Error ? error.message : t("status_error"));
      }
      setState((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === itemId ? { ...item, source } : item,
        ),
      }));
      bump((n) => n + 1);
    },
    [images, resolve, t],
  );

  const changePdfPage = useCallback(
    async (itemId: string, page: number) => {
      const item = state.items.find((candidate) => candidate.id === itemId);
      if (item?.source.kind !== "pdf") return;
      setLoading(true);
      try {
        const next: ItemSource = { ...item.source, page };
        const rendered = await resolve(next);
        dropCache(itemId);
        images.set(itemId, rendered);
        setState((current) => ({
          ...current,
          items: current.items.map((candidate) =>
            // Crop is cleared: it was expressed against the previous page.
            candidate.id === itemId ? { ...candidate, crop: null, source: next } : candidate,
          ),
        }));
        bump((n) => n + 1);
      } catch (error) {
        notifyError(error instanceof Error ? error.message : t("status_error"));
      } finally {
        setLoading(false);
      }
    },
    [images, resolve, state.items, t],
  );

  const reset = () => {
    state.items.forEach((item) => dropCache(item.id));
    images.clear();
    setState(EMPTY_STATE);
    setFile(null);
    setSaveAsSnippet(false);
    options.reset();
  };

  const send = async (queue: boolean) => {
    // Flow mode is the only path that isn't ultimately an image: it sends the
    // items as ordered parts so text stays real ESC/POS text. Canvas mode and
    // the PDF tab both post a single file to their existing endpoint.
    const flow = editing && state.mode === "flow";

    const form = new FormData();
    let outgoing: File | null = null;
    if (flow) {
      const { parts, files } = toFlowParts(state);
      form.set("payload", JSON.stringify({ parts, layout: state }));
      files.forEach((part) => form.append("files", part));
    } else {
      outgoing = editing
        ? await exportPng(state, images, pageWidth, "composition.png")
        : file;
      if (!outgoing) return;
      form.set("file", outgoing);
    }
    if (queue) appendQueueOptions(form, options.toPayload());

    const url = flow ? "/print/composition" : config.url;
    const ok = await runPrint(
      async () => {
        if (saveAsSnippet) await saveTemplate(flow, outgoing);
        return api.postForm<PrintResponse>(url, form);
      },
      // Flow prints have no single image to preview, so the confirm dialog
      // previews the canvas rendering — the same content, laid out for paper.
      flow
        ? { kind: "image", file: await exportPng(state, images, pageWidth) }
        : { kind: config.kind, file: outgoing },
      { queued: queue },
    );
    if (ok) reset();
  };

  /**
   * Save the composition as a reusable template.
   *
   * Stores what to print *and* the editor layout, so it can be reopened rather
   * than only reprinted. Canvas templates store the flattened PNG as part 0 —
   * the server has no canvas renderer and must not need one.
   */
  const saveTemplate = async (flow: boolean, flattened: File | null) => {
    if (!editing) {
      if (flattened) {
        await saveSnippet(deriveFileName(flattened, t(kindLabelKey)), (snippet) => {
          snippet.set("kind", config.kind);
          snippet.set("files", flattened);
        });
      }
      return;
    }

    const name = state.items[0]?.name ?? t("composer_template");
    if (flow) {
      const { parts, files } = toFlowParts(state);
      await saveSnippet(name, (snippet) => {
        snippet.set("kind", "composition");
        snippet.set("payload", JSON.stringify({ mode: "flow", parts, layout: state }));
        files.forEach((part) => snippet.append("files", part));
      });
      return;
    }

    const png = flattened ?? (await exportPng(state, images, pageWidth));
    if (!png) return;
    await saveSnippet(name, (snippet) => {
      snippet.set("kind", "composition");
      snippet.set(
        "payload",
        JSON.stringify({ mode: "canvas", parts: [{ type: "image", file_index: 0 }] }),
      );
      snippet.append("files", png);
    });
  };

  const Icon = config.kind === "image" ? IconPhoto : IconFileTypePdf;
  const nothingToPrint = editing ? state.items.length === 0 : !file;

  return (
    <Stack gap="sm">
      {editing ? (
        <>
          <Text size="xs" c="dimmed">
            {t("editor_intro")}
          </Text>
          <ImageEditor
            state={state}
            onChange={setState}
            images={images}
            pageWidth={pageWidth}
            onAddFiles={(files) => void addFiles(files)}
            onAddSource={(source, name) => void addSource(source, name)}
            onUpdateSource={(id, source) => void updateSource(id, source)}
            onChangePdfPage={(id, page) => void changePdfPage(id, page)}
            busy={loading}
          />
        </>
      ) : (
        <FileInput
          value={file}
          onChange={setFile}
          accept={config.accept}
          clearable
          placeholder={t(kindLabelKey)}
          aria-label={t(config.printLabelKey)}
          leftSection={<Icon size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        />
      )}

      <QueueOptionsFields value={options.state} onChange={options.setState} />

      <PrintActions
        printLabelKey={config.printLabelKey}
        busy={busy || loading}
        disabled={nothingToPrint}
        onPrint={() => void send(false)}
        onQueue={() => void send(true)}
        saveAsSnippet={saveAsSnippet}
        onSaveAsSnippetChange={setSaveAsSnippet}
        queueDisabled={!options.complete}
      />
    </Stack>
  );
}
