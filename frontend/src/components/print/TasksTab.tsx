import { Group, Select, Stack, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type { PrintMode, PrintResponse } from "../../api/types";
import { toDateOnly } from "../../dates";
import { deriveName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import { usePrintGate } from "./PrintGate";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { SecondaryButton } from "../ui/Buttons";
import { IconActionButton } from "../ui/IconActionButton";
import { PrintActions } from "./PrintActions";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";

type Row = { id: number; text: string; due: Date | null };

let nextRowId = 0;
const emptyRow = (): Row => ({ id: nextRowId++, text: "", due: null });

export function TasksTab() {
  const t = useStrings();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<PrintMode>("single");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [saveAsSnippet, setSaveAsSnippet] = useState(false);
  const options = useQueueOptions();
  const { runPrint, busy } = usePrintGate();
  const saveSnippet = useSaveAsSnippet();

  const patchRow = (id: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  /**
   * Pasting a multi-line list fills one task per line rather than dropping the
   * whole block into a single field. Handled on paste (not on change) so the
   * clipboard text is available before the input collapses the newlines, and
   * so typing is never second-guessed.
   */
  const pasteRows = (id: number, clipboard: string): boolean => {
    const lines = clipboard
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*\u2022]\s*/, "").trim())
      .filter(Boolean);
    if (lines.length < 2) return false;

    setRows((current) => {
      const index = current.findIndex((row) => row.id === id);
      const added = lines.map((text) => ({ ...emptyRow(), text }));
      // Replace the row pasted into; keep anything already typed elsewhere.
      return [...current.slice(0, index), ...added, ...current.slice(index + 1)];
    });
    return true;
  };

  const items = rows
    .filter((row) => row.text.trim())
    .map((row) => ({
      text: row.text.trim(),
      due: row.due ? toDateOnly(row.due) : null,
    }));

  const send = async (queue: boolean) => {
    const body = {
      title: title.trim() || null,
      items,
      mode,
      ...(queue ? options.toPayload() : {}),
    };
    const ok = await runPrint(
      async () => {
      if (saveAsSnippet) {
        // The structure, not a rendering of it — a saved checklist reprints
        // through print_checklist with its due dates and mode intact.
        await saveSnippet(
          deriveName(title || items[0]?.text || "", t("kind_checklist")),
          (form) => {
            form.set("kind", "checklist");
            form.set(
              "payload",
              JSON.stringify({ title: title.trim() || null, items, mode }),
            );
          },
        );
      }
        return api.postJson<PrintResponse>("/print/checklist", body);
      },
      {
        kind: "checklist",
        payload: JSON.stringify({ title: title.trim() || null, items, mode }),
      },
      { queued: queue },
    );
    if (ok) {
      setTitle("");
      setRows([emptyRow()]);
      setSaveAsSnippet(false);
      options.reset();
    }
  };

  return (
    <Stack gap="sm">
      <TextInput
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
        placeholder={t("tasks_title_placeholder")}
      />

      <Stack gap="xs">
        {rows.map((row) => (
          <Group key={row.id} gap="xs" wrap="nowrap" align="flex-start">
            <TextInput
              flex={2}
              value={row.text}
              onChange={(event) =>
                patchRow(row.id, { text: event.currentTarget.value })
              }
              onPaste={(event) => {
                if (pasteRows(row.id, event.clipboardData.getData("text"))) {
                  event.preventDefault();
                }
              }}
              placeholder={t("task_placeholder")}
            />
            <DateInput
              flex={1}
              value={row.due}
              onChange={(due) => patchRow(row.id, { due })}
              placeholder={t("due_date")}
              aria-label={t("due_date")}
              valueFormat="YYYY-MM-DD"
              clearable
            />
            <IconActionButton
              label={t("remove_item")}
              tone="danger"
              disabled={rows.length === 1}
              onClick={() =>
                setRows((current) =>
                  current.filter((candidate) => candidate.id !== row.id),
                )
              }
            >
              <IconX size={ICON_SIZE.md} stroke={ICON_STROKE} />
            </IconActionButton>
          </Group>
        ))}
      </Stack>

      <Group gap="xs">
        <SecondaryButton
          type="button"
          onClick={() => setRows((current) => [...current, emptyRow()])}
          icon={<IconPlus size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          {t("add_item")}
        </SecondaryButton>
      </Group>

      <Select
        aria-label={t("print_checklist_btn")}
        value={mode}
        onChange={(value) => setMode((value as PrintMode) ?? "single")}
        allowDeselect={false}
        data={[
          { value: "single", label: t("one_receipt") },
          { value: "separate", label: t("separate_receipts") },
        ]}
      />

      <QueueOptionsFields value={options.state} onChange={options.setState} />

      <PrintActions
        printLabelKey="print_checklist_btn"
        busy={busy}
        disabled={items.length === 0}
        onPrint={() => send(false)}
        onQueue={() => send(true)}
        saveAsSnippet={saveAsSnippet}
        onSaveAsSnippetChange={setSaveAsSnippet}
        queueDisabled={!options.complete}
      />
    </Stack>
  );
}
