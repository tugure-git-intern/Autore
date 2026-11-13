import type { Deployment, Environment, Release, StatusRelease } from "@autore/contracts";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "./ui/badge";

function BoardCard({ testId, children }: { testId?: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-gray-200 bg-white p-5 dark:border-[#50638b] dark:bg-[#353b43] dark:text-white"
    >
      {children}
    </div>
  );
}

const LABEL_RELEASE: Record<StatusRelease, string> = {
  draft: "Draf",
  build_berjalan: "Build Berjalan",
  siap_staging: "Siap Staging",
  staging_berjalan: "Staging Berjalan",
  menunggu_persetujuan: "Menunggu Persetujuan",
  production_berjalan: "Production Berjalan",
  aktif: "Aktif",
  gagal: "Gagal",
  ditolak: "Ditolak",
  rolled_back: "Rolled Back",
};

const TONE_RELEASE: Record<StatusRelease, BadgeTone> = {
  draft: "gray",
  build_berjalan: "blue",
  siap_staging: "blue",
  staging_berjalan: "blue",
  menunggu_persetujuan: "amber",
  production_berjalan: "blue",
  aktif: "green",
  gagal: "red",
  ditolak: "red",
  rolled_back: "gray",
};

/** Mockup Fase 1: data diberikan pemanggil, belum membaca API atau men-deploy. */
export function ReleaseEnvironmentBoard({
  releases,
  environments,
  deployments,
}: {
  releases: Release[];
  environments: Environment[];
  deployments: Deployment[];
}) {
  for (const deployment of deployments) {
    const release = releases.find((item) => item.id === deployment.release_id);
    if (!release || release.image_digest !== deployment.image_digest) {
      throw new Error("digest deployment tidak sama dengan release");
    }
  }

  return (
    <section aria-label="Environment Portal Klaim" className="space-y-4">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Mockup Fase 1</p>
        <h2 className="text-lg font-semibold">Portal Klaim</h2>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {environments.map((environment) => {
          const aktif = deployments.find((item) => item.id === environment.active_deployment_id);
          return (
            <BoardCard key={environment.id} testId={`environment-${environment.nama}`}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">{environment.nama === "staging" ? "Staging" : "Production"}</h3>
                {environment.status_konfigurasi === "belum_dikonfigurasi" ? (
                  <Badge tone="gray">Belum dikonfigurasi</Badge>
                ) : aktif?.status === "sehat" ? (
                  <Badge tone="green">Sehat</Badge>
                ) : (
                  <Badge tone="gray">Belum ada deployment</Badge>
                )}
              </div>
              {environment.status_konfigurasi === "belum_dikonfigurasi" ? (
                <p className="mt-3 text-sm text-muted">Target production belum diisi oleh admin.</p>
              ) : (
                <p className="mt-3 text-sm text-muted">Target: {environment.target}</p>
              )}
            </BoardCard>
          );
        })}
      </div>
      <BoardCard>
        <h3 className="font-medium">Release Terbaru</h3>
        {releases.map((release) => (
          <div key={release.id} className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{release.commit_sha.slice(0, 7)}</span>
              <Badge tone={TONE_RELEASE[release.status]}>{LABEL_RELEASE[release.status]}</Badge>
            </div>
            <code className="block break-all text-xs text-muted">{release.image_digest}</code>
          </div>
        ))}
      </BoardCard>
    </section>
  );
}
