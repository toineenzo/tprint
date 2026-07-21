import { Badge } from "@mantine/core";
import { useStrings } from "../../AppContext";
import { contentType, isKnownContentType } from "../../constants/contentTypes";
import { ICON_SIZE, ICON_STROKE, ROLE } from "../../theme";

/**
 * The category label for a printable content type.
 *
 * The badge body is deliberately neutral grey — category labels used to be
 * rendered in the accent colour, which made them compete with the primary
 * action. The per-type colour lives on the icon instead, which is enough to
 * tell the types apart at a glance without adding another accent.
 */
export function TypeBadge({ kind }: { kind: string }) {
  const t = useStrings();
  const meta = contentType(kind);
  const Icon = meta.icon;
  const label = isKnownContentType(kind) ? t(meta.labelKey) : kind;

  return (
    <Badge
      variant="light"
      color={ROLE.muted}
      size="sm"
      tt="uppercase"
      leftSection={
        <Icon
          size={ICON_SIZE.sm}
          stroke={ICON_STROKE}
          color={`var(--mantine-color-${meta.color}-5)`}
        />
      }
    >
      {label}
    </Badge>
  );
}
