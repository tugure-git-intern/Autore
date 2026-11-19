"use client";

import { Link2, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { goToLogin } from "@/lib/actions-client";
import { namaRepo, repoSah, runConnect } from "@/lib/connect-client";
import { namaSah } from "@/lib/quick-start-client";
import { Toast, type JenisToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

/**
 * `autore connect` menulis ke repo GitHub milik dev (commit Dockerfile/Jenkinsfile)
 * lalu mendaftarkan job Jenkins. Commit di repo orang lain tidak bisa ditarik ulang
 * dari dashboard, jadi formulir dulu, lalu ketik ulang nama aplikasi sebagai
 * konfirmasi ganda — sama seperti Buat Aplikasi Baru.
 */
export function ConnectDialog({ onSelesai }: { onSelesai?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const judulId = useId();
  const [terbuka, setTerbuka] = useState(false);
  const [repo, setRepo] = useState("");
  const [nama, setNama] = useState("");
  const [branch, setBranch] = useState("main");
  const [langkah, setLangkah] = useState<1 | 2>(1);
  const [konfirmasi, setKonfirmasi] = useState("");
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<{ jenis: JenisToast; pesan: string } | null>(null);
  /** Nama aplikasi mengikuti URL repo sampai dev mengubahnya sendiri. */
  const [namaDiubah, setNamaDiubah] = useState(false);

  const repoBersih = repo.trim();
  const namaBersih = nama.trim();
  const branchBersih = branch.trim() || "main";
  const siap = repoSah(repoBersih) && namaSah(namaBersih);
  const cocok = konfirmasi.trim() === namaBersih && namaBersih !== "";

  // showModal memberi jebakan fokus + Escape; jsdom belum punya, jadi atribut
  // `open` jadi jalur cadangannya (dan itu yang diuji).
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (terbuka) {
      if (typeof el.showModal === "function" && !el.open) el.showModal();
      else el.setAttribute("open", "");
    } else {
      el.close?.();
      el.removeAttribute("open");
    }
  }, [terbuka]);

  function ubahRepo(nilai: string) {
    setRepo(nilai);
    if (!namaDiubah) setNama(namaRepo(nilai));
  }

  function tutup() {
    setTerbuka(false);
    setLangkah(1);
    setKonfirmasi("");
    setPending(false);
  }

  async function kirim() {
    setPending(true);
    setToast(null);
    const hasil = await runConnect({ repo: repoBersih, nama: namaBersih, branch: branchBersih });
    setPending(false);
    setToast({ jenis: hasil.ok ? "sukses" : "gagal", pesan: hasil.message });

    if (hasil.redirectTo) {
      goToLogin(hasil.redirectTo);
      return;
    }
    if (hasil.ok) {
      tutup();
      setRepo("");
      setNama("");
      setNamaDiubah(false);
      setBranch("main");
      onSelesai?.();
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-2">
      <Button onClick={() => setTerbuka(true)} disabled={pending}>
        <Link2 className="h-4 w-4" aria-hidden="true" />
        Sambungkan Repo
      </Button>

      {toast ? (
        <Toast jenis={toast.jenis} pesan={toast.pesan} onTutup={() => setToast(null)} />
      ) : null}

      <dialog
        ref={dialog}
        aria-labelledby={judulId}
        className="m-auto w-[min(30rem,92vw)] rounded-lg border border-gray-200 bg-white p-5 text-left shadow-lg backdrop:bg-black/40 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)] backdrop:dark:bg-black/60"
      >
        {terbuka ? (
          <>
          <h2 id={judulId} className="text-base font-semibold text-ink">
            {langkah === 1 ? "Sambungkan Repo yang Sudah Ada" : "Konfirmasi penyambungan repo"}
          </h2>

          {langkah === 1 ? (
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="cn-repo" className="text-sm font-medium text-ink">
                  URL Repo GitHub
                </label>
                <input
                  id="cn-repo"
                  value={repo}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://github.com/tugure-reasuransi/autore-demo"
                  onChange={(e) => ubahRepo(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)]"
                />
                {repoBersih !== "" && !repoSah(repoBersih) ? (
                  <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-300">
                    Pakai URL https://github.com/&lt;owner&gt;/&lt;nama&gt; tanpa token dan tanpa SSH.
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="cn-nama" className="text-sm font-medium text-ink">
                  Nama Aplikasi
                </label>
                <input
                  id="cn-nama"
                  value={nama}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setNamaDiubah(true);
                    setNama(e.target.value);
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)]"
                />
                {namaBersih !== "" && !namaSah(namaBersih) ? (
                  <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-300">
                    Nama aplikasi tidak sah. Pakai huruf kecil/angka di awal, boleh `-` dan `_`.
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="cn-branch" className="text-sm font-medium text-ink">
                  Branch
                </label>
                <input
                  id="cn-branch"
                  value={branch}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setBranch(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)]"
                />
                <p className="mt-1 text-xs text-muted">
                  Kalau repo memakai branch utama lain (mis. master), isi di sini.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button onClick={tutup}>Batal</Button>
                <Button variant="primary" disabled={!siap} onClick={() => setLangkah(2)}>
                  Lanjut
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                Autore akan mengirim commit berisi Dockerfile/Jenkinsfile ke repo ini, lalu membuat
                job Jenkins dan memicu build pertama.
              </p>

              <dl className="space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="w-28 text-muted">Repo</dt>
                  <dd className="break-all font-mono text-ink">{repoBersih}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-muted">Nama</dt>
                  <dd className="font-mono text-ink">{namaBersih}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-muted">Branch</dt>
                  <dd className="font-mono text-ink">{branchBersih}</dd>
                </div>
              </dl>

              <p className="text-sm text-muted">
                Dockerfile/Jenkinsfile yang sudah ada di repo dipakai apa adanya — tidak ditimpa.
              </p>

              <div>
                <label htmlFor="cn-konfirmasi" className="text-sm font-medium text-ink">
                  Ketik nama aplikasi untuk konfirmasi
                </label>
                <input
                  id="cn-konfirmasi"
                  value={konfirmasi}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={namaBersih}
                  onChange={(e) => setKonfirmasi(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)]"
                />
              </div>

              {pending ? (
                <p role="status" className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Sedang clone, push, dan mendaftarkan ke Jenkins… (maks 180 detik)
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button disabled={pending} onClick={() => setLangkah(1)}>
                  Kembali
                </Button>
                <Button
                  variant="primary"
                  disabled={!cocok || pending}
                  aria-busy={pending}
                  onClick={() => void kirim()}
                >
                  {pending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Menyambungkan…
                    </>
                  ) : (
                    "Sambungkan Sekarang"
                  )}
                </Button>
              </div>
            </div>
          )}
          </>
        ) : null}
      </dialog>
    </span>
  );
}
