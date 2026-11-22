"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Settings, ShieldCheck } from "lucide-react";
import { PERAN_UI, parseRole, type Role, type UsersPayload } from "@autore/contracts";
import { PageTabHeader } from "@/components/ui/page-tab-header";
import { useKirimToast } from "@/components/toast";
import { GalatPengaturan, fetchUsers, simpanUsers } from "@/lib/settings-client";

/**
 * Halaman Pengaturan → Pengguna & Role (tahap 1). Halaman ini menjaga dirinya
 * sendiri: role non-admin yang membuka langsung diblokir sebelum daftar
 * dimuat — menyembunyikan menu bukan proteksi. Penegakan sebenarnya ada di API
 * (`/api/settings/users` butuh role admin untuk GET maupun PUT).
 */

/** Baris satu pengguna dalam tabel sunting. `role` dijamin nilai PERAN_UI. */
type Baris = { login: string; role: Role };

const keBaris = (users: UsersPayload["users"]): Baris[] =>
  users.map((u) => ({ login: u.login, role: u.role }));

export default function SettingsPage() {
  const kirimToast = useKirimToast();
  const [awal, setAwal] = useState<UsersPayload | null>(null);
  const [baris, setBaris] = useState<Baris[]>([]);
  const [revisi, setRevisi] = useState("");
  const [sumber, setSumber] = useState<"berkas" | "env" | null>(null);
  const [loginBaru, setLoginBaru] = useState("");
  const [roleBaru, setRoleBaru] = useState<Role>("dev");
  const [menyimpan, setMenyimpan] = useState(false);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [ditolak, setDitolak] = useState(false);
  const sinyalRef = useRef<AbortController | null>(null);

  const muat = useCallback(async () => {
    sinyalRef.current?.abort();
    const sinyal = new AbortController();
    sinyalRef.current = sinyal;
    setMemuat(true);
    setGalat(null);
    try {
      const payload = await fetchUsers(sinyal.signal);
      setAwal(payload);
      setBaris(keBaris(payload.users));
      setRevisi(payload.revisi);
      setSumber(payload.sumber);
      setDitolak(false);
    } catch (err) {
      if (sinyal.signal.aborted) return;
      if (err instanceof GalatPengaturan && err.status === 403) setDitolak(true);
      setGalat(err instanceof Error ? err.message : "Gagal memuat pengguna.");
    } finally {
      if (!sinyal.signal.aborted) setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muat();
    return () => sinyalRef.current?.abort();
  }, [muat]);

  const kotor = useMemo(
    () => JSON.stringify(keBaris(awal?.users ?? [])) !== JSON.stringify(baris),
    [awal, baris],
  );

  const ubahRole = (login: string, nilai: string) => {
    const role = parseRole(nilai);
    if (role === null) return;
    setBaris((dulu) => dulu.map((b) => (b.login === login ? { ...b, role } : b)));
  };

  const hapus = (login: string) => setBaris((dulu) => dulu.filter((b) => b.login !== login));

  const tambah = () => {
    const login = loginBaru.trim().toLowerCase();
    if (!login || baris.some((b) => b.login === login)) return;
    setBaris((dulu) => [...dulu, { login, role: roleBaru }]);
    setLoginBaru("");
  };

  const simpan = async () => {
    setMenyimpan(true);
    try {
      const { backup } = await simpanUsers({
        revisi,
        users: baris.map((b) => ({ login: b.login, role: b.role })),
      });
      kirimToast(backup ? `Tersimpan. Backup: ${backup}` : "Tersimpan.", "sukses");
      await muat();
    } catch (err) {
      // 409 (revisi basi / env menimpa) dan 400 (tanpa admin) dijelaskan oleh
      // server: tampilkan kalimatnya dan muat ulang keadaan sebenarnya.
      kirimToast(err instanceof Error ? err.message : "Gagal menyimpan.", "gagal");
      await muat();
    } finally {
      setMenyimpan(false);
    }
  };

  if (ditolak) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-4">
        <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]">
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
            <ShieldCheck className="h-5 w-5 text-red-600 dark:text-red-300" aria-hidden="true" />
            Akses ditolak
          </h1>
          <p className="mt-2 text-sm text-muted">
            Halaman Pengguna &amp; Role hanya untuk admin. Role akun ini bukan admin.
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="space-y-0">
      <PageTabHeader
        title="Pengaturan — Pengguna &amp; Role"
        description="Siapa yang boleh masuk dashboard dan perannya. Minimal satu admin harus tersisa."
        icon={Settings}
        action={
          <button
            type="button"
            onClick={muat}
            disabled={memuat}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)] dark:hover:bg-[var(--bg-canvas)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${memuat ? "animate-spin" : ""}`} />
            Muat Ulang
          </button>
        }
      />

      <div className="rounded-b-xl bg-white p-5 sm:rounded-b-2xl dark:bg-[var(--bg-canvas)]">
        {sumber === "env" ? (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
            Daftar pengguna sedang diatur lewat <code>AUTORE_ALLOWED_USERS</code> di unit API. Perubahan
            di halaman ini tidak akan tersimpan selama env itu aktif.
          </div>
        ) : null}

        {galat ? (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200">
            <div className="text-sm">
              <p className="font-semibold">Gagal memuat pengguna</p>
              <p className="mt-1 text-xs text-rose-700 dark:text-rose-200">{galat}</p>
              <button type="button" onClick={muat} className="mt-3 rounded border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:bg-transparent dark:text-rose-200">
                Coba Lagi
              </button>
            </div>
          </div>
        ) : null}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-[var(--color-muted)]">
              <th scope="col" className="pb-2">Login GitHub</th>
              <th scope="col" className="pb-2">Role</th>
              <th scope="col" className="pb-2"><span className="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody>
            {baris.map((b) => (
              <tr key={b.login} className="border-t border-gray-100 dark:border-[var(--color-line)]">
                <td className="py-2 font-mono text-xs">{b.login}</td>
                <td className="py-2">
                  <select
                    aria-label={`Role untuk ${b.login}`}
                    value={b.role}
                    onChange={(e) => ubahRole(b.login, e.target.value)}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)]"
                  >
                    {PERAN_UI.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => hapus(b.login)}
                    className="text-xs text-red-600 hover:underline dark:text-red-300"
                  >
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={loginBaru}
            onChange={(e) => setLoginBaru(e.target.value)}
            placeholder="login-github"
            aria-label="Login GitHub baru"
            className="w-56 rounded-md border border-gray-200 bg-white px-3 py-1.5 font-mono text-xs dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)]"
          />
          <select
            aria-label="Role baru"
            value={roleBaru}
            onChange={(e) => {
              const role = parseRole(e.target.value);
              if (role !== null) setRoleBaru(role);
            }}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)]"
          >
            {PERAN_UI.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={tambah}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:hover:bg-[var(--bg-canvas)]"
          >
            Tambah
          </button>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={simpan}
            disabled={menyimpan || !kotor || sumber === "env"}
            className="inline-flex h-9 items-center rounded-md bg-[#273a52] px-4 text-sm font-medium text-[#eaedf3] hover:opacity-90 disabled:opacity-50 dark:bg-[#c9d9f2] dark:text-[#282c32]"
          >
            {menyimpan ? "Menyimpan…" : "Simpan"}
          </button>
          <span className="text-xs text-muted">
            Simpan tidak merusak berkas walau server mati di tengah. Salinan lama otomatis
            dibuat (<code>allowed-users.json.bak-*</code>), dan izin baru langsung berlaku tanpa perlu
            login ulang — menu sidebar baru mengikuti setelah dashboard di-restart.
          </span>
        </div>
      </div>
    </div>
  );
}
