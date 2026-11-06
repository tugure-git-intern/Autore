"use client";

import { RefreshCw } from "lucide-react";
import type { ApiStatusResponse } from "@/lib/contracts";
import type { SessionUser } from "@/lib/current-user";
import { Button } from "./ui/button";
import { UserMenu } from "./user-menu";

export type ConnectionTone = "green" | "neutral" | "red";
export type Connection = { tone: ConnectionTone; label: string };

const dotTone: Record<ConnectionTone, string> = {
  green: "bg-green-500",
  neutral: "bg-gray-400",
  red: "bg-red-500",
};

const textTone: Record<ConnectionTone, string> = {
  green: "text-green-700",
  neutral: "text-muted",
  red: "text-red-600",
};

/**
 * Green ("Terhubung") is reserved for a fresh payload with active Jenkins.
 * Anything stale, failed, inactive or unknown downgrades to a neutral/red dot
 * with honest copy — never a false green.
 */
export function connectionStatus(
  state: ApiStatusResponse | null,
  loading: boolean,
  failed: boolean,
): Connection {
  if (!state) {
    if (loading) return { tone: "neutral", label: "Memuat status" };
    if (failed) return { tone: "red", label: "Koneksi bermasalah" };
    return { tone: "neutral", label: "Status belum tersedia" };
  }
  if (failed || state.stale) return { tone: "red", label: "Data tidak terbaru" };

  const jenkins = state.data.infra.jenkins;
  if (jenkins === "active") return { tone: "green", label: "Terhubung" };
  if (jenkins === "inactive") return { tone: "neutral", label: "Jenkins tidak aktif" };
  return { tone: "neutral", label: "Status Jenkins belum jelas" };
}

export function Navbar({
  title,
  connection,
  onSync,
  refreshing,
  user,
}: {
  /** Null on the dashboard: the sidebar already owns the product name. */
  title: string | null;
  connection: Connection;
  onSync: () => void;
  refreshing?: boolean;
  user: SessionUser;
}) {
  // Satuan baris tetap 64px di semua ukuran: bar atas tidak pernah tumbuh dua
  // tingkat lagi sejak navigasi mobile pindah ke bar bawah.
  return (
    <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
      <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span role="status" className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden="true"
              data-testid="connection-dot"
              className={`h-2 w-2 rounded-full ${dotTone[connection.tone]} ${
                connection.tone === "green" ? "motion-safe:animate-pulse" : ""
              }`}
            />
            <span className={`text-xs font-medium ${textTone[connection.tone]}`}>
              {connection.label}
            </span>
          </span>
          {title ? (
            <>
              <span aria-hidden="true" className="h-4 w-px shrink-0 bg-gray-200" />
              <p className="truncate text-sm font-semibold tracking-tight text-ink">{title}</p>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button onClick={onSync} disabled={refreshing} aria-busy={refreshing ? "true" : undefined}>
            <RefreshCw
              className={refreshing ? "h-4 w-4 motion-safe:animate-spin" : "h-4 w-4"}
              aria-hidden="true"
            />
            Sync
          </Button>
          {user.login ? <UserMenu user={user} /> : null}
        </div>
      </div>
    </header>
  );
}
