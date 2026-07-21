import {
  Card,
  Checkbox,
  FileInput,
  Group,
  Image,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconArrowLeft, IconDeviceFloppy, IconPhoto } from "@tabler/icons-react";
import { useState } from "react";

import { useBootstrap, useStrings } from "../AppContext";
import { api } from "../api/client";
import type { Align, PrinterSettings } from "../api/types";
import { PageShell } from "../components/PageShell";
import { LinkButton, PrimaryButton } from "../components/ui/Buttons";
import { useSubmit } from "../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE } from "../theme";

const BLANK: PrinterSettings = {
  header_text: null,
  footer_text: null,
  has_logo: false,
  default_align: "left",
  default_bold: false,
  default_double_width: false,
};

export function SettingsPage() {
  const t = useStrings();
  const boot = useBootstrap();
  const { submit, busy } = useSubmit();

  const [values, setValues] = useState<PrinterSettings>(
    boot.settings ?? BLANK,
  );
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
    }
  };

  return (
    <PageShell
      narrow
      title={t("settings_title")}
      actions={
        <LinkButton
          href="/"
          icon={<IconArrowLeft size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          {t("back_to_app")}
        </LinkButton>
      }
    >
      <Text c="dimmed" size="sm">
        {t("settings_intro")}
      </Text>

      <Card>
        <Stack gap="md">
          <Textarea
            label={t("settings_header_text")}
            description={t("settings_header_hint")}
            autosize
            minRows={2}
            value={values.header_text ?? ""}
            onChange={(event) =>
              patch({ header_text: event.currentTarget.value })
            }
          />

          <Textarea
            label={t("settings_footer_text")}
            description={t("settings_footer_hint")}
            autosize
            minRows={2}
            value={values.footer_text ?? ""}
            onChange={(event) =>
              patch({ footer_text: event.currentTarget.value })
            }
          />

          <Stack gap="xs">
            {values.has_logo && (
              <Group gap="sm" align="center">
                <Text size="sm" c="dimmed">
                  {t("settings_current_logo")}
                </Text>
                <Image
                  src="/api/settings/logo"
                  alt=""
                  h={40}
                  w="auto"
                  fit="contain"
                />
                <Checkbox
                  label={t("settings_remove_logo")}
                  checked={removeLogo}
                  onChange={(event) =>
                    setRemoveLogo(event.currentTarget.checked)
                  }
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
              leftSection={
                <IconPhoto size={ICON_SIZE.md} stroke={ICON_STROKE} />
              }
            />
          </Stack>

          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              {t("settings_text_style")}
            </Text>
            <Checkbox
              label={t("settings_bold")}
              checked={values.default_bold}
              onChange={(event) =>
                patch({ default_bold: event.currentTarget.checked })
              }
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
            onChange={(value) =>
              patch({ default_align: (value as Align) ?? "left" })
            }
            data={[
              { value: "left", label: t("align_left") },
              { value: "center", label: t("align_center") },
              { value: "right", label: t("align_right") },
            ]}
          />

          <Group>
            <PrimaryButton
              onClick={save}
              loading={busy}
              icon={
                <IconDeviceFloppy size={ICON_SIZE.md} stroke={ICON_STROKE} />
              }
            >
              {t("save_settings")}
            </PrimaryButton>
          </Group>
        </Stack>
      </Card>
    </PageShell>
  );
}
