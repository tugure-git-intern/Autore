/**
 * Validasi & argv untuk aksi dashboard "Sambungkan Repo" (`autore connect`).
 *
 * Pola sama dengan `quick-start.ts`: tidak ada teks browser yang masuk argv
 * selain nilai yang sudah lolos whitelist di sini, argv disusun sebagai array,
 * dan identitas author datang dari sesi — bukan dari body.
 */

import type { Identitas } from "./session";
import { STACK_SAH, type Stack } from "./quick-start";

/** Sama persis dengan `validate_app_name` di cli/src/templates.rs. */
const NAMA_APP = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Hanya https github.com tanpa kredensial/path tambahan — sama dengan parse_repo_url di cli/src/connect.rs. */
const REPO_GITHUB = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/;

/** Nama branch git yang aman dijadikan satu elemen argv. */
const BRANCH_SAH = /^[A-Za-z0-9._/-]{1,100}$/;

export type ConnectInput = { repo: string; nama: string; branch: string; stack?: Stack };

export type HasilBacaConnect =
  | { ok: true; nilai: ConnectInput }
  | { ok: false; error: string };

const KUNCI_BODY = new Set(["repo", "nama", "stack", "branch"]);

function isStack(nilai: unknown): nilai is Stack {
  return typeof nilai === "string" && (STACK_SAH as readonly string[]).includes(nilai);
}

/** URL repo dinormalkan: `.git` dibuang supaya argv dan tampilan konsisten. */
function bacaRepo(mentah: unknown): { ok: true; url: string; nama: string } | { ok: false; error: string } {
  if (typeof mentah !== "string") return { ok: false, error: "repo harus berupa string URL GitHub" };
  const url = mentah.trim();
  if (url.includes("..")) return { ok: false, error: "URL repo tidak boleh memuat '..'" };
  const cocok = url.match(REPO_GITHUB);
  if (!cocok) {
    return {
      ok: false,
      error: "repo harus https://github.com/<owner>/<nama> (tanpa token, tanpa SSH, tanpa path tambahan)",
    };
  }
  return { ok: true, url: `https://github.com/${cocok[1]}/${cocok[2]}`, nama: cocok[2] };
}

/**
 * Body wajib `{"repo": "https://github.com/<owner>/<nama>"}`; `nama`, `stack`,
 * dan `branch` opsional. Kunci lain ditolak supaya permintaan salah bentuk tidak
 * pernah jadi spawn.
 */
export function bacaBodyConnect(body: unknown): HasilBacaConnect {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body harus JSON {"repo":"https://github.com/<owner>/<nama>"}' };
  }

  const record = body as Record<string, unknown>;
  for (const kunci of Object.keys(record)) {
    if (!KUNCI_BODY.has(kunci)) {
      return { ok: false, error: `body hanya boleh memuat kunci repo, nama, stack, branch (ada "${kunci}")` };
    }
  }

  const repo = bacaRepo(record.repo);
  if (!repo.ok) return repo;

  let nama = repo.nama;
  if (record.nama !== undefined) {
    if (typeof record.nama !== "string") return { ok: false, error: "nama harus berupa string" };
    nama = record.nama.trim();
    if (!NAMA_APP.test(nama)) {
      return {
        ok: false,
        error:
          "nama aplikasi tidak sah: 1-63 karakter, huruf kecil/angka di awal, sisanya huruf kecil, angka, '-' atau '_'",
      };
    }
  }

  let branch = "main";
  if (record.branch !== undefined) {
    if (typeof record.branch !== "string") return { ok: false, error: "branch harus berupa string" };
    branch = record.branch.trim();
    if (!BRANCH_SAH.test(branch) || branch.includes("..") || branch.startsWith("-")) {
      return { ok: false, error: "branch tidak sah: hanya huruf, angka, titik, garis bawah, garis miring, dan strip (maks 100 karakter)" };
    }
  }

  if (record.stack !== undefined && !isStack(record.stack)) {
    return {
      ok: false,
      error: `stack harus salah satu dari ${STACK_SAH.join(", ")} (dikirim: ${JSON.stringify(record.stack)})`,
    };
  }

  const nilai: ConnectInput = { repo: repo.url, nama, branch };
  if (record.stack !== undefined) nilai.stack = record.stack as Stack;
  return { ok: true, nilai };
}

/** Argv tetap: `--path` selalu workspace dari unit, bukan dari pemanggil. */
export function argvConnect(workspace: string, nilai: ConnectInput, author?: Identitas): string[] {
  const args = [
    "connect",
    "--path",
    workspace,
    "--repo",
    nilai.repo,
    "--app-name",
    nilai.nama,
    "--branch",
    nilai.branch,
  ];
  // Tanpa --stack, CLI menebak dari isi repo (go.mod, package.json, pom.xml, ...).
  if (nilai.stack) args.push("--stack", nilai.stack);
  if (author) args.push("--author-name", author.nama, "--author-email", author.email);
  return args;
}

/** Awalan baris data `progress::tahap` di CLI (cli/src/progress.rs). */
const PENANDA_TAHAP = "@@AUTORE ";

/**
 * Tahap terakhir yang dilaporkan CLI sebagai gagal, mis. `"jenkins"`.
 *
 * CLI menulis satu baris JSON per tahap hanya saat `AUTORE_PROGRESS=json` (API yang
 * menyalakannya). Tanpa ini pesan 422 hanya berisi kode keluar, padahal user perlu tahu
 * tahap mana yang harus diulang — push sukses tapi Jenkins gagal bukan kegagalan yang sama
 * dengan clone gagal.
 */
export function tahapGagalDariOutput(output: string): string | undefined {
  let gagal: string | undefined;
  for (const baris of output.split("\n")) {
    const isi = baris.trim();
    if (!isi.startsWith(PENANDA_TAHAP)) continue;
    try {
      const data = JSON.parse(isi.slice(PENANDA_TAHAP.length)) as { tahap?: unknown; status?: unknown };
      if (data.status === "gagal" && typeof data.tahap === "string" && data.tahap) gagal = data.tahap;
    } catch {
      // Baris potong (keluaran dipotong MAX_OUTPUT) bukan alasan menggagalkan permintaan.
    }
  }
  return gagal;
}
