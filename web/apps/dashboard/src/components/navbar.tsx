"use client";

import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";
import type { ApiStatusResponse } from "@/lib/contracts";
import { isActiveHref, navItems } from "./nav-items";
import { Button } from "./ui/button";

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
 * Green ("Sistem Siap") is reserved for a fresh payload with active Jenkins.
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
  if (jenkins === "active") return { tone: "green", label: "Sistem Siap" };
  if (jenkins === "inactive") return { tone: "neutral", label: "Jenkins tidak aktif" };
  return { tone: "neutral", label: "Status Jenkins belum jelas" };
}

export function Navbar({
  title,
  connection,
  onSync,
  refreshing,
  initials,
}: {
  title: string;
  connection: Connection;
  onSync: () => void;
  refreshing?: boolean;
  initials: string;
}) {
  const pathname = usePathname() ?? "/";

  return (
    <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
      <div className="flex h-16 items-center justify-between gap-4 px-4 lg:px-6">
        <p className="text-sm font-semibold tracking-tight text-ink">{title}</p>
        <div className="flex items-center gap-3">
          <span role="status" className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${dotTone[connection.tone]}`}
            />
            <span className={`text-xs font-medium ${textTone[connection.tone]}`}>
              {connection.label}
            </span>
          </span>
          <Button onClick={onSync} disabled={refreshing}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Sync
          </Button>
          <span
            aria-hidden="true"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-ink"
          >
            {initials}
          </span>
        </div>
      </div>
      {/* Below lg the sidebar is hidden, so navigation collapses into this row. */}
      <nav aria-label="Navigasi utama" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:hidden">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          return (
            <a
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm ${
                active ? "bg-green-50 text-green-700" : "text-muted hover:bg-gray-50 hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </a>
          );
        })}
      </nav>
    </header>
  );
}
