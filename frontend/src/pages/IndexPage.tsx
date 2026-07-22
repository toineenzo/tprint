import { useStrings } from "../AppContext";
import { AppDataProvider } from "../AppData";
import { CurrentPrintBar } from "../components/CurrentPrintBar";
import { HistorySidebar } from "../components/HistorySidebar";
import { MainPageActions, PageShell } from "../components/PageShell";
import { SurpriseCard } from "../components/SurpriseCard";
import { PrintCard } from "../components/print/PrintCard";
import { PrintGateProvider } from "../components/print/PrintGate";
import { QueueCard } from "../components/queue/QueueCard";
import { ScheduledCard } from "../components/queue/ScheduledCard";
import { SnippetsCard } from "../components/snippets/SnippetsCard";

export function IndexPage() {
  const t = useStrings();

  return (
    <AppDataProvider>
      <PrintGateProvider>
        <PageShell
          title={t("app_title")}
          actions={<MainPageActions />}
          aside={<HistorySidebar />}
        >
          <CurrentPrintBar />
          <PrintCard />
          <SurpriseCard />
          <SnippetsCard />
          <QueueCard />
          <ScheduledCard />
        </PageShell>
      </PrintGateProvider>
    </AppDataProvider>
  );
}
