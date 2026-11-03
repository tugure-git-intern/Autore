"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ApiStatusResponse, StatusValue } from "@/lib/contracts";
import { dash } from "@/lib/contracts";
import { fetchDashboardStatus } from "@/lib/status-client";
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

export default function ApplicationsPage() {
  const [state, setState] = useState<ApiStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    try {
      const result = await fetchDashboardStatus(next.signal);
      if (!next.signal.aborted) {
        setState(result);
        setFailed(false);
      }
    } catch (error) {
      if (!next.signal.aborted && (error as Error)?.name !== "AbortError") setFailed(true);
    } finally {
      if (!next.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

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
        <Button className="mt-4" onClick={() => void load()}>
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Aplikasi</h1>
          <p className="mt-1 text-sm text-muted">
            {applications.length} aplikasi terdaftar lewat <code className="font-mono text-xs">autore</code>.
          </p>
        </div>
        <Button onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Sync
        </Button>
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
                      Nama Aplikasi
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Temuan Keamanan
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
                        <p className="font-mono text-xs text-muted">{app.id}</p>
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={toBadge(app.status)} />
                      </td>
                      <td className="px-5 py-4 text-muted">{app.security_issues}</td>
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
          </Card>
        )}
      </div>
    </>
  );
}