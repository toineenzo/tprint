import { Divider, Group, Stack, Text } from "@mantine/core";
import {
  IconBookmark,
  IconEye,
  IconPencil,
  IconPrinter,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import { api } from "../../api/client";
import type { PrintResponse, Snippet } from "../../api/types";
import { usePrint } from "../../hooks/usePrint";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { EmptyState } from "../ui/EmptyState";
import { IconActionButton } from "../ui/IconActionButton";
import { ConfirmModal } from "../ui/PromptModals";
import { SectionCard } from "../ui/SectionCard";
import { TypeBadge } from "../ui/TypeBadge";
import { SnippetCreateForm } from "./SnippetCreateForm";
import { SnippetEditModal, SnippetPreviewModal } from "./SnippetModals";

function SnippetRow({
  snippet,
  onPreview,
  onEdit,
  onDelete,
}: {
  snippet: Snippet;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useStrings();
  const { print, busy } = usePrint();

  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap="sm">
      <Group gap="sm" wrap="nowrap" miw={0}>
        <Text size="sm" fw={600} truncate>
          {snippet.name}
        </Text>
        <TypeBadge kind={snippet.kind} />
      </Group>

      <Group gap={6} wrap="nowrap">
        <IconActionButton label={t("preview")} onClick={onPreview}>
          <IconEye size={ICON_SIZE.md} stroke={ICON_STROKE} />
        </IconActionButton>
        <IconActionButton label={t("edit")} onClick={onEdit}>
          <IconPencil size={ICON_SIZE.md} stroke={ICON_STROKE} />
        </IconActionButton>
        <IconActionButton
          label={t("print")}
          tone="primary"
          loading={busy}
          onClick={() =>
            print(() =>
              api.post<PrintResponse>(`/snippets/${snippet.id}/print`),
            )
          }
        >
          <IconPrinter size={ICON_SIZE.md} stroke={ICON_STROKE} />
        </IconActionButton>
        <IconActionButton label={t("delete")} tone="danger" onClick={onDelete}>
          <IconTrash size={ICON_SIZE.md} stroke={ICON_STROKE} />
        </IconActionButton>
      </Group>
    </Group>
  );
}

export function SnippetsCard() {
  const t = useStrings();
  const { snippets, refreshSnippets } = useAppData();
  const { submit } = useSubmit();

  const [previewing, setPreviewing] = useState<Snippet | null>(null);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [deleting, setDeleting] = useState<Snippet | null>(null);

  return (
    <SectionCard
      title={t("snippets")}
      icon={<IconBookmark size={ICON_SIZE.lg} stroke={ICON_STROKE} />}
    >
      {snippets.length === 0 ? (
        <EmptyState>{t("no_snippets")}</EmptyState>
      ) : (
        <Stack gap="xs">
          {snippets.map((snippet, index) => (
            <div key={snippet.id}>
              {index > 0 && <Divider mb="xs" />}
              <SnippetRow
                snippet={snippet}
                onPreview={() => setPreviewing(snippet)}
                onEdit={() => setEditing(snippet)}
                onDelete={() => setDeleting(snippet)}
              />
            </div>
          ))}
        </Stack>
      )}

      <SnippetCreateForm />

      <SnippetPreviewModal
        snippet={previewing}
        onClose={() => setPreviewing(null)}
      />
      <SnippetEditModal snippet={editing} onClose={() => setEditing(null)} />
      <ConfirmModal
        opened={deleting !== null}
        confirmLabel={t("delete")}
        message={t("confirm_delete_snippet").replace(
          "{name}",
          deleting?.name ?? "",
        )}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const target = deleting;
          setDeleting(null);
          if (!target) return;
          await submit(
            () => api.del(`/snippets/${target.id}`),
            "status_saved",
          );
          await refreshSnippets();
        }}
      />
    </SectionCard>
  );
}
