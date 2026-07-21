import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { Notifications } from "@mantine/notifications";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "dayjs/locale/nl";

import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "./global.css";

import { AppProvider } from "./AppContext";
import { readBootstrap, type PageName } from "./bootstrap";
import { IndexPage } from "./pages/IndexPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { theme } from "./theme";

const PAGES: Record<PageName, () => JSX.Element> = {
  index: IndexPage,
  settings: SettingsPage,
  login: LoginPage,
};

const boot = readBootstrap();
const Page = PAGES[boot.page];

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from the page shell");

createRoot(container).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      {/* Calendars follow the UI language and start the week on Monday, the
          convention in every locale this app ships. */}
      <DatesProvider settings={{ locale: boot.lang, firstDayOfWeek: 1 }}>
        <Notifications position="top-right" limit={3} />
        <AppProvider boot={boot}>
          <Page />
        </AppProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);
