import { Center, SegmentedControl, Tooltip } from "@mantine/core";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
} from "@tabler/icons-react";

import { useStrings } from "../../AppContext";
import type { Align } from "../../api/types";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import type { StringKey } from "../../i18n/strings";

const OPTIONS = [
  { value: "left", icon: IconAlignLeft, labelKey: "align_left" },
  { value: "center", icon: IconAlignCenter, labelKey: "align_center" },
  { value: "right", icon: IconAlignRight, labelKey: "align_right" },
] as const satisfies ReadonlyArray<{
  value: Align;
  icon: typeof IconAlignLeft;
  labelKey: StringKey;
}>;

/**
 * Alignment as three icon buttons rather than a dropdown.
 *
 * Three mutually exclusive options with universally understood icons don't
 * need a menu to open — and it puts alignment on the same footing as the other
 * one-press style toggles it sits next to in the rich-text editor.
 */
export function AlignPicker({
  value,
  onChange,
  size = "sm",
}: {
  value: Align;
  onChange: (value: Align) => void;
  size?: string;
}) {
  const t = useStrings();

  return (
    <SegmentedControl
      size={size}
      value={value}
      onChange={(next) => onChange(next as Align)}
      data={OPTIONS.map(({ value: option, icon: Icon, labelKey }) => ({
        value: option,
        label: (
          <Tooltip label={t(labelKey)} withArrow openDelay={300}>
            <Center aria-label={t(labelKey)}>
              <Icon size={ICON_SIZE.sm} stroke={ICON_STROKE} />
            </Center>
          </Tooltip>
        ),
      }))}
    />
  );
}
