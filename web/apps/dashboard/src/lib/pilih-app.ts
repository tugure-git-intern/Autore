import type { ApplicationRecord } from "./contracts";

/**
 * Tanpa `?app=`: aplikasi gagal pertama yang dipilih. Halaman ini dipakai untuk mencari
 * masalah, jadi yang rusak didahulukan; kalau semua sehat, aplikasi pertama cukup.
 */
export function pilihAwal(applications: readonly ApplicationRecord[]): ApplicationRecord | undefined {
  return applications.find((app) => app.status === "failed") ?? applications[0];
}

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
  return pipeline.slice(0, panjang) === app.slice(0, panjang);
}