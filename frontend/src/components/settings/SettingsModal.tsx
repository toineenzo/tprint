import { Modal } from "@mantine/core";
import { useState } from "react";

import { useBootstrap, useStrings } from "../../AppContext";
import type { PrinterSettings } from "../../api/types";
import { SettingsForm } from "./SettingsForm";

const BLANK: PrinterSettings = {
  header_text: null,
  footer_text: null,
  has_logo: false,
  default_align: "left",
  default_bold: false,
  default_double_width: false,
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
  const [saved, setSaved] = useState<PrinterSettings>(boot.settings ?? BLANK);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("settings_title")}
      size="lg"
    >
      <SettingsForm initial={saved} onSaved={setSaved} />
    </Modal>
  );
}
