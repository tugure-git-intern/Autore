"use client";

import { MoreVertical, Palette, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";

const KUNCI_KONTRAS = "autore-high-contrast";

type Mode = "light" | "dark" | "system";

/** Satu lembar miniatur dashboard: bar atas, rel kiri, tiga baris teks palsu. */
function LembarMini({ gelap }: { gelap: boolean }) {
  const latar = gelap ? "bg-[#282c32]" : "bg-white";
  const bar = gelap ? "bg-[#3c444e]" : "bg-gray-200";
  const rel = gelap ? "bg-[#353b43]" : "bg-[#F0F5FE]";
  const garis = gelap ? "bg-[#50638b]" : "bg-gray-200";
  const garisTebal = gelap ? "bg-gray-400" : "bg-gray-300";

  return (
    <div className={`flex h-full w-full flex-col p-2 ${latar}`}>
      <div className={`h-2 w-full rounded-sm ${bar}`} />
      <div className="mt-1.5 flex flex-1 gap-1.5">
        <div className={`w-1/4 rounded-sm ${rel}`} />
        <div className="flex flex-1 flex-col justify-center gap-1.5 px-1">
          <div className={`h-1.5 w-3/4 rounded-sm ${garisTebal}`} />
          <div className={`h-1.5 w-full rounded-sm ${garis}`} />
          <div className={`h-1.5 w-5/6 rounded-sm ${garis}`} />
          <div className={`h-1.5 w-2/3 rounded-sm ${garis}`} />
        </div>
      </div>
    </div>
  );
}

function Pratinjau({ mode }: { mode: Mode }) {
  if (mode === "light") {
    return (
      <div
        data-testid="preview-light"
        aria-hidden="true"
        className="h-24 w-full overflow-hidden rounded-md border border-white/20 bg-white"
      >
        <LembarMini gelap={false} />
      </div>
    );
  }
  if (mode === "dark") {
    return (
      <div
        data-testid="preview-dark"
        aria-hidden="true"
        className="h-24 w-full overflow-hidden rounded-md border border-[#50638b] bg-[#282c32]"
      >
        <LembarMini gelap={true} />
      </div>
    );
  }
  // Ikuti Sistem: belah diagonal kiri-atas terang, kanan-bawah gelap.
  return (
    <div
      data-testid="preview-system"
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden rounded-md border border-[#50638b]"
    >
      <div
        data-testid="preview-half"
        className="absolute inset-0"
        style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
      >
        <LembarMini gelap={false} />
      </div>
      <div
        data-testid="preview-half"
        className="absolute inset-0"
        style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
      >
        <LembarMini gelap={true} />
      </div>
    </div>
  );
}

/**
 * Pengaturan tampilan ala Google Cloud Console: menu kebab di topbar memuat item
 * "Penampilan" yang membuka modal tiga kartu radio (Terang, Gelap, Ikuti Sistem)
 * dengan miniatur UI + sakelar Kontras Tinggi di bawahnya.
 */
export function AppearanceMenu() {
  const { theme, setTheme } = useTheme();
  const [menuTerbuka, setMenuTerbuka] = useState(false);
  const [modalTerbuka, setModalTerbuka] = useState(false);
  const [kontrasTinggi, setKontrasTinggi] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const judulId = useId();

  useEffect(() => {
    const tersimpan = window.localStorage.getItem(KUNCI_KONTRAS) === "1";
    setKontrasTinggi(tersimpan);
    document.documentElement.classList.toggle("high-contrast", tersimpan);
  }, []);

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

  const ubahKontras = () => {
    const baru = !kontrasTinggi;
    setKontrasTinggi(baru);
    window.localStorage.setItem(KUNCI_KONTRAS, baru ? "1" : "0");
    document.documentElement.classList.toggle("high-contrast", baru);
  };

  const aktif: Mode =
    theme === "dark" || theme === "system" || theme === "light" ? theme : "light";

  const pilihan: { nilai: Mode; label: string }[] = [
    { nilai: "light", label: "Terang" },
    { nilai: "dark", label: "Gelap" },
    { nilai: "system", label: "Ikuti Sistem" },
  ];

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Menu lainnya"
        aria-haspopup="menu"
        aria-expanded={menuTerbuka}
        onClick={() => setMenuTerbuka((buka) => !buka)}
        className="inline-flex h-11 w-8 -mr-1 items-center justify-center rounded-md text-[#545F72] transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:text-white dark:hover:bg-[#353b43]"
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
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
        className="m-auto w-[92vw] max-w-xl rounded-xl border border-[#50638b] bg-[#3c444e] p-6 text-white backdrop:bg-black/60"
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

        <div
          role="radiogroup"
          aria-labelledby={judulId}
          className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {pilihan.map(({ nilai, label }) => {
            const dipilih = aktif === nilai;
            return (
              <button
                key={nilai}
                type="button"
                role="radio"
                aria-checked={dipilih}
                onClick={() => setTheme(nilai)}
                className={`flex flex-col gap-3 rounded-lg border-2 p-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  dipilih
                    ? "border-blue-500 bg-white/10 text-white ring-1 ring-blue-500"
                    : "border-white/20 text-white/85 hover:border-white/40 hover:text-white"
                }`}
              >
                <Pratinjau mode={nilai} />
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      dipilih ? "border-blue-400" : "border-white/50"
                    }`}
                  >
                    {dipilih ? <span className="h-2 w-2 rounded-full bg-blue-400" /> : null}
                  </span>
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/15 pt-4">
          <div>
            <p id={`${judulId}-kontras`} className="text-sm font-medium text-white">
              Kontras Tinggi
            </p>
            <p className="mt-0.5 text-xs text-white/75">
              Meningkatkan kontras antara teks dan latar belakang.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-labelledby={`${judulId}-kontras`}
            aria-checked={kontrasTinggi}
            onClick={ubahKontras}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
              kontrasTinggi
                ? "border-blue-400 bg-blue-500"
                : "border-white/30 bg-[#282c32]"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                kontrasTinggi ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </dialog>
    </div>
  );
}
