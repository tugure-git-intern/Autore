import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { catatAplikasi } from "./registry";
import { promisify } from "node:util";
import { argvQuickStart, repoDariOutput, type QuickStartInput } from "./quick-start";
import { loadDashboardStatus, type RunAutore } from "./status";

const execFileAsync = promisify(execFile);

export type SpawnResult = { exitCode: number; stdout: string; stderr: string };
export type SpawnOptions = {
  shell: false;
  timeout: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
};
/** Menyelesaikan hasil untuk exit code apa pun; melempar dengan `code` "ETIMEDOUT"/"ENOENT" saat gagal jalan. */
export type SpawnAction = (file: string, args: string[], options: SpawnOptions) => Promise<SpawnResult>;

export type ActionKind = "deploy" | "scan" | "quick-start";

export type ActionResult =
  | {
      ok: true;
      status: 200;
      action: ActionKind;
      target: string;
      /** Hanya quick-start: URL repo GitHub yang dibaca dari keluaran CLI. */
      repo?: string;
      output: string;
    }
  | { ok: false; status: 400 | 404 | 409 | 422 | 503 | 504; error: string; output?: string };

/** Id aplikasi dari registry: cukup ketat untuk menolak "/", "..", spasi, dan NUL. */
const APP_ID = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_OUTPUT = 4_000;
const MAX_BUFFER = 1024 * 1024;
const TIMEOUT: Record<ActionKind, number> = { deploy: 180_000, scan: 60_000, "quick-start": 180_000 };

/**
 * Cangkang tipis di atas `execFile`: satu tempat yang tahu cara menerjemahkan
 * exit code, timeout, dan perintah-hilang menjadi hasil/kegagalan yang bisa dibaca.
 * `shell: false` di sini bukan pilihan gaya — argv tidak pernah lewat shell.
 */
export async function spawnAutore(
  file: string,
  args: string[],
  options: SpawnOptions,
): Promise<SpawnResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      shell: options.shell,
      timeout: options.timeout,
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: unknown;
      killed?: boolean;
      signal?: string | null;
      stdout?: string;
      stderr?: string;
    };
    if (failure.killed || failure.signal) {
      throw Object.assign(new Error(`${file} melewati batas waktu`), { code: "ETIMEDOUT" });
    }
    if (typeof failure.code === "number") {
      return { exitCode: failure.code, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
    }
    throw Object.assign(new Error(`gagal menjalankan ${file}`), { code: failure.code ?? "ESPAWN" });
  }
}

function capped(text: string): string {
  return text.length <= MAX_OUTPUT ? text : text.slice(0, MAX_OUTPUT);
}

function failed(status: 400 | 404 | 409 | 422 | 503 | 504, error: string, output?: string): ActionResult {
  return output === undefined ? { ok: false, status, error } : { ok: false, status, error, output };
}

export type Actions = ReturnType<typeof hatchActions>;

/**
 * Aksi yang boleh dijalankan dashboard. TypeScript tidak pernah menyusun argv dari
 * teks yang datang dari browser: id aplikasi hanya dipakai sebagai kunci pencarian,
 * dan path selalu dibentuk di sini dari `workspace` yang dikonfigurasi unit.
 */
/** Aplikasi dianggap nyata kalau CLI meninggalkan foldernya di workspace. */
async function folderAda(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Aplikasi yang dibuat lewat dashboard WAJIB masuk `registry.tsv`, karena daftar
 * aplikasi di dashboard dibaca dari file itu. Gagal mencatat tidak boleh
 * menyembunyikan hasil aksinya, jadi pesannya cuma ditempel ke keluaran.
 */
async function catatKeRegistry(workspace: string, dir: string, nama: string): Promise<string> {
  if (!(await folderAda(dir))) return "";
  try {
    return `terdaftar di registry (port ${await catatAplikasi(workspace, nama)})`;
  } catch (error) {
    return `gagal menambah "${nama}" ke registry.tsv: ${String(error)}`;
  }
}

export function hatchActions(deps: {
  workspace: string;
  run: RunAutore;
  spawn: SpawnAction;
  deployApp: string;
  bin?: string;
}) {
  const bin = deps.bin || process.env.AUTORE_BIN || "autore";
  const workspace = deps.workspace.trim();
  const deployApp = deps.deployApp.trim();
  // Satu lock untuk semua aksi: dua git push/deploy bersamaan ke repo yang sama
  // bukan sesuatu yang bisa diselamatkan di sisi klien.
  let busy: ActionKind | null = null;

  async function resolveTarget(
    id: string,
  ): Promise<{ ok: true; dir: string } | { ok: false; status: 400 | 404 | 503; error: string }> {
    if (!APP_ID.test(id)) {
      return { ok: false, status: 400, error: `id aplikasi tidak sah: ${JSON.stringify(id)}` };
    }

    let listed: string[];
    try {
      const status = await loadDashboardStatus(deps.run);
      // Data basi berarti `autore status` sedang gagal: untuk aksi yang mengubah
      // sistem, daftar lama tidak cukup — lebih baik menolak daripada menebak.
      if (status.stale) {
        return { ok: false, status: 503, error: "daftar aplikasi basi (autore status gagal)" };
      }
      listed = status.data.applications.map((app) => app.id);
    } catch {
      return { ok: false, status: 503, error: "daftar aplikasi tidak bisa dibaca dari autore status" };
    }
    if (!listed.includes(id)) {
      return { ok: false, status: 404, error: `aplikasi "${id}" tidak terdaftar` };
    }

    // Lapis ketiga: path hasil gabungan tetap harus satu tingkat di bawah workspace.
    const dir = join(workspace, id);
    if (dirname(resolve(dir)) !== resolve(workspace)) {
      return { ok: false, status: 400, error: `path aplikasi keluar dari workspace: ${id}` };
    }
    try {
      if (!(await stat(dir)).isDirectory()) {
        return { ok: false, status: 404, error: `direktori aplikasi "${id}" bukan direktori` };
      }
    } catch {
      return { ok: false, status: 404, error: `direktori aplikasi "${id}" tidak ditemukan` };
    }
    return { ok: true, dir };
  }

  async function run(kind: ActionKind, appId?: string): Promise<ActionResult> {
    if (!workspace) {
      return failed(503, "AUTORE_WORKSPACE belum diset di unit API");
    }

    const id = kind === "deploy" ? deployApp : (appId ?? "").trim();
    if (!id) {
      return kind === "deploy"
        ? failed(503, "target deploy belum dikonfigurasi (AUTORE_DEPLOY_APP)")
        : failed(400, "body harus memuat app id aplikasi yang akan dipindai");
    }
    if (busy) {
      return failed(409, `aksi ${busy} masih berjalan, tunggu sampai selesai`);
    }

    busy = kind;
    try {
      const target = await resolveTarget(id);
      if (!target.ok) return failed(target.status, target.error);

      const args =
        kind === "deploy"
          ? ["deploy", "--path", target.dir]
          : ["scan", "--no-docker", "--path", target.dir];

      let res: SpawnResult;
      try {
        res = await deps.spawn(bin, args, {
          shell: false,
          timeout: TIMEOUT[kind],
          cwd: workspace,
          // Tanpa TTY, git tidak boleh menggantung menunggu password.
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        return code === "ETIMEDOUT"
          ? failed(504, `aksi ${kind} melewati batas waktu ${TIMEOUT[kind] / 1000} detik`)
          : failed(503, `gagal menjalankan perintah autore: ${String(code ?? error)}`);
      }

      const output = capped([res.stdout.trim(), res.stderr.trim()].filter(Boolean).join("\n"));
      return res.exitCode === 0
        ? { ok: true, status: 200, action: kind, target: id, output }
        : failed(422, `aksi ${kind} keluar dengan kode ${res.exitCode}`, output);
    } finally {
      busy = null;
    }
  }

  /**
   * Alur 1-klik: kerangka pipeline, repo GitHub, push, daftar ke Jenkins, build pertama.
   * Lock `busy` dipakai bersama deploy/scan - dua push ke repo yang sama tidak bisa
   * diselamatkan di sisi klien.
   */
  async function quickStart(input: QuickStartInput): Promise<ActionResult> {
    if (!workspace) {
      return failed(503, "AUTORE_WORKSPACE belum diset di unit API");
    }
    if (busy) {
      return failed(409, `aksi ${busy} masih berjalan, tunggu sampai selesai`);
    }

    const dir = join(workspace, input.nama);
    if (dirname(resolve(dir)) !== resolve(workspace)) {
      return failed(400, `nama aplikasi keluar dari workspace: ${input.nama}`);
    }
    try {
      if ((await stat(dir)).isDirectory()) {
        return failed(409, `folder aplikasi "${input.nama}" sudah ada di workspace`);
      }
    } catch {
      // Belum ada: itu keadaan yang diinginkan.
    }

    busy = "quick-start";
    try {
      let res: SpawnResult;
      try {
        res = await deps.spawn(bin, argvQuickStart(workspace, input), {
          shell: false,
          timeout: TIMEOUT["quick-start"],
          cwd: workspace,
          env: {
            ...process.env,
            // Tanpa TTY, git tidak boleh menggantung menunggu password.
            GIT_TERMINAL_PROMPT: "0",
            AUTORE_PROGRESS: "json",
          },
        });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "ETIMEDOUT") {
          return failed(
            504,
            `quick-start melewati batas waktu ${TIMEOUT["quick-start"] / 1000} detik. ` +
              "Prosesnya mungkin masih jalan di Jenkins - periksa daftar pipeline sebelum mengulang.",
          );
        }
        return failed(503, `gagal menjalankan perintah autore: ${String(code ?? error)}`);
      }

      const catatan = await catatKeRegistry(workspace, dir, input.nama);
      const output = capped(
        [res.stdout.trim(), res.stderr.trim(), catatan].filter(Boolean).join("\n"),
      );
      return res.exitCode === 0
        ? {
            ok: true,
            status: 200,
            action: "quick-start",
            target: input.nama,
            repo: repoDariOutput(output),
            output,
          }
        : failed(422, `quick-start keluar dengan kode ${res.exitCode}`, output);
    } finally {
      busy = null;
    }
  }

  return { run, quickStart };
}
