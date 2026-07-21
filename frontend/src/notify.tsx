import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { ICON_SIZE, ICON_STROKE, ROLE } from "./theme";

/**
 * Status feedback. Replaces the old bare `<p id="status">` string, which never
 * dismissed and reused the accent colour for success.
 *
 * Green is reserved for success here and nowhere else in the app.
 */
export function notifySuccess(message: string) {
  notifications.show({
    message,
    color: ROLE.success,
    icon: <IconCheck size={ICON_SIZE.md} stroke={ICON_STROKE} />,
    autoClose: 3000,
    withBorder: true,
  });
}

export function notifyError(message: string) {
  notifications.show({
    message,
    color: ROLE.danger,
    icon: <IconAlertTriangle size={ICON_SIZE.md} stroke={ICON_STROKE} />,
    autoClose: 6000,
    withBorder: true,
  });
}
