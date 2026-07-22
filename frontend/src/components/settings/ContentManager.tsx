import {
  ActionIcon,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { useBootstrap, useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type {
  ContentItem,
  ContentKind,
  RecipeCategory,
  RecipeValue,
} from "../../api/types";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrimaryButton, SecondaryButton } from "../ui/Buttons";
import { EmptyState } from "../ui/EmptyState";
import { ConfirmModal } from "../ui/PromptModals";

const KINDS: ContentKind[] = ["joke", "fortune", "recipe"];
const CATEGORIES: RecipeCategory[] = [
  "breakfast", "lunch", "dinner", "dessert", "snack", "drink",
];

/** A recipe's list fields are edited as one textarea, one entry per line. */
const toLines = (values: string[]) => values.join("\n");
const fromLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

type Draft = {
  id: number | null;
  text: string;
  title: string;
  category: string;
  ingredients: string;
  steps: string;
};

const EMPTY: Draft = {
  id: null, text: "", title: "", category: "", ingredients: "", steps: "",
};

function draftFrom(item: ContentItem): Draft {
  if (item.kind === "recipe") {
    const recipe = item.value as RecipeValue;
    return {
      id: item.id,
      text: "",
      title: recipe.title,
      category: recipe.category ?? "",
      ingredients: toLines(recipe.ingredients),
      steps: toLines(recipe.steps),
    };
  }
  return { ...EMPTY, id: item.id, text: item.value as string };
}

/** One-line summary for the list; a recipe shows its title. */
function summarize(item: ContentItem): string {
  return item.kind === "recipe"
    ? (item.value as RecipeValue).title
    : (item.value as string);
}

/**
 * Add/edit/delete the jokes, fortunes and recipes that "Surprise me" draws
 * from. These ship as JSON inside the image but live in the database, so edits
 * survive a redeploy — see app/content.py.
 */
export function ContentManager() {
  const t = useStrings();
  const { lang: uiLang, languages } = useBootstrap();
  const { submit, busy } = useSubmit();

  const [kind, setKind] = useState<ContentKind>("joke");
  const [lang, setLang] = useState(uiLang);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<ContentItem | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api.get<{ items: ContentItem[] }>(
        `/api/content?kind=${kind}&lang=${lang}`,
      );
      setItems(result.items);
    } catch {
      setItems([]);
    }
  }, [kind, lang]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (!draft) return;
    const body =
      kind === "recipe"
        ? {
            title: draft.title,
            category: draft.category || null,
            ingredients: fromLines(draft.ingredients),
            steps: fromLines(draft.steps),
          }
        : { text: draft.text };

    const ok = await submit(
      () =>
        draft.id === null
          ? api.postJson("/api/content", { kind, lang, ...body })
          : api.putJson(`/api/content/${draft.id}`, body),
      "status_saved",
    );
    if (ok !== undefined) {
      setDraft(null);
      await refresh();
    }
  };

  const complete =
    draft &&
    (kind === "recipe"
      ? draft.title.trim() && fromLines(draft.ingredients).length && fromLines(draft.steps).length
      : draft.text.trim());

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        {t("content_title")}
      </Text>
      <Text size="sm" c="dimmed">
        {t("content_hint")}
      </Text>

      <Group gap="xs" grow>
        <Select
          aria-label={t("content_kind")}
          value={kind}
          allowDeselect={false}
          onChange={(value) => setKind((value as ContentKind) ?? "joke")}
          data={KINDS.map((value) => ({
            value,
            label: t(`content_kind_${value}` as never),
          }))}
        />
        <Select
          aria-label={t("content_language")}
          value={lang}
          allowDeselect={false}
          onChange={(value) => setLang(value ?? uiLang)}
          data={languages.map((code) => ({ value: code, label: code.toUpperCase() }))}
        />
      </Group>

      {items.length === 0 ? (
        <EmptyState>{t("content_empty")}</EmptyState>
      ) : (
        <Table striped withTableBorder>
          <Table.Tbody>
            {items.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>
                  <Text size="xs" lineClamp={2}>
                    {summarize(item)}
                  </Text>
                </Table.Td>
                <Table.Td width={80}>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <ActionIcon
                      aria-label={t("edit")}
                      variant="default"
                      onClick={() => setDraft(draftFrom(item))}
                    >
                      <IconPencil size={ICON_SIZE.sm} stroke={ICON_STROKE} />
                    </ActionIcon>
                    <ActionIcon
                      aria-label={t("delete")}
                      variant="light"
                      color="red"
                      onClick={() => setDeleting(item)}
                    >
                      <IconTrash size={ICON_SIZE.sm} stroke={ICON_STROKE} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Group>
        <SecondaryButton
          size="xs"
          onClick={() => setDraft({ ...EMPTY })}
          icon={<IconPlus size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("content_add")}
        </SecondaryButton>
      </Group>

      <Modal
        opened={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id === null ? t("content_add") : t("edit")}
        size="lg"
      >
        {draft && (
          <Stack gap="md">
            {kind === "recipe" ? (
              <>
                <TextInput
                  data-autofocus
                  label={t("content_recipe_title")}
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.currentTarget.value })
                  }
                />
                <Select
                  label={t("recipe_category")}
                  value={draft.category}
                  allowDeselect={false}
                  onChange={(value) => setDraft({ ...draft, category: value ?? "" })}
                  data={[
                    { value: "", label: t("recipe_category_none") },
                    ...CATEGORIES.map((value) => ({
                      value,
                      label: t(`recipe_category_${value}` as never),
                    })),
                  ]}
                />
                <Textarea
                  label={t("content_recipe_ingredients")}
                  description={t("content_one_per_line")}
                  autosize
                  minRows={3}
                  value={draft.ingredients}
                  onChange={(event) =>
                    setDraft({ ...draft, ingredients: event.currentTarget.value })
                  }
                />
                <Textarea
                  label={t("content_recipe_steps")}
                  description={t("content_one_per_line")}
                  autosize
                  minRows={3}
                  value={draft.steps}
                  onChange={(event) =>
                    setDraft({ ...draft, steps: event.currentTarget.value })
                  }
                />
              </>
            ) : (
              <Textarea
                data-autofocus
                label={t(`content_kind_${kind}` as never)}
                autosize
                minRows={3}
                value={draft.text}
                onChange={(event) =>
                  setDraft({ ...draft, text: event.currentTarget.value })
                }
              />
            )}
            <Group justify="flex-end" gap="xs">
              <SecondaryButton onClick={() => setDraft(null)}>
                {t("cancel")}
              </SecondaryButton>
              <PrimaryButton onClick={save} loading={busy} disabled={!complete}>
                {t("save_changes")}
              </PrimaryButton>
            </Group>
          </Stack>
        )}
      </Modal>

      <ConfirmModal
        opened={deleting !== null}
        confirmLabel={t("delete")}
        message={t("content_confirm_delete").replace(
          "{item}",
          deleting ? summarize(deleting).slice(0, 60) : "",
        )}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const target = deleting;
          setDeleting(null);
          if (!target) return;
          await submit(() => api.del(`/api/content/${target.id}`), "status_saved");
          await refresh();
        }}
      />
    </Stack>
  );
}
