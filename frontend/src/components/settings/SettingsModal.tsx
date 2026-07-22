import { Modal } from "@mantine/core";

import { useBootstrap, useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import type { PrinterSettings } from "../../api/types";
import { SettingsForm } from "./SettingsForm";

const BLANK: PrinterSettings = {
  header_text: null,
  footer_text: null,
  has_logo: false,
  has_footer_logo: false,
  default_align: "left",
  default_bold: false,
  default_double_width: false,
  paper_width_px: 576,
  auto_cut: true,
  confirm_before_print: false,
  surprise_preview: false,
  print_delay_seconds: 0,
  retention_max_items: 50,
  retention_max_age_days: 0,
};

/**
 * Settings used to be a page of its own at `/settings`. It's a modal now, so
 * changing a header doesn't cost you the page you were printing from.
 *
 * The form is deliberately *not* kept mounted: Mantine drops the children when
 * closed, so every open starts from `saved` rather than from whatever half-typed
 * edits were abandoned last time.
 */
export function SettingsModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const t = useStrings();
  const boot = useBootstrap();
  // Settings live in AppData rather than here, so saving one immediately
  // changes how the print gate and the Surprise card behave without a reload.
  const { settings, setSettings } = useAppData();
  const saved = settings ?? boot.settings ?? BLANK;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("settings_title")}
      size="xl"
    >
      <SettingsForm initial={saved} onSaved={setSettings} />
    </Modal>
  );
}
