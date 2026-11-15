import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jalurWorkspace } from "./workspace";

export type KonfigLingkungan = {
  productionTarget: string | null;
  productionDeployPort: number | null;
  productionContainerPort: number | null;
};

/** Belum ada entri = production app itu belum dikonfigurasi. */
const BELUM_DIKONFIGURASI: KonfigLingkungan = {
  productionTarget: null,
  productionDeployPort: null,
  productionContainerPort: null,
};

/** Satu berkas untuk semua app, sebelah ledger supaya satu workspace satu kebenaran. */
export function jalurLingkungan(env: NodeJS.ProcessEnv = process.env): string {
  return env.AUTORE_ENVIRONMENTS ?? join(jalurWorkspace(env), "environments.json");
}

function target(nilai: unknown): string | null {
  return typeof nilai === "string" && nilai.trim() ? nilai.trim() : null;
}

function port(nilai: unknown): number | null {
  if (typeof nilai !== "number" || !Number.isInteger(nilai)) return null;
  return nilai > 0 && nilai <= 65535 ? nilai : null;
}

/**
 * Konfigurasi environment per app. Fail-closed: berkas hilang, JSON rusak, atau
 * app tidak terdaftar semuanya berarti production belum dikonfigurasi, jadi
 * promosi ditolak 409 sebelum ada job yang jalan. Tidak ada target tersembunyi
 * di kode supaya app baru cukup menambah entri di sini, tanpa ubah kode.
 */
export function bacaLingkungan(app: string, jalur: string = jalurLingkungan()): KonfigLingkungan {
  let isi: unknown;
  try {
    isi = JSON.parse(readFileSync(jalur, "utf8")) as unknown;
  } catch {
    return BELUM_DIKONFIGURASI;
  }
  if (typeof isi !== "object" || isi === null || Array.isArray(isi)) return BELUM_DIKONFIGURASI;
  const appKonfig = (isi as Record<string, unknown>)[app];
  if (typeof appKonfig !== "object" || appKonfig === null) return BELUM_DIKONFIGURASI;
  const production = (appKonfig as Record<string, unknown>).production;
  if (typeof production !== "object" || production === null) return BELUM_DIKONFIGURASI;
  const record = production as Record<string, unknown>;
  return {
    productionTarget: target(record.target),
    productionDeployPort: port(record.deploy_port),
    productionContainerPort: port(record.container_port),
  };
}
