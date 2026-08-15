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
 * One component rather than two copies, but scoped per panel: each button
 * clears only its own list, because one button emptying both reads as a bug
 * from whichever list you weren't looking at. The manual/scheduled split
 * itself stays server-side — see print_queue.CLEAR_SCOPES.
 */
export function ClearFinishedButton({
  scope,
}: {
  /** Which panel's finished jobs to clear — the server owns the split. */
  scope: "manual" | "scheduled";
}) {
  const t = useStrings();
  const { queue, refreshAll } = useAppData();
  const { submit } = useSubmit();

  const finished = queue.filter(
    (job) =>
      job.status !== "pending" &&
      job.status !== "running" &&
      job.scheduled === (scope === "scheduled"),
  );

  return (
    <SecondaryButton
      size="xs"
      disabled={finished.length === 0}
      icon={<IconTrash size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
      onClick={async () => {
        await submit(
          () => api.del(`/queue/finished?scope=${scope}`),
          "status_queue_cleared",
        );
        await refreshAll();
      }}
    >
      {t("queue_clear_finished")}
    </SecondaryButton>
  );
}
