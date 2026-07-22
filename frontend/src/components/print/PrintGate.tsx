import { Image, Loader, Modal, Stack, Text } from "@mantine/core";
import { IconPrinter } from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useStrings } from "../../AppContext";
import { useAppData } from "../../AppData";
import type { PreviewRequest, PrintResponse } from "../../api/types";
import { usePreviewImage } from "../../hooks/usePreview";
import { usePrint } from "../../hooks/usePrint";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../../theme";
import { PrimaryButton, SecondaryButton } from "../ui/Buttons";

type RunPrint = (
  action: () => Promise<PrintResponse>,
  preview: PreviewRequest,
  options?: { queued?: boolean },
) => Promise<boolean>;

const PrintGateContext = createContext<{ runPrint: RunPrint; busy: boolean } | null>(
  null,
);

/**
 * Wraps every print in the optional "confirm before printing" step.
 *
 * Tabs call `runPrint` instead of `print` and pass a description of what they
 * are about to send. With the setting off it forwards straight through; with
 * it on, that description is rendered by the server and shown for approval
 * first. Queued and scheduled prints skip the gate — there is nothing
 * immediate to confirm, and the point of queueing is to walk away.
 */
export function PrintGateProvider({ children }: { children: ReactNode }) {
  const t = useStrings();
  const { settings } = useAppData();
  const { print, busy } = usePrint();

  const [pending, setPending] = useState<PreviewRequest | null>(null);
  const action = useRef<(() => Promise<PrintResponse>) | null>(null);
  const settle = useRef<((confirmed: boolean) => void) | null>(null);

  /**
   * Hand back the pending promise exactly once and clear the slot.
   *
   * Everything that ends a confirmation goes through here. Settling twice is a
   * no-op, and — more importantly — *never* settling is impossible: a caller
   * awaiting `runPrint` would otherwise hang forever, leaving its form stuck
   * with the text it thought it had just printed.
   */
  const settleOnce = useCallback((confirmed: boolean) => {
    const resolve = settle.current;
    settle.current = null;
    action.current = null;
    resolve?.(confirmed);
  }, []);

  const finish = useCallback(
    (confirmed: boolean) => {
      setPending(null);
      settleOnce(confirmed);
    },
    [settleOnce],
  );

  const runPrint = useCallback<RunPrint>(
    async (next, preview, options) => {
      if (!settings?.confirm_before_print || options?.queued) {
        return print(next);
      }
      // A second request while one is still awaiting confirmation abandons the
      // first, rather than overwriting its resolver and stranding that caller.
      settleOnce(false);
      return new Promise<boolean>((resolve) => {
        action.current = next;
        settle.current = resolve;
        setPending(preview);
      });
    },
    [print, settleOnce, settings?.confirm_before_print],
  );

  return (
    <PrintGateContext.Provider value={{ runPrint, busy }}>
      {children}
      <PreviewModal
        request={pending}
        busy={busy}
        onCancel={() => finish(false)}
        onConfirm={async () => {
          // Captured before anything awaits: a second press (double-click, or
          // Enter landing on the autofocused button) then finds the slot empty
          // and settles harmlessly instead of printing twice.
          const run = action.current;
          const resolve = settle.current;
          action.current = null;
          settle.current = null;
          setPending(null);
          if (!run) return resolve?.(false);
          // Through print(), not the raw action: the confirmed print still
          // needs the success/failure toast and the list refresh.
          resolve?.(await print(run));
        }}
        confirmLabel={t("print")}
      />
    </PrintGateContext.Provider>
  );
}

export function usePrintGate() {
  const value = useContext(PrintGateContext);
  if (!value) {
    throw new Error("usePrintGate must be used inside <PrintGateProvider>");
  }
  return value;
}

/** The receipt image itself — shared by the gate and any other preview caller. */
export function PreviewImage({ request }: { request: PreviewRequest | null }) {
  const t = useStrings();
  const { url, error, loading } = usePreviewImage(request);

  if (loading && !url) return <Loader size="sm" />;
  if (error) {
    return (
      <Text size="sm" c={ROLE.danger}>
        {error}
      </Text>
    );
  }
  if (!url) return null;
  return (
    <Image
      src={url}
      alt={t("preview")}
      fit="contain"
      // White background and a border: the preview is a picture of paper, and
      // without them it dissolves into the dark theme.
      style={{
        background: "#fff",
        border: "1px solid var(--mantine-color-default-border)",
        maxHeight: "60vh",
      }}
    />
  );
}

function PreviewModal({
  request,
  busy,
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  request: PreviewRequest | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  const t = useStrings();
  return (
    <Modal
      opened={request !== null}
      onClose={onCancel}
      title={t("confirm_print_title")}
      size="md"
    >
      <Stack gap="md" align="stretch">
        <Text size="sm" c="dimmed">
          {t("confirm_print_hint")}
        </Text>
        <PreviewImage request={request} />
        <Stack gap="xs">
          <PrimaryButton
            data-autofocus
            loading={busy}
            onClick={onConfirm}
            icon={<IconPrinter size={ICON_SIZE.md} stroke={ICON_STROKE} />}
          >
            {confirmLabel}
          </PrimaryButton>
          <SecondaryButton onClick={onCancel}>{t("cancel")}</SecondaryButton>
        </Stack>
      </Stack>
    </Modal>
  );
}
