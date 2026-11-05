"use client";

import { Loader2, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { goToLogin } from "@/lib/actions-client";
import { STACK, namaSah, runQuickStart, type Kode, type Stack } from "@/lib/quick-start-client";
import { Toast, type JenisToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

const LABEL_STACK: Record<Stack, string> = {
  python: "Python",
  nodejs: "Node.js",
  java: "Java",
  go: "Go",
};

/**
 * Aksi paling berbahaya di dashboard: `autore quick-start` membuat repo GitHub
 * PUBLIK, push kode, lalu mendaftarkan job Jenkins dan memicu build pertama —
 * semuanya tidak bisa dibatalkan. Karena itu dua langkah: isi formulir dulu,
 * lalu ketik ulang nama aplikasi sebagai konfirmasi ganda.
 */
export function QuickStartDialog({ onSelesai }: { onSelesai?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const judulId = useId();
  const [terbuka, setTerbuka] = useState(false);
  const [nama, setNama] = useState("");
  const [stack, setStack] = useState<Stack>("nodejs");
  const [kode, setKode] = useState<Kode>("contoh");
  const [langkah, setLangkah] = useState<1 | 2>(1);
  const [konfirmasi, setKonfirmasi] = useState("");
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<{ jenis: JenisToast; pesan: string } | null>(null);

  const namaBersih = nama.trim();
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

  function tutup() {
    setTerbuka(false);
    setLangkah(1);
    setKonfirmasi("");
    setPending(false);
  }

  async function kirim() {
    setPending(true);
    setToast(null);
    const hasil = await runQuickStart({ nama: namaBersih, stack, kode });
    setPending(false);
    setToast({ jenis: hasil.ok ? "sukses" : "gagal", pesan: hasil.message });

    if (hasil.redirectTo) {
      goToLogin(hasil.redirectTo);
      return;
    }
    if (hasil.ok) {
      tutup();
      setNama("");
      onSelesai?.();
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-2">
      <Button variant="primary" onClick={() => setTerbuka(true)} disabled={pending}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Buat Aplikasi Baru
      </Button>

      {toast ? (
        <Toast jenis={toast.jenis} pesan={toast.pesan} onTutup={() => setToast(null)} />
      ) : null}

      <dialog
        ref={dialog}
        aria-labelledby={judulId}
        className="m-auto w-[min(30rem,92vw)] rounded-lg border border-gray-200 p-5 text-left shadow-lg backdrop:bg-black/40"
      >
        <h2 id={judulId} className="text-base font-semibold text-ink">
          {langkah === 1 ? "Buat Aplikasi Baru" : "Konfirmasi pembuatan aplikasi"}
        </h2>

        {langkah === 1 ? (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="qs-nama" className="text-sm font-medium text-ink">
                Nama Aplikasi
              </label>
              <input
                id="qs-nama"
                value={nama}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setNama(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
              />
              {namaBersih !== "" && !namaSah(namaBersih) ? (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  Nama aplikasi tidak sah. Pakai huruf kecil/angka di awal, boleh `-` dan `_`
                  (contoh: coba-web).
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="qs-stack" className="text-sm font-medium text-ink">
                Bahasa
              </label>
              <select
                id="qs-stack"
                value={stack}
                onChange={(e) => setStack(e.target.value as Stack)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {STACK.map((pilihan) => (
                  <option key={pilihan} value={pilihan}>
                    {LABEL_STACK[pilihan]}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={kode === "contoh"}
                onChange={(e) => setKode(e.target.checked ? "contoh" : "kosong")}
              />
              Isi kode contoh (tanpa centang: repo kosong)
            </label>

            <div className="flex justify-end gap-2">
              <Button onClick={tutup}>Batal</Button>
              <Button variant="primary" disabled={!namaSah(namaBersih)} onClick={() => setLangkah(2)}>
                Lanjut
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              Aplikasi ini akan membuat repository PUBLIK di GitHub.
            </p>

            <dl className="space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 text-muted">Nama</dt>
                <dd className="font-mono text-ink">{namaBersih}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-muted">Bahasa</dt>
                <dd className="text-ink">{LABEL_STACK[stack]}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-muted">Isi kode</dt>
                <dd className="text-ink">{kode === "contoh" ? "Kode contoh" : "Repo kosong"}</dd>
              </div>
            </dl>

            <p className="text-sm text-muted">
              Langkah ini tidak bisa dibatalkan: repo GitHub, push kode, job Jenkins, dan build
              pertama dijalankan sekaligus.
            </p>

            <div>
              <label htmlFor="qs-konfirmasi" className="text-sm font-medium text-ink">
                Ketik nama aplikasi untuk konfirmasi
              </label>
              <input
                id="qs-konfirmasi"
                value={konfirmasi}
                autoComplete="off"
                spellCheck={false}
                placeholder={namaBersih}
                onChange={(e) => setKonfirmasi(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
              />
            </div>

            {pending ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Sedang membuat repo di GitHub dan mendaftarkan ke Jenkins… (maks 180 detik)
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
                    Membuat…
                  </>
                ) : (
                  "Buat Aplikasi"
                )}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </span>
  );
}
