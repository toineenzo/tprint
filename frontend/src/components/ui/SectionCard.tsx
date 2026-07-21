import { Card, Group, Title } from "@mantine/core";
import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  icon?: ReactNode;
  /** Optional trailing control, e.g. the queue's "run now" button. */
  action?: ReactNode;
  children: ReactNode;
};

/** A titled panel. Every top-level section of the app is one of these. */
export function SectionCard({ title, icon, action, children }: Props) {
  return (
    <Card component="section">
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
