import { Group, Modal, Stack, Text } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { useStrings } from "../../AppContext";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { DangerButton, PrimaryButton, SecondaryButton } from "./Buttons";

/**
 * Replaces `window.confirm` — the browser's own dialog is an OS-chrome window
 * that ignores the app's theme entirely, the same problem the native
 * date/time inputs had. Every
 * confirmation in the app goes through this one component so they can't drift
 * apart — pass `tone`/`confirmIcon` rather than hand-rolling another modal.
 */
export function ConfirmModal({
  opened,
  title,
  message,
  confirmLabel,
  confirmIcon,
  tone = "danger",
  onClose,
  onConfirm,
}: {
  opened: boolean;
  /** Defaults to `confirmLabel`, which reads fine for a plain "Delete". */
  title?: string;
  message: string;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  tone?: "danger" | "primary";
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useStrings();
  const ConfirmButton = tone === "primary" ? PrimaryButton : DangerButton;
  const icon = confirmIcon ?? (
    <IconTrash size={ICON_SIZE.md} stroke={ICON_STROKE} />
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title ?? confirmLabel}
      size="sm"
    >
      <Stack gap="md">
        <Text size="sm">{message}</Text>
        <Group justify="flex-end" gap="xs">
          <SecondaryButton onClick={onClose}>{t("cancel")}</SecondaryButton>
          <ConfirmButton data-autofocus onClick={onConfirm} icon={icon}>
            {confirmLabel}
          </ConfirmButton>
        </Group>
      </Stack>
    </Modal>
  );
}
