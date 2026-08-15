import { Modal, Group, Stack, Text } from "@mantine/core";
import { IconCrop } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { useStrings } from "../../AppContext";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrimaryButton, SecondaryButton } from "./Buttons";

/** A crop box in fractions of the source, which is what the server applies. */
export type CropBox = { x: number; y: number; w: number; h: number };

type Drag = { x0: number; y0: number; x1: number; y1: number };

const boxOf = (drag: Drag): CropBox => ({
  x: Math.min(drag.x0, drag.x1),
  y: Math.min(drag.y0, drag.y1),
  w: Math.abs(drag.x1 - drag.x0),
  h: Math.abs(drag.y1 - drag.y0),
});

/**
 * Crop something *before* it is uploaded.
 *
 * The box is dragged over a preview and kept as fractions of the source, so
 * the same box works whatever size the preview happened to be rendered at.
 * What happens with it differs by caller, and deliberately so:
 *
 * - an image (a composer file, a header/footer logo) is cropped here, in a
 *   canvas, and the caller uploads the smaller file — the server never sees
 *   the discarded pixels;
 * - a PDF can't be cropped in the browser, so the box travels with the print
 *   request and `printer.crop_fractions` applies it to every rendered page.
 *
 * Cropping is always optional: "Use whole image" closes with no box at all.
 */
export function CropModal({
  file,
  previewUrl,
  onCancel,
  onDone,
}: {
  /** The image to crop in-browser. Omit for a PDF-page preview. */
  file?: File | null;
  /** A ready-made preview URL, for sources that aren't an image file. */
  previewUrl?: string | null;
  onCancel: () => void;
  /** `cropped` is null when the source can only be cropped server-side. */
  onDone: (result: { box: CropBox | null; cropped: File | null }) => void;
}) {
  const t = useStrings();
  const [url, setUrl] = useState<string | null>(previewUrl ?? null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Whether a drag is *in progress*. Separate from `drag`, which holds the box
  // after the button is released: sharing one value meant every later pointer
  // move kept resizing the finished box — including the move towards "Use
  // selection", which is exactly when it has to stop.
  const dragging = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (previewUrl || !file) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, previewUrl]);

  useEffect(() => {
    if (previewUrl) setUrl(previewUrl);
  }, [previewUrl]);

  const pointAt = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const box = drag ? boxOf(drag) : null;
  const usable = box !== null && box.w > 0.02 && box.h > 0.02;

  /** Crop the image itself, so only the kept pixels are ever uploaded. */
  const cropFile = async (source: File, crop: CropBox): Promise<File> => {
    const bitmap = await createImageBitmap(source);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * crop.w));
    canvas.height = Math.max(1, Math.round(bitmap.height * crop.h));
    const context = canvas.getContext("2d");
    if (!context) return source;
    context.drawImage(
      bitmap,
      Math.round(bitmap.width * crop.x),
      Math.round(bitmap.height * crop.y),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) return source;
    return new File([blob], source.name.replace(/\.[^.]+$/, "") + ".png", {
      type: "image/png",
    });
  };

  return (
    <Modal opened onClose={onCancel} title={t("crop_title")} size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t("crop_hint")}
        </Text>

        {url && (
          <div
            style={{ position: "relative", touchAction: "none", userSelect: "none" }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              dragging.current = true;
              const point = pointAt(event);
              setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
            }}
            onPointerMove={(event) => {
              if (!dragging.current) return;
              const point = pointAt(event);
              setDrag((current) =>
                current ? { ...current, x1: point.x, y1: point.y } : current,
              );
            }}
            onPointerUp={(event) => {
              dragging.current = false;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            // A cancelled or lost pointer ends the drag too — otherwise it
            // would silently resume on the next move with no button held.
            onPointerCancel={() => {
              dragging.current = false;
            }}
            onLostPointerCapture={() => {
              dragging.current = false;
            }}
          >
            <img
              ref={imageRef}
              src={url}
              alt={t("crop_title")}
              draggable={false}
              style={{ width: "100%", display: "block", background: "#fff" }}
            />
            {box && (
              <div
                style={{
                  position: "absolute",
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                  border: "2px dashed var(--mantine-primary-color-filled)",
                  background: "rgba(255,255,255,0.15)",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        )}

        <Group justify="flex-end" gap="xs">
          <SecondaryButton onClick={() => onDone({ box: null, cropped: null })}>
            {t("crop_skip")}
          </SecondaryButton>
          <PrimaryButton
            disabled={!usable}
            icon={<IconCrop size={ICON_SIZE.md} stroke={ICON_STROKE} />}
            onClick={async () => {
              if (!box) return;
              onDone({
                box,
                cropped: file ? await cropFile(file, box) : null,
              });
            }}
          >
            {t("crop_apply")}
          </PrimaryButton>
        </Group>
      </Stack>
    </Modal>
  );
}
