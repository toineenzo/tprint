export type SnippetKind = "text" | "image" | "pdf";

export type Snippet = {
  id: number;
  name: string;
  kind: SnippetKind;
  text_content: string | null;
  files: string[];
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
  run_at: string | null;
  recurrence: Recurrence | null;
  recurrence_time: string | null;
  last_run_at: string | null;
  error: string | null;
  created_at: string;
};

export type CurrentPrint = { label?: string };

export type Align = "left" | "center" | "right";

/** One combined receipt, or one torn-off receipt per item/event. */
export type PrintMode = "single" | "separate";

export type PrinterSettings = {
  header_text: string | null;
  footer_text: string | null;
  has_logo: boolean;
  default_align: Align;
  default_bold: boolean;
  default_double_width: boolean;
};

export type Recurrence = "daily" | "weekly" | "monthly";

/** The queue/schedule options every printable form can carry. */
export type QueueOptions = {
  queue?: boolean;
  run_at?: string | null;
  recurrence?: Recurrence | null;
  recurrence_time?: string | null;
};

export type PrintResponse =
  | { status: "printed"; count?: number }
  | { status: "queued"; job_id: number };
