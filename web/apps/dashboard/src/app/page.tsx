"use client";

import { LayoutDashboard } from "lucide-react";
import { useCurrentUser } from "@/components/app-shell";
import { useBahasa } from "@/components/bahasa-provider";
import { DashboardOverview } from "@/components/dashboard-overview";
import { PageTabHeader } from "@/components/ui/page-tab-header";

// Deploy sengaja tidak ada di sini: tanpa aplikasi terpilih, deploy cuma menebak
// target. Jalankan Ulang di /pipeline (atau detail aplikasi) yang punya konteks.
export default function DashboardPage() {
  const { login } = useCurrentUser();
  const { t } = useBahasa();

  return (
    <div>
      <PageTabHeader
        polos
        className="mb-6 sm:mb-8"
        title={t("nav.dashboard")}
        description={login ? `${t("beranda.sapaan")} ${login}.` : undefined}
        icon={LayoutDashboard}
      />
      <DashboardOverview />
    </div>
  );
}
