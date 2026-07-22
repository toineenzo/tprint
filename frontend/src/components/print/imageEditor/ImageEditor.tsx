import {
  ActionIcon,
  Group,
  NumberInput,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowBackUp,
  IconCrop,
  IconLetterT,
  IconPhotoPlus,
  IconQrcode,
  IconRotateClockwise,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FileButton } from "@mantine/core";

import { useStrings } from "../../../AppContext";
import { SecondaryButton } from "../../ui/Buttons";
import { ICON_SIZE, ICON_STROKE } from "../../../theme";
import {
  drawPage,
  dropCache,
  hitTest,
  layoutPage,
  type CropRect,
  type EditorItem,
  type EditorState,
  type ItemSource,
  type Placed,
  type Rendered,
  type Rotation,
  type Stroke,
} from "./compose";

type Tool = "move" | "crop" | "draw";

const SHADES = [
  { label: "rt_tint_black", value: 0 },
  { label: "rt_tint_dark", value: 90 },
  { label: "rt_tint_light", value: 160 },
] as const;

let nextId = 0;

export function newItem(name: string, source: ItemSource): EditorItem {
  return { id: `item-${nextId++}`, name, source, rotation: 0, crop: null, scale: 1, x: 0, y: 0 };
}

/**
 * Compose one or more images (and PDF pages) into a single receipt-width image.
 *
 * The canvas is the page at its real dot width, scaled down only for display —
 * so nothing here is an approximation of the print. Strokes live on the page
 * rather than on an item: they're drawn over the composition, and moving an
 * item afterwards doesn't drag the annotation with it.
 */
export function ImageEditor({
  state,
  onChange,
  images,
  pageWidth,
  onAddFiles,
  onAddSource,
  onUpdateSource,
  onChangePdfPage,
  busy,
}: {
  state: EditorState;
  onChange: (next: EditorState) => void;
  images: Map<string, Rendered>;
  pageWidth: number;
  onAddFiles: (files: File[]) => void;
  /** Add a non-file item (a text block or a code) to the page. */
  onAddSource: (source: ItemSource, name: string) => void;
  /** Re-render an item after its text or code settings changed. */
  onUpdateSource: (itemId: string, source: ItemSource) => void;
  /** Re-rasterize an existing PDF item at a different page. */
  onChangePdfPage: (itemId: string, page: number) => void;
  busy?: boolean;
}) {
  const t = useStrings();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("move");
  const [selected, setSelected] = useState<string | null>(null);
  const [penWidth, setPenWidth] = useState(4);
  const [penShade, setPenShade] = useState(0);
  const [cropDrag, setCropDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const cropTarget = useRef<Placed | null>(null);

  const { placed, height } = layoutPage(state, images, pageWidth);
  const selectedItem = state.items.find((item) => item.id === selected) ?? null;

  /** Pointer position in page dots, undoing the CSS display scaling. */
  const toPage = useCallback((event: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * pageWidth,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, [pageWidth]);

  // Redraw whenever anything visible changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = pageWidth;
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawPage(ctx, state, images, pageWidth, canvas.height, placed);

    // Selection and crop marquee are chrome, drawn after and never exported —
    // exportPng calls drawPage directly, so they can't leak onto paper.
    if (selectedItem) {
      const box = placed.find((p) => p.item.id === selectedItem.id);
      if (box) {
        ctx.save();
        ctx.strokeStyle = "#4c6ef5";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.restore();
      }
    }
    if (cropDrag) {
      ctx.save();
      ctx.strokeStyle = "#f03e3e";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        Math.min(cropDrag.x0, cropDrag.x1),
        Math.min(cropDrag.y0, cropDrag.y1),
        Math.abs(cropDrag.x1 - cropDrag.x0),
        Math.abs(cropDrag.y1 - cropDrag.y0),
      );
      ctx.restore();
    }
  }, [state, images, pageWidth, height, placed, selectedItem, cropDrag]);

  const patchItem = (id: string, next: Partial<EditorItem>) =>
    onChange({
      ...state,
      items: state.items.map((item) => (item.id === id ? { ...item, ...next } : item)),
    });

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toPage(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "draw") {
      stroke.current = { points: [point], width: penWidth, shade: penShade };
      onChange({ ...state, strokes: [...state.strokes, stroke.current] });
      return;
    }

    const hit = hitTest(placed, point.x, point.y);
    if (tool === "crop") {
      if (!hit) return;
      cropTarget.current = hit;
      setSelected(hit.item.id);
      setCropDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
      return;
    }

    setSelected(hit?.item.id ?? null);
    // Dragging is only meaningful in free layout; a grid computes positions.
    if (hit && state.layout === "free") {
      drag.current = { id: hit.item.id, dx: point.x - hit.x, dy: point.y - hit.y };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!stroke.current && !drag.current && !cropDrag) return;
    const point = toPage(event);

    if (stroke.current) {
      stroke.current.points.push(point);
      onChange({ ...state, strokes: [...state.strokes] });
      return;
    }
    if (cropDrag) {
      setCropDrag({ ...cropDrag, x1: point.x, y1: point.y });
      return;
    }
    if (drag.current) {
      patchItem(drag.current.id, {
        x: Math.round(point.x - drag.current.dx),
        y: Math.round(point.y - drag.current.dy),
      });
    }
  };

  const onPointerUp = () => {
    if (cropDrag && cropTarget.current) {
      const box = cropTarget.current;
      const x0 = Math.min(cropDrag.x0, cropDrag.x1);
      const y0 = Math.min(cropDrag.y0, cropDrag.y1);
      const w = Math.abs(cropDrag.x1 - cropDrag.x0);
      const h = Math.abs(cropDrag.y1 - cropDrag.y0);
      // A stray click shouldn't crop the image down to nothing.
      if (w > 4 && h > 4) {
        const previous = box.item.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        // Fractions of the box, composed onto any crop already applied, so
        // cropping twice narrows further instead of resetting.
        const fx = (x0 - box.x) / box.w;
        const fy = (y0 - box.y) / box.h;
        const fw = w / box.w;
        const fh = h / box.h;
        const next: CropRect = {
          x: previous.x + Math.max(0, fx) * previous.w,
          y: previous.y + Math.max(0, fy) * previous.h,
          w: Math.min(1 - Math.max(0, fx), fw) * previous.w,
          h: Math.min(1 - Math.max(0, fy), fh) * previous.h,
        };
        patchItem(box.item.id, { crop: next });
      }
    }
    stroke.current = null;
    drag.current = null;
    cropTarget.current = null;
    setCropDrag(null);
  };

  const removeItem = (id: string) => {
    dropCache(id);
    onChange({ ...state, items: state.items.filter((item) => item.id !== id) });
    setSelected(null);
  };

  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="wrap">
        <SegmentedControl
          size="xs"
          value={tool}
          onChange={(value) => setTool(value as Tool)}
          data={[
            { value: "move", label: t("editor_tool_move") },
            { value: "crop", label: t("editor_tool_crop") },
            { value: "draw", label: t("editor_tool_draw") },
          ]}
        />
        <SegmentedControl
          size="xs"
          value={state.layout}
          onChange={(value) => {
            // Seed free positions from the current grid, so switching keeps
            // the arrangement rather than collapsing everything to 0,0.
            if (value === "free") {
              const seeded = state.items.map((item) => {
                const box = placed.find((p) => p.item.id === item.id);
                return box
                  ? { ...item, x: Math.round(box.x), y: Math.round(box.y), scale: box.w / pageWidth }
                  : item;
              });
              onChange({ ...state, layout: "free", items: seeded });
            } else {
              onChange({ ...state, layout: "grid" });
            }
          }}
          data={[
            { value: "grid", label: t("editor_layout_grid") },
            { value: "free", label: t("editor_layout_free") },
          ]}
        />
        <SecondaryButton
          size="xs"
          onClick={() =>
            onAddSource(
              {
                kind: "text",
                blocks: [
                  { text: "", level: 0, bold: false, italic: false,
                    underline: false, tint: "black", align: "left" },
                ],
              },
              t("composer_text_item"),
            )
          }
          icon={<IconLetterT size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("composer_add_text")}
        </SecondaryButton>
        <SecondaryButton
          size="xs"
          onClick={() =>
            onAddSource(
              { kind: "code", data: "https://example.com", format: "qr", symbology: "code128" },
              t("composer_code_item"),
            )
          }
          icon={<IconQrcode size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("composer_add_code")}
        </SecondaryButton>
        <FileButton onChange={onAddFiles} accept="image/*,application/pdf" multiple>
          {(props) => (
            <SecondaryButton
              {...props}
              size="xs"
              loading={busy}
              icon={<IconPhotoPlus size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
            >
              {t("editor_add_images")}
            </SecondaryButton>
          )}
        </FileButton>
      </Group>

      <Group gap="xs" wrap="wrap" align="center">
        <Text size="xs" c="dimmed">
          {t("composer_mode")}
        </Text>
        <SegmentedControl
          size="xs"
          value={state.mode}
          onChange={(value) => onChange({ ...state, mode: value as EditorState["mode"] })}
          data={[
            { value: "canvas", label: t("composer_mode_canvas") },
            { value: "flow", label: t("composer_mode_flow") },
          ]}
        />
        <Text size="xs" c="dimmed">
          {state.mode === "canvas" ? t("composer_mode_canvas_hint") : t("composer_mode_flow_hint")}
        </Text>
      </Group>

      {state.layout === "grid" && (
        <Group gap="xs" wrap="wrap">
          <NumberInput
            size="xs"
            w={130}
            label={t("editor_columns")}
            min={1}
            max={6}
            value={state.columns}
            onChange={(value) => onChange({ ...state, columns: Number(value) || 1 })}
          />
          <NumberInput
            size="xs"
            w={130}
            label={t("editor_padding")}
            min={0}
            max={64}
            value={state.padding}
            onChange={(value) => onChange({ ...state, padding: Number(value) || 0 })}
          />
        </Group>
      )}

      {tool === "draw" && (
        <Group gap="sm" wrap="wrap" align="flex-end">
          <Stack gap={2} w={160}>
            <Text size="xs">{t("editor_pen_width")}</Text>
            <Slider size="xs" min={1} max={24} value={penWidth} onChange={setPenWidth} />
          </Stack>
          <SegmentedControl
            size="xs"
            value={String(penShade)}
            onChange={(value) => setPenShade(Number(value))}
            data={SHADES.map((shade) => ({ value: String(shade.value), label: t(shade.label) }))}
          />
          <SecondaryButton
            size="xs"
            disabled={state.strokes.length === 0}
            onClick={() => onChange({ ...state, strokes: state.strokes.slice(0, -1) })}
            icon={<IconArrowBackUp size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
          >
            {t("editor_undo_stroke")}
          </SecondaryButton>
        </Group>
      )}

      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          width: "100%",
          maxWidth: pageWidth,
          background: "#fff",
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 4,
          touchAction: "none",
          cursor: tool === "draw" ? "crosshair" : tool === "crop" ? "cell" : "grab",
        }}
      />

      {selectedItem?.source.kind === "text" && (
        <Textarea
          label={t("composer_text_item")}
          autosize
          minRows={2}
          value={selectedItem.source.blocks.map((block) => block.text).join("\n")}
          onChange={(event) => {
            const source = selectedItem.source as Extract<ItemSource, { kind: "text" }>;
            const template = source.blocks[0];
            onUpdateSource(selectedItem.id, {
              kind: "text",
              // One block per line, each inheriting the first block's styling —
              // the same shape the standalone rich-text editor produces.
              blocks: event.currentTarget.value
                .split("\n")
                .map((text) => ({ ...template, text })),
            });
          }}
        />
      )}

      {selectedItem?.source.kind === "code" && (
        <Group gap="xs" wrap="wrap" align="flex-end">
          <TextInput
            size="xs"
            flex={1}
            label={t("code_placeholder")}
            value={selectedItem.source.data}
            onChange={(event) =>
              onUpdateSource(selectedItem.id, {
                ...(selectedItem.source as Extract<ItemSource, { kind: "code" }>),
                data: event.currentTarget.value,
              })
            }
          />
          <SegmentedControl
            size="xs"
            value={selectedItem.source.format}
            onChange={(value) =>
              onUpdateSource(selectedItem.id, {
                ...(selectedItem.source as Extract<ItemSource, { kind: "code" }>),
                format: value as "qr" | "barcode",
              })
            }
            data={[
              { value: "qr", label: t("code_format_qr") },
              { value: "barcode", label: t("code_format_barcode") },
            ]}
          />
        </Group>
      )}

      {selectedItem ? (
        <Group gap="xs" wrap="wrap" align="flex-end">
          <Text size="xs" c="dimmed" style={{ maxWidth: 160 }} truncate>
            {selectedItem.name}
          </Text>
          <Tooltip label={t("editor_rotate")} withArrow openDelay={300}>
            <ActionIcon
              aria-label={t("editor_rotate")}
              variant="default"
              onClick={() =>
                patchItem(selectedItem.id, {
                  rotation: (((selectedItem.rotation + 90) % 360) as Rotation),
                })
              }
            >
              <IconRotateClockwise size={ICON_SIZE.sm} stroke={ICON_STROKE} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("editor_reset_crop")} withArrow openDelay={300}>
            <ActionIcon
              aria-label={t("editor_reset_crop")}
              variant="default"
              disabled={!selectedItem.crop}
              onClick={() => patchItem(selectedItem.id, { crop: null })}
            >
              <IconCrop size={ICON_SIZE.sm} stroke={ICON_STROKE} />
            </ActionIcon>
          </Tooltip>
          {selectedItem.source.kind === "pdf" && selectedItem.source.pageCount > 1 && (
            <NumberInput
              size="xs"
              w={120}
              label={t("editor_pdf_page")}
              min={1}
              max={selectedItem.source.pageCount}
              value={selectedItem.source.page}
              onChange={(value) =>
                onChangePdfPage(selectedItem.id, Math.max(1, Number(value) || 1))
              }
            />
          )}
          {state.layout === "free" && (
            <Stack gap={2} w={160}>
              <Text size="xs">{t("editor_scale")}</Text>
              <Slider
                size="xs"
                min={0.1}
                max={1}
                step={0.01}
                value={selectedItem.scale}
                onChange={(value) => patchItem(selectedItem.id, { scale: value })}
              />
            </Stack>
          )}
          <Tooltip label={t("delete")} withArrow openDelay={300}>
            <ActionIcon
              aria-label={t("delete")}
              variant="light"
              color="red"
              onClick={() => removeItem(selectedItem.id)}
            >
              <IconTrash size={ICON_SIZE.sm} stroke={ICON_STROKE} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ) : (
        <Text size="xs" c="dimmed">
          {state.items.length ? t("editor_select_hint") : t("editor_empty_hint")}
        </Text>
      )}
    </Stack>
  );
}
