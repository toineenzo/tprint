import {
  IconBookmark,
  IconCalendarEvent,
  IconDice5,
  IconFileText,
  IconFileTypePdf,
  IconListCheck,
  IconPhoto,
  IconPrinter,
  IconLayoutBoard,
  IconQrcode,
  IconTypography,
  type Icon,
} from "@tabler/icons-react";
import type { StringKey } from "../i18n/strings";

/**
 * The one place a printable content type is described.
 *
 * Keys are the exact `kind` values the backend emits — see `history.add_entry`
 * calls in app/actions.py, the `_execute` dispatch in app/print_queue.py, and
 * the snippets table's CHECK constraint in app/db.py. The history sidebar, the
 * queue list and the snippet list all read from here, so a type looks the same
 * everywhere by construction.
 *
 * Adding a new backend kind is a one-line change here. Until that line exists
 * it renders via FALLBACK_CONTENT_TYPE rather than breaking.
 *
 * Note the split of duties: the badge chrome around these is always neutral
 * grey (see TypeBadge) and it is the *icon* that carries the colour. That
 * keeps category labels from competing with the primary action colour while
 * still making each type instantly distinguishable.
 */
export type ContentTypeMeta = {
  icon: Icon;
  /** Mantine colour for the icon only — never applied to the badge body. */
  color: string;
  labelKey: StringKey;
};

export const CONTENT_TYPES: Record<string, ContentTypeMeta> = {
  text: { icon: IconFileText, color: "blue", labelKey: "kind_text" },
  image: { icon: IconPhoto, color: "violet", labelKey: "kind_image" },
  pdf: { icon: IconFileTypePdf, color: "red", labelKey: "kind_pdf" },
  checklist: { icon: IconListCheck, color: "lime", labelKey: "kind_checklist" },
  ics: { icon: IconCalendarEvent, color: "cyan", labelKey: "kind_ics" },
  code: { icon: IconQrcode, color: "grape", labelKey: "kind_code" },
  composition: { icon: IconLayoutBoard, color: "pink", labelKey: "kind_composition" },
  richtext: { icon: IconTypography, color: "indigo", labelKey: "kind_richtext" },
  random: { icon: IconDice5, color: "orange", labelKey: "kind_random" },
  snippet: { icon: IconBookmark, color: "teal", labelKey: "kind_snippet" },
};

export const FALLBACK_CONTENT_TYPE: ContentTypeMeta = {
  icon: IconPrinter,
  color: "gray",
  labelKey: "kind_text",
};

export function contentType(kind: string): ContentTypeMeta {
  return CONTENT_TYPES[kind] ?? FALLBACK_CONTENT_TYPE;
}

/** True when `kind` has a real entry, i.e. its label key is meaningful. */
export function isKnownContentType(kind: string): boolean {
  return kind in CONTENT_TYPES;
}
