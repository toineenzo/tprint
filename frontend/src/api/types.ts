export type SnippetKind =
  | "text"
  | "image"
  | "pdf"
  | "checklist"
  | "ics"
  | "composition";

/** What a saved checklist stores — enough to reprint it exactly. */
export type ChecklistPayload = {
  title: string | null;
  items: { text: string; due: string | null }[];
  mode: PrintMode;
};

/** A saved agenda keeps the original .ics file; only the mode is payload. */
export type IcsPayload = { mode: PrintMode };

export type Snippet = {
  id: number;
  name: string;
  kind: SnippetKind;
  text_content: string | null;
  files: string[];
  /** Set for the `checklist` and `ics` kinds only; null for the rest. */
  payload: ChecklistPayload | IcsPayload | null;
  created_at: string;
  updated_at: string;
};

export type HistoryEntry = {
  id: number;
  kind: string;
  preview_text: string | null;
  has_image: boolean;
  created_at: string;
};

export type QueueStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "canceled";

export type QueueJob = {
  id: number;
  kind: string;
  label: string | null;
  status: QueueStatus;
  /** Naive *local* time — parse with parseNaiveDateTime, never `new Date(s)`. */
  run_at: string | null;
  recurrence: Recurrence | null;
  recurrence_time: string | null;
  /** Weekdays 1-7 (Mon-Sun) for weekly, days of month for monthly. */
  recurrence_days: number[] | null;
  /**
   * Server-computed: true when the job runs on its own trigger, false when it
   * waits for "Run queue now". Trusted rather than re-derived here, so this
   * list and run_manual_queue()'s WHERE clause can never disagree.
   */
  scheduled: boolean;
  last_run_at: string | null;
  error: string | null;
  created_at: string;
};

export type CurrentPrint = { label?: string };

export type Align = "left" | "center" | "right";

/** One combined receipt, or one torn-off receipt per item/event. */
export type PrintMode = "single" | "separate";

/** Agendas add a per-day mode the checklist has no meaning for. */
export type IcsMode = "single" | "separate" | "day";
export type AgendaOverview = "none" | "week" | "month";
export type AgendaOrientation = "vertical" | "horizontal";

export type PrinterSettings = {
  header_text: string | null;
  footer_text: string | null;
  has_logo: boolean;
  has_footer_logo: boolean;
  default_align: Align;
  default_bold: boolean;
  default_double_width: boolean;
  /** Printable width in dots — 576 for 80mm, 384 for 58mm. */
  paper_width_px: number;
  auto_cut: boolean;
  confirm_before_print: boolean;
  surprise_preview: boolean;
  print_delay_seconds: number;
  retention_max_items: number;
  retention_max_age_days: number;
};

export type CodeFormat = "qr" | "barcode";

export type Tint = "black" | "dark" | "light";

/** One styled line of a rich-text print. Styling is per line, not per word. */
export type RichTextBlock = {
  text: string;
  /** 0 = body, 1-3 = heading levels. */
  level: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  tint: Tint;
  align: Align;
};

export type RecipeCategory =
  | "breakfast"
  | "lunch"
  | "dinner"
  | "dessert"
  | "snack"
  | "drink";

export type ContentKind = "joke" | "recipe" | "fortune";

export type RecipeValue = {
  title: string;
  ingredients: string[];
  steps: string[];
  /** Optional: a recipe with no category only appears under "any". */
  category?: RecipeCategory | null;
};

/** A surprise-me entry. `value` is a plain string except for recipes. */
export type ContentItem = {
  id: number;
  kind: ContentKind;
  lang: string;
  position: number;
  value: string | RecipeValue;
};

export type AboutInfo = {
  license: string;
  license_name: string;
  license_url: string;
  license_note: string;
  source_url: string;
  libraries: { name: string; license: string; role: string }[];
};

/** What a print would produce, as sent to POST /print/preview. */
export type PreviewRequest = {
  kind: string;
  text?: string;
  payload?: string;
  /** Widened for agendas, which have a per-day mode checklists don't. */
  mode?: PrintMode | IcsMode;
  overview?: AgendaOverview;
  orientation?: AgendaOrientation;
  snippet_id?: number;
  file?: File | null;
};

export type Recurrence = "daily" | "weekly" | "monthly";

/** The queue/schedule options every printable form can carry. */
export type QueueOptions = {
  queue?: boolean;
  run_at?: string | null;
  recurrence?: Recurrence | null;
  recurrence_time?: string | null;
  recurrence_days?: number[] | null;
};

export type PrintResponse =
  | { status: "printed"; count?: number }
  | { status: "queued"; job_id: number };
