import { createHash } from "node:crypto";
import { copyFile, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  normalizeLogin,
  parseAllowlist,
  parseRole,
  type EntriPengguna,
  type Role,
} from "@autore/contracts";

/**
 * Sisi tulis `allowed-users.json`. Pembacaan tetap milik `session.ts`
 * (`bacaAllowlist`, dibaca ulang tiap request); modul ini hanya yang dibutuhkan
 * halaman Pengaturan: baca mentah + revisi, validasi, tulis atomik.
 *
 * Aturan tulis:
 * - backup `.bak-<ISO>` dulu, karena isi lama adalah satu-satunya jalan pulang;
 * - tulis ke berkas sementara di folder yang sama, fsync, lalu rename: proses
 *   yang mati di tengah tidak pernah meninggalkan whitelist kosong (itu akan
 *   mengunci semua orang);
 * - bentuk berkas = peta login → role, sama seperti yang dibaca `parseAllowlist`.
 */

/** Login GitHub: huruf/angka, tanda hubung di tengah, maks 39 karakter. */
const LOGIN_SAH = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

export type HasilBacaBerkas = {
  /** Peta efektif isi berkas (entri tidak sah dibuang oleh `parseAllowlist`). */
  peta: Map<string, Role>;
  /** Sidik isi mentah; berubah kalau berkas disentuh siapa pun. */
  revisi: string;
  /** true = berkas belum ada (bukan galat; whitelist kosong). */
  baru: boolean;
};

export function sidik(isi: string): string {
  return createHash("sha256").update(isi).digest("hex").slice(0, 16);
}

export async function bacaBerkas(jalur: string): Promise<HasilBacaBerkas> {
  let isi: string;
  try {
    isi = await readFile(jalur, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { peta: new Map(), revisi: sidik(""), baru: true };
    }
    throw error;
  }
  return { peta: parseAllowlist(JSON.parse(isi) as unknown), revisi: sidik(isi), baru: false };
}

export type HasilValidasi = { ok: true; peta: Map<string, Role> } | { ok: false; error: string };

/**
 * Validasi daftar kiriman UI. Login dinormalkan lebih dulu (huruf kecil) supaya
 * `Alif` dan `alif` tidak bisa jadi dua entri; duplikat = ditolak, bukan
 * terakhir-menang. Role hanya dari `parseRole` — nilai asing tidak pernah
 * dinaikkan jadi admin.
 */
export function validasiEntri(entri: readonly EntriPengguna[]): HasilValidasi {
  const peta = new Map<string, Role>();
  for (const item of entri) {
    const login = normalizeLogin(String(item?.login ?? ""));
    if (!LOGIN_SAH.test(login)) {
      return { ok: false, error: `login tidak sah: "${String(item?.login ?? "")}"` };
    }
    const role = parseRole(item?.role);
    if (role === null) {
      return { ok: false, error: `role tidak dikenal untuk ${login}: "${String(item?.role)}"` };
    }
    if (peta.has(login)) return { ok: false, error: `login ganda: ${login}` };
    peta.set(login, role);
  }
  return { ok: true, peta };
}

export function jumlahAdmin(peta: ReadonlyMap<string, Role>): number {
  let n = 0;
  for (const role of peta.values()) if (role === "admin") n += 1;
  return n;
}

/**
 * Tulis atomik + backup. Mengembalikan jalur backup supaya UI bisa menyebutnya
 * (transparan: admin tahu ada jalan pulang).
 */
export async function tulisBerkas(peta: ReadonlyMap<string, Role>, jalur: string): Promise<string> {
  const urut = [...peta.entries()].sort(([a], [b]) => a.localeCompare(b));
  const isi = `${JSON.stringify(Object.fromEntries(urut), null, 2)}\n`;
  const backup = `${jalur}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  try {
    await copyFile(jalur, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const sementara = join(dirname(jalur), `.${Date.now()}.allowed-users.tmp`);
  const berkas = await open(sementara, "w", 0o644);
  try {
    await berkas.writeFile(isi, "utf8");
    await berkas.sync();
  } finally {
    await berkas.close();
  }
  try {
    await rename(sementara, jalur);
  } catch (error) {
    await rm(sementara, { force: true });
    throw error;
  }
  return backup;
}
