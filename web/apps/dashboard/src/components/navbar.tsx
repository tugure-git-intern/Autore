"use client";

import { RefreshCw } from "lucide-react";
import type { SessionUser } from "@/lib/current-user";
import { AppearanceMenu } from "./appearance-menu";
import { UserMenu } from "./user-menu";

export function Navbar({
  title,
  onSync,
  refreshing,
  user,
}: {
  /** Null on the dashboard: the sidebar already owns the product name. */
  title: string | null;
  onSync: () => void;
  refreshing?: boolean;
  user: SessionUser;
}) {
  return (
    <header className="sticky top-0 z-10 w-full bg-[#F0F5FE] dark:bg-[#282c32]">
      {/* lg:pl-[274px] melewati kartu sidebar melayang: 12px jarak + 250px lebar + 12px celah. */}
      <div className="flex h-16 items-center justify-between gap-3 px-4 lg:pl-[274px] lg:pr-3">
        <div className="flex min-w-0 items-center">
          {/* Status koneksi hanya ada di footer sidebar ("Server Online"); topbar tidak
              mengulanginya. Tanpa indikator, breadcrumb jadi elemen pertama grup kiri,
              jadi tidak ada divider "|" yang menggantung di tepi. */}
          {title ? (
            <p className="truncate text-sm font-semibold tracking-tight text-[#545F72] dark:text-white">
              <span className="font-normal text-[#545F72] dark:text-white">Autore / </span>
              {title}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0">
          <button
            type="button"
            onClick={onSync}
            disabled={refreshing}
            aria-busy={refreshing ? "true" : undefined}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#50638b] bg-transparent px-3 py-1.5 text-sm font-medium text-[#545F72] transition-colors hover:bg-white/10 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-white dark:hover:text-white"
          >
            <RefreshCw
              className={
                refreshing
                  ? "h-4 w-4 motion-safe:animate-spin text-[#545F72] dark:text-white"
                  : "h-4 w-4 text-[#545F72] dark:text-white"
              }
              aria-hidden="true"
            />
            Sync
          </button>
          <AppearanceMenu />
          {user.login ? <UserMenu user={user} /> : null}
        </div>
      </div>
    </header>
  );
}
