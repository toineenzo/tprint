import { IconTrash } from "@tabler/icons-react";

import { useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import { api } from "../../api/client";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { SecondaryButton } from "../ui/Buttons";

/**
 * "Clear finished", for either queue panel.
 *
 * One component rather than two copies because the endpoint is one call that
 * drops *every* finished job, wherever it happened to be listed — so both
 * buttons must also agree on when they're enabled. Pending and scheduled work
 * is never touched; see print_queue.clear_finished.
 */
export function ClearFinishedButton() {
  const t = useStrings();
  const { queue, refreshAll } = useAppData();
  const { submit } = useSubmit();

  const finished = queue.filter(
    (job) => job.status !== "pending" && job.status !== "running",
  );

  return (
    <SecondaryButton
      size="xs"
      disabled={finished.length === 0}
      icon={<IconTrash size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
      onClick={async () => {
        await submit(() => api.del("/queue/finished"), "status_queue_cleared");
        await refreshAll();
      }}
    >
      {t("queue_clear_finished")}
    </SecondaryButton>
  );
}
