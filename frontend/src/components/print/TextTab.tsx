import { Stack, Switch, Textarea } from "@mantine/core";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type { PrintResponse, RichTextBlock } from "../../api/types";
import { deriveName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import { PrintActions } from "./PrintActions";
import { usePrintGate } from "./PrintGate";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";
import {
  RichTextEditor,
  blocksToText,
  isUnstyled,
  textToBlocks,
} from "./RichTextEditor";

/**
 * One tab for both plain and formatted text.
 *
 * Unformatted text takes the native ESC/POS path exactly as it always has —
 * crisp printer font, small payload. Turning formatting on switches to
 * /print/richtext, which renders a bitmap because ESC/POS has no italic and no
 * per-run grey. The bitmap cost is only paid when formatting is actually used,
 * and switching the toggle carries the text across either way.
 */
export function TextTab() {
  const t = useStrings();
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState<RichTextBlock[]>(() => textToBlocks(""));
  const [formatted, setFormatted] = useState(false);
  const [saveAsSnippet, setSaveAsSnippet] = useState(false);
  const options = useQueueOptions();
  const { runPrint, busy } = usePrintGate();
  const saveSnippet = useSaveAsSnippet();

  const plain = formatted ? blocksToText(blocks) : text;
  const empty = !plain.trim();

  const toggleFormatting = (on: boolean) => {
    // Carry the content across so toggling never loses what was typed.
    if (on) setBlocks(textToBlocks(text));
    else setText(blocksToText(blocks));
    setFormatted(on);
  };

  const send = async (queue: boolean) => {
    // Formatting that changes nothing still goes down the crisp native path.
    const useRich = formatted && !isUnstyled(blocks);
    const queueOptions = queue ? options.toPayload() : {};
    const body = useRich
      ? { blocks, ...queueOptions }
      : { text: plain, ...queueOptions };

    const ok = await runPrint(
      async () => {
        if (saveAsSnippet) {
          await saveSnippet(deriveName(plain, t("kind_text")), (form) => {
            form.set("kind", "text");
            form.set("text_content", plain.trim());
          });
        }
        return api.postJson<PrintResponse>(
          useRich ? "/print/richtext" : "/print/text",
          body,
        );
      },
      useRich
        ? { kind: "richtext", payload: JSON.stringify({ blocks }) }
        : { kind: "text", text: plain },
      { queued: queue },
    );
    if (ok) {
      setText("");
      setBlocks(textToBlocks(""));
      setSaveAsSnippet(false);
      options.reset();
    }
  };

  return (
    <Stack gap="sm">
      <Switch
        checked={formatted}
        onChange={(event) => toggleFormatting(event.currentTarget.checked)}
        label={t("rt_enable")}
        description={t("rt_enable_hint")}
      />

      {formatted ? (
        <RichTextEditor blocks={blocks} onChange={setBlocks} />
      ) : (
        <Textarea
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder={t("text_placeholder")}
          autosize
          minRows={6}
          maxRows={16}
        />
      )}

      <QueueOptionsFields value={options.state} onChange={options.setState} />

      <PrintActions
        printLabelKey="print_text_btn"
        busy={busy}
        disabled={empty}
        onPrint={() => send(false)}
        onQueue={() => send(true)}
        saveAsSnippet={saveAsSnippet}
        onSaveAsSnippetChange={setSaveAsSnippet}
        queueDisabled={!options.complete}
      />
    </Stack>
  );
}
