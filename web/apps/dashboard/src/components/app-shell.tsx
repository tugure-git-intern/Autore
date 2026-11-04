"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { ApiStatusResponse } from "@/lib/contracts";
import { fetchDashboardStatus } from "@/lib/status-client";
import { connectionStatus, Navbar } from "./navbar";
import { routeTitle } from "./nav-items";
import { Sidebar } from "./sidebar";

export type StatusState = {
  state: ApiStatusResponse | null;
  loading: boolean;
  failed: boolean;
  refreshing: boolean;
  /** Background refetch wired to the navbar Sync button. */
  refresh: () => void;
  /** Foreground retry for error states. */
  reload: () => void;
};

const StatusContext = createContext<StatusState | null>(null);

export function useStatus(): StatusState {
  const ctx = useContext(StatusContext);
  if (!ctx) throw new Error("useStatus must be used within StatusProvider");
  return ctx;
}

/**
 * Single owner of `/api/status`. The navbar and every page read the same
 * payload, so one Sync refreshes both the indicator and the content.
 */
export function StatusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ApiStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (background: boolean) => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await fetchDashboardStatus(next.signal);
      if (!next.signal.aborted) {
        setState(result);
        setFailed(false);
      }
    } catch (error) {
      if (!next.signal.aborted && (error as Error)?.name !== "AbortError") setFailed(true);
    } finally {
      if (!next.signal.aborted) {
        if (background) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(false);
    return () => controller.current?.abort();
  }, [load]);

  const refresh = useCallback(() => void load(true), [load]);
  const reload = useCallback(() => void load(false), [load]);

  return (
    <StatusContext.Provider value={{ state, loading, failed, refreshing, refresh, reload }}>
      {children}
    </StatusContext.Provider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const status = useStatus();
  // Same pathname source as the sidebar active rule: one title per route.
  const pathname = usePathname() ?? "/";

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar
          title={routeTitle(pathname)}
          connection={connectionStatus(status.state, status.loading, status.failed)}
          onSync={status.refresh}
          refreshing={status.refreshing}
          initials="AR"
        />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <StatusProvider>
      <Shell>{children}</Shell>
    </StatusProvider>
  );
}
