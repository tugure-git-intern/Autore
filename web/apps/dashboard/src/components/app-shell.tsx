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
import type { SessionUser } from "@/lib/current-user";
import { fetchDashboardStatus } from "@/lib/status-client";
import { connectionStatus, Navbar } from "./navbar";
import { NavBawah } from "./nav-bawah";
import { routeTitle } from "./nav-items";
import { Sidebar } from "./sidebar";
import { Toast, ToastSink, type JenisToast } from "./toast";
import { useActivePipelines, type HasilActive } from "./use-active-pipelines";
import { useRuns, type HasilRuns } from "./use-runs";

const COPY_SUKSES = "Data berhasil disinkronkan.";
const COPY_GAGAL = "Gagal menyinkronkan data.";

export type StatusState = {
  state: ApiStatusResponse | null;
  loading: boolean;
  failed: boolean;
  /** Sync sedang berjalan; tombol topbar memakainya untuk spinner + disabled. */
  refreshing: boolean;
  /** Tarik status, runs dan active sekaligus. true = ketiganya membawa data. */
  sync: () => Promise<boolean>;
  /** Foreground retry for error states. */
  reload: () => void;
  runs: HasilRuns;
  aktif: HasilActive;
  toast: { pesan: string; jenis: JenisToast } | null;
  tutupToast: () => void;
};

const StatusContext = createContext<StatusState | null>(null);

export function useStatus(): StatusState {
  const ctx = useContext(StatusContext);
  if (!ctx) throw new Error("useStatus must be used within StatusProvider");
  return ctx;
}

/**
 * User disediakan lewat context karena `app/page.tsx` komponen klien:
 * `currentUser()` (server) tidak bisa dipanggil dari sana. Default kosong —
 * bukan throw — supaya render tanpa kerangka (halaman auth, tes satuan) tetap
 * jalan, dengan sapaan yang hilang alih-alih nama palsu.
 */
const UserContext = createContext<SessionUser>({ login: "", name: "", image: null });

export function useCurrentUser(): SessionUser {
  return useContext(UserContext);
}

export const INTERVAL_POLLING_RUNNING_MS = 5_000;
export const INTERVAL_POLLING_IDLE_MS = 15_000;

/**
 * Single owner of `/api/status`, plus the two other things the topbar Sync
 * button has to move: `/api/runs` and `/api/active`. Keeping all three here is
 * what lets one click repaint the indicator, the charts and the active cards —
 * and lets `sync()` wait for the slowest of them before releasing the button.
 */
export function StatusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ApiStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState<{ pesan: string; jenis: JenisToast } | null>(null);
  const controller = useRef<AbortController | null>(null);

  const runs = useRuns();
  const aktif = useActivePipelines();
  const refreshRuns = runs.refresh;
  const refreshAktif = aktif.refresh;

  /**
   * Satu tarikan status. `true` hanya kalau payload baru benar-benar masuk —
   * permintaan yang dibatalkan permintaan berikutnya menjawab `false`, supaya
   * Sync tidak mengaku sukses atas data yang tidak pernah dipasang.
   */
  const load = useCallback(async (): Promise<boolean> => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    try {
      const result = await fetchDashboardStatus(next.signal);
      if (next.signal.aborted) return false;
      setState(result);
      setFailed(false);
      return true;
    } catch (error) {
      if (next.signal.aborted || (error as Error)?.name === "AbortError") return false;
      setFailed(true);
      return false;
    }
  }, []);

  useEffect(() => {
    let hidup = true;
    void load().finally(() => {
      if (hidup) setLoading(false);
    });
    return () => {
      hidup = false;
      controller.current?.abort();
    };
  }, [load]);

  // Polling adaptif: cepat saat ada pipeline jalan (5s), santai saat idle (15s).
  // Berhenti total bila tab browser di-minimize atau switch tab (Page Visibility).
  const sedangJalan =
    state?.data?.latest_pipeline?.status === "running" ||
    (typeof aktif?.counts?.running === "number" && aktif.counts.running > 0);
  const intervalPollingMs = sedangJalan
    ? INTERVAL_POLLING_RUNNING_MS
    : INTERVAL_POLLING_IDLE_MS;

  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void load();
    };

    const timer = setInterval(tick, intervalPollingMs);

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void load();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [intervalPollingMs, load]);

  const reload = useCallback(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  /**
   * Ketiga penarik tidak pernah melempar (mereka menjawab boolean), jadi
   * `Promise.all` di sini menunggu yang paling lambat tanpa membatalkan data
   * yang sudah tiba. Satu gagal = toast gagal, tapi status/runs/active yang
   * sukses tetap terpasang di layar.
   */
  const sync = useCallback(async (): Promise<boolean> => {
    setRefreshing(true);
    try {
      const hasil = await Promise.all([load(), refreshRuns(), refreshAktif()]);
      const sukses = hasil.every(Boolean);
      setToast(
        sukses ? { pesan: COPY_SUKSES, jenis: "sukses" } : { pesan: COPY_GAGAL, jenis: "gagal" },
      );
      return sukses;
    } finally {
      setRefreshing(false);
    }
  }, [load, refreshRuns, refreshAktif]);

  const tutupToast = useCallback(() => setToast(null), []);

  /** Pintu yang dipakai komponen mana pun (tombol aksi, dialog) untuk bercerita. */
  const pesanToast = useCallback(
    (pesan: string, jenis: JenisToast) => setToast({ pesan, jenis }),
    [],
  );

  return (
    <ToastSink.Provider value={pesanToast}>
      <StatusContext.Provider
        value={{
          state,
          loading,
          failed,
          refreshing,
          sync,
          reload,
          runs,
          aktif,
          toast,
          tutupToast,
        }}
      >
        {children}
      </StatusContext.Provider>
    </ToastSink.Provider>
  );
}

/** Halaman auth punya kartu sendiri di tengah layar; sidebar/topbar di sana cuma jadi kebisingan. */
const TANPA_KERANGKA = new Set(["/login", "/403"]);

function Shell({ children, user }: { children: ReactNode; user: SessionUser }) {
  const status = useStatus();
  // Same pathname source as the sidebar active rule: one title per route.
  const pathname = usePathname() ?? "/";

  if (TANPA_KERANGKA.has(pathname)) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar
          title={routeTitle(pathname)}
          connection={connectionStatus(status.state, status.loading, status.failed)}
          onSync={status.sync}
          refreshing={status.refreshing}
          user={user}
        />
        {/* pb-24 = tinggi bar bawah + jeda; tanpa ini baris terakhir konten
            (dan tombol aksinya) tersembunyi di balik bar di layar sempit. */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pt-6 pb-24 lg:px-6">{children}</main>
      </div>
      <NavBawah />
      {status.toast ? (
        <Toast
          pesan={status.toast.pesan}
          jenis={status.toast.jenis}
          onTutup={status.tutupToast}
        />
      ) : null}
    </div>
  );
}

export function AppShell({ children, user }: { children: ReactNode; user: SessionUser }) {
  return (
    <UserContext.Provider value={user}>
      <StatusProvider>
        <Shell user={user}>{children}</Shell>
      </StatusProvider>
    </UserContext.Provider>
  );
}
