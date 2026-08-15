import { Alert, Group, List, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { IconCheck, IconPlugConnected, IconPrinter, IconX } from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type { PrinterSettings } from "../../api/types";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../../theme";
import { PrimaryButton, SecondaryButton } from "../ui/Buttons";

type PrinterCheck = { label: string; ok: boolean; detail: string };
type TestResult = { ok: boolean; device: string; checks: PrinterCheck[] };

/**
 * Where the app sends bytes, and why that isn't working.
 *
 * The connection used to be `PRINTER_BACKEND`/`PRINTER_DEVICE` in
 * docker-compose only, which meant "the printer moved to lp1" was a redeploy.
 * It's a stored setting now; the env vars remain the fallback, so an install
 * that never opens this tab is unaffected.
 */
export function PrinterPanel({
  settings,
  onSaved,
}: {
  settings: PrinterSettings;
  onSaved: (next: PrinterSettings) => void;
}) {
  const t = useStrings();
  const { submit, busy } = useSubmit();
  const [backend, setBackend] = useState(settings.printer_backend);
  const [device, setDevice] = useState(settings.printer_device);
  const [test, setTest] = useState<TestResult | null>(null);

  const save = async () => {
    const form = new FormData();
    form.set("printer_backend", backend);
    form.set("printer_device", device);
    const saved = await submit(
      () => api.postForm<PrinterSettings>("/api/settings/connection", form),
      "settings_saved",
    );
    if (saved) onSaved(saved);
    return Boolean(saved);
  };

  const runTest = async (withPrint: boolean) => {
    // Saved first: the checks report on the stored connection, not on text
    // that has only been typed into these fields.
    if (!(await save())) return;
    const form = new FormData();
    form.set("do_print", String(withPrint));
    try {
      setTest(await api.postForm<TestResult>("/api/settings/printer-test", form));
    } catch {
      setTest(null);
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        {t("settings_connection")}
      </Text>
      <Text size="sm" c="dimmed">
        {t("settings_connection_hint")}
      </Text>

      <SegmentedControl
        value={backend}
        onChange={setBackend}
        data={[
          { value: "file", label: t("setup_backend_file") },
          { value: "dummy", label: t("setup_backend_dummy") },
        ]}
      />

      {backend === "file" && (
        <TextInput
          label={t("setup_device")}
          description={t("setup_device_hint")}
          value={device}
          onChange={(event) => setDevice(event.currentTarget.value)}
        />
      )}

      <Group gap="xs">
        <PrimaryButton onClick={() => void save()} loading={busy}>
          {t("save_settings")}
        </PrimaryButton>
        <SecondaryButton
          onClick={() => void runTest(false)}
          icon={<IconPlugConnected size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          {t("setup_test")}
        </SecondaryButton>
        <SecondaryButton
          onClick={() => void runTest(true)}
          icon={<IconPrinter size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          {t("settings_test_print")}
        </SecondaryButton>
      </Group>

      {test && (
        <Alert color={test.ok ? ROLE.success : ROLE.danger}>
          <List spacing={4} size="sm">
            {test.checks.map((check) => (
              <List.Item
                key={check.label}
                icon={
                  check.ok ? (
                    <IconCheck size={ICON_SIZE.sm} stroke={ICON_STROKE} />
                  ) : (
                    <IconX size={ICON_SIZE.sm} stroke={ICON_STROKE} />
                  )
                }
              >
                {check.label}: {check.detail}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
    </Stack>
  );
}
