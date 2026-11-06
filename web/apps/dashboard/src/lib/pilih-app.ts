import type { ApplicationRecord } from "./contracts";

/**
 * Tanpa `?app=`: aplikasi gagal pertama yang dipilih. Halaman ini dipakai untuk mencari
 * masalah, jadi yang rusak didahulukan; kalau semua sehat, aplikasi pertama cukup.
 */
export function pilihAwal(applications: readonly ApplicationRecord[]): ApplicationRecord | undefined {
  return applications.find((app) => app.status === "failed") ?? applications[0];
}

/** Sha lebih pendek dari ini bukan bukti identitas, hanya tebakan yang bisa kembar. */
const SHA_MIN = 7;

/**
 * `latest_pipeline` adalah satu record global workspace. Pipeline itu hanya boleh
 * ditampilkan sebagai milik sebuah aplikasi kalau commit-nya memang commit aplikasi
 * tersebut — CLI kadang menulis short sha, jadi cocokkan sepanjang yang terpendek.
 */
export function cocokCommit(
  pipelineSha: string | null | undefined,
  appSha: string | null | undefined,
): boolean {
  const pipeline = (pipelineSha ?? "").trim().toLowerCase();
  const app = (appSha ?? "").trim().toLowerCase();
  if (!pipeline || !app) return false;

  const panjang = Math.min(pipeline.length, app.length);
  if (panjang < SHA_MIN) return false;
  return pipeline.slice(0, panjang) === app.slice(0, panjang);
}

/**
 * Boleh tidaknya record global ditampilkan sebagai pipeline aplikasi terpilih.
 * Tiga syarat, dan semuanya harus lolos:
 *
 * 1. commit-nya cocok (panjang minimal, lihat `cocokCommit`);
 * 2. sha pendek itu tidak kembar dengan aplikasi lain — repo berbeda bisa punya sha
 *    awalan yang sama (tes-java vs autore-dummy), dan record global cuma satu;
 * 3. statusnya tidak bertentangan — timeline hijau tidak pernah boleh dipakai untuk
 *    aplikasi yang sedang merah (dan sebaliknya).
 */
export function cocokPipeline(
  pipeline: { commit_sha: string | null | undefined; status: string },
  app: { commit_sha: string | null | undefined; status: string },
  applications: readonly { commit_sha: string | null | undefined }[] = [],
): boolean {
  if (!cocokCommit(pipeline.commit_sha, app.commit_sha)) return false;

  const pemilik = applications.filter((kandidat) =>
    cocokCommit(pipeline.commit_sha, kandidat.commit_sha),
  ).length;
  if (pemilik > 1) return false;

  // Hanya pasangan final yang berlawanan yang dilarang. "Aplikasi lulus + pipeline
  // sedang berjalan/idle" itu wajar (build berikutnya belum selesai), dan sebaliknya.
  const berlawanan =
    (app.status === "passed" && pipeline.status === "failed") ||
    (app.status === "failed" && pipeline.status === "passed");
  return !berlawanan;
}