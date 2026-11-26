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

const MAKS_TERLIHAT = 3;

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
  digantikan: "Digantikan",
  gagal: "Gagal",
  ditolak: "Ditolak",
  rolled_back: "Dikembalikan",
};

/** Tautan commit hanya jika pipeline merekam URL repo; event lama tidak punya. */
function tautanCommit(repoUrl: string | null, sha: string): string | null {
  if (!repoUrl) return null;
  return `${repoUrl.trim().replace(/\.git$/, "").replace(/\/$/, "")}/commit/${sha}`;
}

/** Nama build pendek dari id release (`tes-testing:sha:73` -> `73`). */
function nomorBuild(id: string): string {
  return id.slice(id.lastIndexOf(":") + 1);
}

/**
 * Umur antrean approval dalam bahasa manusia. Dihitung dari waktu event staging
 * sehat, bukan waktu render, supaya angkanya sama di semua penonton.
 */
export function umurPersetujuan(sejak: string | null, sekarang = Date.now()): string | null {
  if (!sejak) return null;
  const mulai = Date.parse(sejak);
  if (Number.isNaN(mulai)) return null;
  const menit = Math.floor((sekarang - mulai) / 60_000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} menit`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam`;
  return `${Math.floor(jam / 24)} hari`;
}

/** Siapa yang perlu bergerak pada status ini; status tenang tidak diberi label. */
const TINDAKAN: Partial<Record<StatusRelease, string>> = {
  menunggu_persetujuan: "Perlu QA/Admin menyetujui",
  gagal: "Perlu developer memperbaiki build",
  ditolak: "Perlu developer revisi lalu build ulang",
  rolled_back: "Perlu developer memeriksa penyebab rollback",
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
  digantikan: "gray",
  gagal: "red",
  ditolak: "red",
  rolled_back: "gray",
};

const FORMAT_WAKTU = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

function waktuBuild(iso: string): string {
  const waktu = Date.parse(iso);
  return Number.isNaN(waktu) ? "—" : FORMAT_WAKTU.format(waktu).replace(",", "");
}

function ringkasDigest(digest: string | null): string {
  if (!digest) return "—";
  const [algo, nilai] = digest.split(":", 2);
  return `${algo}:${(nilai ?? "").slice(0, 12)}...`;
}

function DaftarRelease({
  items,
  label,
  role,
}: {
  items: { release: Release; pengganti: string | null }[];
  label: string;
  role: Role | null;
}) {
  return (
    <ol
      aria-label={label}
      className="mt-3 divide-y divide-gray-200 dark:divide-[var(--color-line)]"
    >
      {items.map(({ release, pengganti }) => (
        <li key={release.id} className="py-4 first:pt-0 last:pb-0">
          <ReleaseRow release={release} pengganti={pengganti} role={role} />
        </li>
      ))}
    </ol>
  );
}

function ReleaseRow({
  release,
  pengganti,
  role,
}: {
  release: Release;
  pengganti: string | null;
  role: Role | null;
}) {
  const commitUrl = tautanCommit(release.repo_url, release.commit_sha);
  const tindakan = TINDAKAN[release.status];
  const umur = release.status === "menunggu_persetujuan"
    ? umurPersetujuan(release.menunggu_sejak)
    : null;
  // Rilis pengganti tidak bisa disetujui, dan umur antreannya sudah tidak relevan.
  const tampilkanTindakan = !(pengganti && release.status === "menunggu_persetujuan");
  const tampilkanUmur = tampilkanTindakan && umur !== null;

  return (
    <article className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {commitUrl ? (
            <a
              href={commitUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-sm font-semibold hover:underline hover:underline-offset-2"
              data-testid="release-commit-link"
            >
              {release.commit_sha.slice(0, 7)}
            </a>
          ) : (
            <span className="font-mono text-sm font-semibold">{release.commit_sha.slice(0, 7)}</span>
          )}
          <span
            data-testid="release-build"
            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-muted dark:bg-[var(--bg-sidebar)]"
          >
            #{nomorBuild(release.id)}
          </span>
          {release.branch ? (
            <span data-testid="release-branch" className="font-mono text-xs text-muted">
              {release.branch}
            </span>
          ) : null}
        </div>
        <Badge tone={TONE_RELEASE[release.status]} className="shrink-0">
          {LABEL_RELEASE[release.status]}
        </Badge>
      </div>

      <p
        data-testid="release-subjek"
        className="truncate text-sm font-medium leading-snug"
        title={release.commit_subject ?? undefined}
      >
        {release.commit_subject ?? (
          <span className="font-normal italic text-muted">Tanpa pesan commit</span>
        )}
      </p>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
        <span>
          Dibuat oleh <span data-testid="release-dibuat-oleh">{release.dibuat_oleh}</span>
        </span>
        <span aria-hidden="true">·</span>
        {release.approved_by ? (
          <span>
            disetujui <span data-testid="release-approved-by">{release.approved_by}</span>
          </span>
        ) : (
          <span data-testid="release-approved-by">belum disetujui</span>
        )}
        <span aria-hidden="true">·</span>
        <time data-testid="release-waktu" dateTime={release.dibuat_pada}>
          {waktuBuild(release.dibuat_pada)}
        </time>
        {pengganti ? (
          <>
            <span aria-hidden="true">·</span>
            <span data-testid="release-digantikan">Digantikan build {nomorBuild(pengganti)}</span>
          </>
        ) : null}
        {tampilkanTindakan && (tindakan || tampilkanUmur) ? (
          <>
            {tindakan ? (
              <>
                <span aria-hidden="true">·</span>
                <span
                  data-testid="release-tindakan"
                  className="font-medium text-amber-700 dark:text-amber-300"
                >
                  {tindakan}
                </span>
              </>
            ) : null}
            {tampilkanUmur ? (
              <>
                <span aria-hidden="true">·</span>
                <span data-testid="release-umur" className="text-amber-700 dark:text-amber-300">
                  menunggu {umur}
                </span>
              </>
            ) : null}
          </>
        ) : null}
      </p>

      {/* Digest penuh tetap ada di tooltip; baris tidak lagi memenuhi lebar kartu. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <span>image</span>
          <code
            data-testid="release-digest"
            title={release.image_digest ?? undefined}
            aria-label={release.image_digest ?? "digest belum tersedia"}
            className="min-w-0 truncate font-mono"
          >
            {ringkasDigest(release.image_digest)}
          </code>
        </p>

        <div className="empty:hidden shrink-0">
          <ReleaseKeputusan
            releaseId={release.id}
            role={role}
            status={release.status}
            digantikan={pengganti !== null}
          />
        </div>
      </div>
    </article>
  );
}

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
  // Catatan historis yang tidak lagi ditunjuk environment tetap menjadi ledger,
  // tetapi hanya deployment aktif yang memengaruhi status dashboard.
  const activeDeploymentIds = new Set(
    environments.flatMap((environment) =>
      environment.active_deployment_id ? [environment.active_deployment_id] : [],
    ),
  );
  const inkonsisten = deployments.filter((deployment) => {
    if (!activeDeploymentIds.has(deployment.id)) return false;
    const release = releases.find((item) => item.id === deployment.release_id);
    return !release || !release.image_digest || !deployment.image_digest
      || release.image_digest !== deployment.image_digest;
  });

  const baris = releases.map((release) => ({
    release,
    pengganti: digantikanDiStaging(release.id, environments, deployments),
  }));
  const terlihat = baris.slice(0, MAKS_TERLIHAT);
  const sisa = baris.slice(MAKS_TERLIHAT);

  return (
    <section aria-label={`Environment ${appName}`} className="space-y-4">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Environment</p>
        <h2 className="text-lg font-semibold">{appName}</h2>
      </header>
      {inkonsisten.length > 0 ? (
        <div
          data-testid="deployment-inkonsisten"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          {inkonsisten.length} deployment aktif tidak cocok dengan release-nya (digest kosong atau berbeda):{" "}
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
        <DaftarRelease items={terlihat} label="Release terbaru" role={role} />
        {sisa.length > 0 ? (
          <details className="border-t border-gray-200 pt-3 dark:border-[var(--color-line)]">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted hover:text-ink">
              Lihat semua {releases.length} rilis
            </summary>
            <DaftarRelease items={sisa} label="Release sebelumnya" role={role} />
          </details>
        ) : null}
      </BoardCard>
    </section>
  );
}
