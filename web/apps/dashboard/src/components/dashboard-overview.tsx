"use client";

import { Boxes, Container, Timer, Workflow } from "lucide-react";
import type { StatusValue } from "@/lib/contracts";
import { dash } from "@/lib/format";
import { parseLeadTime, type PipelineWaktu } from "@/lib/format";
import type { Bahasa, KunciTerjemah } from "@/lib/i18n";
import { AnimatedNumber } from "./ui/animated-number";
import { useStatus } from "./app-shell";
import { useBahasa } from "./bahasa-provider";
import { EmptyApplications } from "./empty-applications";
import { OverviewAnalytics } from "./overview-analytics";
import { RepositoryHealthCard } from "./repository-health-card";
import { StatCard } from "./stat-card";
import { StatusBadge, type AppStatus } from "./status-badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { StatusBanner } from "./status-banner";

const pipelineLabels: Record<StatusValue, KunciTerjemah> = {
  idle: "status.siaga",
  running: "status.berjalan",
  passed: "status.lulus",
  failed: "status.gagal",
  unknown: "status.tidakDiketahui",
  pending: "status.menunggu",
  skipped: "status.dilewati",
};

/** Only a recorded gate result may style an app as passed/running/failed. */
function toBadge(status: StatusValue): AppStatus {
  return status === "passed" || status === "running" || status === "failed" ? status : "unknown";
}

const buildTime: Record<Bahasa, Intl.DateTimeFormat> = {
  id: new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }),
  en: new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }),
};

export function formatBuild(value: string | null, bahasa: Bahasa = "id"): string {
  if (!value || !value.trim()) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : buildTime[bahasa].format(date);
}

function AnimatedLeadTime({ pipeline }: { pipeline?: PipelineWaktu | null }) {
  const parsed = parseLeadTime(pipeline);
  if (!parsed) return <>-</>;
  const totalDetik = parsed.menit * 60 + parsed.detik;
  return (
    <AnimatedNumber
      value={totalDetik}
      format={(sec) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}m ${s}s`;
      }}
    />
  );
}

export function DashboardOverview() {
  // Status and the Sync action live in the shared shell navbar.
  const { state, loading, failed, reload } = useStatus();
  const { bahasa, t } = useBahasa();

  if (loading && !state) return <LoadingSkeleton />;

  if (failed && !state) {
    return (
      <Card className="p-6">
        <div role="alert">
          <p className="font-medium text-red-700">{t("beranda.gagal")}</p>
          <p className="mt-1 text-sm text-red-600">{t("beranda.gagalSub")}</p>
        </div>
        <Button className="mt-4" onClick={reload}>
          {t("beranda.cobaLagi")}
        </Button>
      </Card>
    );
  }

  if (!state) return <LoadingSkeleton />;

  const { data, stale } = state;
  const applications = data.applications;

  return (
    <>
      <StatusBanner stale={stale} failed={failed} />

      <section
        aria-label={t("beranda.statistik")}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5"
      >
        <StatCard
          label={t("beranda.totalTerdaftar")}
          value={<AnimatedNumber value={data.stats.total_apps} />}
          icon={Boxes}
          tone="blue"
          hint={t("beranda.totalTerdaftarSub")}
        />
        <StatCard
          label={t("beranda.containerBerjalan")}
          value={<AnimatedNumber value={data.stats.running_containers} />}
          icon={Container}
          tone="green"
          hint={t("beranda.containerBerjalanSub")}
        />
        <StatCard
          label="Lead Time"
          value={<AnimatedLeadTime pipeline={data.latest_pipeline} />}
          icon={Timer}
          tone="violet"
          hint={t("beranda.waktuProses")}
        />
        <StatCard
          label={t("beranda.statusPipeline")}
          value={t(pipelineLabels[data.latest_pipeline.status] ?? pipelineLabels.unknown)}
          icon={Workflow}
          tone="amber"
          hint={t("beranda.buildTerakhir")}
        />
        <RepositoryHealthCard health={data.repository_health} />
      </section>

      <OverviewAnalytics />

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-gray-200 dark:border-[#50638b] px-5 py-4">
          <h2 className="text-sm font-semibold text-ink dark:text-white">{t("beranda.aplikasi")}</h2>
        </div>
        {applications.length === 0 ? (
          <EmptyApplications />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-[#282c32] text-xs uppercase tracking-wide text-muted dark:text-white">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    {t("beranda.kolomNama")}
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    {t("beranda.kolomStatus")}
                  </th>
                  {/* Empat kolom = 625px; "Terakhir Diperbarui" menyusul di >= sm
                      supaya tabelnya muat di 390px tanpa geser. */}
                  <th scope="col" className="hidden px-5 py-3 font-medium sm:table-cell">
                    {t("beranda.kolomTerakhir")}
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    {t("beranda.kolomAksi")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#50638b]">
                {applications.map((app) => (
                  <tr key={app.id}>
                    <td className="px-5 py-4">
                      <p className="font-medium text-ink dark:text-white">{dash(app.name)}</p>
                      {/* sha 25 karakter = ~175px min-content: di HP ia yang
                          memaksa tabel melebar, jadi tampil mulai sm saja. */}
                      <p className="hidden font-mono text-xs text-muted sm:block">
                        {dash(app.commit_sha)}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={toBadge(app.status)} />
                    </td>
                    <td className="hidden px-5 py-4 text-muted sm:table-cell">
                      {formatBuild(app.last_build, bahasa)}
                    </td>
                    <td className="px-5 py-4">
                      <a
                        href={`/pipeline?app=${encodeURIComponent(app.id)}`}
                        className="text-blue-600 dark:text-blue-300 hover:underline"
                      >
                        {t("beranda.detail")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function LoadingSkeleton() {
  const { t } = useBahasa();

  return (
    <section aria-label={t("beranda.memuat")} aria-busy="true">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((key) => (
          <Skeleton key={key} className="h-28" />
        ))}
      </div>
      <Card className="mt-6 p-5">
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-10" />
          ))}
        </div>
      </Card>
    </section>
  );
}