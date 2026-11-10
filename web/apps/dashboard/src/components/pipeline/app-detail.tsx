"use client";

import type { ReactNode } from "react";
import { ArrowLeft, Boxes, ExternalLink } from "lucide-react";
import { ActionButton } from "@/components/actions/action-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ActivePipeline, ApplicationRecord, DashboardStatus, RunRecord } from "@/lib/contracts";
import { dash } from "@/lib/format";
import { formatDuration, relativeTime, shortSha } from "@/lib/format";
import { cocokPipeline } from "@/lib/pilih-app";
import { StatusBadge, type AppStatus } from "../status-badge";
import { WorkspacePipeline } from "./workspace-pipeline";

const MAKS_RUN = 5;

const IKON: Record<string, string> = {
  passed: "bg-green-50 text-green-600 dark:bg-green-950/60 dark:text-green-300",
  failed: "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300",
  running: "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300",
  pending: "bg-yellow-50 text-yellow-600 dark:bg-yellow-950/60 dark:text-yellow-300",
};

// "Jalankan Ulang" memakai jalur deploy: commit + push lokal lalu trigger Jenkins.
const RERUN_CONFIRM = {
  title: "Jalankan ulang pipeline?",
  warning:
    "Tindakan ini akan melakukan commit dan push kode lokal Anda ke repository, lalu memicu build Jenkins.",
  confirmLabel: "Ya, jalankan ulang",
};

function Fakta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)]">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

const jumlahTemuan = (jumlah: number) => (jumlah === 0 ? "Tidak ada temuan" : `${jumlah} temuan keamanan`);

const statusDeploy = (deployed: boolean | undefined) =>
  deployed === undefined ? "—" : deployed ? "Terpasang" : "Belum terpasang";

/** Detail satu aplikasi. Semuanya presentational — data datang dari halaman. */
export function AppDetail({
  app,
  pipeline,
  runs,
  aktif,
  applications,
  onDaftar,
  onSelesai,
}: {
  app: ApplicationRecord;
  pipeline: DashboardStatus["latest_pipeline"];
  runs: readonly RunRecord[];
  aktif: readonly ActivePipeline[];
  /** Seluruh aplikasi: dipakai untuk mendeteksi sha pendek yang kembar antar repo. */
  applications: readonly ApplicationRecord[];
  /** Layar sempit: detail menggantikan daftar, jadi butuh jalan kembali. */
  onDaftar?: () => void;
  onSelesai?: () => void;
}) {
  const riwayat = runs.filter((run) => run.app === app.id).slice(0, MAKS_RUN);
  const sedangAktif = aktif.filter((baris) => baris.app === app.id);
  const cocok = cocokPipeline(pipeline, app, applications);
  const jobUrl = riwayat[0]?.url ?? "";
  const buildGagal = riwayat.find((run) => run.status === "failed");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {onDaftar ? (
            <button
              type="button"
              onClick={onDaftar}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)] dark:hover:bg-[var(--bg-canvas)]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Daftar aplikasi
            </button>
          ) : null}
          <span
            aria-hidden="true"
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
              IKON[app.status] ?? "bg-gray-100 text-gray-600 dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-muted)]"
            }`}
          >
            <Boxes className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-ink">Detail Pipeline</h1>
            <p className="mt-1 text-sm text-muted">
              {app.name} · {app.id}
            </p>
          </div>
        </div>
        <ActionButton
          label="Jalankan Ulang"
          action="deploy"
          app={app.id}
          confirm={RERUN_CONFIRM}
          onDone={onSelesai}
        />
      </div>

      {sedangAktif.length > 0 ? (
        <div
          data-testid="detail-aktif"
          className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)]"
        >
          {sedangAktif.map((baris) => (
            <span key={`${baris.app}#${baris.number}`} className="flex items-center gap-2">
              <Badge tone={baris.status === "queued" ? "yellow" : "blue"}>
                {baris.status === "queued" ? "Menunggu" : "Berjalan"}
              </Badge>
              {baris.status === "queued" ? "Sedang menunggu di antrean Jenkins" : "Sedang dibangun sekarang"}
              {baris.url ? (
                <a href={baris.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline dark:text-blue-300">
                  Buka Jenkins
                </a>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Fakta label="Build terakhir">
          {app.last_build ? relativeTime(app.last_build) : "Belum ada build"}
        </Fakta>
        <Fakta label="Commit">
          <span className="font-mono">{shortSha(app.commit_sha ?? "")}</span>
        </Fakta>
        <Fakta label="Penulis">{app.author?.trim() || "—"}</Fakta>
        <Fakta label="Keamanan">{jumlahTemuan(app.security_issues)}</Fakta>
        <Fakta label="Deploy">{statusDeploy(app.deployed)}</Fakta>
        <Fakta label="Status">
          <StatusBadge status={app.status as AppStatus} />
        </Fakta>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">Riwayat Build</h2>
        <p className="mt-1 text-xs text-muted">Lima build terakhir aplikasi ini dari Jenkins.</p>
        {riwayat.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Belum ada run untuk aplikasi ini</p>
        ) : (
          <ul aria-label="Riwayat build aplikasi ini" className="mt-3 divide-y divide-gray-100 dark:divide-[var(--color-line)]">
            {riwayat.map((run) => (
              <li
                key={`${run.app}#${run.number}`}
                data-testid="detail-run-row"
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
              >
                <a
                  href={run.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-600 hover:underline dark:text-blue-300"
                >
                  #{run.number}
                </a>
                <StatusBadge status={run.status as AppStatus} />
                <span className="font-mono text-xs text-muted">{shortSha(run.commit_sha)}</span>
                <span className="text-gray-600 dark:text-[var(--color-muted)]">{dash(run.author)}</span>
                <span className="text-gray-500 dark:text-[var(--color-muted)]">{formatDuration(run.duration_ms)}</span>
                <span className="text-gray-500 dark:text-[var(--color-muted)]">{relativeTime(run.started_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {cocok ? (
        <WorkspacePipeline pipeline={pipeline} />
      ) : app.status === "failed" ? (
        // Aplikasi merah tidak boleh disuguhi timeline hijau milik aplikasi lain:
        // itu inti bug "semua hijau padahal build gagal".
        <Card className="p-5">
          <div data-testid="detail-gagal">
            <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
              Pipeline gagal, cek log Jenkins.
            </p>
            <p className="mt-1 text-sm text-muted">
              Build terakhir <span className="font-medium">{app.name}</span> tidak lulus
              {buildGagal ? ` (build #${buildGagal.number})` : ""}. Tahapan dan log workspace tidak
              ditampilkan karena commit terakhir di workspace bukan milik aplikasi ini.
            </p>
            {buildGagal?.url ? (
              <a
                href={buildGagal.url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline dark:text-blue-300"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Buka log build #{buildGagal.number} di Jenkins
              </a>
            ) : jobUrl ? (
              <a
                href={jobUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline dark:text-blue-300"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Buka job Jenkins {app.name}
              </a>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <p className="text-sm text-ink">
            Pipeline terakhir di workspace ini bukan milik {app.name} (commit{" "}
            <span className="font-mono">{shortSha(pipeline.commit_sha)}</span> vs{" "}
            <span className="font-mono">{shortSha(app.commit_sha ?? "")}</span>
            ). Tahapan dan lognya tidak ditampilkan supaya tidak menyesatkan.
          </p>
          {jobUrl ? (
            <a
              href={jobUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline dark:text-blue-300"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Buka job Jenkins {app.name}
            </a>
          ) : null}
        </Card>
      )}
    </div>
  );
}
