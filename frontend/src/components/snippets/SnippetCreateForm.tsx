import {
  Accordion,
  FileInput,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconDeviceFloppy, IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import { api } from "../../api/client";
import type { SnippetKind } from "../../api/types";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrimaryButton } from "../ui/Buttons";

export function SnippetCreateForm() {
  const t = useStrings();
  const { refreshSnippets } = useAppData();
  const { submit, busy } = useSubmit();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<SnippetKind>("text");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const complete =
    name.trim() && (kind === "text" ? text.trim() : files.length > 0);

  const save = async () => {
    const form = new FormData();
    form.set("name", name.trim());
    form.set("kind", kind);
    if (kind === "text") form.set("text_content", text);
    files.forEach((file) => form.append("files", file));

    const ok = await submit(
      () => api.postForm("/snippets", form),
      "status_snippet_saved",
    );
    if (ok !== undefined) {
      setName("");
      setText("");
      setFiles([]);
      await refreshSnippets();
    }
  };

  return (
    <Accordion variant="contained" chevronPosition="left" mt="md">
      <Accordion.Item value="add">
        <Accordion.Control
          icon={<IconPlus size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          <Text size="sm">{t("add_snippet")}</Text>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <TextInput
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={t("snippet_name_placeholder")}
              required
            />

            <Select
              aria-label={t("add_snippet")}
              value={kind}
              onChange={(value) => {
                setKind((value as SnippetKind) ?? "text");
                setFiles([]);
              }}
              allowDeselect={false}
              data={[
                { value: "text", label: t("kind_text") },
                { value: "image", label: t("kind_image") },
                { value: "pdf", label: t("kind_pdf") },
              ]}
            />

            {/* Rendered as separate elements rather than one FileInput with a
                dynamic `multiple`, whose value type depends on that prop. */}
            {kind === "text" && (
              <Textarea
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder={t("snippet_text_placeholder")}
                autosize
                minRows={4}
                maxRows={12}
              />
            )}

            {kind === "image" && (
              <FileInput
                accept="image/*"
                multiple
                clearable
                aria-label={t("kind_image")}
                value={files}
                onChange={setFiles}
                description={t("snippet_multi_image_hint")}
              />
            )}

            {kind === "pdf" && (
              <FileInput
                accept="application/pdf"
                clearable
                aria-label={t("kind_pdf")}
                value={files[0] ?? null}
                onChange={(file) => setFiles(file ? [file] : [])}
                description={t("snippet_pdf_hint")}
              />
            )}

            <PrimaryButton
              onClick={save}
              loading={busy}
              disabled={!complete}
              icon={
                <IconDeviceFloppy size={ICON_SIZE.md} stroke={ICON_STROKE} />
              }
            >
              {t("save_snippet")}
            </PrimaryButton>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
