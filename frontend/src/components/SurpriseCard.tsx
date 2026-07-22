import { Code, Group, Modal, Select, Stack } from "@mantine/core";
import {
  IconArrowsShuffle,
  IconChefHat,
  IconMoodSmile,
  IconPrinter,
  IconRefresh,
  IconSparkles,
  IconStars,
} from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../AppContext";
import { useAppData } from "../AppData";
import { ApiError, api } from "../api/client";
import type { PrintResponse, RecipeCategory } from "../api/types";
import { usePrint } from "../hooks/usePrint";
import type { StringKey } from "../i18n/strings";
import { notifyError } from "../notify";
import { ICON_SIZE, ICON_STROKE } from "../theme";
import { PrimaryButton, SecondaryButton, SurpriseButton } from "./ui/Buttons";
import { SectionCard } from "./ui/SectionCard";

const SURPRISES = [
  { kind: "joke", labelKey: "joke", icon: IconMoodSmile },
  { kind: "recipe", labelKey: "recipe", icon: IconChefHat },
  { kind: "fortune", labelKey: "fortune", icon: IconStars },
  { kind: null, labelKey: "random", icon: IconArrowsShuffle },
] as const satisfies ReadonlyArray<{
  kind: string | null;
  labelKey: StringKey;
  icon: typeof IconMoodSmile;
}>;

type Peeked = { kind: string | null; text: string };

const CATEGORIES: RecipeCategory[] = [
  "breakfast", "lunch", "dinner", "dessert", "snack", "drink",
];

/**
 * All four options share one style. They used to be four primary-coloured
 * buttons, which read as four competing calls to action rather than one
 * grouped feature.
 *
 * With the "preview surprises" setting on, a button draws an item and shows it
 * for approval instead of printing it. Re-rolling draws another; printing sends
 * back the text that was shown, so the receipt is always the item that was
 * approved rather than a fresh draw.
 */
export function SurpriseCard() {
  const t = useStrings();
  const { settings } = useAppData();
  const { print, busy } = usePrint();
  const [peeked, setPeeked] = useState<Peeked | null>(null);
  // Recipes only. "" means any category, which is also what the API expects
  // when the parameter is simply absent.
  const [category, setCategory] = useState<string>("");

  const preview = settings?.surprise_preview ?? false;

  // Drawing isn't a mutation, so it gets no success toast — "Saved!" on a
  // peek is a lie. A failure still needs saying, hence the explicit notify.
  const draw = async (kind: string | null) => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (kind === "recipe" && category) params.set("category", category);
    const query = params.toString() ? `?${params}` : "";
    try {
      const result = await api.get<Peeked>(`/print/surprise/peek${query}`);
      setPeeked({ kind, text: result.text });
    } catch (error) {
      notifyError(error instanceof ApiError ? error.message : t("status_error"));
    }
  };

  const trigger = (kind: string | null) => {
    if (preview) return draw(kind);
    return print(() =>
      api.postJson<PrintResponse>("/print/random", {
        kind,
        ...(kind === "recipe" && category ? { category } : {}),
      }),
    );
  };

  return (
    <SectionCard
      title={t("surprise_me")}
      icon={<IconSparkles size={ICON_SIZE.lg} stroke={ICON_STROKE} />}
    >
      <Group gap="xs" wrap="wrap">
        {SURPRISES.map(({ kind, labelKey, icon: Icon }) => (
          <SurpriseButton
            key={labelKey}
            disabled={busy}
            onClick={() => trigger(kind)}
            icon={<Icon size={ICON_SIZE.md} stroke={ICON_STROKE} />}
          >
            {t(labelKey)}
          </SurpriseButton>
        ))}
      </Group>

      <Select
        mt="xs"
        size="xs"
        w={220}
        label={t("recipe_category")}
        description={t("recipe_category_hint")}
        value={category}
        allowDeselect={false}
        onChange={(value) => setCategory(value ?? "")}
        data={[
          { value: "", label: t("recipe_category_any") },
          ...CATEGORIES.map((value) => ({
            value,
            label: t(`recipe_category_${value}` as never),
          })),
        ]}
      />

      <Modal
        opened={peeked !== null}
        onClose={() => setPeeked(null)}
        title={t("surprise_preview_title")}
        size="md"
      >
        <Stack gap="md">
          <Code block style={{ whiteSpace: "pre-wrap" }}>
            {peeked?.text ?? ""}
          </Code>
          <Group justify="flex-end" gap="xs">
            <SecondaryButton
              onClick={() => peeked && draw(peeked.kind)}
              icon={<IconRefresh size={ICON_SIZE.md} stroke={ICON_STROKE} />}
            >
              {t("surprise_reroll")}
            </SecondaryButton>
            <PrimaryButton
              data-autofocus
              loading={busy}
              icon={<IconPrinter size={ICON_SIZE.md} stroke={ICON_STROKE} />}
              onClick={async () => {
                const current = peeked;
                setPeeked(null);
                if (!current) return;
                // Sends the drawn text back, so the printed item is the one
                // that was approved rather than a fresh roll.
                await print(() =>
                  api.postJson<PrintResponse>("/print/random", {
                    kind: current.kind,
                    text: current.text,
                  }),
                );
              }}
            >
              {t("print")}
            </PrimaryButton>
          </Group>
        </Stack>
      </Modal>
    </SectionCard>
  );
}
