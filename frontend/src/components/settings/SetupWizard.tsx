import {
  Alert,
  Group,
  List,
  Modal,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconCheck, IconPlugConnected, IconX } from "@tabler/icons-react";
import { useState } from "react";

import { useBootstrap, useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import { api } from "../../api/client";
import type { PrinterSettings } from "../../api/types";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../../theme";
import { PrimaryButton, SecondaryButton } from "../ui/Buttons";

type PrinterCheck = { label: string; ok: boolean; detail: string };
type TestResult = { ok: boolean; device: string; checks: PrinterCheck[] };

const STEPS = ["printer", "language", "password"] as const;
type Step = (typeof STEPS)[number];

/**
 * First-run setup: printer connection, language, and the login.
 *
 * Shown when `setup_done` is false, which is true of a fresh database and of
 * one that has just been reset — an upgraded install is marked done by the
 * migration, because it self-evidently is. Every step is skippable: the
 * defaults it starts from are the environment's, so finishing it without
 * touching anything leaves the app exactly as `docker-compose.yml` configured
 * it.
 */
export function SetupWizard({ opened, onDone }: { opened: boolean; onDone: () => void }) {
  const t = useStrings();
  const boot = useBootstrap();
  const { settings, setSettings } = useAppData();
  const { submit, busy } = useSubmit();

  const [step, setStep] = useState<Step>("printer");
  const [backend, setBackend] = useState(settings?.printer_backend ?? "file");
  const [device, setDevice] = useState(settings?.printer_device ?? "/dev/usb/lp0");
  const [test, setTest] = useState<TestResult | null>(null);
  const [lang, setLang] = useState(boot.lang);
  const [authOn, setAuthOn] = useState(settings?.auth_enabled ?? true);
  const [password, setPassword] = useState("");

  const index = STEPS.indexOf(step);

  const saveConnection = async () => {
    const form = new FormData();
    form.set("printer_backend", backend);
    form.set("printer_device", device);
    const saved = await submit(
      () => api.postForm<PrinterSettings>("/api/settings/connection", form),
      "settings_saved",
    );
    if (saved) setSettings(saved);
    return Boolean(saved);
  };

  const runTest = async () => {
    // Save first: the test reports on the *stored* connection, so testing
    // fields that were only typed would answer a question nobody asked.
    if (!(await saveConnection())) return;
    const form = new FormData();
    form.set("do_print", "false");
    try {
      setTest(await api.postForm<TestResult>("/api/settings/printer-test", form));
    } catch {
      setTest(null);
    }
  };

  const finish = async () => {
    if (lang !== boot.lang) {
      document.cookie = `lang=${lang}; path=/; max-age=31536000`;
    }
    if (authOn !== (settings?.auth_enabled ?? true) || password) {
      const form = new FormData();
      form.set("enabled", String(authOn));
      if (password) form.set("password", password);
      const saved = await submit(
        () => api.postForm<PrinterSettings>("/api/settings/auth", form),
        "settings_saved",
      );
      if (!saved) return;
      setSettings(saved);
    }
    await api.postForm<PrinterSettings>("/api/settings/setup-done", new FormData());
    onDone();
    // The language is served by the server per request, so a change only
    // shows after a reload — which also re-reads the login state.
    if (lang !== boot.lang) window.location.reload();
  };

  return (
    <Modal
      opened={opened}
      onClose={onDone}
      title={t("setup_title")}
      size="lg"
      closeOnClickOutside={false}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t("setup_intro")}
        </Text>

        {step === "printer" && (
          <Stack gap="sm">
            <Title order={4}>{t("setup_step_printer")}</Title>
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
            <Group>
              <SecondaryButton
                onClick={() => void runTest()}
                loading={busy}
                icon={<IconPlugConnected size={ICON_SIZE.md} stroke={ICON_STROKE} />}
              >
                {t("setup_test")}
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
        )}

        {step === "language" && (
          <Stack gap="sm">
            <Title order={4}>{t("setup_step_language")}</Title>
            <Select
              label={t("setup_step_language")}
              value={lang}
              allowDeselect={false}
              onChange={(next) => setLang(next ?? boot.lang)}
              data={boot.languages.map((code) => ({
                value: code,
                label: boot.native_names[code] ?? code,
              }))}
            />
          </Stack>
        )}

        {step === "password" && (
          <Stack gap="sm">
            <Title order={4}>{t("setup_step_password")}</Title>
            <Switch
              label={t("setup_auth_enabled")}
              description={t("setup_auth_hint")}
              checked={authOn}
              onChange={(event) => setAuthOn(event.currentTarget.checked)}
            />
            {authOn && (
              <PasswordInput
                label={t("setup_password")}
                description={
                  settings?.has_password ? t("setup_password_keep") : t("setup_password_hint")
                }
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            )}
          </Stack>
        )}

        <Group justify="space-between">
          <SecondaryButton
            disabled={index === 0}
            onClick={() => setStep(STEPS[Math.max(0, index - 1)])}
          >
            {t("setup_back")}
          </SecondaryButton>
          <Group gap="xs">
            <SecondaryButton onClick={() => void finish()}>{t("setup_skip")}</SecondaryButton>
            {index < STEPS.length - 1 ? (
              <PrimaryButton
                onClick={async () => {
                  if (step === "printer") await saveConnection();
                  setStep(STEPS[index + 1]);
                }}
                loading={busy}
              >
                {t("setup_next")}
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={() => void finish()} loading={busy}>
                {t("setup_finish")}
              </PrimaryButton>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
