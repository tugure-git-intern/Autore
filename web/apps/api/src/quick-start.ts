/**
 * Validasi & argv untuk aksi dashboard "Buat Aplikasi Baru" (`autore quick-start`).
 *
 * Tidak ada teks dari browser yang masuk ke argv selain tiga nilai di bawah, dan
 * ketiganya sudah diloloskan whitelist/regex di sini. Argv disusun di server
 * sebagai array — `quick-start.ts` tidak pernah menyentuh shell.
 *
 * Identitas author (audit trail) juga bukan dari browser: nilainya datang dari
 * sesi Auth.js, jadi dipanggil dari pemanggil (`argvQuickStart`) bukan dari body.
 */

import type { Identitas } from "./session";

/** Sama persis dengan `validate_app_name` di cli/src/templates.rs:227. */
const NAMA_APP = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export const STACK_SAH = ["python", "nodejs", "java", "go"] as const;
export type Stack = (typeof STACK_SAH)[number];

export const KODE_SAH = ["contoh", "kosong"] as const;
export type Kode = (typeof KODE_SAH)[number];

export type QuickStartInput = { nama: string; stack: Stack; kode: Kode; org?: string };

/** Cermin `validate_org_name` CLI: boleh huruf besar dan titik, tetap satu elemen argv. */
const NAMA_ORG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/;

export type HasilBaca =
  | { ok: true; nilai: QuickStartInput }
  | { ok: false; error: string };

/** Nama field yang boleh ada di body: sisanya ditolak, bukan diabaikan diam-diam. */
const KUNCI_BODY = new Set(["nama", "stack", "kode", "org"]);

function isStack(nilai: unknown): nilai is Stack {
  return typeof nilai === "string" && (STACK_SAH as readonly string[]).includes(nilai);
}

function isKode(nilai: unknown): nilai is Kode {
  return typeof nilai === "string" && (KODE_SAH as readonly string[]).includes(nilai);
}

/**
 * Body wajib `{"nama": "...", "stack": "python|nodejs|java|go", "kode": "contoh|kosong"}`;
 * `kode` boleh tidak dikirim (default `contoh` — repo kosong membuat build pertama gagal).
 * Kunci lain ditolak supaya permintaan yang salah bentuk tidak pernah jadi spawn.
 */
export function bacaBodyQuickStart(body: unknown): HasilBaca {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body harus JSON {"nama":"...","stack":"python|nodejs|java|go"}' };
  }

  const record = body as Record<string, unknown>;
  for (const kunci of Object.keys(record)) {
    if (!KUNCI_BODY.has(kunci)) {
      return { ok: false, error: `body hanya boleh memuat kunci nama, stack, kode, org (ada "${kunci}")` };
    }
  }

  const namaMentah = record.nama;
  if (typeof namaMentah !== "string") {
    return { ok: false, error: "nama harus berupa string" };
  }
  const nama = namaMentah.trim();
  if (!NAMA_APP.test(nama)) {
    return {
      ok: false,
      error:
        "nama aplikasi tidak sah: 1-63 karakter, huruf kecil/angka di awal, sisanya huruf kecil, angka, '-' atau '_'",
    };
  }

  if (!isStack(record.stack)) {
    return {
      ok: false,
      error: `stack harus salah satu dari ${STACK_SAH.join(", ")} (dikirim: ${JSON.stringify(record.stack)})`,
    };
  }

  const kodeMentah = record.kode === undefined ? "contoh" : record.kode;
  if (!isKode(kodeMentah)) {
    return {
      ok: false,
      error: `kode harus salah satu dari ${KODE_SAH.join(", ")} (dikirim: ${JSON.stringify(record.kode)})`,
    };
  }

  let org: string | undefined;
  if (record.org !== undefined) {
    if (typeof record.org !== "string") return { ok: false, error: "org harus berupa string" };
    const bersih = record.org.trim();
    if (!NAMA_ORG.test(bersih)) {
      return {
        ok: false,
        error:
          "org tidak sah: 1-39 karakter, huruf/angka di awal, sisanya huruf, angka, '.', '-' atau '_'",
      };
    }
    org = bersih;
  }

  return { ok: true, nilai: { nama, stack: record.stack, kode: kodeMentah, ...(org ? { org } : {}) } };
}

/** Argv tetap: `--path` selalu workspace dari unit, bukan dari pemanggil. */
export function argvQuickStart(workspace: string, nilai: QuickStartInput, author?: Identitas): string[] {
  const args = [
    "quick-start",
    "--path",
    workspace,
    "--app-name",
    nilai.nama,
    "--stack",
    nilai.stack,
    "--kode",
    nilai.kode,
  ];
  // Identitas author hanya datang dari sesi (lihat `identitasDariToken`), tidak
  // pernah dari body. Tanpa sesi, CLI memakai identitas bot bawaannya.
  if (author) args.push("--author-name", author.nama, "--author-email", author.email);
  // Org hanya dikirim kalau diisi: tanpa flag, CLI membuat repo di akun pemilik token.
  if (nilai.org) args.push("--org", nilai.org);
  return args;
}

/** CLI mencetak `• Repo GitHub <owner>/<nama> (baru dibuat|sudah ada)`. */
const BARIS_REPO = /\bRepo GitHub\s+([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)/;

export function repoDariOutput(output: string): string {
  const bersih = output.replace(/\u001b\[[0-9;]*m/g, "");
  // `match`, bukan `exec`: gate keamanan pra-commit menandai panggilan `.exec(` sebagai exec() shell.
  const cocok = bersih.match(BARIS_REPO);
  return cocok ? `https://github.com/${cocok[1]}` : "";
}
