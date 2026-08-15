import { Card, Group, Image, Modal, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconBookmark, IconHistory, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../AppContext";
import { registerFlightTarget } from "../flight";
import { useAppData } from "../AppData";
import { api } from "../api/client";
import type { HistoryEntry } from "../api/types";
import { contentType } from "../constants/contentTypes";
import { displayTimestamp } from "../dates";
import { useSubmit } from "../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE } from "../theme";
import { SecondaryButton } from "./ui/Buttons";
import { EmptyState } from "./ui/EmptyState";
import { ConfirmModal } from "./ui/PromptModals";
import { TypeBadge } from "./ui/TypeBadge";

const PREVIEW_CHARS = 120;

/**
 * One history row.
 *
 * Every entry gets its type icon, not just the ones with a thumbnail — text,
 * checklist and agenda entries previously rendered as indistinguishable grey
 * blocks. When there is no thumbnail the icon takes the thumbnail's place at
 * the same size, so the list stays on one rhythm.
 */
function HistoryRow({ entry, onOpen }: { entry: HistoryEntry; onOpen: () => void }) {
  const meta = contentType(entry.kind);
  const Icon = meta.icon;

  return (
    <Group
      align="flex-start"
      gap="sm"
      wrap="nowrap"
      onClick={onOpen}
      style={{ cursor: "pointer" }}
    >
      {entry.has_image ? (
        <Image
          src={`/history/${entry.id}/image`}
          alt=""
          w={56}
          h={56}
          radius="sm"
          fit="cover"
        />
      ) : (
        <ThemeIcon variant="light" color={meta.color} size={56} radius="sm">
          <Icon size={26} stroke={ICON_STROKE} />
        </ThemeIcon>
      )}

      <Stack gap={4} miw={0}>
        <TypeBadge kind={entry.kind} />
        <Text size="xs" c="dimmed">
          {displayTimestamp(entry.created_at)}
        </Text>
        {entry.preview_text && (
          <Text size="sm" lineClamp={3} style={{ whiteSpace: "pre-line" }}>
            {entry.preview_text.slice(0, PREVIEW_CHARS)}
          </Text>
        )}
      </Stack>
    </Group>
  );
}

export function HistorySidebar() {
  const t = useStrings();
  const { history, refreshAll } = useAppData();
  const { submit } = useSubmit();
  const [clearing, setClearing] = useState(false);
  /** The entry being previewed, if any. */
  const [viewing, setViewing] = useState<HistoryEntry | null>(null);

  return (
    <Card
      component="aside"
      ref={(element: HTMLElement | null) => registerFlightTarget("history", element)}
    >
      <Group justify="space-between" align="center" mb="md" wrap="nowrap">
        <Group gap="xs" align="center" wrap="nowrap">
          <IconHistory size={ICON_SIZE.lg} stroke={ICON_STROKE} />
          <Title order={2}>{t("history_title")}</Title>
        </Group>
        {history.length > 0 && (
          <SecondaryButton
            size="xs"
            onClick={() => setClearing(true)}
            icon={<IconTrash size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
          >
            {t("history_clear")}
          </SecondaryButton>
        )}
      </Group>

      <ConfirmModal
        opened={clearing}
        confirmLabel={t("history_clear")}
        message={t("history_confirm_clear")}
        onClose={() => setClearing(false)}
        onConfirm={async () => {
          setClearing(false);
          await submit(() => api.del("/history"), "status_history_cleared");
          await refreshAll();
        }}
      />

      {history.length === 0 ? (
        <EmptyState>{t("history_empty")}</EmptyState>
      ) : (
        <Stack gap="md">
          {history.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              onOpen={() => setViewing(entry)}
            />
          ))}
        </Stack>
      )}

      {/* Preview of a past print: the thumbnail that was kept at print time,
          plus whatever text was recorded. Deliberately not a re-render — the
          receipt on screen is the one that actually came out. */}
      <Modal
        opened={viewing !== null}
        onClose={() => setViewing(null)}
        title={t("preview")}
        size="md"
      >
        <Stack gap="md">
          {viewing?.has_image && (
            <Image
              src={`/history/${viewing.id}/image`}
              alt={t("preview")}
              fit="contain"
              maw={320}
              style={{
                background: "#fff",
                border: "1px solid var(--mantine-color-default-border)",
              }}
            />
          )}
          {viewing?.preview_text && (
            <Text size="sm" style={{ whiteSpace: "pre-line" }}>
              {viewing.preview_text}
            </Text>
          )}
          {viewing?.can_snippet && (
            <Group justify="flex-end">
              <SecondaryButton
                icon={<IconBookmark size={ICON_SIZE.md} stroke={ICON_STROKE} />}
                onClick={async () => {
                  const target = viewing;
                  setViewing(null);
                  await submit(
                    () => api.post(`/history/${target.id}/snippet`),
                    "status_snippet_saved",
                  );
                  await refreshAll();
                }}
              >
                {t("save_as_snippet")}
              </SecondaryButton>
            </Group>
          )}
        </Stack>
      </Modal>
    </Card>
  );
}
