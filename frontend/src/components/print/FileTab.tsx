import { FileInput, Group, Stack, Text } from "@mantine/core";
import { IconCrop, IconFileTypePdf, IconPhoto } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import { api, appendQueueOptions } from "../../api/client";
import type { PrintResponse, SnippetKind } from "../../api/types";
import { deriveFileName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import type { StringKey } from "../../i18n/strings";
import { notifyError } from "../../notify";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { SecondaryButton } from "../ui/Buttons";
import { CropModal, type CropBox } from "../ui/CropModal";
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
  /** Whether this tab is the canvas composer or a plain file printer. */
  composer?: boolean;
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
export const FILE_TABS: Record<"photo" | "image" | "pdf", FileTabConfig> = {
  // "Print this photo", with nothing in the way: pick a file, crop it if you
  // want, print. The composer is the wrong tool for that, and was the only
  // way to print an image at all until this tab existed.
  photo: {
    url: "/print/image",
    accept: "image/*",
    kind: "image",
    printLabelKey: "print_image_btn",
  },
  image: {
    url: "/print/image",
    accept: "image/*",
    kind: "image",
    printLabelKey: "print_compose_btn",
    composer: true,
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

  const editing = config.composer === true;
  const pageWidth = settings?.paper_width_px ?? 576;

  const [state, setState] = useState<EditorState>(EMPTY_STATE);
  const [images] = useState(() => new Map<string, Rendered>());
  const [loading, setLoading] = useState(false);
  // Bumped whenever the image map changes, since a Map mutation is invisible
  // to React's identity check and the canvas would otherwise not redraw.
  const [, bump] = useState(0);

  const kindLabelKey = config.kind === "image" ? "kind_image" : "kind_pdf";

  // PDF tab only: a preview of the chosen document, and an optional crop box
  // that the server applies to every page (a PDF can't be cropped in-browser).
  const [pdfPreview, setPdfPreview] = useState<{ url: string; page: number; pages: number } | null>(
    null,
  );
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfCrop, setPdfCrop] = useState<CropBox | null>(null);
  const [cropping, setCropping] = useState(false);
  // Images picked for the composer wait here until they have been offered a
  // crop, one at a time.
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingRest, setPendingRest] = useState<File[]>([]);

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

  // Object URL for the plain image tab's preview, revoked when it changes.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (editing || !file || config.kind !== "image") {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [editing, file, config.kind]);

  /**
   * Show the chosen PDF as it will print, a page at a time.
   *
   * Rendered by `/print/pdf-page` — the same rasterizer the print itself uses
   * — so the preview can't disagree with the paper, and a PDF the renderer
   * can't open says so here rather than at print time.
   */
  useEffect(() => {
    if (editing || !file || config.kind !== "pdf") {
      setPdfPreview(null);
      setPdfCrop(null);
      return;
    }
    let stale = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const { blob, pageCount } = await rasterizePdf(file, pdfPage);
        if (stale) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfPreview({ url: objectUrl, page: pdfPage, pages: pageCount });
      } catch (error) {
        if (!stale) {
          setPdfPreview(null);
          notifyError(error instanceof Error ? error.message : t("status_error"));
        }
      }
    })();
    return () => {
      stale = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [editing, file, config.kind, pdfPage, rasterizePdf, t]);

  const reset = () => {
    state.items.forEach((item) => dropCache(item.id));
    images.clear();
    setState(EMPTY_STATE);
    setFile(null);
    setPdfPage(1);
    setPdfCrop(null);
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
      // A PDF is cropped by the server, per page — see printer.crop_fractions.
      if (!editing && pdfCrop) form.set("crop", JSON.stringify(pdfCrop));
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
        : {
            kind: config.kind,
            file: outgoing,
            crop: !editing && pdfCrop ? JSON.stringify(pdfCrop) : null,
          },
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
            // Images get the crop step before they land on the canvas; a PDF
            // can't be cropped in the browser and goes straight in, where the
            // editor's own crop tool covers it.
            onAddFiles={(files) => {
              const pdfs = files.filter((f) => f.type === "application/pdf");
              const pictures = files.filter((f) => f.type !== "application/pdf");
              if (pdfs.length) void addFiles(pdfs);
              if (pictures.length) {
                setPendingImage(pictures[0]);
                setPendingRest(pictures.slice(1));
              }
            }}
            onAddSource={(source, name) => void addSource(source, name)}
            onUpdateSource={(id, source) => void updateSource(id, source)}
            onChangePdfPage={(id, page) => void changePdfPage(id, page)}
            busy={loading}
          />
        </>
      ) : (
        <>
          <FileInput
            value={file}
            onChange={(next) => {
              setFile(next);
              setPdfPage(1);
              setPdfCrop(null);
            }}
            accept={config.accept}
            clearable
            placeholder={t(kindLabelKey)}
            aria-label={t(config.printLabelKey)}
            leftSection={<Icon size={ICON_SIZE.md} stroke={ICON_STROKE} />}
          />

          {file && config.kind === "image" && (
            <Stack gap="xs">
              <Group gap="xs">
                <SecondaryButton
                  size="xs"
                  onClick={() => setPendingImage(file)}
                  icon={<IconCrop size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
                >
                  {t("crop_title")}
                </SecondaryButton>
              </Group>
              <img
                src={photoUrl ?? ""}
                alt={t("preview")}
                style={{
                  maxWidth: 320,
                  display: "block",
                  background: "#fff",
                  border: "1px solid var(--mantine-color-default-border)",
                }}
              />
            </Stack>
          )}

          {pdfPreview && (
            <Stack gap="xs">
              <Group gap="xs" wrap="wrap">
                <Text size="xs" c="dimmed">
                  {t("pdf_preview_page")
                    .replace("{page}", String(pdfPreview.page))
                    .replace("{pages}", String(pdfPreview.pages))}
                </Text>
                {pdfPreview.pages > 1 && (
                  <>
                    <SecondaryButton
                      size="xs"
                      disabled={pdfPage <= 1}
                      onClick={() => setPdfPage((page) => Math.max(1, page - 1))}
                    >
                      {"<"}
                    </SecondaryButton>
                    <SecondaryButton
                      size="xs"
                      disabled={pdfPage >= pdfPreview.pages}
                      onClick={() =>
                        setPdfPage((page) => Math.min(pdfPreview.pages, page + 1))
                      }
                    >
                      {">"}
                    </SecondaryButton>
                  </>
                )}
                <SecondaryButton
                  size="xs"
                  onClick={() => setCropping(true)}
                  icon={<IconCrop size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
                >
                  {pdfCrop ? t("crop_change") : t("crop_title")}
                </SecondaryButton>
                {pdfCrop && (
                  <SecondaryButton size="xs" onClick={() => setPdfCrop(null)}>
                    {t("crop_clear")}
                  </SecondaryButton>
                )}
              </Group>
              <div style={{ position: "relative", maxWidth: 320 }}>
                <img
                  src={pdfPreview.url}
                  alt={t("preview")}
                  style={{
                    width: "100%",
                    display: "block",
                    background: "#fff",
                    border: "1px solid var(--mantine-color-default-border)",
                  }}
                />
                {pdfCrop && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${pdfCrop.x * 100}%`,
                      top: `${pdfCrop.y * 100}%`,
                      width: `${pdfCrop.w * 100}%`,
                      height: `${pdfCrop.h * 100}%`,
                      border: "2px dashed var(--mantine-primary-color-filled)",
                    }}
                  />
                )}
              </div>
            </Stack>
          )}

          {cropping && pdfPreview && (
            <CropModal
              previewUrl={pdfPreview.url}
              onCancel={() => setCropping(false)}
              onDone={({ box }) => {
                setCropping(false);
                setPdfCrop(box);
              }}
            />
          )}
        </>
      )}

      {/* Composer uploads are offered a crop one image at a time. */}
      {pendingImage && (
        <CropModal
          file={pendingImage}
          onCancel={() => {
            setPendingImage(null);
            setPendingRest([]);
          }}
          onDone={({ cropped }) => {
            const next = cropped ?? pendingImage;
            const [head, ...rest] = pendingRest;
            setPendingImage(head ?? null);
            setPendingRest(rest);
            // On the plain image tab there is no canvas to add to: the crop
            // simply becomes the file that gets printed.
            if (!editing) {
              setFile(next);
              return;
            }
            void addFiles([next]);
          }}
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
        scheduleOnly={options.chosen}
      />
    </Stack>
  );
}
