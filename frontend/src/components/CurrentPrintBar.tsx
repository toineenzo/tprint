import { Alert, Group, Text } from "@mantine/core";
import { IconPlayerStop, IconPrinter } from "@tabler/icons-react";

import { useStrings } from "../AppContext";
import { useAppData } from "../AppData";
import { api } from "../api/client";
import { useSubmit } from "../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../theme";
import { DangerButton } from "./ui/Buttons";

/** Shown only while something is on the printer, with the abort control. */
export function CurrentPrintBar() {
  const t = useStrings();
  const { current, refreshAll } = useAppData();
  const { submit, busy } = useSubmit();

  if (!current?.label) return null;

  return (
    <Alert
      color={ROLE.primary}
      variant="light"
      icon={<IconPrinter size={ICON_SIZE.lg} stroke={ICON_STROKE} />}
    >
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Text size="sm">
          {t("currently_printing")}: <strong>{current.label}</strong>
        </Text>
        <DangerButton
          size="xs"
          loading={busy}
          icon={<IconPlayerStop size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
          onClick={async () => {
            await submit(
              () => api.post("/queue/cancel-current"),
              "status_canceled",
            );
            await refreshAll();
          }}
        >
          {t("cancel_current_print")}
        </DangerButton>
      </Group>
    </Alert>
  );
}
