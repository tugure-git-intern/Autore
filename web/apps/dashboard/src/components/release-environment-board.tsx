import {
  digantikanDiStaging,
  type Deployment,
  type Environment,
  type Release,
  type Role,
  type StatusRelease,
} from "@autore/contracts";
import { ReleaseKeputusan } from "./release-keputusan";
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
  disetujui: "Disetujui",
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
  disetujui: "green",
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
  appName = "Portal Klaim",
  role = null,
}: {
  releases: Release[];
  environments: Environment[];
  deployments: Deployment[];
  appName?: string;
  /** Role efektif penampil; qa ke atas boleh melihat tombol approval. */
  role?: Role | null;
}) {
  // Satu record lama yang tidak konsisten tidak boleh mematikan seluruh halaman:
  // dilaporkan sebagai peringatan, bukan throw yang memicu error boundary.
  const inkonsisten = deployments.filter((deployment) => {
    const release = releases.find((item) => item.id === deployment.release_id);
    return !release || release.image_digest !== deployment.image_digest;
  });

  return (
    <section aria-label={`Environment ${appName}`} className="space-y-4">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Staging</p>
        <h2 className="text-lg font-semibold">{appName}</h2>
      </header>
      {inkonsisten.length > 0 ? (
        <div
          data-testid="deployment-inkonsisten"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          {inkonsisten.length} deployment lama tidak cocok dengan release-nya (digest kosong atau berbeda):{" "}
          <span className="font-mono text-xs">{inkonsisten.map((item) => item.id).join(", ")}</span>
        </div>
      ) : null}
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
                  <Badge tone="green">{environment.nama === "production" ? "Aktif" : "Sehat"}</Badge>
                ) : (
                  <Badge tone="gray">Belum ada deployment</Badge>
                )}
              </div>
              {environment.status_konfigurasi === "belum_dikonfigurasi" ? (
                <p className="mt-3 text-sm text-muted">Target production belum diisi oleh admin.</p>
              ) : (
                <p className="mt-3 text-sm text-muted">Target: {environment.target || "-"}</p>
              )}
            </BoardCard>
          );
        })}
      </div>
      <BoardCard>
        <h3 className="font-medium">Release Terbaru</h3>
        {releases.map((release) => {
          // Rilis yang pointer staging-nya sudah pindah: badged, tombolnya dimatikan.
          const pengganti = digantikanDiStaging(release.id, environments, deployments);
          return (
          <div key={release.id} className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{release.commit_sha.slice(0, 7)}</span>
              <Badge tone={TONE_RELEASE[release.status]}>{LABEL_RELEASE[release.status]}</Badge>
              {pengganti ? (
                <Badge tone="gray">
                  <span data-testid="release-digantikan">
                    Digantikan build {pengganti.slice(pengganti.lastIndexOf(":") + 1)}
                  </span>
                </Badge>
              ) : null}
            </div>
            {/* Jejak audit terlihat orang: pembuat commit dan approver terakhir. */}
            <p className="text-xs text-muted">
              Dibuat oleh <span data-testid="release-dibuat-oleh">{release.dibuat_oleh}</span>
              {" - "}
              {release.approved_by ? (
                <>
                  disetujui <span data-testid="release-approved-by">{release.approved_by}</span>
                </>
              ) : (
                <span data-testid="release-approved-by">belum disetujui</span>
              )}
            </p>
            <code className="block break-all text-xs text-muted">{release.image_digest}</code>
            {/* Komponen sendiri yang memutuskan aksi mana yang boleh tampil. */}
            <ReleaseKeputusan
              releaseId={release.id}
              role={role}
              status={release.status}
              digantikan={pengganti !== null}
            />
          </div>
          );
        })}
      </BoardCard>
    </section>
  );
}
