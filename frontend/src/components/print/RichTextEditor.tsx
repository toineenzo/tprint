import { ActionIcon, Group, Select, Stack, Textarea, Tooltip } from "@mantine/core";
import {
  IconBold,
  IconItalic,
  IconPlus,
  IconTrash,
  IconUnderline,
} from "@tabler/icons-react";

import { useStrings } from "../../AppContext";
import type { RichTextBlock, Tint } from "../../api/types";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { SecondaryButton } from "../ui/Buttons";

export const EMPTY_BLOCK: RichTextBlock = {
  text: "",
  level: 0,
  bold: false,
  italic: false,
  underline: false,
  tint: "black",
  align: "left",
};

/** True when nothing would look different from a plain text print. */
export function isUnstyled(blocks: RichTextBlock[]): boolean {
  return blocks.every(
    (b) =>
      !b.bold && !b.italic && !b.underline && b.level === 0 &&
      b.tint === "black" && b.align === "left",
  );
}

/** Blocks as plain text, for the unformatted path and for snippet names. */
export function blocksToText(blocks: RichTextBlock[]): string {
  return blocks.map((block) => block.text).join("\n");
}

export function textToBlocks(text: string): RichTextBlock[] {
  const lines = text.split("\n");
  return (lines.length ? lines : [""]).map((line) => ({ ...EMPTY_BLOCK, text: line }));
}

/**
 * Styling is per line, not per word.
 *
 * Receipts are line-oriented — a heading, a body line, a faint note — and
 * per-line styling covers that without pulling in a WYSIWYG editor and its
 * dependency tree. It also maps exactly onto how the server renders: one
 * strip per block, stacked.
 */
export function RichTextEditor({
  blocks,
  onChange,
}: {
  blocks: RichTextBlock[];
  onChange: (next: RichTextBlock[]) => void;
}) {
  const t = useStrings();

  const patch = (index: number, next: Partial<RichTextBlock>) =>
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...next } : b)));

  const removeAt = (index: number) =>
    onChange(blocks.length === 1 ? [{ ...EMPTY_BLOCK }] : blocks.filter((_, i) => i !== index));

  return (
    <Stack gap="xs">
      {blocks.map((block, index) => (
        <Stack key={index} gap={4}>
          <Textarea
            value={block.text}
            autosize
            minRows={1}
            placeholder={t("text_placeholder")}
            onChange={(event) => {
              const value = event.currentTarget.value;
              // Pasting several lines splits into one styled block per line,
              // inheriting this block's styling.
              if (value.includes("\n")) {
                const parts = value.split("\n").map((line) => ({ ...block, text: line }));
                onChange([...blocks.slice(0, index), ...parts, ...blocks.slice(index + 1)]);
              } else {
                patch(index, { text: value });
              }
            }}
          />
          <Group gap={4} wrap="wrap">
            <Tooltip label={t("rt_bold")} withArrow openDelay={300}>
              <ActionIcon
                aria-label={t("rt_bold")}
                variant={block.bold ? "filled" : "default"}
                onClick={() => patch(index, { bold: !block.bold })}
              >
                <IconBold size={ICON_SIZE.sm} stroke={ICON_STROKE} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("rt_italic")} withArrow openDelay={300}>
              <ActionIcon
                aria-label={t("rt_italic")}
                variant={block.italic ? "filled" : "default"}
                onClick={() => patch(index, { italic: !block.italic })}
              >
                <IconItalic size={ICON_SIZE.sm} stroke={ICON_STROKE} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("rt_underline")} withArrow openDelay={300}>
              <ActionIcon
                aria-label={t("rt_underline")}
                variant={block.underline ? "filled" : "default"}
                onClick={() => patch(index, { underline: !block.underline })}
              >
                <IconUnderline size={ICON_SIZE.sm} stroke={ICON_STROKE} />
              </ActionIcon>
            </Tooltip>

            <Select
              w={110}
              size="xs"
              aria-label={t("rt_level")}
              value={String(block.level)}
              allowDeselect={false}
              onChange={(value) => patch(index, { level: Number(value ?? 0) })}
              data={[
                { value: "0", label: t("rt_level_body") },
                { value: "1", label: t("rt_level_h1") },
                { value: "2", label: t("rt_level_h2") },
                { value: "3", label: t("rt_level_h3") },
              ]}
            />
            <Select
              w={110}
              size="xs"
              aria-label={t("rt_tint")}
              value={block.tint}
              allowDeselect={false}
              onChange={(value) => patch(index, { tint: (value as Tint) ?? "black" })}
              data={[
                { value: "black", label: t("rt_tint_black") },
                { value: "dark", label: t("rt_tint_dark") },
                { value: "light", label: t("rt_tint_light") },
              ]}
            />
            <Select
              w={100}
              size="xs"
              aria-label={t("settings_align")}
              value={block.align}
              allowDeselect={false}
              onChange={(value) =>
                patch(index, { align: (value as RichTextBlock["align"]) ?? "left" })
              }
              data={[
                { value: "left", label: t("align_left") },
                { value: "center", label: t("align_center") },
                { value: "right", label: t("align_right") },
              ]}
            />

            <Tooltip label={t("remove_item")} withArrow openDelay={300}>
              <ActionIcon
                aria-label={t("remove_item")}
                variant="light"
                color="red"
                onClick={() => removeAt(index)}
              >
                <IconTrash size={ICON_SIZE.sm} stroke={ICON_STROKE} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      ))}

      <Group>
        <SecondaryButton
          size="xs"
          onClick={() => onChange([...blocks, { ...EMPTY_BLOCK }])}
          icon={<IconPlus size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("rt_add_line")}
        </SecondaryButton>
      </Group>
    </Stack>
  );
}
