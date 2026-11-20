import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { catatAudit, type PencatatAudit } from "./audit";
import { bacaRegistry, catatAplikasi } from "./registry";
import { aksiBerjalan, ambilKunci, pemegangKunci } from "./kunci";
import { promisify } from "node:util";
import { argvQuickStart, peringatanDariOutput, repoDariOutput, type QuickStartInput } from "./quick-start";
import { argvConnect, type ConnectInput } from "./connect";
import { argvHapusApp, bersihkanAnsi } from "./hapus-app";
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

export type ActionKind = "deploy" | "scan" | "quick-start" | "connect" | "remove";

/**
 * Jenis aksi yang dijalankan lewat `run` (tanpa lock khusus quick-start/connect).
 * Tipe sempit + tabel dispatch: tanpa itu jenis asing (mis. "remove") lolos ke
 * `else` dan diam-diam menjalankan scan.
 */
export type KindJalankan = "deploy" | "scan";

export type ActionResult =
  | {
      ok: true;
      status: 200;
      action: ActionKind;
      target: string;
      /** Hanya quick-start/connect: URL repo GitHub yang dibaca dari keluaran CLI. */
      repo?: string;
      /** Hanya quick-start/connect: peringatan CLI (mis. repo belum punya /health), bila ada. */
      peringatan?: string;
      output: string;
    }
  | { ok: false; status: 400 | 404 | 409 | 422 | 503 | 504; error: string; output?: string };

/** Id aplikasi dari registry: cukup ketat untuk menolak "/", "..", spasi, dan NUL. */
const APP_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Nama app dari `registry.tsv` mentah: kolom pertama tiap baris, tanpa syarat
 * kolom lain ada atau portnya angka. `bacaRegistry` membuang baris legacy dan
 * baris ber-port rusak, sedangkan CLI `hapus-app` justru menghapus baris seperti
 * itu — daftar ini yang dipakai gerbang hapus supaya API tidak lebih ketat
 * daripada CLI, dan app paling perlu dibersihkan tidak malah ditolak.
 */
function namaDiRegistry(isi: string): string[] {
  return isi
    .split("\n")
    .map((baris) => baris.split("\t")[0].trim())
    .filter((nama) => nama !== "");
}

const MAX_OUTPUT = 4_000;
const MAX_BUFFER = 1024 * 1024;
const TIMEOUT: Record<ActionKind, number> = {
  deploy: 180_000,
  scan: 60_000,
  "quick-start": 180_000,
  connect: 180_000,
  remove: 120_000,
};

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

type PerakitArgv = (dir: string, author?: Identitas) => string[];

const ARGV_JALANKAN: Record<KindJalankan, PerakitArgv> = {
  deploy: (dir, author) => argvDeploy(dir, author),
  scan: (dir) => ["scan", "--no-docker", "--path", dir],
};

export function hatchActions(deps: {
  workspace: string;
  run: RunAutore;
  spawn: SpawnAction;
  bin?: string;
  /** Jejak aksi; default menulis JSONL ke `~/.local/state/autore/audit.log`. */
  audit?: PencatatAudit;
  /** Org tujuan repo baru; default dari `AUTORE_DEFAULT_ORG`. */
  orgBawaan?: string;
}) {
  const bin = deps.bin || process.env.AUTORE_BIN || "autore";
  const orgBawaan = (deps.orgBawaan ?? process.env.AUTORE_DEFAULT_ORG ?? "").trim();
  const workspace = deps.workspace.trim();
  const audit = deps.audit ?? catatAudit;
  // Kunci tulis tinggal di kunci.ts supaya deploy, scan, quick-start, dan approval
  // berbagi SATU ruang kunci per aplikasi (K2) — bukan satu map per modul, yang
  // akan membuat approve dan deploy bisa menyentuh aplikasi sama bersamaan.

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

  /**
   * App dianggap ada untuk keperluan hapus kalau punya baris `registry.tsv` ATAU
   * muncul di `autore status`. Folder TIDAK diperiksa: app yatim (folder sudah
   * hilang) justru yang paling perlu dibersihkan, sedangkan `resolveTarget` akan
   * menolaknya.
   *
   * "tidak-ada" hanya disimpulkan bila KEDUA sumber terbaca. Registry gagal dibaca
   * atau status gagal = kita tidak tahu; menjawab 404 di keadaan itu menyuruh user
   * percaya app-nya sudah hilang padahal mungkin masih ada.
   */
  type KeberadaanApp = "ada" | "tidak-ada" | "tidak-bisa-dipastikan";

  async function keberadaanApp(id: string): Promise<KeberadaanApp> {
    let namaRegistry: string[] = [];
    let registryTerbaca = true;
    try {
      namaRegistry = namaDiRegistry(await readFile(join(workspace, "registry.tsv"), "utf8"));
    } catch (error) {
      // ENOENT = workspace belum pernah menulis registry, jadi "terbaca kosong".
      registryTerbaca = (error as { code?: unknown }).code === "ENOENT";
    }
    if (namaRegistry.includes(id)) return "ada";

    const namaStatus = await loadDashboardStatus(deps.run)
      .then((status) => status.data.applications.map((app) => app.id))
      .catch(() => null);
    if (namaStatus?.includes(id)) return "ada";
    return registryTerbaca && namaStatus ? "tidak-ada" : "tidak-bisa-dipastikan";
  }

  async function run(
    kind: KindJalankan,
    appId?: string,
    author?: Identitas,
  ): Promise<ActionResult> {
    if (!workspace) {
      return failed(503, "AUTORE_WORKSPACE belum diset di unit API");
    }

    // Tipe sempit tidak menahan teks asing saat runtime (rute bisa mengirim apa
    // saja): jenis di luar tabel ditolak sebelum kunci diambil atau CLI dijalankan.
    const rakitan = (ARGV_JALANKAN as Record<string, PerakitArgv>)[kind];
    if (!rakitan) {
      return failed(400, `jenis aksi "${kind}" tidak dikenal`);
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
    // quick-start menyentuh registry dan Jenkins, bukan cuma satu folder: aturan
    // lama (aksi lain menunggu selama quick-start jalan) dipertahankan.
    const globalsedang = aksiBerjalan();
    if (globalsedang === "quick-start" || globalsedang === "connect") {
      return failed(409, `aksi ${globalsedang} masih berjalan, tunggu sampai selesai`);
    }
    const sedang = pemegangKunci(id);
    if (sedang) {
      return failed(409, `aksi ${sedang} masih berjalan, tunggu sampai selesai`);
    }

    const lepas = ambilKunci(id, kind);
    if (!lepas) {
      return failed(409, `aksi ${pemegangKunci(id) ?? kind} masih berjalan, tunggu sampai selesai`);
    }
    try {
      const target = await resolveTarget(id);
      if (!target.ok) return failed(target.status, target.error);

      const args = rakitan(target.dir, author);

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
        // `exit: -1` = tidak pernah ada exit code dari CLI. Jejak tetap dicatat:
        // percobaan yang gagal jalan justru yang paling perlu ditelusuri.
        await audit({
          login: author?.login ?? "",
          email: author?.email ?? "",
          action: kind,
          target: id,
          exit: -1,
        });
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
      lepas();
    }
  }

  /**
   * Alur 1-klik: kerangka pipeline, repo GitHub, push, daftar ke Jenkins, build pertama.
   * Lock `busy` dipakai bersama deploy/scan - dua push ke repo yang sama tidak bisa
   * diselamatkan di sisi klien.
   *
   * `author` = identitas dari sesi dashboard; jadi author commit di repo (audit trail).
   */
  async function buatBaru(
    kind: "quick-start" | "connect",
    nama: string,
    args: string[],
    author?: Identitas,
  ): Promise<ActionResult> {
    if (!workspace) {
      return failed(503, "AUTORE_WORKSPACE belum diset di unit API");
    }
    const berjalan = aksiBerjalan();
    if (berjalan) {
      return failed(409, `aksi ${berjalan} masih berjalan, tunggu sampai selesai`);
    }

    const dir = join(workspace, nama);
    if (dirname(resolve(dir)) !== resolve(workspace)) {
      return failed(400, `nama aplikasi keluar dari workspace: ${nama}`);
    }
    try {
      if ((await stat(dir)).isDirectory()) {
        return failed(409, `folder aplikasi "${nama}" sudah ada di workspace`);
      }
    } catch {
      // Belum ada: itu keadaan yang diinginkan.
    }

    // Kunci per aplikasi (K2): aplikasi lama atau sedang deploy juga ikut menahan
    // nama ini. Spawn yang benar-benar jalan sudah ditolak `aksiBerjalan` di atas.
    const lepas = ambilKunci(nama, kind);
    if (!lepas) {
      return failed(
        409,
        `aksi ${pemegangKunci(nama) ?? kind} masih berjalan, tunggu sampai selesai`,
      );
    }
    try {
      let res: SpawnResult;
      try {
        res = await deps.spawn(bin, args, {
          shell: false,
          timeout: TIMEOUT[kind],
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
            `${kind} melewati batas waktu ${TIMEOUT[kind] / 1000} detik. ` +
              "Prosesnya mungkin masih jalan di Jenkins - periksa daftar pipeline sebelum mengulang.",
          );
        }
        return failed(503, `gagal menjalankan perintah autore: ${String(code ?? error)}`);
      }

      const catatan = await catatKeRegistry(workspace, dir, nama);
      const peringatan = peringatanDariOutput(res.stdout);
      resetStatusCache();
      const output = capped(
        [res.stdout.trim(), res.stderr.trim(), catatan].filter(Boolean).join("\n"),
      );
      await audit({
        login: author?.login ?? "",
        email: author?.email ?? "",
        action: kind,
        target: nama,
        exit: res.exitCode,
      });
      return res.exitCode === 0
        ? {
            ok: true,
            status: 200,
            action: kind,
            target: nama,
            repo: repoDariOutput(output),
            ...(peringatan ? { peringatan } : {}),
            output,
          }
        : failed(422, `${kind} keluar dengan kode ${res.exitCode}`, output);
    } finally {
      lepas();
    }
  }

  async function quickStart(input: QuickStartInput, author?: Identitas): Promise<ActionResult> {
    // Org kosong berarti org bawaan unit, bukan akun pemilik token. Connect tidak
    // ikut: repo itu sudah ada di GitHub, jadi pemiliknya tidak ditentukan di sini.
    const nilai = orgBawaan && !input.org ? { ...input, org: orgBawaan } : input;
    return buatBaru("quick-start", nilai.nama, argvQuickStart(workspace, nilai, author), author);
  }

  /** Repo dev yang sudah ada: clone → pipeline bila belum ada → push → daftar Jenkins. */
  async function connect(input: ConnectInput, author?: Identitas): Promise<ActionResult> {
    return buatBaru("connect", input.nama, argvConnect(workspace, input, author), author);
  }

  /**
   * Hapus app permanen: job Jenkins + container + baris registry + folder.
   *
   * Beda dari deploy/scan, folder app boleh SUDAH hilang (app yatim) — jadi
   * `resolveTarget` tidak dipakai, ia menuntut folder ada. Keberadaan app cukup
   * dibuktikan lewat `appTerdaftar` (registry atau `autore status`).
   *
   * `konfirmasi` wajib sama persis dengan nama app: aksi permanen, salah ketik
   * harus berhenti sebelum CLI dipanggil.
   */
  async function remove(app: string, konfirmasi: string, author?: Identitas): Promise<ActionResult> {
    if (!workspace) {
      return failed(503, "AUTORE_WORKSPACE belum diset di unit API");
    }

    const id = (app ?? "").trim();
    if (!APP_ID.test(id)) {
      return failed(400, `id aplikasi tidak sah: ${JSON.stringify(id)}`);
    }
    if (konfirmasi !== id) {
      return failed(400, `konfirmasi tidak sama dengan nama aplikasi: ${JSON.stringify(konfirmasi)}`);
    }
    // remove menyentuh registry + Jenkins seperti quick-start, jadi aksi tulis
    // mana pun yang sedang berjalan cukup alasan untuk menolak.
    const berjalan = aksiBerjalan();
    if (berjalan) {
      return failed(409, `aksi ${berjalan} masih berjalan, tunggu sampai selesai`);
    }
    const sedang = pemegangKunci(id);
    if (sedang) {
      return failed(409, `aksi ${sedang} masih berjalan, tunggu sampai selesai`);
    }

    const lepas = ambilKunci(id, "remove");
    if (!lepas) {
      return failed(409, `aksi ${pemegangKunci(id) ?? "remove"} masih berjalan, tunggu sampai selesai`);
    }
    try {
      const ada = await keberadaanApp(id);
      if (ada === "tidak-bisa-dipastikan") {
        return failed(
          503,
          `tidak bisa memastikan keberadaan aplikasi "${id}": registry atau autore status gagal dibaca`,
        );
      }
      if (ada === "tidak-ada") {
        return failed(404, `aplikasi "${id}" tidak terdaftar`);
      }
      // Lapis path: gabungan tetap satu tingkat di bawah workspace (menahan "..").
      const dir = join(workspace, id);
      if (dirname(resolve(dir)) !== resolve(workspace)) {
        return failed(400, `path aplikasi keluar dari workspace: ${id}`);
      }

      let res: SpawnResult;
      try {
        res = await deps.spawn(bin, argvHapusApp(id, konfirmasi), {
          shell: false,
          timeout: TIMEOUT.remove,
          cwd: workspace,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        // Hapus itu permanen: walau CLI tidak sempat jalan, jejak "siapa menekan
        // tombol" harus ada (`exit: -1` = tidak pernah ada exit code dari CLI).
        await audit({
          login: author?.login ?? "",
          email: author?.email ?? "",
          action: "remove",
          target: id,
          exit: -1,
        });
        return code === "ETIMEDOUT"
          ? failed(504, `aksi remove melewati batas waktu ${TIMEOUT.remove / 1000} detik`)
          : failed(503, `gagal menjalankan perintah autore: ${String(code ?? error)}`);
      }

      // Keluaran hapus-app berwarna (escape ANSI + simbol ✔/✖): bersihkan dulu
      // supaya dashboard tidak menerima kode escape mentah.
      const output = capped(
        bersihkanAnsi([res.stdout.trim(), res.stderr.trim()].filter(Boolean).join("\n")),
      );
      resetStatusCache();
      await audit({
        login: author?.login ?? "",
        email: author?.email ?? "",
        action: "remove",
        target: id,
        exit: res.exitCode,
      });
      return res.exitCode === 0
        ? { ok: true, status: 200, action: "remove", target: id, output }
        : failed(422, `aksi remove keluar dengan kode ${res.exitCode}`, output);
    } finally {
      lepas();
    }
  }

  return { run, quickStart, connect, remove };
}
