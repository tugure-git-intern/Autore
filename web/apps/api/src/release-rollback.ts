import { spawn as spawnProses } from "node:child_process";
import {
  aksiRollback,
  type Deployment,
  type Environment,
  type Release,
  foldReleaseEvents,
  isReleaseEvent,
  type ReleaseEvent,
} from "@autore/contracts";
import { ambilKunci } from "./kunci";
import { appDariId, bacaLedgerMentah, jalurLedger } from "./release-approval";
import type { Identitas } from "./session";

export type EnvironmentRollback = "staging" | "production";

export type HasilRollback =
  | {
      ok: true;
      status: 202;
      job: string;
      environment: EnvironmentRollback;
      release_id: string;
      target_deployment_id: string;
      target_digest: string;
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 502; error: string };

export type RollbackDeps = {
  ledger?: string | (() => string);
  bin?: string;
  job?: (app: string) => string | undefined;
  spawn?: (bin: string, args: string[]) => Promise<{ code: number; stderr: string }>;
};

const PESAN_BODY = 'body wajib JSON {"environment":"staging"|"production"}';

/**
 * Membaca environment rollback dari body JSON. TIDAK ADA default: nilai harus
 * persis `staging` atau `production`. `Production`, `prod`, `null`, `""`, dan
 * kunci lain ditolak 400 supaya tidak ada rollback production yang lahir dari
 * salah tulis — parameter ini yang menentukan aksi di tabel 3.6 dan parameter
 * ROLLBACK_ENVIRONMENT job.
 */
export function bacaEnvironmentRollback(
  isi: unknown,
): { ok: true; environment: EnvironmentRollback } | { ok: false; error: string } {
  if (typeof isi !== "object" || isi === null || Array.isArray(isi)) {
    return { ok: false, error: PESAN_BODY };
  }
  const record = isi as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, "environment")) {
    return { ok: false, error: `body hanya boleh memuat kunci environment. ${PESAN_BODY}` };
  }
  const nilai = record.environment;
  if (nilai !== "staging" && nilai !== "production") {
    return { ok: false, error: 'environment harus persis "staging" atau "production"' };
  }
  return { ok: true, environment: nilai };
}

/**
 * Target rollback: deployment sehat TERAKHIR di environment itu yang bukan
 * deployment aktif sekarang dan bukan milik release yang sedang di-rollback.
 * Bukan `active_before` event terakhir — rollback harus bisa menembus lebih dari
 * satu langkah ke belakang, asal deployment sehatnya masih terdaftar.
 */
export function pilihTargetRollback(
  deployments: Deployment[],
  environment: Environment,
  release: Release,
): Deployment | null {
  const kandidat = deployments
    .filter((deployment) => deployment.environment_id === environment.id)
    .filter((deployment) => deployment.status === "sehat")
    .filter((deployment) => deployment.id !== environment.active_deployment_id)
    .filter((deployment) => deployment.release_id !== release.id)
    .sort((kiri, kanan) => {
      if (kiri.mulai_pada === kanan.mulai_pada) return kiri.id.localeCompare(kanan.id);
      return kiri.mulai_pada < kanan.mulai_pada ? -1 : 1;
    });
  return kandidat.length > 0 ? kandidat[kandidat.length - 1] : null;
}

export type RollbackHandler = {
  rollback(id: string, environment: EnvironmentRollback, aktor: Identitas): Promise<HasilRollback>;
};

async function jalankanAutore(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return await new Promise((resolve) => {
    const anak = spawnProses(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    anak.stderr?.on("data", (potongan: Buffer) => {
      if (stderr.length < 4000) stderr += potongan.toString();
    });
    anak.on("error", (error) => resolve({ code: 127, stderr: error.message }));
    anak.on("close", (code) => resolve({ code: code ?? 1, stderr: stderr.trim() }));
  });
}

export function jobRollback(app: string): string {
  return `${app}-rollback`;
}

export function hatchRollback(deps: RollbackDeps = {}): RollbackHandler {
  const jalur = typeof deps.ledger === "function" ? deps.ledger() : (deps.ledger ?? jalurLedger());
  const bin = deps.bin ?? process.env.AUTORE_BIN ?? "autore";
  const job = deps.job ?? ((app: string) => process.env.AUTORE_ROLLBACK_JOB ?? jobRollback(app));
  const spawn = deps.spawn ?? jalankanAutore;

  return {
    async rollback(id, environment, aktor) {
      const app = appDariId(id);
      if (!app) {
        return { ok: false, status: 400, error: "id release tidak sah" };
      }
      const isProduction = environment === "production";
      // Satu rollback per aplikasi sekaligus: tidak ada dua job yang bertarung
      // menulis container aktif yang sama.
      const lepas = ambilKunci(app, "rollback");
      if (!lepas) {
        return { ok: false, status: 409, error: `rollback ${app} sedang berjalan` };
      }
      try {
        const events: ReleaseEvent[] = [];
        for (const baris of bacaLedgerMentah(jalur).events ?? []) {
          if (isReleaseEvent(baris)) events.push(baris);
        }
        let hasilFold;
        try {
          hasilFold = foldReleaseEvents(events);
        } catch {
          return { ok: false, status: 409, error: "ledger release tidak konsisten" };
        }
        const releasesAtas = hasilFold.releases.find((item) => item.id === id) ?? null;
        if (!releasesAtas) {
          return { ok: false, status: 404, error: `release ${id} tidak ditemukan` };
        }
        const release = releasesAtas;
        if (!aksiRollback(release.status, isProduction)) {
          return {
            ok: false,
            status: 409,
            error: `rollback ${environment} tidak sah dari status ${release.status}`,
          };
        }
        const targetEnv =
          hasilFold.environments.find((item) => item.nama === environment) ?? null;
        if (!targetEnv || targetEnv.status_konfigurasi !== "terkonfigurasi") {
          return {
            ok: false,
            status: 409,
            error: `environment ${environment} belum dikonfigurasi untuk ${app}`,
          };
        }
        const target = pilihTargetRollback(hasilFold.deployments, targetEnv, release);
        if (!target) {
          return {
            ok: false,
            status: 409,
            error: `tidak ada deployment sehat sebelumnya di ${environment} untuk ${app}`,
          };
        }
        const namaJob = job(app) || jobRollback(app);
        const args = [
          "release",
          "trigger-rollback",
          "--job",
          namaJob,
          "--app",
          app,
          "--environment",
          environment,
          "--digest",
          target.image_digest,
          "--deployment-id",
          target.id,
          "--release-id",
          release.id,
          "--build",
          release.id.split(":")[2] ?? "",
          "--actor",
          aktor.login,
        ];
        const keluaran = await spawn(bin, args);
        if (keluaran.code !== 0) {
          return {
            ok: false,
            status: 502,
            error: `gagal memicu job rollback: ${keluaran.stderr || `exit ${keluaran.code}`}`,
          };
        }
        return {
          ok: true,
          status: 202,
          job: namaJob,
          environment,
          release_id: release.id,
          target_deployment_id: target.id,
          target_digest: target.image_digest,
        };
      } finally {
        lepas();
      }
    },
  };
}

/** Body JSON endpoint rollback; bad JSON = null (ditolak 400 oleh pemanggil). */
export async function bacaBodyRollback(
  request: { json: () => Promise<unknown> },
): Promise<{ ok: true; environment: EnvironmentRollback } | { ok: false; error: string }> {
  let isi: unknown;
  try {
    isi = await request.json();
  } catch {
    return { ok: false, error: PESAN_BODY };
  }
  return bacaEnvironmentRollback(isi);
}
