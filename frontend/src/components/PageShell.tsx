import { Box, Container, Group, Select, Stack, Text, Title } from "@mantine/core";
import { IconHelp, IconLogout, IconSettings } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useBootstrap, useStrings } from "../AppContext";
import { registerSettingsOpener } from "../settingsOpener";
import { ICON_SIZE, ICON_STROKE } from "../theme";
import { HelpModal } from "./HelpModal";
import { SettingsModal } from "./settings/SettingsModal";
import { SetupWizard } from "./settings/SetupWizard";
import { IconActionButton } from "./ui/IconActionButton";
import { ConfirmModal } from "./ui/PromptModals";

function TopBar({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="center" wrap="nowrap">
      <Title order={1}>{title}</Title>
      <Group gap="xs" wrap="nowrap">
        {actions}
      </Group>
    </Group>
  );
}

function LanguageFooter() {
  const { languages, native_names, lang, build_date } = useBootstrap();
  return (
    <Group justify="space-between" align="center" py="md" gap="md">
      <Select
        size="xs"
        w={140}
        aria-label="Language"
        value={lang}
        allowDeselect={false}
        data={languages.map((code) => ({
          value: code,
          label: native_names[code] ?? code,
        }))}
        onChange={(value) => {
          if (value && value !== lang) window.location.href = `/lang/${value}`;
        }}
      />
      {build_date && (
        <Text c="dimmed" size="xs">
          tprint · {build_date}
        </Text>
      )}
    </Group>
  );
}

/** The chrome around the main page. */
export function PageShell({
  title,
  actions,
  aside,
  children,
}: {
  title: string;
  actions?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Container size="xl" py="md">
      <TopBar title={title} actions={actions} />
      <Box className={aside ? "layout-with-aside" : undefined} mt="md">
        <Stack gap="md">{children}</Stack>
        {aside && <Box className="layout-aside">{aside}</Box>}
      </Box>
      <LanguageFooter />
    </Container>
  );
}

/** The top-bar actions for the main page: settings, and logout when enabled. */
export function MainPageActions() {
  const t = useStrings();
  const boot = useBootstrap();
  const { auth_enabled, open_settings } = boot;

  // `/settings` is still a real URL — it now serves the main page with this
  // flag set, so old bookmarks land on the modal instead of a dead route.
  const [settingsOpen, setSettingsOpen] = useState(open_settings ?? false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const logoutForm = useRef<HTMLFormElement>(null);
  // A fresh database — or one just reset — has setup_done false, which is the
  // only trigger for the wizard.
  const [setupOpen, setSetupOpen] = useState(!(boot.settings?.setup_done ?? true));
  const [helpOpen, setHelpOpen] = useState(false);

  // Lets any panel deep-link into a settings tab — see settingsOpener.ts.
  useEffect(() => {
    registerSettingsOpener((tab) => {
      setSettingsTab(tab);
      setSettingsOpen(true);
    });
    return () => registerSettingsOpener(null);
  }, []);

  return (
    <>
      <IconActionButton label={t("help_title")} onClick={() => setHelpOpen(true)}>
        <IconHelp size={ICON_SIZE.lg} stroke={ICON_STROKE} />
      </IconActionButton>
      <HelpModal opened={helpOpen} onClose={() => setHelpOpen(false)} />

      <IconActionButton
        label={t("settings")}
        onClick={() => setSettingsOpen(true)}
      >
        <IconSettings size={ICON_SIZE.lg} stroke={ICON_STROKE} />
      </IconActionButton>
      <SetupWizard opened={setupOpen} onDone={() => setSetupOpen(false)} />

      <SettingsModal
        opened={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
      />

      {auth_enabled && (
        <>
          {/* Still a native form post to /logout — confirming just defers the
              submit, so the request and the session clear are unchanged. */}
          <form ref={logoutForm} method="post" action="/logout" />
          <IconActionButton
            label={t("logout")}
            onClick={() => setConfirmingLogout(true)}
          >
            <IconLogout size={ICON_SIZE.lg} stroke={ICON_STROKE} />
          </IconActionButton>
          <ConfirmModal
            opened={confirmingLogout}
            title={t("logout")}
            message={t("confirm_logout")}
            confirmLabel={t("logout")}
            confirmIcon={<IconLogout size={ICON_SIZE.md} stroke={ICON_STROKE} />}
            onClose={() => setConfirmingLogout(false)}
            onConfirm={() => logoutForm.current?.requestSubmit()}
          />
        </>
      )}
    </>
  );
}
