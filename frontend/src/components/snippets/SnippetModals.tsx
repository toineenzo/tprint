import {
  Checkbox,
  Code,
  FileInput,
  Group,
  Image,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import { api } from "../../api/client";
import type { ChecklistPayload, IcsPayload, Snippet } from "../../api/types";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrimaryButton, SecondaryButton } from "../ui/Buttons";

const fileUrl = (name: string) => `/snippets/files/${encodeURIComponent(name)}`;

export function SnippetPreviewModal({
  snippet,
  onClose,
}: {
  snippet: Snippet | null;
  onClose: () => void;
}) {
  const t = useStrings();
  return (
    <Modal opened={snippet !== null} onClose={onClose} title={snippet?.name} size="lg">
      {snippet?.kind === "text" && (
        <Code block style={{ whiteSpace: "pre-wrap" }}>
          {snippet.text_content ?? ""}
        </Code>
      )}

      {snippet?.kind === "image" && (
        <Stack gap="sm">
          {snippet.files.map((name) => (
            <Image key={name} src={fileUrl(name)} alt="" radius="sm" />
          ))}
        </Stack>
      )}

      {snippet?.kind === "pdf" && snippet.files[0] && (
        <iframe
          title={snippet.name}
          src={fileUrl(snippet.files[0])}
          style={{ width: "100%", height: "60vh", border: 0 }}
        />
      )}

      {snippet?.kind === "checklist" && (
        <ChecklistPreview payload={snippet.payload as ChecklistPayload | null} />
      )}

      {snippet?.kind === "ics" && (
        <Stack gap={4}>
          <Text size="sm">{snippet.files[0]}</Text>
          <Text size="sm" c="dimmed">
            {(snippet.payload as IcsPayload | null)?.mode === "separate"
              ? t("ics_mode_separate")
              : t("ics_mode_single")}
          </Text>
        </Stack>
      )}
    </Modal>
  );
}

/** Mirrors what the printer renders: an unticked box per item, due date last. */
function ChecklistPreview({ payload }: { payload: ChecklistPayload | null }) {
  const t = useStrings();
  if (!payload) return null;
  return (
    <Stack gap={4}>
      {payload.title && <Text fw={600}>{payload.title}</Text>}
      {payload.items.map((item, index) => (
        <Text key={index} size="sm">
          [ ] {item.text}
          {item.due && (
            <Text span c="dimmed">
              {" "}
              ({t("due_label")} {item.due})
            </Text>
          )}
        </Text>
      ))}
      <Text size="xs" c="dimmed" mt="xs">
        {payload.mode === "separate" ? t("separate_receipts") : t("one_receipt")}
      </Text>
    </Stack>
  );
}

export function SnippetEditModal({
  snippet,
  onClose,
}: {
  snippet: Snippet | null;
  onClose: () => void;
}) {
  const t = useStrings();
  const { refreshSnippets } = useAppData();
  const { submit, busy } = useSubmit();

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const [added, setAdded] = useState<File[]>([]);

  // Reset to the snippet's own values each time a different one is opened.
  useEffect(() => {
    if (!snippet) return;
    setName(snippet.name);
    setText(snippet.text_content ?? "");
    setRemoved([]);
    setAdded([]);
  }, [snippet]);

  if (!snippet) return null;

  const save = async () => {
    const form = new FormData();
    form.set("name", name.trim());
    if (snippet.kind === "text") form.set("text_content", text);
    removed.forEach((file) => form.append("remove_files", file));
    added.forEach((file) => form.append("add_files", file));

    const ok = await submit(
      () => api.putForm(`/snippets/${snippet.id}`, form),
      "status_saved",
    );
    if (ok !== undefined) {
      await refreshSnippets();
      onClose();
    }
  };

  return (
    <Modal opened onClose={onClose} title={t("edit")} size="lg">
      <Stack gap="md">
        <TextInput
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
        />

        {snippet.kind === "text" && (
          <Textarea
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            autosize
            minRows={6}
            maxRows={16}
          />
        )}

        {snippet.kind === "image" && (
          <>
            <Text size="sm" c="dimmed">
              {t("current_files")}
            </Text>
            <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="sm">
              {snippet.files.map((file) => (
                <Stack key={file} gap={4} align="center">
                  <Image src={fileUrl(file)} alt="" h={72} w="100%" fit="cover" radius="sm" />
                  <Checkbox
                    size="xs"
                    label={t("remove_item")}
                    checked={removed.includes(file)}
                    onChange={(event) =>
                      setRemoved((current) =>
                        event.currentTarget.checked
                          ? [...current, file]
                          : current.filter((name) => name !== file),
                      )
                    }
                  />
                </Stack>
              ))}
            </SimpleGrid>
            <FileInput
              label={t("add_more_images")}
              aria-label={t("add_more_images")}
              accept="image/*"
              multiple
              clearable
              value={added}
              onChange={setAdded}
            />
          </>
        )}

        {/* checklist/ics hold structured data captured at print time — there's
            no coherent form for editing it, so only the name is editable. */}
        {(snippet.kind === "checklist" || snippet.kind === "ics") && (
          <Text size="sm" c="dimmed">
            {t("edit_name_only")}
          </Text>
        )}

        {snippet.kind === "pdf" && (
          <>
            <Text size="sm" c="dimmed">
              {snippet.files[0]}
            </Text>
            <FileInput
              label={t("replace_pdf_file")}
              aria-label={t("replace_pdf_file")}
              accept="application/pdf"
              clearable
              value={added[0] ?? null}
              onChange={(file) => setAdded(file ? [file] : [])}
            />
          </>
        )}

        <Group justify="flex-end" gap="xs">
          <SecondaryButton onClick={onClose}>{t("cancel")}</SecondaryButton>
          <PrimaryButton
            onClick={save}
            loading={busy}
            disabled={!name.trim()}
            icon={<IconDeviceFloppy size={ICON_SIZE.md} stroke={ICON_STROKE} />}
          >
            {t("save_changes")}
          </PrimaryButton>
        </Group>
      </Stack>
    </Modal>
  );
}
