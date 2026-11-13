import { type SbomResult, isSbomPayload } from "@autore/contracts";
import type { SpawnAction, SpawnResult } from "./actions";
import { loadDashboardStatus, type RunAutore } from "./status";

export type SbomLoader = (app: string) => Promise<SbomResult>;

/** Sama seperti `actions.ts`: id aplikasi dari registry Autore. */
const APP_ID = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_OUTPUT = 4_000;
const TIMEOUT = 30_000;

const failed = (status: 400 | 404 | 422 | 503 | 504, error: string): SbomResult => ({
  ok: false,
  status,
  error,
});

/**
 * Baca SBOM terakhir satu aplikasi. Cangkang tipis di atas `autore sbom --json`:
 * keputusan "file ada / tidak ada" milik CLI, bukan ditebak API. Read-only, jadi
 * tidak ada penjagaan `busy` seperti aksi yang mengubah sistem.
 */
export function hatchSbom(deps: {
  workspace: string;
  run: RunAutore;
  spawn: SpawnAction;
  bin?: string;
}) {
  const bin = deps.bin ?? (process.env.AUTORE_BIN || "autore");
  const { workspace } = deps;

  async function get(appId: string): Promise<SbomResult> {
    if (!workspace) {
      return failed(503, "AUTORE_WORKSPACE belum diset di unit API");
    }
    const id = (appId ?? "").trim();
    if (!APP_ID.test(id)) {
      return failed(400, `id aplikasi tidak sah: ${JSON.stringify(id)}`);
    }

    let listed: string[];
    try {
      const status = await loadDashboardStatus(deps.run);
      // Registry basi = `autore status` sedang gagal; menampilkan SBOM aplikasi
      // yang tidak bisa dipastikan terdaftar berarti menebak.
      if (status.stale) {
        return failed(503, "daftar aplikasi basi (autore status gagal)");
      }
      listed = status.data.applications.map((app) => app.id);
    } catch {
      return failed(503, "daftar aplikasi tidak bisa dibaca dari autore status");
    }
    if (!listed.includes(id)) {
      return failed(404, `aplikasi "${id}" tidak terdaftar`);
    }

    let res: SpawnResult;
    try {
      res = await deps.spawn(bin, ["sbom", "--app", id, "--json"], {
        shell: false,
        timeout: TIMEOUT,
        cwd: workspace,
        // Workspace dikirim eksplisit: unit API bisa jalan dengan cwd lain.
        env: { ...process.env, AUTORE_WORKSPACE: workspace },
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      return code === "ETIMEDOUT"
        ? failed(504, `autore sbom melewati batas waktu ${TIMEOUT / 1000} detik`)
        : failed(503, `gagal menjalankan perintah autore: ${String(code ?? error)}`);
    }

    // CLI hanya menulis stdout pada jalur sukses; non-zero = tidak ada SBOM
    // (belum dibuild) atau argumennya ditolak. Pesannya milik CLI, diteruskan apa adanya.
    if (res.exitCode !== 0) {
      const pesan = (res.stderr.trim() || res.stdout.trim() || `exit ${res.exitCode}`).slice(
        0,
        MAX_OUTPUT,
      );
      return failed(404, pesan);
    }

    let data: unknown;
    try {
      data = JSON.parse(res.stdout);
    } catch {
      return failed(422, "keluaran autore sbom bukan JSON");
    }
    if (!isSbomPayload(data)) {
      return failed(422, "keluaran autore sbom tidak sesuai kontrak /api/sbom");
    }
    return { ok: true, status: 200, data };
  }

  return { get };
}

export type Sbom = ReturnType<typeof hatchSbom>;

