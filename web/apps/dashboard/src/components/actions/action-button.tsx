"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useKirimToast } from "@/components/toast";
import { runAction, goToLogin, type ActionKind } from "@/lib/actions-client";

export interface ActionConfirmation {
  title: string;
  /** Peringatan efek samping; ditampilkan merah karena bisa mengubah repo pengguna. */
  warning?: string;
  confirmLabel: string;
  /** Bila diisi, user harus mengetik ulang nama ini persis sebelum konfirmasi aktif. */
  requireTypedName?: string;
}

interface ActionButtonProps {
  label: string;
  action: ActionKind;
  /** Aplikasi yang jadi sasaran aksi. Deploy & scan sama-sama butuh ini: server
   *  tidak punya target cadangan, dan aksi tanpa id dijawab 400. */
  app: string;
  variant?: "primary" | "secondary";
  confirm?: ActionConfirmation;
  onDone?: () => void;
}

export function ActionButton({
  label,
  action,
  app,
  variant = "secondary",
  confirm,
  onDone,
}: ActionButtonProps) {
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  // Penjaga sinkron: state `pending` belum tentu sudah ter-commit saat Enter
  // ditekan berulang, sedangkan ref langsung. Mencegah aksi permanen terkirim dua kali.
  const mengirim = useRef(false);
  const titleId = useId();
  const inputId = useId();
  const kirimToast = useKirimToast();

  // Konfirmasi hanya aktif kalau nama diketik persis (tanpa trim): spasi di
  // ujung tetap dianggap belum cocok, sama seperti pengecekan server.
  const namaCocok = confirm?.requireTypedName === undefined || typed === confirm.requireTypedName;

  // showModal memberi jebakan fokus + Escape; jsdom belum punya, jadi atribut
  // `open` jadi jalur cadangannya (dan itu yang diuji).
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (typeof element.showModal === "function" && !element.open) element.showModal();
      else element.setAttribute("open", "");
    } else {
      element.close?.();
      element.removeAttribute("open");
    }
  }, [open]);

  /**
   * Pesannya pergi ke toast global, bukan ke paragraf di dalam sel tabel: baris
   * tabel tetap setinggi tombolnya, dan satu pesan gagal tidak mendorong layout.
   * Kemajuan sudah diucapkan `aria-busy` + label tombol, jadi tidak perlu toast.
   */
  async function dispatch() {
    if (mengirim.current) return;
    mengirim.current = true;
    setPending(true);
    const outcome = await runAction(
      action,
      app,
      confirm?.requireTypedName !== undefined ? typed : undefined,
    );
    setPending(false);
    mengirim.current = false;
    kirimToast(outcome.message, outcome.ok ? "sukses" : "gagal");
    onDone?.();
    // Pindah halaman setelah pesan terkirim: user sempat membaca alasannya.
    if (outcome.redirectTo) goToLogin(outcome.redirectTo);
  }

  return (
    <span className="inline-flex flex-col items-end gap-2">
      <Button
        variant={variant}
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          if (confirm) {
            setTyped("");
            setOpen(true);
          } else void dispatch();
        }}
      >
        {pending ? (
          <>
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            Menjalankan…
          </>
        ) : (
          label
        )}
      </Button>

      {confirm ? (
        <dialog
          ref={dialog}
          aria-labelledby={titleId}
          // Escape menutup dialog native tanpa lewat React: sinkronkan state
          // supaya klik Hapus berikutnya masih bisa membukanya.
          onClose={() => setOpen(false)}
          className="m-auto rounded-lg border border-gray-200 bg-white p-4 text-left backdrop:bg-black/30 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]"
        >
          {/* Isi dialog hanya saat terbuka: <dialog> tertutup memuat 14 input
              ber-aria-label mirip di halaman tabel, dan itu membuat locator
              `getByLabel` spek lama (mis. "Nama Aplikasi", "Batal") ambigu
              sekaligus mengotori pohon aksesibilitas. */}
          {open ? (
            <>
              <h2 id={titleId} className="text-sm font-semibold text-gray-900 dark:text-[var(--color-ink)]">
                {confirm.title}
              </h2>
              {confirm.warning ? (
                <p className="mt-2 max-w-sm text-xs font-medium text-red-600 dark:text-red-300">{confirm.warning}</p>
              ) : null}
              {confirm.requireTypedName !== undefined ? (
                <div className="mt-3">
                  <label htmlFor={inputId} className="block text-xs text-gray-700 dark:text-[var(--color-muted)]">
                    Ketik nama aplikasi untuk konfirmasi
                  </label>
                  <input
                    id={inputId}
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    // autoComplete off: nama app bukan data yang mau diisi browser.
                    autoComplete="off"
                    aria-label="Ketik nama aplikasi untuk konfirmasi"
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)] dark:text-[var(--color-ink)]"
                  />
                </div>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <Button onClick={() => setOpen(false)}>Batal</Button>
                <Button
                  variant="primary"
                  disabled={!namaCocok}
                  onClick={() => {
                    setOpen(false);
                    void dispatch();
                  }}
                >
                  {confirm.confirmLabel}
                </Button>
              </div>
            </>
          ) : null}
        </dialog>
      ) : null}
    </span>
  );
}
