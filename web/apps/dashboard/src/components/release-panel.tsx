"use client";

import { useEffect, useState } from "react";
import type { FoldResult } from "@autore/contracts";
import { fetchReleases } from "@/lib/releases-client";
import { ReleaseEnvironmentBoard } from "./release-environment-board";

/**
 * Panel read-only untuk Fase 2A. Pipeline auto-deploy setelah gate; panel ini
 * hanya menampilkan fakta yang dicatat pipeline, tidak punya tombol aksi.
 */
export function ReleasePanel({ appId, appName }: { appId: string; appName: string }) {
  const [data, setData] = useState<FoldResult | null>(null);

  useEffect(() => {
    const kontrol = new AbortController();
    fetchReleases(appId, kontrol.signal)
      .then((hasil) => setData(hasil.data))
      .catch(() => setData(null));
    return () => kontrol.abort();
  }, [appId]);

  if (!data) return null;
  if (data.releases.length === 0 && data.environments.length === 0) return null;

  return (
    <section data-testid="release-panel" className="space-y-2">
      <p className="text-xs text-muted">
        Build + auto-deploy staging. Sumber: event pipeline nyata.
      </p>
      <ReleaseEnvironmentBoard
        appName={appName}
        releases={data.releases}
        environments={data.environments}
        deployments={data.deployments}
      />
    </section>
  );
}
