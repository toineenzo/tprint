import {
  Checkbox,
  Divider,
  FileInput,
  Group,
  Image,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconDeviceFloppy, IconPhoto, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type { Align, PrinterSettings } from "../../api/types";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../../theme";
import { DangerButton, PrimaryButton } from "../ui/Buttons";
import { ConfirmModal } from "../ui/PromptModals";

/**
 * The printer-settings form. Lives inside SettingsModal rather than a page of
 * its own — the fields, and the single multipart POST /api/settings they
 * produce, are unchanged from when this was `/settings`.
 */
export function SettingsForm({
  initial,
  onSaved,
}: {
  initial: PrinterSettings;
  onSaved: (saved: PrinterSettings) => void;
}) {
  const t = useStrings();
  const { submit, busy } = useSubmit();

  const [values, setValues] = useState<PrinterSettings>(initial);
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);

  const patch = (next: Partial<PrinterSettings>) =>
    setValues((current) => ({ ...current, ...next }));

  const save = async () => {
    const form = new FormData();
    form.set("header_text", values.header_text ?? "");
    form.set("footer_text", values.footer_text ?? "");
    form.set("default_align", values.default_align);
    form.set("default_bold", String(values.default_bold));
    form.set("default_double_width", String(values.default_double_width));
    form.set("remove_logo", String(removeLogo));
    if (logo && !removeLogo) form.set("logo", logo);

    const saved = await submit(
      () => api.postForm<PrinterSettings>("/api/settings", form),
      "settings_saved",
    );
    if (saved) {
      setValues(saved);
      setLogo(null);
      setRemoveLogo(false);
      onSaved(saved);
    }
  };

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        {t("settings_intro")}
      </Text>

      <Textarea
        label={t("settings_header_text")}
        description={t("settings_header_hint")}
        autosize
        minRows={2}
        value={values.header_text ?? ""}
        onChange={(event) => patch({ header_text: event.currentTarget.value })}
      />

      <Textarea
        label={t("settings_footer_text")}
        description={t("settings_footer_hint")}
        autosize
        minRows={2}
        value={values.footer_text ?? ""}
        onChange={(event) => patch({ footer_text: event.currentTarget.value })}
      />

      <Stack gap="xs">
        {values.has_logo && (
          <Group gap="sm" align="center">
            <Text size="sm" c="dimmed">
              {t("settings_current_logo")}
            </Text>
            <Image src="/api/settings/logo" alt="" h={40} w="auto" fit="contain" />
            <Checkbox
              label={t("settings_remove_logo")}
              checked={removeLogo}
              onChange={(event) => setRemoveLogo(event.currentTarget.checked)}
            />
          </Group>
        )}
        <FileInput
          label={t("settings_logo")}
          aria-label={t("settings_logo")}
          description={t("settings_logo_hint")}
          accept="image/*"
          clearable
          disabled={removeLogo}
          value={logo}
          onChange={setLogo}
          leftSection={<IconPhoto size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        />
      </Stack>

      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          {t("settings_text_style")}
        </Text>
        <Checkbox
          label={t("settings_bold")}
          checked={values.default_bold}
          onChange={(event) => patch({ default_bold: event.currentTarget.checked })}
        />
        <Checkbox
          label={t("settings_double_width")}
          checked={values.default_double_width}
          onChange={(event) =>
            patch({ default_double_width: event.currentTarget.checked })
          }
        />
      </Stack>

      <Select
        label={t("settings_align")}
        value={values.default_align}
        allowDeselect={false}
        onChange={(value) => patch({ default_align: (value as Align) ?? "left" })}
        data={[
          { value: "left", label: t("align_left") },
          { value: "center", label: t("align_center") },
          { value: "right", label: t("align_right") },
        ]}
      />

      <Group justify="flex-end">
        <PrimaryButton
          onClick={save}
          loading={busy}
          icon={<IconDeviceFloppy size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          {t("save_settings")}
        </PrimaryButton>
      </Group>

      <Divider my="xs" />

      <ResetDataSection />
    </Stack>
  );
}

/**
 * Wipes the database. Isolated at the bottom behind its own confirmation
 * because it is the only control in the app that destroys data the user can't
 * get back — the page reloads afterwards, since every seeded list is stale.
 */
function ResetDataSection() {
  const t = useStrings();
  const { submit, busy } = useSubmit();
  const [confirming, setConfirming] = useState(false);

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600} c={ROLE.danger}>
        {t("danger_zone")}
      </Text>
      <Text size="sm" c="dimmed">
        {t("reset_data_hint")}
      </Text>
      <Group>
        <DangerButton
          loading={busy}
          onClick={() => setConfirming(true)}
          icon={<IconTrash size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          {t("reset_data")}
        </DangerButton>
      </Group>

      <ConfirmModal
        opened={confirming}
        title={t("reset_data")}
        message={t("confirm_reset_data")}
        confirmLabel={t("reset_data")}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          const done = await submit(
            () => api.post("/api/settings/reset"),
            "reset_data_done",
          );
          // The bootstrap payload still holds the pre-reset snippets, history
          // and settings; a reload is the honest way to show an empty app.
          if (done !== undefined) window.location.reload();
        }}
      />
    </Stack>
  );
}
