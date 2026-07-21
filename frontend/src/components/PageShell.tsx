import { Box, Container, Group, Select, Stack, Text, Title } from "@mantine/core";
import { IconLogout, IconSettings } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { useBootstrap, useStrings } from "../AppContext";
import { ICON_SIZE, ICON_STROKE } from "../theme";
import { IconActionButton, IconActionLink } from "./ui/IconActionButton";

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

/** The chrome shared by the index and settings pages. */
export function PageShell({
  title,
  actions,
  aside,
  children,
  narrow = false,
}: {
  title: string;
  actions?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <Container size={narrow ? "sm" : "xl"} py="md">
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
  const { auth_enabled } = useBootstrap();
  return (
    <>
      <IconActionLink label={t("settings")} href="/settings">
        <IconSettings size={ICON_SIZE.lg} stroke={ICON_STROKE} />
      </IconActionLink>
      {auth_enabled && (
        <form method="post" action="/logout">
          <IconActionButton label={t("logout")} type="submit">
            <IconLogout size={ICON_SIZE.lg} stroke={ICON_STROKE} />
          </IconActionButton>
        </form>
      )}
    </>
  );
}
