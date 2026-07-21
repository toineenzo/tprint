import {
  ActionIcon,
  Tooltip,
  type ActionIconProps,
  type ElementProps,
} from "@mantine/core";
import type { ReactNode } from "react";
import { ROLE, type Role } from "../../theme";

/** Named `tone`, not `role` — `role` is the ARIA attribute on the DOM node. */
export type ActionTone = Extract<Role, "primary" | "secondary" | "danger">;

/**
 * All tinted rather than filled. These appear several to a row (a snippet's
 * preview/edit/print/delete), and a row of solid primary blocks would read as
 * several competing calls to action.
 */
const TONES = {
  primary: { variant: "light", color: ROLE.primary },
  secondary: { variant: "default", color: undefined },
  danger: { variant: "light", color: ROLE.danger },
} as const;

type Shared = {
  /** Required — an icon-only control must still be announced to a screen reader. */
  label: string;
  tone?: ActionTone;
  children: ReactNode;
};

interface IconButtonProps
  extends Omit<ActionIconProps, "color" | "variant" | "children">,
    ElementProps<"button", keyof ActionIconProps>,
    Shared {}

interface IconLinkProps
  extends Omit<ActionIconProps, "color" | "variant" | "children">,
    ElementProps<"a", keyof ActionIconProps>,
    Shared {}

/**
 * A compact icon-only action with a tooltip and an accessible name. The old UI
 * used bare emoji with only a `title` attribute; this guarantees the tooltip
 * and the aria-label are always both present.
 */
export function IconActionButton({
  label,
  tone = "secondary",
  children,
  ...props
}: IconButtonProps) {
  const style = TONES[tone];
  return (
    <Tooltip label={label} withArrow openDelay={300}>
      <ActionIcon
        aria-label={label}
        size="lg"
        variant={style.variant}
        color={style.color}
        {...props}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

/** The same control as an anchor, for server-rendered page routes. */
export function IconActionLink({
  label,
  tone = "secondary",
  children,
  ...props
}: IconLinkProps) {
  const style = TONES[tone];
  return (
    <Tooltip label={label} withArrow openDelay={300}>
      <ActionIcon
        component="a"
        aria-label={label}
        size="lg"
        variant={style.variant}
        color={style.color}
        {...props}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  );
}
