import { Card, Group, Title } from "@mantine/core";
import type { ReactNode, Ref } from "react";

type Props = {
  title: ReactNode;
  icon?: ReactNode;
  /** Optional trailing control, e.g. the queue's "run now" button. */
  action?: ReactNode;
  /** The card element, for panels that are a print-animation destination. */
  elementRef?: Ref<HTMLElement>;
  children: ReactNode;
};

/** A titled panel. Every top-level section of the app is one of these. */
export function SectionCard({ title, icon, action, elementRef, children }: Props) {
  return (
    <Card component="section" ref={elementRef}>
      <Group justify="space-between" align="center" wrap="nowrap" mb="md">
        <Group gap="xs" align="center" wrap="nowrap">
          {icon}
          <Title order={2}>{title}</Title>
        </Group>
        {action}
      </Group>
      {children}
    </Card>
  );
}
