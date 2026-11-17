"use client";

import { LayoutDashboard } from "lucide-react";
import { useCurrentUser } from "@/components/app-shell";
import { DashboardOverview } from "@/components/dashboard-overview";
import { PageTabHeader } from "@/components/ui/page-tab-header";

// Deploy sengaja tidak ada di sini: tanpa aplikasi terpilih, deploy cuma menebak
// target. Jalankan Ulang di /pipeline (atau detail aplikasi) yang punya konteks.
export default function DashboardPage() {
  const { login } = useCurrentUser();

  return (
    <div>
      <PageTabHeader
        polos
        className="mb-6 sm:mb-8"
        title="Dashboard"
        description={login ? `Selamat datang, ${login}.` : undefined}
        icon={LayoutDashboard}
      />
      <DashboardOverview />
    </div>
  );
}
