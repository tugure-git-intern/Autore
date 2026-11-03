"use client";

import { AlertTriangle, Boxes, Container, ServerCog, Workflow } from "lucide-react";
import type { StatusValue } from "@/lib/contracts";
import { dash } from "@/lib/contracts";
import { useStatus } from "./app-shell";
import { EmptyApplications } from "./empty-applications";
import { StatCard } from "./stat-card";
import { StatusBadge, type AppStatus } from "./status-badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

const STALE_COPY = "Gagal terhubung ke Jenkins. Menampilkan data terakhir.";

const pipelineLabels: Record<StatusValue, string> = {
  idle: "Siaga",
  running: "Berjalan",
  passed: "Lulus",
  failed: "Gagal",
  unknown: "Tidak diketahui",
  pending: "Menunggu",
  skipped: "Dilewati",
};

/** Only a recorded gate result may style an app as passed/running/failed. */
function toBadge(status: StatusValue): AppStatus {
  return status === "passed" || status === "running" || status === "failed" ? status : "unknown";
}

const buildTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export function formatBuild(value: string | null): string {
  if (!value || !value.trim()) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : buildTime.format(date);
}

export function DashboardOverview() {
  // Status and the Sync action live in the shared shell navbar.
  const { state, loading, failed, reload } = useStatus();

  if (loading && !state) return <LoadingSkeleton />;

  if (failed && !state) {
    return (
      <Card className="p-6">
        <div role="alert">
          <p className="font-medium text-red-700">Status Autore belum tersedia.</p>
          <p className="mt-1 text-sm text-red-600">
            Server tidak mengembalikan data. Coba lagi setelah pipeline berjalan.
          </p>
        </div>
        <Button className="mt-4" onClick={reload}>
          Coba lagi
        </Button>
      </Card>
    );
  }

  if (!state) return <LoadingSkeleton />;

  const { data, stale } = state;
  const applications = data.applications;

  return (
    <>
      {stale || failed ? (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {STALE_COPY}
        </div>
      ) : null}

      <section
        aria-label="Statistik"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard label="Total Terdaftar" value={data.stats.total_apps} icon={Boxes} tone="blue" />
        <StatCard
          label="Container Berjalan"
          value={data.stats.running_containers}
          icon={Container}
          tone="green"
        />
        <StatCard
          label="Infrastruktur CI/CD"
          value="Jenkins & Nexus"
          icon={ServerCog}
          tone="violet"
        />
        <StatCard
          label="Status Pipeline"
          value={pipelineLabels[data.latest_pipeline.status] ?? pipelineLabels.unknown}
          icon={Workflow}
          tone="amber"
        />
      </section>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Aplikasi</h2>
        </div>
        {applications.length === 0 ? (
          <div className="p-5">
            <EmptyApplications />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Nama Aplikasi
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Status Keamanan
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Terakhir Diperbarui
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {applications.map((app) => (
                  <tr key={app.id}>
                    <td className="px-5 py-4">
                      <p className="font-medium text-ink">{dash(app.name)}</p>
                      <p className="font-mono text-xs text-muted">{dash(app.commit_sha)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={toBadge(app.status)} />
                    </td>
                    <td className="px-5 py-4 text-muted">{formatBuild(app.last_build)}</td>
                    <td className="px-5 py-4">
                      <a
                        href={`/pipeline?app=${encodeURIComponent(app.id)}`}
                        className="text-blue-600 hover:underline"
                      >
                        Detail
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
  return (
    <section aria-label="Memuat status" aria-busy="true">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
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
