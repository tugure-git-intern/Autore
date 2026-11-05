"use client";

import { ActionButton } from "@/components/actions/action-button";
import { useCurrentUser, useStatus } from "@/components/app-shell";
import { DashboardOverview } from "@/components/dashboard-overview";

// Deploy = commit + push lokal lalu trigger Jenkins: pengguna harus tahu itu dulu.
const DEPLOY_CONFIRM = {
  title: "Yakin mau deploy?",
  warning:
    "Tindakan ini akan melakukan commit dan push kode lokal Anda ke repository, lalu memicu build Jenkins.",
  confirmLabel: "Ya, deploy sekarang",
};

export default function DashboardPage() {
  const { reload } = useStatus();
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
        <ActionButton
          label="Deploy Sekarang"
          action="deploy"
          variant="green"
          confirm={DEPLOY_CONFIRM}
          onDone={reload}
        />
      </div>
      <DashboardOverview />
    </div>
  );
}
