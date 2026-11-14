import { spawn as spawnProses } from "node:child_process";
import {
  type Deployment,
  type Environment,
  foldReleaseEvents,
  isReleaseEvent,
  type ReleaseEvent,
} from "@autore/contracts";
import { ambilKunci } from "./kunci";
import { appDariId, bacaLedgerMentah, jalurLedger } from "./release-approval";
import type { Identitas } from "./session";

export type HasilPromote =
  | {
      ok: true;
      status: 202;
      job: string;
      environment: "production";
      release_id: string;
      digest: string;
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 502; error: string };

export type PromoteDeps = {
  ledger?: string | (() => string);
  bin?: string;
  job?: (app: string) => string | undefined;
  spawn?: (bin: string, args: string[]) => Promise<{ code: number; stderr: string }>;
};

export type PromoteHandler = {
  promote(id: string, aktor: Identitas): Promise<HasilPromote>;
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

export function jobPromote(app: string): string {
  return `${app}-promote`;
}

/** Production aktif sudah memakai digest ini: promosi tidak boleh mengulang. */
function sudahDiProduction(production: Environment | null, deployments: Deployment[], digest: string): boolean {
  if (!production?.active_deployment_id) return false;
  const aktif = deployments.find((item) => item.id === production.active_deployment_id);
  return aktif?.image_digest === digest;
}

export function hatchPromote(deps: PromoteDeps = {}): PromoteHandler {
  const jalur = typeof deps.ledger === "function" ? deps.ledger() : (deps.ledger ?? jalurLedger());
  const bin = deps.bin ?? process.env.AUTORE_BIN ?? "autore";
  const job = deps.job ?? ((app: string) => process.env.AUTORE_PROMOTE_JOB ?? jobPromote(app));
  const spawn = deps.spawn ?? jalankanAutore;

  return {
    async promote(id, aktor) {
      const app = appDariId(id);
      if (!app) {
        return { ok: false, status: 400, error: "id release tidak sah" };
      }
      // Satu promosi per aplikasi sekaligus: job production tidak boleh bertarung
      // menulis container aktif yang sama.
      const lepas = ambilKunci(app, "promote");
      if (!lepas) {
        return { ok: false, status: 409, error: `promosi ${app} sedang berjalan` };
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
        const release = hasilFold.releases.find((item) => item.id === id) ?? null;
        if (!release) {
          return { ok: false, status: 404, error: `release ${id} tidak ditemukan` };
        }
        // Hanya rilis yang sudah lolos gerbang manual qa yang boleh jalan ke production.
        if (release.status !== "disetujui") {
          return {
            ok: false,
            status: 409,
            error: `promosi production hanya untuk release disetujui (status ${release.status})`,
          };
        }
        const digest = release.image_digest;
        if (!digest) {
          return { ok: false, status: 409, error: `release ${id} belum punya digest` };
        }
        const staging = hasilFold.environments.find((item) => item.nama === "staging") ?? null;
        const production = hasilFold.environments.find((item) => item.nama === "production") ?? null;
        if (!staging || staging.status_konfigurasi !== "terkonfigurasi") {
          return { ok: false, status: 409, error: `environment staging belum dikonfigurasi untuk ${app}` };
        }
        const aktifStaging = staging.active_deployment_id
          ? hasilFold.deployments.find((item) => item.id === staging.active_deployment_id)
          : undefined;
        // Production memakai gambar yang sudah lolos staging, bukan hasil build lain.
        if (!aktifStaging || aktifStaging.image_digest !== digest) {
          return {
            ok: false,
            status: 409,
            error: `digest ${digest} bukan deployment staging aktif ${app}`,
          };
        }
        if (!production || production.status_konfigurasi !== "terkonfigurasi") {
          return { ok: false, status: 409, error: `environment production belum dikonfigurasi untuk ${app}` };
        }
        if (sudahDiProduction(production, hasilFold.deployments, digest)) {
          return { ok: false, status: 409, error: `production ${app} sudah memakai digest ${digest}` };
        }
        const namaJob = job(app) || jobPromote(app);
        const args = [
          "release",
          "trigger-promote",
          "--job",
          namaJob,
          "--app",
          app,
          "--digest",
          digest,
          "--release-id",
          release.id,
          "--build",
          release.id.split(":")[2] ?? "",
          "--actor",
          aktor.login,
          // Port production bisa diarahkan lewat env (uji memakai port bebas),
          // default tetap produksi sebenarnya.
          "--container-port",
          process.env.AUTORE_PROMOTE_CONTAINER_PORT ?? "8080",
          "--deploy-port",
          process.env.AUTORE_PROMOTE_DEPLOY_PORT ?? "8154",
        ];
        const keluaran = await spawn(bin, args);
        if (keluaran.code !== 0) {
          return {
            ok: false,
            status: 502,
            error: `gagal memicu job promosi: ${keluaran.stderr || `exit ${keluaran.code}`}`,
          };
        }
        return {
          ok: true,
          status: 202,
          job: namaJob,
          environment: "production",
          release_id: release.id,
          digest,
        };
      } finally {
        lepas();
      }
    },
  };
}
