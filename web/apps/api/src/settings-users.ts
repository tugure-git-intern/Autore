import { parseAllowlistEnv, type EntriPengguna, type Role, type UsersPayload, type UsersSaveBody } from "@autore/contracts";
import { catatAudit, type BarisAudit } from "./audit";
import { bacaBerkas, jumlahAdmin, tulisBerkas, validasiEntri } from "./allowlist-berkas";
import { jalurAllowlist, type Identitas } from "./session";

/**
 * Halaman Pengaturan → Pengguna & Role: logika di luar HTTP, supaya route Hono
 * tetap tipis dan aturannya bisa diuji tanpa cookie. Batas keras (admin, rate
 * limit) dipasang di route; modul ini yang memutuskan bentuk data, revisi,
 * admin terakhir, dan jejak audit.
 */

export type HasilSimpan =
  | { ok: true; status: 200; backup: string; users: EntriPengguna[] }
  | { ok: false; status: 400 | 409 | 500; error: string };

export type UsersHandler = {
  baca(aktor: Identitas): Promise<UsersPayload>;
  simpan(aktor: Identitas, body: UsersSaveBody): Promise<HasilSimpan>;
};

const urutEntri = (peta: ReadonlyMap<string, Role>): EntriPengguna[] =>
  [...peta.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([login, role]) => ({ login, role }));

/** `AUTORE_ALLOWED_USERS` menimpa berkas; saat itu aktif, menulis berkas sia-sia. */
function dariEnv(): Map<string, Role> | null {
  const peta = parseAllowlistEnv(process.env.AUTORE_ALLOWED_USERS ?? "");
  return peta.size > 0 ? peta : null;
}

export function hatchSettings(
  options: { jalur?: () => string; audit?: (baris: BarisAudit) => Promise<void> } = {},
): UsersHandler {
  const jalur = options.jalur ?? (() => jalurAllowlist());
  const audit = options.audit ?? catatAudit;

  const catat = async (aktor: Identitas, target: string, exit: number) => {
    await audit({
      login: aktor.login,
      email: aktor.email,
      action: "settings-users",
      target,
      exit,
    });
  };

  return {
    async baca() {
      const env = dariEnv();
      if (env) {
        return { sumber: "env", bisaDiubah: false, revisi: "", users: urutEntri(env) };
      }
      const { peta, revisi } = await bacaBerkas(jalur());
      return { sumber: "berkas", bisaDiubah: true, revisi, users: urutEntri(peta) };
    },

    async simpan(aktor, body) {
      const env = dariEnv();
      if (env) {
        await catat(aktor, "users:env", 1);
        return {
          ok: false,
          status: 409,
          error:
            "Daftar pengguna diatur AUTORE_ALLOWED_USERS di unit API; ubah env itu, bukan berkas.",
        };
      }

      const bentuk = validasiEntri(body.users);
      if (!bentuk.ok) {
        await catat(aktor, "users:tidak-sah", 1);
        return { ok: false, status: 400, error: bentuk.error };
      }

      // Revisi basi = ada yang menyimpan lebih dulu. Menimpa diam-diam berarti
      // suntingan admin lain hilang tanpa jejak, jadi ditolak dan UI memuat ulang.
      const sekarang = await bacaBerkas(jalur());
      if (sekarang.revisi !== body.revisi) {
        await catat(aktor, "users:revisi-basi", 1);
        return { ok: false, status: 409, error: "Daftar berubah sejak dibuka; muat ulang lalu ulangi." };
      }

      if (jumlahAdmin(bentuk.peta) === 0) {
        await catat(aktor, "users:tanpa-admin", 1);
        return {
          ok: false,
          status: 400,
          error: "Minimal satu admin harus tersisa, kalau tidak tidak ada yang bisa membuka Pengaturan lagi.",
        };
      }

      let backup: string;
      try {
        backup = await tulisBerkas(bentuk.peta, jalur());
      } catch (error) {
        await catat(aktor, "users:tulis-gagal", 1);
        return { ok: false, status: 500, error: `Gagal menulis allowlist: ${String(error)}` };
      }

      await catat(aktor, `users:${bentuk.peta.size}`, 0);
      return { ok: true, status: 200, backup, users: urutEntri(bentuk.peta) };
    },
  };
}
