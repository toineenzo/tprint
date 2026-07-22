import { Tabs } from "@mantine/core";
import {
  IconCalendarEvent,
  IconFileText,
  IconFileTypePdf,
  IconListCheck,
  IconPhoto,
  IconQrcode,
  IconPrinter,
} from "@tabler/icons-react";
import { useState } from "react";

import { useStrings } from "../../AppContext";
import type { StringKey } from "../../i18n/strings";
import { ICON_SIZE, ICON_STROKE } from "../../theme";
import { SectionCard } from "../ui/SectionCard";
import { CodeTab } from "./CodeTab";
import { FILE_TABS, FileTab } from "./FileTab";
import { IcsTab } from "./IcsTab";
import { TasksTab } from "./TasksTab";
import { TextTab } from "./TextTab";

const TABS = [
  { value: "text", labelKey: "tab_text", icon: IconFileText },
  { value: "image", labelKey: "tab_compose", icon: IconPhoto },
  { value: "pdf", labelKey: "tab_pdf", icon: IconFileTypePdf },
  { value: "tasks", labelKey: "tab_tasks", icon: IconListCheck },
  { value: "ics", labelKey: "tab_ics", icon: IconCalendarEvent },
  { value: "code", labelKey: "tab_code", icon: IconQrcode },
] as const satisfies ReadonlyArray<{
  value: string;
  labelKey: StringKey;
  icon: typeof IconFileText;
}>;

export function PrintCard() {
  const t = useStrings();
  const [tab, setTab] = useState<string>("text");

  return (
    <SectionCard
      title={t("print_something")}
      icon={<IconPrinter size={ICON_SIZE.lg} stroke={ICON_STROKE} />}
    >
      {/*
        variant="pills" keeps a visible pill behind every tab, so an inactive
        tab still reads as a tab. The previous bar drew nothing at rest, making
        Image/PDF/Tasks/Calendar indistinguishable from plain text.
      */}
      <Tabs
        value={tab}
        onChange={(value) => setTab(value ?? "text")}
        variant="pills"
        keepMounted={false}
        classNames={{ tab: "print-tab" }}
      >
        <Tabs.List mb="md">
          {TABS.map(({ value, labelKey, icon: Icon }) => (
            <Tabs.Tab
              key={value}
              value={value}
              leftSection={<Icon size={ICON_SIZE.md} stroke={ICON_STROKE} />}
            >
              {t(labelKey)}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel value="text">
          <TextTab />
        </Tabs.Panel>
        <Tabs.Panel value="image">
          <FileTab config={FILE_TABS.image} />
        </Tabs.Panel>
        <Tabs.Panel value="pdf">
          <FileTab config={FILE_TABS.pdf} />
        </Tabs.Panel>
        <Tabs.Panel value="tasks">
          <TasksTab />
        </Tabs.Panel>
        <Tabs.Panel value="ics">
          <IcsTab />
        </Tabs.Panel>
        <Tabs.Panel value="code">
          <CodeTab />
        </Tabs.Panel>
      </Tabs>
    </SectionCard>
  );
}
