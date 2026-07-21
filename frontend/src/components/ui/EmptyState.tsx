import { Text } from "@mantine/core";

/** The "nothing here yet" line shared by the snippet, queue and history lists. */
export function EmptyState({ children }: { children: string }) {
  return (
    <Text c="dimmed" size="sm" py="xs">
      {children}
    </Text>
  );
}
