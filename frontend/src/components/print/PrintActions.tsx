import { Group } from "@mantine/core";
import { IconDeviceFloppy, IconPlaylistAdd, IconPrinter } from "@tabler/icons-react";

import { useStrings } from "../../AppContext";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrimaryButton, SecondaryButton } from "../ui/Buttons";
import { IconActionButton } from "../ui/IconActionButton";
import type { StringKey } from "../../i18n/strings";

/**
 * The action row every print tab ends with.
 *
 * Exactly one primary button (Print). "Queue" is secondary and quick-save is a
 * plain icon button — previously all three read as equally important, and
 * quick-save was a bare checkmark glyph floating over the textarea.
 */
export function PrintActions({
  printLabelKey,
  onPrint,
  onQueue,
  onQuickSave,
  busy,
  disabled,
}: {
  printLabelKey: StringKey;
  onPrint: () => void;
  onQueue: () => void;
  onQuickSave?: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const t = useStrings();

  return (
    <Group gap="xs" wrap="wrap">
      <PrimaryButton
        type="button"
        onClick={onPrint}
        loading={busy}
        disabled={disabled}
        icon={<IconPrinter size={ICON_SIZE.md} stroke={ICON_STROKE} />}
      >
        {t(printLabelKey)}
      </PrimaryButton>

      <SecondaryButton
        type="button"
        onClick={onQueue}
        disabled={busy || disabled}
        icon={<IconPlaylistAdd size={ICON_SIZE.md} stroke={ICON_STROKE} />}
      >
        {t("queue_btn")}
      </SecondaryButton>

      {onQuickSave && (
        <IconActionButton
          label={t("quick_save_hint")}
          onClick={onQuickSave}
          disabled={busy || disabled}
        >
          <IconDeviceFloppy size={ICON_SIZE.md} stroke={ICON_STROKE} />
        </IconActionButton>
      )}
    </Group>
  );
}
