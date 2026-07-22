import { Checkbox, Group } from "@mantine/core";
import { IconPlaylistAdd, IconPrinter } from "@tabler/icons-react";

import { useStrings } from "../../AppContext";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrimaryButton, SecondaryButton } from "../ui/Buttons";
import type { StringKey } from "../../i18n/strings";

/**
 * The action row every print tab ends with.
 *
 * Exactly one primary button (Print), with "Queue" secondary beside it. The
 * "Save as snippet" checkbox applies to whichever of the two you press — it
 * replaced a separate save button and a whole snippet-creation form, so there
 * is now one way to make a snippet: print or queue something with it ticked.
 */
export function PrintActions({
  printLabelKey,
  onPrint,
  onQueue,
  saveAsSnippet,
  onSaveAsSnippetChange,
  busy,
  disabled,
  queueDisabled,
}: {
  printLabelKey: StringKey;
  onPrint: () => void;
  onQueue: () => void;
  saveAsSnippet: boolean;
  onSaveAsSnippetChange: (checked: boolean) => void;
  busy: boolean;
  disabled?: boolean;
  /** Set when the schedule is half-filled — Print stays available, Queue can't. */
  queueDisabled?: boolean;
}) {
  const t = useStrings();

  return (
    <Group gap="md" wrap="wrap">
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
          disabled={busy || disabled || queueDisabled}
          icon={<IconPlaylistAdd size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          {t("queue_btn")}
        </SecondaryButton>
      </Group>

      <Checkbox
        checked={saveAsSnippet}
        onChange={(event) => onSaveAsSnippetChange(event.currentTarget.checked)}
        disabled={busy}
        label={t("save_as_snippet")}
      />
    </Group>
  );
}
