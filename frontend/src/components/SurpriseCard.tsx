import { Group } from "@mantine/core";
import {
  IconArrowsShuffle,
  IconChefHat,
  IconMoodSmile,
  IconSparkles,
  IconStars,
} from "@tabler/icons-react";

import { useStrings } from "../AppContext";
import { api } from "../api/client";
import type { PrintResponse } from "../api/types";
import { usePrint } from "../hooks/usePrint";
import type { StringKey } from "../i18n/strings";
import { ICON_SIZE, ICON_STROKE } from "../theme";
import { SurpriseButton } from "./ui/Buttons";
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

/**
 * All four options share one style. They used to be four primary-coloured
 * buttons, which read as four competing calls to action rather than one
 * grouped feature.
 */
export function SurpriseCard() {
  const t = useStrings();
  const { print, busy } = usePrint();

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
            onClick={() =>
              print(() => api.postJson<PrintResponse>("/print/random", { kind }))
            }
            icon={<Icon size={ICON_SIZE.md} stroke={ICON_STROKE} />}
          >
            {t(labelKey)}
          </SurpriseButton>
        ))}
      </Group>
    </SectionCard>
  );
}
