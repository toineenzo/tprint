import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Bootstrap } from "./bootstrap";
import { makeTranslator, type Translate } from "./i18n/strings";

type AppContextValue = {
  boot: Bootstrap;
  t: Translate;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  boot,
  children,
}: {
  boot: Bootstrap;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ boot, t: makeTranslator(boot.strings) }),
    [boot],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}

/** Translate a key. The only way components should read UI text. */
export function useStrings(): Translate {
  return useApp().t;
}

/** The server-injected bootstrap payload (language list, build date, seeds). */
export function useBootstrap(): Bootstrap {
  return useApp().boot;
}
