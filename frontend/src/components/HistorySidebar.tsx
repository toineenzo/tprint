import { Card, Group, Image, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";

import { useStrings } from "../AppContext";
import { registerFlightTarget } from "../flight";
import { useAppData } from "../AppData";
import type { HistoryEntry } from "../api/types";
import { contentType } from "../constants/contentTypes";
import { displayTimestamp } from "../dates";
import { ICON_SIZE, ICON_STROKE } from "../theme";
import { EmptyState } from "./ui/EmptyState";
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
function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const meta = contentType(entry.kind);
  const Icon = meta.icon;

  return (
    <Group align="flex-start" gap="sm" wrap="nowrap">
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
  const { history } = useAppData();

  return (
    <Card
      component="aside"
      ref={(element: HTMLElement | null) => registerFlightTarget("history", element)}
    >
      <Group gap="xs" align="center" mb="md" wrap="nowrap">
        <IconHistory size={ICON_SIZE.lg} stroke={ICON_STROKE} />
        <Title order={2}>{t("history_title")}</Title>
      </Group>

      {history.length === 0 ? (
        <EmptyState>{t("history_empty")}</EmptyState>
      ) : (
        <Stack gap="md">
          {history.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </Stack>
      )}
    </Card>
  );
}
