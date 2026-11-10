"use client";

import { Moon, MoreVertical, Palette, Sun, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Pengaturan tampilan ala Google Cloud Console: satu menu kebab di ujung kanan
 * topbar, bukan tombol toggle terpisah. Menu memuat satu item "Penampilan" yang
 * membuka modal berisi dua kartu tema.
 *
 * Modal memakai <dialog> native supaya Escape, jebakan fokus, dan backdrop
 * ditangani browser; klik di luar panel = klik pada elemen <dialog> itu sendiri.
 */
export function AppearanceMenu() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [menuTerbuka, setMenuTerbuka] = useState(false);
  const [modalTerbuka, setModalTerbuka] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const judulId = useId();

  // Tutup menu saat klik di luar atau Escape.
  useEffect(() => {
    if (!menuTerbuka) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuTerbuka(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuTerbuka(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuTerbuka]);

  // jsdom belum punya showModal, jadi atribut `open` jadi jalur cadangannya.
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (modalTerbuka) {
      if (typeof element.showModal === "function" && !element.open) element.showModal();
      else element.setAttribute("open", "");
    } else {
      element.close?.();
      element.removeAttribute("open");
    }
  }, [modalTerbuka]);

  const aktif = (resolvedTheme ?? theme) === "dark" ? "dark" : "light";

  const kartu = [
    { nilai: "light" as const, label: "Terang", Ikon: Sun },
    { nilai: "dark" as const, label: "Gelap", Ikon: Moon },
  ];

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Menu lainnya"
        aria-haspopup="menu"
        aria-expanded={menuTerbuka}
        onClick={() => setMenuTerbuka((buka) => !buka)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[#545F72] transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:text-white dark:hover:bg-[#353b43]"
      >
        <MoreVertical className="h-5 w-5" aria-hidden="true" />
      </button>

      {menuTerbuka ? (
        <div
          role="menu"
          aria-label="Menu aplikasi"
          className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-gray-200 bg-white p-1 shadow-lg dark:border-[#50638b] dark:bg-[#282c32]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuTerbuka(false);
              setModalTerbuka(true);
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-white dark:hover:bg-[#353b43]"
          >
            <Palette className="h-4 w-4" aria-hidden="true" />
            Penampilan
          </button>
        </div>
      ) : null}

      <dialog
        ref={dialogRef}
        aria-labelledby={judulId}
        onClose={() => setModalTerbuka(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setModalTerbuka(false);
        }}
        className="m-auto w-[min(26rem,92vw)] rounded-xl border border-[#50638b] bg-[#3c444e] p-5 text-white backdrop:bg-black/60"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={judulId} className="text-base font-semibold">
            Pilih Tema Tampilan
          </h2>
          <button
            type="button"
            aria-label="Tutup"
            onClick={() => setModalTerbuka(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {kartu.map(({ nilai, label, Ikon }) => {
            const dipilih = aktif === nilai;
            return (
              <button
                key={nilai}
                type="button"
                aria-pressed={dipilih}
                onClick={() => setTheme(nilai)}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 px-3 py-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  dipilih
                    ? "border-blue-500 bg-white/10 text-white"
                    : "border-white/20 text-white/80 hover:border-white/40 hover:text-white"
                }`}
              >
                <Ikon className="h-6 w-6" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </dialog>
    </div>
  );
}
