/**
 * The layout model for the image editor, and the single function that draws it.
 *
 * The page is authored at exactly the configured paper width in dots, so the
 * canvas is not a preview of the print — it *is* the print. Export just runs
 * the same `drawPage` into an offscreen canvas and hands the result to
 * /print/image as an ordinary file, which is why none of this needed a new
 * backend path or a new print kind.
 */

import type { CodeFormat, RichTextBlock } from "../../../api/types";

export type Rotation = 0 | 90 | 180 | 270;

/**
 * What an item is made of. Every source resolves to a bitmap before it reaches
 * the canvas, which is why layout, crop, rotation and export needed no changes
 * when the editor grew from images-only to a multi-type composer.
 */
export type ItemSource =
  | { kind: "image"; file: File }
  | { kind: "pdf"; file: File; page: number; pageCount: number }
  | { kind: "text"; blocks: RichTextBlock[] }
  | { kind: "code"; data: string; format: CodeFormat; symbology: string };

/** A resolved source: anything canvas can draw, plus its intrinsic size. */
export type Rendered = { source: CanvasImageSource; width: number; height: number };

/** Crop as fractions (0-1) of the item's post-rotation box, so it survives rotation. */
export type CropRect = { x: number; y: number; w: number; h: number };

export type EditorItem = {
  id: string;
  name: string;
  source: ItemSource;
  rotation: Rotation;
  crop: CropRect | null;
  /** Free layout only: width as a fraction of the page. */
  scale: number;
  /** Free layout only: top-left in page dots. */
  x: number;
  y: number;
};

export type Stroke = {
  points: { x: number; y: number }[];
  width: number;
  /** 0 = black … 255 = white. Greyscale only: the printer has no colour. */
  shade: number;
};

export type Layout = "grid" | "free";

/**
 * How the composition reaches the printer.
 *
 * `canvas` flattens the page to one PNG and prints it as an ordinary image —
 * free positioning, but text becomes a bitmap. `flow` sends the items as
 * ordered parts to /print/composition, where text stays real ESC/POS text;
 * positions are ignored because ESC/POS has no cursor to place them with.
 */
export type PrintMode = "canvas" | "flow";

export type EditorState = {
  items: EditorItem[];
  mode: PrintMode;
  layout: Layout;
  /** Defaults to 1 so added items simply stack down the receipt. */
  columns: number;
  padding: number;
  strokes: Stroke[];
};

export const EMPTY_STATE: EditorState = {
  items: [],
  mode: "canvas",
  layout: "grid",
  columns: 1,
  padding: 8,
  strokes: [],
};

export type Placed = { item: EditorItem; x: number; y: number; w: number; h: number };

/** Natural size of an item once rotation and crop are applied. */
export function itemSize(item: EditorItem, image: Rendered): { w: number; h: number } {
  const turned = item.rotation === 90 || item.rotation === 270;
  const rw = turned ? image.height : image.width;
  const rh = turned ? image.width : image.height;
  const crop = item.crop;
  return crop ? { w: Math.max(1, rw * crop.w), h: Math.max(1, rh * crop.h) } : { w: rw, h: rh };
}

/**
 * Where every item lands, and how tall the page ends up.
 *
 * Grid rows are as tall as their tallest item rather than a fixed cell height,
 * so a portrait photo next to a landscape one doesn't get letterboxed — the
 * receipt is a continuous strip and has no page height to fill.
 */
export function layoutPage(
  state: EditorState,
  images: Map<string, Rendered>,
  pageWidth: number,
): { placed: Placed[]; height: number } {
  const placed: Placed[] = [];
  const sizeOf = (item: EditorItem) => {
    const image = images.get(item.id);
    return image ? itemSize(item, image) : { w: 1, h: 1 };
  };

  if (state.layout === "free") {
    let height = 0;
    for (const item of state.items) {
      const natural = sizeOf(item);
      const w = Math.max(1, pageWidth * item.scale);
      const h = Math.max(1, (w * natural.h) / natural.w);
      placed.push({ item, x: item.x, y: item.y, w, h });
      height = Math.max(height, item.y + h);
    }
    return { placed, height: Math.ceil(height) || 1 };
  }

  const columns = Math.max(1, Math.floor(state.columns));
  const pad = Math.max(0, state.padding);
  const cell = Math.max(1, (pageWidth - pad * (columns + 1)) / columns);

  let y = pad;
  for (let start = 0; start < state.items.length; start += columns) {
    const row = state.items.slice(start, start + columns);
    let rowHeight = 0;
    row.forEach((item, column) => {
      const natural = sizeOf(item);
      const h = Math.max(1, (cell * natural.h) / natural.w);
      placed.push({ item, x: pad + column * (cell + pad), y, w: cell, h });
      rowHeight = Math.max(rowHeight, h);
    });
    y += rowHeight + pad;
  }
  return { placed, height: Math.ceil(y) || 1 };
}

/**
 * Rotated copies, cached per (item, rotation).
 *
 * Canvas can't crop *and* rotate in one drawImage, so the source is rotated
 * into an offscreen canvas once and the crop is then a plain sub-rectangle of
 * it. Rebuilding that on every pointer move while dragging was visibly slow.
 */
const rotationCache = new Map<string, HTMLCanvasElement>();

function rotated(item: EditorItem, image: Rendered): Rendered {
  if (item.rotation === 0) return image;
  const key = `${item.id}:${item.rotation}:${image.width}x${image.height}`;
  const cached = rotationCache.get(key);
  if (cached) return { source: cached, width: cached.width, height: cached.height };

  const turned = item.rotation === 90 || item.rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = turned ? image.height : image.width;
  canvas.height = turned ? image.width : image.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.drawImage(image.source, -image.width / 2, -image.height / 2);
  }
  rotationCache.set(key, canvas);
  return { source: canvas, width: canvas.width, height: canvas.height };
}

/** Forget cached rotations for an item that's been removed or replaced. */
export function dropCache(id: string): void {
  for (const key of [...rotationCache.keys()]) {
    if (key.startsWith(`${id}:`)) rotationCache.delete(key);
  }
}

export function drawPage(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  images: Map<string, Rendered>,
  pageWidth: number,
  height: number,
  placed: Placed[],
): void {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageWidth, height);

  for (const { item, x, y, w, h } of placed) {
    const image = images.get(item.id);
    if (!image) continue;
    const turnedImage = rotated(item, image);
    const sw = turnedImage.width;
    const sh = turnedImage.height;
    const crop = item.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    ctx.drawImage(
      turnedImage.source,
      crop.x * sw, crop.y * sh, Math.max(1, crop.w * sw), Math.max(1, crop.h * sh),
      x, y, w, h,
    );
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of state.strokes) {
    if (stroke.points.length === 0) continue;
    const shade = Math.round(stroke.shade);
    ctx.strokeStyle = `rgb(${shade}, ${shade}, ${shade})`;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
    // A single tap is a dot, not nothing.
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Render the page at full paper resolution and hand it back as a file. */
export async function exportPng(
  state: EditorState,
  images: Map<string, Rendered>,
  pageWidth: number,
  filename = "composition.png",
): Promise<File | null> {
  const { placed, height } = layoutPage(state, images, pageWidth);
  const canvas = document.createElement("canvas");
  canvas.width = pageWidth;
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawPage(ctx, state, images, pageWidth, canvas.height, placed);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  return blob ? new File([blob], filename, { type: "image/png" }) : null;
}

/** The topmost item under a page-space point, so clicks hit what's on top. */
export function hitTest(placed: Placed[], x: number, y: number): Placed | null {
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    const p = placed[i];
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
  }
  return null;
}

// --- source resolution -----------------------------------------------------

/** Same scale/tint conventions as app/richtext.py, so a text item on the
 *  canvas matches a standalone styled-text print closely. */
const BASE_SIZE = 22;
const LINE_GAP = 6;
const HEADING_SCALE: Record<number, number> = { 0: 1, 1: 2, 2: 1.6, 3: 1.3 };
const TINTS: Record<string, number> = { black: 0, dark: 90, light: 160 };

/**
 * Draw styled text blocks to a canvas at the page width.
 *
 * Done in the browser rather than by calling richtext.py, because a server
 * round-trip per keystroke would make the editor unusable. Flow mode doesn't
 * use this at all — there the server prints the same blocks as real text.
 */
export function renderTextBlocks(blocks: RichTextBlock[], width: number): Rendered {
  const measure = document.createElement("canvas").getContext("2d");
  const lines: { text: string; block: RichTextBlock; size: number }[] = [];

  for (const block of blocks) {
    const size = Math.max(8, Math.round(BASE_SIZE * (HEADING_SCALE[block.level] ?? 1)));
    const font = `${block.bold ? "bold " : ""}${block.italic ? "italic " : ""}${size}px sans-serif`;
    if (measure) measure.font = font;
    const words = (block.text || "").split(" ");
    let current = "";
    for (const word of words) {
      const candidate = `${current} ${word}`.trim();
      const fits = !measure || measure.measureText(candidate).width <= width;
      if (fits || !current) current = candidate;
      else {
        lines.push({ text: current, block, size });
        current = word;
      }
    }
    lines.push({ text: current, block, size });
  }

  const height = lines.reduce((total, line) => total + line.size + LINE_GAP, 0) || 1;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = "top";
    let y = 0;
    for (const { text, block, size } of lines) {
      const shade = TINTS[block.tint] ?? 0;
      ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
      ctx.font = `${block.bold ? "bold " : ""}${block.italic ? "italic " : ""}${size}px sans-serif`;
      const textWidth = ctx.measureText(text).width;
      const x =
        block.align === "center" ? Math.max(0, (width - textWidth) / 2)
        : block.align === "right" ? Math.max(0, width - textWidth)
        : 0;
      ctx.fillText(text, x, y);
      if (block.underline) {
        ctx.fillRect(x, y + size + 1, textWidth, Math.max(1, Math.round(size / 14)));
      }
      y += size + LINE_GAP;
    }
  }
  return { source: canvas, width, height };
}

/** An <img> from a blob, as a Rendered record. */
export function loadRendered(blob: Blob): Promise<Rendered> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image"));
    };
    image.src = url;
  });
}

/**
 * The parts payload for flow mode.
 *
 * Only image-backed sources need uploading, so this returns both the parts and
 * the files they index into — keeping the two in step is the whole reason
 * `file_index` exists rather than a name.
 */
export function toFlowParts(
  state: EditorState,
): { parts: Record<string, unknown>[]; files: File[] } {
  const parts: Record<string, unknown>[] = [];
  const files: File[] = [];
  for (const item of state.items) {
    const source = item.source;
    if (source.kind === "text") {
      parts.push({ type: "text", blocks: source.blocks });
    } else if (source.kind === "code") {
      parts.push({
        type: "code",
        data: source.data,
        format: source.format,
        symbology: source.symbology,
      });
    } else {
      parts.push({ type: "image", file_index: files.length });
      files.push(source.file);
    }
  }
  return { parts, files };
}
