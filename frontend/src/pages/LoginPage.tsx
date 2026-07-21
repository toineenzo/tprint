import { Alert, Card, Center, PasswordInput, Stack, Title } from "@mantine/core";
import { IconAlertTriangle, IconLogin } from "@tabler/icons-react";

import { useBootstrap, useStrings } from "../AppContext";
import { PrimaryButton } from "../components/ui/Buttons";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../theme";

/**
 * A native <form> post, not a fetch. The server already handles POST /login
 * with a session cookie and a 303 redirect, so styling it is the only change —
 * no auth API had to be invented, and the page still works without JS-driven
 * state handling.
 */
export function LoginPage() {
  const t = useStrings();
  const { login_error } = useBootstrap();

  return (
    <Center mih="100vh" p="md">
      <Card w="100%" maw={380} component="form" method="post" action="/login">
        <Stack gap="md">
          <Title order={1}>{t("app_title")}</Title>

          {login_error && (
            <Alert
              color={ROLE.danger}
              variant="light"
              icon={<IconAlertTriangle size={ICON_SIZE.md} stroke={ICON_STROKE} />}
            >
              {login_error}
            </Alert>
          )}

          <PasswordInput
            name="password"
            label={t("login_password")}
            autoFocus
            required
          />

          <PrimaryButton
            type="submit"
            fullWidth
            icon={<IconLogin size={ICON_SIZE.md} stroke={ICON_STROKE} />}
          >
            {t("login_button")}
          </PrimaryButton>
        </Stack>
      </Card>
    </Center>
  );
}
