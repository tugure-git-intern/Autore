"use client";

import { AlertTriangle } from "lucide-react";
import type { StatusValue } from "@/lib/contracts";
import { dash } from "@/lib/contracts";
import { useStatus } from "@/components/app-shell";
import { formatBuild } from "@/components/dashboard-overview";
import { EmptyApplications } from "@/components/empty-applications";
import { StatusBadge, type AppStatus } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const STALE_COPY = "Gagal terhubung ke Jenkins. Menampilkan data terakhir.";

/** Only a recorded gate result may style an app as passed/running/failed. */
function toBadge(status: StatusValue): AppStatus {
  return status === "passed" || status === "running" || status === "failed" ? status : "unknown";
}

/**
 * A finding count is only a fact once a scan produced a verdict. Without one
 * (registry-only app, or a scan still running) the cell stays a dash instead of
 * claiming "0 temuan".
 */
function findings(status: AppStatus, securityIssues: number): string {
  if (status !== "passed" && status !== "failed") return "—";
  return `${securityIssues} temuan`;
}

export default function ApplicationsPage() {
  const { state, loading, failed, reload } = useStatus();

  if (loading && !state) {
    return (
      <section aria-label="Memuat aplikasi" aria-busy="true">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-4 h-64" />
      </section>
    );
  }

  if (!state) {
    return (
      <Card className="p-6">
        <p role="alert" className="font-medium text-red-700">
          Status Autore belum tersedia.
        </p>
        <Button className="mt-4" onClick={reload}>
          Coba lagi
        </Button>
      </Card>
    );
  }

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

      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Aplikasi</h1>
        <p className="mt-1 text-sm text-muted">{applications.length} aplikasi terdaftar.</p>
      </div>

      <div className="mt-4">
        {applications.length === 0 ? (
          <EmptyApplications />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Nama
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Status Keamanan
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Terakhir Update
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {applications.map((app) => {
                    const badge = toBadge(app.status);
                    return (
                      <tr key={app.id}>
                        <td className="px-5 py-4">
                          <p className="font-medium text-ink">{dash(app.name)}</p>
                          <p className="font-mono text-xs text-muted">{app.id}</p>
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={badge} />
                          <p className="mt-1 text-xs text-muted">
                            {findings(badge, app.security_issues)}
                          </p>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
