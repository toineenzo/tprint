import { Button, type ButtonProps, type ElementProps } from "@mantine/core";
import type { ReactNode } from "react";
import { ROLE } from "../../theme";

interface BaseProps
  extends Omit<ButtonProps, "color" | "variant">,
    ElementProps<"button", keyof ButtonProps> {
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * The button hierarchy. Use these instead of Mantine's <Button> directly so a
 * new feature inherits the hierarchy rather than having to remember it.
 *
 * Rule: at most ONE PrimaryButton per card. Everything alongside it is a
 * SecondaryButton. SurpriseButton exists so the four "surprise me" options
 * read as a single grouped feature rather than four competing CTAs.
 */
export function PrimaryButton({ icon, children, ...props }: BaseProps) {
  return (
    <Button variant="filled" color={ROLE.primary} leftSection={icon} {...props}>
      {children}
    </Button>
  );
}

export function SecondaryButton({ icon, children, ...props }: BaseProps) {
  return (
    <Button variant="default" leftSection={icon} {...props}>
      {children}
    </Button>
  );
}

export function SurpriseButton({ icon, children, ...props }: BaseProps) {
  return (
    <Button variant="light" color={ROLE.surprise} leftSection={icon} {...props}>
      {children}
    </Button>
  );
}

export function DangerButton({ icon, children, ...props }: BaseProps) {
  return (
    <Button variant="light" color={ROLE.danger} leftSection={icon} {...props}>
      {children}
    </Button>
  );
}
