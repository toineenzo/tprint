import { createTheme, type MantineThemeOverride } from "@mantine/core";

/**
 * The single source of truth for colour, spacing, radius and icon sizing.
 *
 * The old hand-rolled CSS had one accent colour (teal) doing six unrelated
 * jobs: active tab, primary button, the four "surprise" buttons, the success
 * status text and the history category label. Nothing signalled which action
 * was the main one. Each colour below therefore has exactly ONE role, and
 * components reference the role rather than the colour.
 */
export const ROLE = {
  /** The single main call-to-action per view. Rendered `variant="filled"`. */
  primary: "indigo",
  /** Supporting actions next to a primary one. Rendered `variant="default"`. */
  secondary: "gray",
  /** The "surprise me" group — one shared style so they read as one feature. */
  surprise: "orange",
  /** Success confirmation only (toasts). Never a button, tag or tab. */
  success: "green",
  /** Destructive and abort actions, and error toasts. */
  danger: "red",
  /** Neutral chrome: category badges, metadata. Never an action. */
  muted: "gray",
} as const;

export type Role = keyof typeof ROLE;

/**
 * Icon sizing scale. `sm` inside badges and dense lists, `md` on buttons,
 * `lg` for section headers and the standalone icon buttons.
 */
export const ICON_SIZE = { sm: 14, md: 18, lg: 22 } as const;

/** Stroke width for every @tabler/icons-react icon, so weight stays uniform. */
export const ICON_STROKE = 1.7;

export const theme: MantineThemeOverride = createTheme({
  primaryColor: ROLE.primary,
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: "md",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  headings: {
    fontWeight: "650",
    sizes: {
      h1: { fontSize: "1.5rem", lineHeight: "1.3" },
      h2: { fontSize: "1.1rem", lineHeight: "1.3" },
      h3: { fontSize: "1rem", lineHeight: "1.35" },
    },
  },
  components: {
    Card: {
      defaultProps: { withBorder: true, radius: "lg", padding: "lg" },
    },
    Button: {
      defaultProps: { radius: "md" },
    },
    ActionIcon: {
      defaultProps: { radius: "md", variant: "default" },
    },
    Badge: {
      defaultProps: { radius: "sm" },
    },
    TextInput: { defaultProps: { radius: "md" } },
    Textarea: { defaultProps: { radius: "md" } },
    Select: { defaultProps: { radius: "md" } },
    FileInput: { defaultProps: { radius: "md" } },
    Modal: { defaultProps: { radius: "lg", centered: true } },
  },
});
