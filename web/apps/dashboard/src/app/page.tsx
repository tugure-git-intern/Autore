"use client";

import { useCurrentUser } from "@/components/app-shell";
import { DashboardOverview } from "@/components/dashboard-overview";

// Deploy sengaja tidak ada di sini: tanpa aplikasi terpilih, deploy cuma menebak
// target. Jalankan Ulang di /pipeline (atau detail aplikasi) yang punya konteks.
export default function DashboardPage() {
  const { login } = useCurrentUser();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4 sm:mb-8 sm:gap-5">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
        {login ? (
          <>
            <span
              data-testid="header-separator"
              aria-hidden="true"
              className="hidden text-gray-300 sm:inline"
            >
              |
            </span>
            <p className="text-sm text-gray-500 sm:text-base">Selamat datang, {login}.</p>
          </>
        ) : null}
      </div>
      <DashboardOverview />
    </div>
  );
}
