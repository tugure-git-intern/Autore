"use client";

import Link from "next/link";

import { useState } from "react";
import { Layers } from "lucide-react";
import type { StatusValue } from "@/lib/contracts";
import { dash } from "@/lib/format";
import { filterApps, type StatusFilter } from "@/lib/filter-apps";
import { useStatus } from "@/components/app-shell";
import { ActionButton } from "@/components/actions/action-button";
import { ConnectDialog } from "@/components/actions/connect-dialog";
import { QuickStartDialog } from "@/components/actions/quick-start-dialog";
import { ApplicationsFilter } from "@/components/applications-filter";
import { useBahasa } from "@/components/bahasa-provider";
import { formatBuild } from "@/components/dashboard-overview";
import { EmptyApplications } from "@/components/empty-applications";
import { StatusBadge, type AppStatus } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageTabHeader } from "@/components/ui/page-tab-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/status-banner";
import { useLayarSempit } from "@/components/use-layar-sempit";

/** Only a recorded gate result may style an app as passed/running/failed. */
function toBadge(status: StatusValue): AppStatus {
  return status === "passed" || status === "running" || status === "failed" ? status : "unknown";
}

/**
 * Tiga aksi yang sama dipakai tabel (desktop) dan kartu (HP). Di kartu
 * target sentuhnya dilebarkan ke 44px: tautan teks 14px terlalu kecil untuk
 * jempol.
 */
function AksiAplikasi({ app, onDone, sentuh }: { app: string; onDone: () => void; sentuh?: boolean }) {
  const { t } = useBahasa();
  const kelasTautan = sentuh
    ? "inline-flex min-h-11 items-center text-sm text-blue-600 hover:underline dark:text-blue-300"
    : "whitespace-nowrap text-blue-600 hover:underline dark:text-blue-300";

  return (
    <div className={sentuh ? "mt-1 flex flex-wrap items-center gap-4" : "flex flex-wrap items-center gap-x-3 gap-y-1"}>
      <Link href={`/pipeline?app=${encodeURIComponent(app)}`} className={kelasTautan}>
        {t("aplikasi.detail")}
      </Link>
      <Link href={`/applications/sbom?app=${encodeURIComponent(app)}`} className={kelasTautan}>
        {t("aplikasi.lihatSbom")}
      </Link>
      <ActionButton label={t("aplikasi.scanKeamanan")} action="scan" app={app} onDone={onDone} />
      <ActionButton
        label={t("aplikasi.hapus")}
        action="remove"
        app={app}
        confirm={{
          title: t("aplikasi.hapusJudul"),
          warning: t("aplikasi.hapusPeringatan"),
          confirmLabel: t("aplikasi.hapusKonfirmasi"),
          requireTypedName: app,
        }}
        onDone={onDone}
      />
    </div>
  );
}

export default function ApplicationsPage() {
  const { state, loading, failed, reload } = useStatus();
  const { bahasa, t } = useBahasa();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  // Empat kolom + tiga aksi butuh 727px; di HP barisnya jadi kartu.
  const sempit = useLayarSempit();

  if (loading && !state) {
    return (
      <section aria-label={t("aplikasi.memuat")} aria-busy="true">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-4 h-64" />
      </section>
    );
  }

  if (!state) {
    return (
      <Card className="p-6">
        <p role="alert" className="font-medium text-red-700 dark:text-red-300">
          {t("aplikasi.gagal")}
        </p>
        <Button className="mt-4" onClick={reload}>
          {t("aplikasi.cobaLagi")}
        </Button>
      </Card>
    );
  }

  const { data, stale } = state;
  const applications = data.applications;
  const tersaring = filterApps(applications, query, status);

  /**
   * Angka temuan baru fakta setelah ada hasil scan. Tanpa itu (aplikasi baru
   * terdaftar, atau scan masih jalan) selnya tetap strip, bukan "0 temuan".
   */
  const temuan = (badge: AppStatus, securityIssues: number): string =>
    badge === "passed" || badge === "failed" ? `${securityIssues} ${t("aplikasi.temuan")}` : "—";

  return (
    <>
      <StatusBanner stale={stale} failed={failed} />

      <div className="space-y-0">
        <PageTabHeader
          title={t("aplikasi.judul")}
          description={`${applications.length} ${t("aplikasi.deskripsi")}`}
          icon={Layers}
          action={
            <span className="flex flex-wrap items-start justify-end gap-2">
              <ConnectDialog onSelesai={reload} />
              <QuickStartDialog onSelesai={reload} />
            </span>
          }
        />

        <div className="rounded-b-xl sm:rounded-b-2xl bg-white p-5 sm:p-6 pt-4 space-y-4 dark:bg-[var(--bg-canvas)]">
          {applications.length === 0 ? null : (
            <ApplicationsFilter
              query={query}
              onQueryChange={setQuery}
              status={status}
              onStatusChange={setStatus}
              total={applications.length}
              shown={tersaring.length}
            />
          )}

          {applications.length === 0 ? (
            <EmptyApplications />
          ) : tersaring.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-[var(--color-muted)]">{t("aplikasi.tidakCocok")}</p>
          ) : sempit ? (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-[var(--color-line)] dark:border-[var(--color-line)]">
              {tersaring.map((app) => {
                const badge = toBadge(app.status);
                return (
                  <div key={app.id} data-testid="kartu-aplikasi" className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{dash(app.name)}</p>
                        <p className="font-mono text-xs text-muted">{app.id}</p>
                        {app.author ? (
                          <p className="mt-1 text-xs text-muted">
                            {t("aplikasi.dibuatOleh")} {app.author}
                          </p>
                        ) : null}
                      </div>
                      <StatusBadge status={badge} />
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {temuan(badge, app.security_issues)} · {t("aplikasi.terakhirUpdate")}{" "}
                      {formatBuild(app.last_build, bahasa)}
                    </p>
                    <AksiAplikasi app={app.id} onDone={reload} sentuh />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-[var(--color-line)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-muted dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-muted)]">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">
                      {t("aplikasi.kolomNama")}
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      {t("aplikasi.kolomStatus")}
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      {t("aplikasi.kolomTerakhir")}
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      {t("aplikasi.kolomAksi")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-[var(--color-line)]">
                  {tersaring.map((app) => {
                    const badge = toBadge(app.status);
                    return (
                      <tr key={app.id}>
                        <td className="px-5 py-4">
                          <p className="font-medium text-ink">{dash(app.name)}</p>
                          <p className="font-mono text-xs text-muted">{app.id}</p>
                          {app.author ? (
                            <p className="mt-1 text-xs text-muted">
                              {t("aplikasi.dibuatOleh")} {app.author}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={badge} />
                          <p className="mt-1 text-xs text-muted">{temuan(badge, app.security_issues)}</p>
                        </td>
                        <td className="px-5 py-4 text-muted">{formatBuild(app.last_build, bahasa)}</td>
                        <td className="px-5 py-4">
                          <AksiAplikasi app={app.id} onDone={reload} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
