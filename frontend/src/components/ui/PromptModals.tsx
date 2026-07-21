import { Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { IconDeviceFloppy, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { useStrings } from "../../AppContext";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { DangerButton, PrimaryButton, SecondaryButton } from "./Buttons";

/**
 * Replaces `window.prompt`. The browser's own dialog is an OS-chrome window
 * that ignores the app's theme entirely — the same problem the native
 * date/time inputs had.
 */
export function NamePromptModal({
  opened,
  title,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const t = useStrings();
  const [name, setName] = useState("");

  useEffect(() => {
    if (opened) setName("");
  }, [opened]);

  const trimmed = name.trim();

  return (
    <Modal opened={opened} onClose={onClose} title={title} size="sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
      >
        <Stack gap="md">
          <TextInput
            data-autofocus
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={t("snippet_name_placeholder")}
            required
          />
          <Group justify="flex-end" gap="xs">
            <SecondaryButton type="button" onClick={onClose}>
              {t("cancel")}
            </SecondaryButton>
            <PrimaryButton
              type="submit"
              disabled={!trimmed}
              icon={<IconDeviceFloppy size={ICON_SIZE.md} stroke={ICON_STROKE} />}
            >
              {t("save_snippet")}
            </PrimaryButton>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Replaces `window.confirm`, for the same reason as NamePromptModal. */
export function ConfirmModal({
  opened,
  message,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  opened: boolean;
  message: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useStrings();
  return (
    <Modal opened={opened} onClose={onClose} title={confirmLabel} size="sm">
      <Stack gap="md">
        <Text size="sm">{message}</Text>
        <Group justify="flex-end" gap="xs">
          <SecondaryButton onClick={onClose}>{t("cancel")}</SecondaryButton>
          <DangerButton
            onClick={onConfirm}
            icon={<IconTrash size={ICON_SIZE.md} stroke={ICON_STROKE} />}
          >
            {confirmLabel}
          </DangerButton>
        </Group>
      </Stack>
    </Modal>
  );
}
