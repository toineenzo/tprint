import {
  Anchor,
  Switch,
  Divider,
  FileInput,
  Group,
  Image,
  Loader,
  NumberInput,
  SegmentedControl,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconDeviceFloppy,
  IconHistory,
  IconInfoCircle,
  IconLayoutBoardSplit,
  IconPhoto,
  IconPlugConnected,
  IconPrinter,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { useStrings } from "../../AppContext";
import { api } from "../../api/client";
import type { AboutInfo, PrinterSettings } from "../../api/types";
import { useSubmit } from "../../hooks/useSubmit";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../../theme";
import { AlignPicker } from "../ui/AlignPicker";
import { CropModal } from "../ui/CropModal";
import { DEFAULT_FRAME_STYLE, FrameStyleRow, isPlainFrame } from "./FrameStyleRow";
import { DangerButton, PrimaryButton } from "../ui/Buttons";
import { ConfirmModal } from "../ui/PromptModals";
import { ContentManager } from "./ContentManager";
import { PrinterPanel } from "./PrinterPanel";

/** Widths that get a named button; anything else is entered as raw dots. */
const PAPER_PRESETS = [576, 384];

/**
 * A sample receipt rendered by the server from the *saved* settings.
 *
 * Deliberately not rendered from this form's unsaved state: it answers "what
 * do my settings produce", and showing edits that aren't in effect yet would
 * make it a worse answer, not a better one.
 */
function SettingsPreview({ refreshKey }: { refreshKey: number }) {
  const t = useStrings();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(`/api/settings/preview?v=${refreshKey}`);
        if (!res.ok) return;
        const blob = await res.blob();
        if (stale) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        /* the panel simply stays empty */
      }
    })();
    return () => {
      stale = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [refreshKey]);

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>{t("settings_preview")}</Text>
      <Text size="sm" c="dimmed">{t("settings_preview_hint")}</Text>
      {url ? (
        <Image
          src={url}
          alt={t("settings_preview")}
          fit="contain"
          // Capped at roughly a receipt's own width: stretched to the panel it
          // upscales a 576-dot strip into something that looks nothing like
          // what comes out of the printer.
          maw={320}
          style={{
            background: "#fff",
            border: "1px solid var(--mantine-color-default-border)",
            maxHeight: 320,
          }}
        />
      ) : (
        <Loader size="sm" />
      )}
    </Stack>
  );
}

/** App description, licence, and the libraries tprint is built on. */
function AboutSection() {
  const t = useStrings();
  const [about, setAbout] = useState<AboutInfo | null>(null);

  useEffect(() => {
    void api
      .get<AboutInfo>("/api/settings/about")
      .then(setAbout)
      .catch(() => undefined);
  }, []);

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>{t("about_title")}</Text>
      <Text size="sm" c="dimmed">{t("about_description")}</Text>

      {about && (
        <>
          <Text size="sm">
            {t("about_license")}:{" "}
            <Anchor href={about.license_url} target="_blank" rel="noreferrer">
              {about.license_name}
            </Anchor>
          </Text>
          <Text size="xs" c="dimmed">{about.license_note}</Text>
          <Text size="sm">
            <Anchor href={about.source_url} target="_blank" rel="noreferrer">
              {t("about_source")}
            </Anchor>
          </Text>

          <Text size="sm" mt="xs">{t("about_libraries")}</Text>
          <Table striped withTableBorder>
            <Table.Tbody>
              {about.libraries.map((library) => (
                <Table.Tr key={library.name}>
                  <Table.Td><Text size="xs" fw={600}>{library.name}</Text></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{library.role}</Text></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{library.license}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}

/**
 * The printer-settings form. Lives inside SettingsModal rather than a page of
 * its own — the fields, and the single multipart POST /api/settings they
 * produce, are unchanged from when this was `/settings`.
 */
export function SettingsForm({
  initial,
  initialTab,
  onSaved,
}: {
  initial: PrinterSettings;
  initialTab?: string;
  onSaved: (saved: PrinterSettings) => void;
}) {
  const t = useStrings();
  const { submit, busy } = useSubmit();

  const [values, setValues] = useState<PrinterSettings>(initial);
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [footerLogo, setFooterLogo] = useState<File | null>(null);
  const [removeFooterLogo, setRemoveFooterLogo] = useState(false);
  // Bumped after every save so the preview panel refetches; the endpoint
  // renders from the stored settings, not from this form's state.
  const [previewKey, setPreviewKey] = useState(0);
  /** Which logo is being cropped, if either — see CropModal. */
  const [croppingLogo, setCroppingLogo] = useState<"header" | "footer" | null>(null);
  const [tab, setTab] = useState<string | null>(initialTab ?? "frame");

  const patch = (next: Partial<PrinterSettings>) =>
    setValues((current) => ({ ...current, ...next }));

  const save = async () => {
    const form = new FormData();
    form.set("header_text", values.header_text ?? "");
    form.set("footer_text", values.footer_text ?? "");
    form.set("default_align", values.default_align);
    form.set("default_bold", String(values.default_bold));
    form.set("default_double_width", String(values.default_double_width));
    form.set("remove_logo", String(removeLogo));
    if (logo && !removeLogo) form.set("logo", logo);
    form.set("remove_footer_logo", String(removeFooterLogo));
    if (footerLogo && !removeFooterLogo) form.set("footer_logo", footerLogo);
    form.set("paper_width_px", String(values.paper_width_px));
    form.set("auto_cut", String(values.auto_cut));
    form.set("confirm_before_print", String(values.confirm_before_print));
    form.set("surprise_preview", String(values.surprise_preview));
    form.set("print_delay_seconds", String(values.print_delay_seconds));
    form.set("retention_max_items", String(values.retention_max_items));
    form.set("retention_max_age_days", String(values.retention_max_age_days));
    form.set("queue_auto_clear", String(values.queue_auto_clear));
    // A default style is saved as *no* style, keeping the frame on the crisp
    // native path — see printer._frame_style.
    if (values.header_style && !isPlainFrame(values.header_style)) {
      form.set("header_style", JSON.stringify(values.header_style));
    }
    if (values.footer_style && !isPlainFrame(values.footer_style)) {
      form.set("footer_style", JSON.stringify(values.footer_style));
    }

    const saved = await submit(
      () => api.postForm<PrinterSettings>("/api/settings", form),
      "settings_saved",
    );
    if (saved) {
      setValues(saved);
      setLogo(null);
      setRemoveLogo(false);
      setFooterLogo(null);
      setRemoveFooterLogo(false);
      setPreviewKey((key) => key + 1);
      onSaved(saved);
    }
  };

  // The three field tabs share one Save (a single POST persists all `values`),
  // so the Save button + preview live below the Tabs and only show for them —
  // Content, About and Reset are self-contained and don't touch `values`.
  const fieldTab = tab === "frame" || tab === "output" || tab === "retention";

  // A sidebar next to a form panel needs width the phone doesn't have — on a
  // narrow screen the tabs go back on top and the panel gets the whole width.
  const narrow = useMediaQuery("(max-width: 48em)");

  return (
    <Tabs
      orientation={narrow ? "horizontal" : "vertical"}
      value={tab}
      onChange={setTab}
      variant="pills"
    >
      {/* The modal body is the scroll container, so the tab list sticks to the
          top of it and only the panel scrolls away. `alignSelf` is what makes
          that possible: a stretched flex child is as tall as the panel and has
          nowhere to stick to. Narrow screens keep the list above the content,
          where sticking it would cover the fields it scrolls over. */}
      <Tabs.List
        mr={narrow ? 0 : "md"}
        mb={narrow ? "md" : 0}
        style={narrow ? undefined : { position: "sticky", top: 0, alignSelf: "flex-start" }}
      >
        <Tabs.Tab
          value="frame"
          leftSection={<IconLayoutBoardSplit size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("settings_tab_frame")}
        </Tabs.Tab>
        <Tabs.Tab
          value="output"
          leftSection={<IconPrinter size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("settings_tab_output")}
        </Tabs.Tab>
        <Tabs.Tab
          value="retention"
          leftSection={<IconHistory size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("settings_tab_retention")}
        </Tabs.Tab>
        <Tabs.Tab
          value="printer"
          leftSection={<IconPlugConnected size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("settings_tab_printer")}
        </Tabs.Tab>
        <Tabs.Tab
          value="content"
          leftSection={<IconSparkles size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("settings_tab_content")}
        </Tabs.Tab>
        <Tabs.Tab
          value="about"
          leftSection={<IconInfoCircle size={ICON_SIZE.sm} stroke={ICON_STROKE} />}
        >
          {t("about_title")}
        </Tabs.Tab>
      </Tabs.List>

      <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
        <Tabs.Panel value="frame">
          <Stack gap="md">
            <Text c="dimmed" size="sm">
              {t("settings_intro")}
            </Text>

            <Textarea
              label={t("settings_header_text")}
              description={t("settings_header_hint")}
              autosize
              minRows={2}
              value={values.header_text ?? ""}
              onChange={(event) => patch({ header_text: event.currentTarget.value })}
            />
            <FrameStyleRow
              value={values.header_style ?? DEFAULT_FRAME_STYLE}
              onChange={(header_style) => patch({ header_style })}
            />

            <Textarea
              label={t("settings_footer_text")}
              description={t("settings_footer_hint")}
              autosize
              minRows={2}
              value={values.footer_text ?? ""}
              onChange={(event) => patch({ footer_text: event.currentTarget.value })}
            />
            <FrameStyleRow
              value={values.footer_style ?? DEFAULT_FRAME_STYLE}
              onChange={(footer_style) => patch({ footer_style })}
            />

            <Stack gap="xs">
              {values.has_logo && (
                <Group gap="sm" align="center">
                  <Text size="sm" c="dimmed">
                    {t("settings_current_logo")}
                  </Text>
                  <Image src="/api/settings/logo" alt="" h={40} w="auto" fit="contain" />
                  <Switch
                    label={t("settings_remove_logo")}
                    checked={removeLogo}
                    onChange={(event) => setRemoveLogo(event.currentTarget.checked)}
                  />
                </Group>
              )}
              <FileInput
                label={t("settings_logo")}
                aria-label={t("settings_logo")}
                description={t("settings_logo_hint")}
                accept="image/*"
                clearable
                disabled={removeLogo}
                value={logo}
                onChange={(next) => {
                  setLogo(next);
                  // A logo is nearly always a crop away from being right, and
                  // the printer is only ~570 dots wide — offer it up front.
                  if (next) setCroppingLogo("header");
                }}
                leftSection={<IconPhoto size={ICON_SIZE.md} stroke={ICON_STROKE} />}
              />
            </Stack>

            <Stack gap="xs">
              {values.has_footer_logo && (
                <Group gap="sm" align="center">
                  <Text size="sm" c="dimmed">
                    {t("settings_current_footer_logo")}
                  </Text>
                  <Image src="/api/settings/footer-logo" alt="" h={40} w="auto" fit="contain" />
                  <Switch
                    label={t("settings_remove_logo")}
                    checked={removeFooterLogo}
                    onChange={(event) => setRemoveFooterLogo(event.currentTarget.checked)}
                  />
                </Group>
              )}
              <FileInput
                label={t("settings_footer_logo")}
                aria-label={t("settings_footer_logo")}
                description={t("settings_footer_logo_hint")}
                accept="image/*"
                clearable
                disabled={removeFooterLogo}
                value={footerLogo}
                onChange={(next) => {
                  setFooterLogo(next);
                  if (next) setCroppingLogo("footer");
                }}
                leftSection={<IconPhoto size={ICON_SIZE.md} stroke={ICON_STROKE} />}
              />
            </Stack>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="output">
          <Stack gap="md">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                {t("settings_text_style")}
              </Text>
              <Switch
                label={t("settings_bold")}
                checked={values.default_bold}
                onChange={(event) => patch({ default_bold: event.currentTarget.checked })}
              />
              <Switch
                label={t("settings_double_width")}
                checked={values.default_double_width}
                onChange={(event) =>
                  patch({ default_double_width: event.currentTarget.checked })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                {t("settings_align")}
              </Text>
              <AlignPicker
                value={values.default_align}
                onChange={(align) => patch({ default_align: align })}
              />
            </Stack>

            <Divider my="xs" />

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                {t("settings_paper")}
              </Text>
              <SegmentedControl
                fullWidth
                value={PAPER_PRESETS.includes(values.paper_width_px)
                  ? String(values.paper_width_px)
                  : "custom"}
                onChange={(next) =>
                  patch({
                    paper_width_px:
                      next === "custom" ? values.paper_width_px : Number(next),
                  })
                }
                data={[
                  { value: "576", label: t("paper_80mm") },
                  { value: "384", label: t("paper_58mm") },
                  { value: "custom", label: t("paper_custom") },
                ]}
              />
              <NumberInput
                label={t("paper_width_label")}
                description={t("paper_width_hint")}
                min={100}
                max={2048}
                value={values.paper_width_px}
                onChange={(value) =>
                  patch({ paper_width_px: Number(value) || values.paper_width_px })
                }
              />
              <Switch
                label={t("settings_auto_cut")}
                description={t("settings_auto_cut_hint")}
                checked={values.auto_cut}
                onChange={(event) => patch({ auto_cut: event.currentTarget.checked })}
              />
            </Stack>

            <Divider my="xs" />

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                {t("settings_behaviour")}
              </Text>
              <Switch
                label={t("settings_confirm_print")}
                description={t("settings_confirm_print_hint")}
                checked={values.confirm_before_print}
                onChange={(event) =>
                  patch({ confirm_before_print: event.currentTarget.checked })
                }
              />
              <Switch
                label={t("settings_surprise_preview")}
                description={t("settings_surprise_preview_hint")}
                checked={values.surprise_preview}
                onChange={(event) =>
                  patch({ surprise_preview: event.currentTarget.checked })
                }
              />
              <NumberInput
                label={t("settings_print_delay")}
                description={t("settings_print_delay_hint")}
                min={0}
                max={60}
                value={values.print_delay_seconds}
                onChange={(value) => patch({ print_delay_seconds: Number(value) || 0 })}
              />
            </Stack>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="retention">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {t("settings_retention")}
            </Text>
            <Text size="sm" c="dimmed">
              {t("settings_retention_hint")}
            </Text>
            <NumberInput
              label={t("settings_retention_items")}
              description={t("settings_retention_zero")}
              min={0}
              value={values.retention_max_items}
              onChange={(value) => patch({ retention_max_items: Number(value) || 0 })}
            />
            <NumberInput
              label={t("settings_retention_age")}
              description={t("settings_retention_zero")}
              min={0}
              value={values.retention_max_age_days}
              onChange={(value) =>
                patch({ retention_max_age_days: Number(value) || 0 })
              }
            />
            <Switch
              label={t("settings_queue_auto_clear")}
              description={t("settings_queue_auto_clear_hint")}
              checked={values.queue_auto_clear}
              onChange={(event) =>
                patch({ queue_auto_clear: event.currentTarget.checked })
              }
            />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="printer">
          <PrinterPanel settings={values} onSaved={(next) => { setValues(next); onSaved(next); }} />
        </Tabs.Panel>

        <Tabs.Panel value="content">
          <ContentManager />
        </Tabs.Panel>

        <Tabs.Panel value="about">
          <Stack gap="md">
            <AboutSection />
            <Divider my="xs" />
            <ResetDataSection />
          </Stack>
        </Tabs.Panel>

        {fieldTab && (
          <>
            <Group justify="flex-end">
              <PrimaryButton
                onClick={save}
                loading={busy}
                icon={<IconDeviceFloppy size={ICON_SIZE.md} stroke={ICON_STROKE} />}
              >
                {t("save_settings")}
              </PrimaryButton>
            </Group>

            <Divider my="xs" />

            <SettingsPreview refreshKey={previewKey} />
          </>
        )}

        {croppingLogo && (
          <CropModal
            file={croppingLogo === "header" ? logo : footerLogo}
            onCancel={() => setCroppingLogo(null)}
            onDone={({ cropped }) => {
              if (cropped) {
                if (croppingLogo === "header") setLogo(cropped);
                else setFooterLogo(cropped);
              }
              setCroppingLogo(null);
            }}
          />
        )}
      </Stack>
    </Tabs>
  );
}

/**
 * Wipes the database. Isolated at the bottom behind its own confirmation
 * because it is the only control in the app that destroys data the user can't
 * get back — the page reloads afterwards, since every seeded list is stale.
 */
function ResetDataSection() {
  const t = useStrings();
  const { submit, busy } = useSubmit();
  const [confirming, setConfirming] = useState(false);

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600} c={ROLE.danger}>
        {t("danger_zone")}
      </Text>
      <Text size="sm" c="dimmed">
        {t("reset_data_hint")}
      </Text>
      <Group>
        <DangerButton
          loading={busy}
          onClick={() => setConfirming(true)}
          icon={<IconTrash size={ICON_SIZE.md} stroke={ICON_STROKE} />}
        >
          {t("reset_data")}
        </DangerButton>
      </Group>

      <ConfirmModal
        opened={confirming}
        title={t("reset_data")}
        message={t("confirm_reset_data")}
        confirmLabel={t("reset_data")}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          const done = await submit(
            () => api.post("/api/settings/reset"),
            "reset_data_done",
          );
          // The bootstrap payload still holds the pre-reset snippets, history
          // and settings; a reload is the honest way to show an empty app.
          if (done !== undefined) window.location.reload();
        }}
      />
    </Stack>
  );
}
