"use client";

import { useCurrentUser } from "@/components/app-shell";
import { DashboardOverview } from "@/components/dashboard-overview";

// Deploy sengaja tidak ada di sini: tanpa aplikasi terpilih, deploy cuma menebak
// target. Jalankan Ulang di /pipeline (atau detail aplikasi) yang punya konteks.
export default function DashboardPage() {
  const { login } = useCurrentUser();

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            {login ? `Selamat datang, ${login}. ` : ""}Ringkasan status CI/CD Autore.
          </p>
        </div>
      </div>
      <DashboardOverview />
    </div>
  );
}
