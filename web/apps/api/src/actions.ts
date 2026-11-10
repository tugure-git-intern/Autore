import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { catatAudit, type PencatatAudit } from "./audit";
import { bacaRegistry, catatAplikasi } from "./registry";
import { promisify } from "node:util";
import { argvQuickStart, repoDariOutput, type QuickStartInput } from "./quick-start";
import type { Identitas } from "./session";
import { loadDashboardStatus, resetStatusCache, type RunAutore } from "./status";

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
    return `terdaftar di registry (port ${await catatAplikasi(workspace, nama, { dir })})`;
  } catch (error) {
    return `gagal menambah "${nama}" ke registry.tsv: ${String(error)}`;
  }
}

/**
 * Argv `deploy`: target selalu per-aplikasi (lihat `run`), dan identitas sesi —
 * kalau ada — jadi author commit di repo aplikasi (audit trail). Tanpa identitas
 * CLI memakai bot `Autore CLI` supaya pemakaian dari terminal tidak berubah.
 */
export function argvDeploy(dir: string, author?: Identitas): string[] {
  const args = ["deploy", "--path", dir];
  if (author) args.push("--author-name", author.nama, "--author-email", author.email);
  return args;
}

export function hatchActions(deps: {
  workspace: string;
  run: RunAutore;
  spawn: SpawnAction;
  bin?: string;
  /** Jejak aksi; default menulis JSONL ke `~/.local/state/autore/audit.log`. */
  audit?: PencatatAudit;
}) {
  const bin = deps.bin || process.env.AUTORE_BIN || "autore";
  const workspace = deps.workspace.trim();
  const audit = deps.audit ?? catatAudit;
  // Satu lock untuk semua aksi: dua git push/deploy bersamaan ke repo yang sama
  // bukan sesuatu yang bisa diselamatkan di sisi klien.
  const busyByTarget = new Map<string, ActionKind>();
  let busyQuickStart = false;

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
      const isiRegistry = await readFile(join(workspace, "registry.tsv"), "utf8").catch(() => "");
      const terdaftar = bacaRegistry(isiRegistry).map((item) => item.nama);
      if (!terdaftar.includes(id)) {
        return { ok: false, status: 404, error: `aplikasi "${id}" tidak terdaftar` };
      }
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

  async function run(
    kind: ActionKind,
    appId?: string,
    author?: Identitas,
  ): Promise<ActionResult> {
    if (!workspace) {
      return failed(503, "AUTORE_WORKSPACE belum diset di unit API");
    }

    // Target selalu dari permintaan: tidak ada aplikasi yang ditentukan server, karena
    // tombol di dashboard selalu menunjuk aplikasi yang sedang dibuka.
    const id = (appId ?? "").trim();
    if (!id) {
      return failed(
        400,
        kind === "deploy"
          ? "body harus memuat app id aplikasi yang akan di-deploy"
          : "body harus memuat app id aplikasi yang akan dipindai",
      );
    }
    if (busyQuickStart) {
      return failed(409, "aksi quick-start masih berjalan, tunggu sampai selesai");
    }
    const sedang = busyByTarget.get(id);
    if (sedang) {
      return failed(409, `aksi ${sedang} masih berjalan, tunggu sampai selesai`);
    }

    busyByTarget.set(id, kind);
    try {
      const target = await resolveTarget(id);
      if (!target.ok) return failed(target.status, target.error);

      const args =
        kind === "deploy"
          ? argvDeploy(target.dir, author)
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
      // Dicatat sebelum hasil dikembalikan, termasuk saat gagal: "siapa menekan
      // tombol" harus tetap ada walau deploy-nya berakhir 422.
      resetStatusCache();
      await audit({
        login: author?.login ?? "",
        email: author?.email ?? "",
        action: kind,
        target: id,
        exit: res.exitCode,
      });
      return res.exitCode === 0
        ? { ok: true, status: 200, action: kind, target: id, output }
        : failed(422, `aksi ${kind} keluar dengan kode ${res.exitCode}`, output);
    } finally {
      busyByTarget.delete(id);
    }
  }

  /**
   * Alur 1-klik: kerangka pipeline, repo GitHub, push, daftar ke Jenkins, build pertama.
   * Lock `busy` dipakai bersama deploy/scan - dua push ke repo yang sama tidak bisa
   * diselamatkan di sisi klien.
   *
   * `author` = identitas dari sesi dashboard; jadi author commit di repo (audit trail).
   */
  async function quickStart(input: QuickStartInput, author?: Identitas): Promise<ActionResult> {
    if (!workspace) {
      return failed(503, "AUTORE_WORKSPACE belum diset di unit API");
    }
    if (busyQuickStart || busyByTarget.size > 0) {
      const berjalan = busyQuickStart ? "quick-start" : busyByTarget.values().next().value!;
      return failed(409, `aksi ${berjalan} masih berjalan, tunggu sampai selesai`);
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

    busyQuickStart = true;
    try {
      let res: SpawnResult;
      try {
        res = await deps.spawn(bin, argvQuickStart(workspace, input, author), {
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
      resetStatusCache();
      const output = capped(
        [res.stdout.trim(), res.stderr.trim(), catatan].filter(Boolean).join("\n"),
      );
      await audit({
        login: author?.login ?? "",
        email: author?.email ?? "",
        action: "quick-start",
        target: input.nama,
        exit: res.exitCode,
      });
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
      busyQuickStart = false;
    }
  }

  return { run, quickStart };
}
