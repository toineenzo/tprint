import {
  Checkbox,
  FileInput,
  TextInput,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCalendarEvent } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { useStrings } from "../../AppContext";
import { api, appendQueueOptions } from "../../api/client";
import type {
  AgendaOrientation,
  AgendaOverview,
  IcsMode,
  PrintResponse,
} from "../../api/types";
import { toDateOnly } from "../../dates";
import { deriveFileName, useSaveAsSnippet } from "../../hooks/useSaveAsSnippet";
import { notifyError } from "../../notify";
import { SecondaryButton } from "../ui/Buttons";
import { usePrintGate } from "./PrintGate";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { PrintActions } from "./PrintActions";
import { QueueOptionsFields, useQueueOptions } from "./QueueOptionsFields";

/** One event as the server lists it, with the index that selects it. */
type IcsEvent = {
  index: number;
  summary: string;
  when: string | null;
  location: string | null;
  /** ISO day, or null when the event has no usable start. */
  date: string | null;
};

export function IcsTab() {
  const t = useStrings();
  const [file, setFile] = useState<File | null>(null);
  // A subscription URL instead of an upload. The distinction matters for a
  // scheduled job: a URL is re-fetched on every run, so "every Monday" prints
  // the calendar as it is *then*.
  const [source, setSource] = useState<"file" | "url">("file");
  const [url, setUrl] = useState("");
  // Relative window, evaluated server-side at print time — an absolute range
  // would be frozen to the day the job was created.
  const [daysAhead, setDaysAhead] = useState<string>("none");
  const [mode, setMode] = useState<IcsMode>("single");
  const [overview, setOverview] = useState<AgendaOverview>("none");
  const [orientation, setOrientation] = useState<AgendaOrientation>("vertical");
  const [saveAsSnippet, setSaveAsSnippet] = useState(false);
  // The calendar's contents, and which of it to print. `chosen` holds indices
  // into the parsed list — the same token /print/ics selects by, so a queued
  // job re-parsing the stored file picks exactly these events.
  const [events, setEvents] = useState<IcsEvent[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);
  const options = useQueueOptions();
  const { runPrint, busy } = usePrintGate();
  const saveSnippet = useSaveAsSnippet();

  // Read the calendar as soon as it's picked: the choice below is only
  // meaningful once you can see what's in the file.
  useEffect(() => {
    const usingUrl = source === "url" && url.trim().length > 0;
    if (!file && !usingUrl) {
      setEvents([]);
      setChosen(new Set());
      setRange([null, null]);
      return;
    }
    let stale = false;
    void (async () => {
      const form = new FormData();
      if (usingUrl) form.set("url", url.trim());
      else if (file) form.set("file", file);
      if (daysAhead !== "none") form.set("days_ahead", daysAhead);
      try {
        const result = await api.postForm<{ events: IcsEvent[] }>(
          "/print/ics-events",
          form,
        );
        if (stale) return;
        setEvents(result.events);
        // Everything selected to begin with: the tab printed the whole
        // calendar before this existed, and that stays the default.
        setChosen(new Set(result.events.map((event) => event.index)));
      } catch (error) {
        if (!stale) notifyError(error instanceof Error ? error.message : t("status_error"));
      }
    })();
    return () => {
      stale = true;
    };
  }, [file, source, url, daysAhead, t]);

  const [from, to] = range;
  const inRange = (event: IcsEvent) => {
    if (!from && !to) return true;
    // An event with no usable date can't be inside a range; hiding it is
    // better than silently printing something the filter never showed.
    if (!event.date) return false;
    if (from && event.date < toDateOnly(from)) return false;
    if (to && event.date > toDateOnly(to)) return false;
    return true;
  };

  const visible = events.filter(inRange);
  const selected = visible.filter((event) => chosen.has(event.index));

  const toggle = (index: number, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });

  const send = async (queue: boolean) => {
    const usingUrl = source === "url" && url.trim().length > 0;
    if (!file && !usingUrl) return;
    const form = new FormData();
    if (usingUrl) form.set("url", url.trim());
    else if (file) form.set("file", file);
    if (daysAhead !== "none") form.set("days_ahead", daysAhead);
    form.set("mode", mode);
    form.set("overview", overview);
    form.set("orientation", orientation);
    // Only sent when it is actually a subset: omitting it means "all", which
    // is what every caller that predates selection sends.
    const selection = selected.map((event) => event.index);
    if (selection.length !== events.length) form.set("select", selection.join(","));
    if (queue) appendQueueOptions(form, options.toPayload());
    const ok = await runPrint(
      async () => {
      // A URL calendar has no file to store, so it can't become a snippet —
      // the checkbox is hidden in that mode rather than silently doing nothing.
      if (saveAsSnippet && file) {
        // Stores the .ics itself, so reprinting re-parses the calendar rather
        // than replaying one frozen rendering of it.
        await saveSnippet(deriveFileName(file, t("kind_ics")), (snippet) => {
          snippet.set("kind", "ics");
          snippet.set("files", file);
          snippet.set("mode", mode);
          snippet.set("overview", overview);
          snippet.set("orientation", orientation);
        });
      }
        return api.postForm<PrintResponse>("/print/ics", form);
      },
      {
        kind: "ics",
        file: usingUrl ? null : file,
        url: usingUrl ? url.trim() : undefined,
        days_ahead: daysAhead === "none" ? undefined : Number(daysAhead),
        mode,
        overview,
        orientation,
        select:
          selection.length === events.length ? undefined : selection.join(","),
      },
      { queued: queue },
    );
    if (ok) {
      setFile(null);
      setEvents([]);
      setChosen(new Set());
      setRange([null, null]);
      setSaveAsSnippet(false);
      options.reset();
    }
  };

  return (
    <Stack gap="sm">
      <SegmentedControl
        fullWidth
        value={source}
        onChange={(next) => {
          setSource(next as "file" | "url");
          setFile(null);
          setEvents([]);
        }}
        data={[
          { value: "file", label: t("ics_source_file") },
          { value: "url", label: t("ics_source_url") },
        ]}
      />

      {source === "file" ? (
        <FileInput
          label={t("ics_upload_label")}
          aria-label={t("ics_upload_label")}
          value={file}
          onChange={setFile}
          accept=".ics,text/calendar"
          clearable
          leftSection={
            <IconCalendarEvent size={ICON_SIZE.md} stroke={ICON_STROKE} />
          }
        />
      ) : (
        <TextInput
          label={t("ics_url_label")}
          description={t("ics_url_hint")}
          placeholder="https://…/basic.ics"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          leftSection={
            <IconCalendarEvent size={ICON_SIZE.md} stroke={ICON_STROKE} />
          }
        />
      )}

      <Select
        label={t("ics_window_label")}
        description={t("ics_window_hint")}
        value={daysAhead}
        allowDeselect={false}
        onChange={(value) => setDaysAhead(value ?? "none")}
        data={[
          { value: "none", label: t("ics_window_all") },
          { value: "0", label: t("ics_window_today") },
          { value: "7", label: t("ics_window_week") },
          { value: "14", label: t("ics_window_fortnight") },
          { value: "30", label: t("ics_window_month") },
        ]}
      />

      {events.length > 0 && (
        <Stack gap="xs">
          <DatePickerInput
            type="range"
            label={t("ics_range_label")}
            description={t("ics_range_hint")}
            placeholder="—"
            clearable
            valueFormat="YYYY-MM-DD"
            value={range}
            onChange={(next) => setRange(next as [Date | null, Date | null])}
          />

          <Group gap="xs">
            <Text size="sm">
              {t("ics_selected_count")
                .replace("{selected}", String(selected.length))
                .replace("{total}", String(events.length))}
            </Text>
            <SecondaryButton
              size="xs"
              onClick={() =>
                setChosen(new Set(visible.map((event) => event.index)))
              }
            >
              {t("ics_select_all")}
            </SecondaryButton>
            <SecondaryButton size="xs" onClick={() => setChosen(new Set())}>
              {t("ics_select_none")}
            </SecondaryButton>
          </Group>

          <ScrollArea.Autosize mah={220}>
            <Stack gap={4}>
              {visible.map((event) => (
                <Checkbox
                  key={event.index}
                  checked={chosen.has(event.index)}
                  onChange={(changed) =>
                    toggle(event.index, changed.currentTarget.checked)
                  }
                  label={
                    <Text size="sm">
                      {event.summary || "—"}
                      {event.when && (
                        <Text span size="xs" c="dimmed">
                          {" "}
                          · {event.when}
                        </Text>
                      )}
                    </Text>
                  }
                />
              ))}
              {visible.length === 0 && (
                <Text size="sm" c="dimmed">
                  {t("ics_none_in_range")}
                </Text>
              )}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      )}

      <Select
        aria-label={t("print_ics_btn")}
        value={mode}
        onChange={(value) => setMode((value as IcsMode) ?? "single")}
        allowDeselect={false}
        data={[
          { value: "single", label: t("ics_mode_single") },
          { value: "day", label: t("ics_mode_day") },
          { value: "separate", label: t("ics_mode_separate") },
        ]}
      />

      <Stack gap={4}>
        <Switch
          label={t("agenda_overview")}
          description={t("agenda_overview_hint")}
          checked={overview !== "none"}
          onChange={(event) =>
            setOverview(event.currentTarget.checked ? "month" : "none")
          }
        />
        {overview !== "none" && (
          <SegmentedControl
            size="xs"
            value={overview}
            onChange={(value) => setOverview(value as AgendaOverview)}
            data={[
              { value: "week", label: t("agenda_overview_week") },
              { value: "month", label: t("agenda_overview_month") },
            ]}
          />
        )}
      </Stack>

      {/* Orientation only means anything for a per-day slip: an agenda that
          runs to several receipts has nothing to turn sideways. */}
      {mode === "day" && (
        <Stack gap={4}>
          <Text size="sm">{t("agenda_orientation")}</Text>
          <SegmentedControl
            size="xs"
            value={orientation}
            onChange={(value) => setOrientation(value as AgendaOrientation)}
            data={[
              { value: "vertical", label: t("agenda_vertical") },
              { value: "horizontal", label: t("agenda_horizontal") },
            ]}
          />
          <Text size="xs" c="dimmed">
            {orientation === "horizontal"
              ? t("agenda_horizontal_hint")
              : t("agenda_vertical_hint")}
          </Text>
        </Stack>
      )}

      <QueueOptionsFields value={options.state} onChange={options.setState} />

      <PrintActions
        printLabelKey="print_ics_btn"
        busy={busy}
        disabled={selected.length === 0}
        onPrint={() => send(false)}
        onQueue={() => send(true)}
        saveAsSnippet={saveAsSnippet}
        onSaveAsSnippetChange={setSaveAsSnippet}
        queueDisabled={!options.complete}
        scheduleOnly={options.chosen}
      />
    </Stack>
  );
}
