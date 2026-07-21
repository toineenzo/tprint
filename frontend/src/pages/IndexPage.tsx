import { useStrings } from "../AppContext";
import { AppDataProvider } from "../AppData";
import { CurrentPrintBar } from "../components/CurrentPrintBar";
import { HistorySidebar } from "../components/HistorySidebar";
import { MainPageActions, PageShell } from "../components/PageShell";
import { QueueCard } from "../components/QueueCard";
import { SurpriseCard } from "../components/SurpriseCard";
import { PrintCard } from "../components/print/PrintCard";
import { SnippetsCard } from "../components/snippets/SnippetsCard";

export function IndexPage() {
  const t = useStrings();

  return (
    <AppDataProvider>
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
      </PageShell>
    </AppDataProvider>
  );
}
