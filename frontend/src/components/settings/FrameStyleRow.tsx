import { ActionIcon, Group, Select, Tooltip } from "@mantine/core";
import { IconBold, IconItalic, IconUnderline } from "@tabler/icons-react";

import { useStrings } from "../../AppContext";
import type { FrameStyle, Tint } from "../../api/types";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { AlignPicker } from "../ui/AlignPicker";

export const DEFAULT_FRAME_STYLE: FrameStyle = {
  level: 0,
  bold: false,
  italic: false,
  underline: false,
  tint: "black",
  align: "center",
};

/** True when a style would print identically to no style at all. */
export function isPlainFrame(style: FrameStyle): boolean {
  return (
    !style.bold &&
    !style.italic &&
    !style.underline &&
    style.level === 0 &&
    style.tint === "black" &&
    style.align === "center"
  );
}

/**
 * Styling for the header/footer text, using the same block shape as the
 * rich-text editor — so the frame gets italic and grey through the existing
 * bitmap fallback rather than a second styling implementation.
 *
 * A style equal to the default is saved as *no* style, which keeps the frame
 * on the printer's own crisp native path exactly as before.
 */
export function FrameStyleRow({
  value,
  onChange,
}: {
  value: FrameStyle;
  onChange: (next: FrameStyle) => void;
}) {
  const t = useStrings();
  const patch = (next: Partial<FrameStyle>) => onChange({ ...value, ...next });

  return (
    <Group gap={4} wrap="wrap">
      <Tooltip label={t("rt_bold")} withArrow openDelay={300}>
        <ActionIcon
          aria-label={t("rt_bold")}
          variant={value.bold ? "filled" : "default"}
          onClick={() => patch({ bold: !value.bold })}
        >
          <IconBold size={ICON_SIZE.sm} stroke={ICON_STROKE} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("rt_italic")} withArrow openDelay={300}>
        <ActionIcon
          aria-label={t("rt_italic")}
          variant={value.italic ? "filled" : "default"}
          onClick={() => patch({ italic: !value.italic })}
        >
          <IconItalic size={ICON_SIZE.sm} stroke={ICON_STROKE} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("rt_underline")} withArrow openDelay={300}>
        <ActionIcon
          aria-label={t("rt_underline")}
          variant={value.underline ? "filled" : "default"}
          onClick={() => patch({ underline: !value.underline })}
        >
          <IconUnderline size={ICON_SIZE.sm} stroke={ICON_STROKE} />
        </ActionIcon>
      </Tooltip>

      <AlignPicker
        size="xs"
        value={value.align}
        onChange={(align) => patch({ align })}
      />

      <Select
        w={110}
        size="xs"
        aria-label={t("rt_level")}
        value={String(value.level)}
        allowDeselect={false}
        onChange={(next) => patch({ level: Number(next ?? 0) })}
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
        value={value.tint}
        allowDeselect={false}
        onChange={(next) => patch({ tint: (next as Tint) ?? "black" })}
        data={[
          { value: "black", label: t("rt_tint_black") },
          { value: "dark", label: t("rt_tint_dark") },
          { value: "light", label: t("rt_tint_light") },
        ]}
      />
    </Group>
  );
}
