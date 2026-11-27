"use client";

import { Check, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useBahasa } from "./bahasa-provider";
import type { Bahasa, KunciTerjemah } from "@/lib/i18n";

/**
 * Bendera digambar sebagai SVG inline, bukan emoji: emoji bendera tidak dirender
 * di Windows (muncul jadi huruf "ID"/"GB"), dan berkas gambar akan jadi aset
 * yang harus diunggah. Dua bendera = 20 baris, ukurannya ikut kotaknya.
 */
function BenderaIndonesia() {
  return (
    <svg
      data-testid="bendera-id"
      viewBox="0 0 3 2"
      role="img"
      aria-label="Bendera Indonesia"
      className="h-full w-full"
    >
      <rect width="3" height="1" fill="#CE1126" />
      <rect y="1" width="3" height="1" fill="#FFFFFF" />
    </svg>
  );
}

function BenderaInggris({ klipId }: { klipId: string }) {
  return (
    <svg
      data-testid="bendera-en"
      viewBox="0 0 60 30"
      role="img"
      aria-label="Union Jack"
      className="h-full w-full"
    >
      <clipPath id={klipId}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
      <path
        d="M0,0 L60,30 M60,0 L0,30"
        clipPath={`url(#${klipId})`}
        stroke="#C8102E"
        strokeWidth="4"
      />
      <path d="M30,0 v30 M0,15 h60" stroke="#FFFFFF" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

/** Pilihan tetap: urutannya Indonesia lalu Inggris, sesuai bahasa bawaan. */
const PILIHAN: { nilai: Bahasa; nama: KunciTerjemah; sub: KunciTerjemah }[] = [
  { nilai: "id", nama: "bahasa.indonesia", sub: "bahasa.subIndonesia" },
  { nilai: "en", nama: "bahasa.inggris", sub: "bahasa.subInggris" },
];

/**
 * Modal pemilih bahasa, tampil dari item "Bahasa" di menu kebab topbar —
 * tepat di bawah "Penampilan", dan memakai chrome modal yang sama.
 */
export function PemilihBahasa({ terbuka, onTutup }: { terbuka: boolean; onTutup: () => void }) {
  const { bahasa, setBahasa, t } = useBahasa();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const judulId = useId();
  const klipId = `bendera-uk-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (terbuka) {
      if (typeof element.showModal === "function" && !element.open) element.showModal();
      else element.setAttribute("open", "");
    } else {
      element.close?.();
      element.removeAttribute("open");
    }
  }, [terbuka]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={judulId}
      onClose={onTutup}
      onClick={(event) => {
        if (event.target === event.currentTarget) onTutup();
      }}
      className="m-auto w-[92vw] max-w-xl rounded-xl border border-[#50638b] bg-[#3c444e] p-6 text-white backdrop:bg-black/60"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={judulId} className="text-base font-semibold">
          {t("bahasa.judul")}
        </h2>
        <button
          type="button"
          aria-label={t("tampilan.tutup")}
          onClick={onTutup}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div
        role="radiogroup"
        aria-labelledby={judulId}
        className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {PILIHAN.map(({ nilai, nama, sub }) => {
          const dipilih = bahasa === nilai;
          return (
            <button
              key={nilai}
              type="button"
              role="radio"
              aria-checked={dipilih}
              onClick={() => setBahasa(nilai)}
              className={`flex flex-col gap-3 rounded-lg border-2 p-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                dipilih
                  ? "border-blue-500 bg-white/10 text-white ring-1 ring-blue-500"
                  : "border-white/20 text-white/85 hover:border-white/40 hover:text-white"
              }`}
            >
              <span
                aria-hidden="true"
                className="block h-16 w-full overflow-hidden rounded-md border border-white/25"
              >
                {nilai === "id" ? <BenderaIndonesia /> : <BenderaInggris klipId={klipId} />}
              </span>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    dipilih ? "border-blue-400" : "border-white/50"
                  }`}
                >
                  {dipilih ? <Check className="h-3 w-3 text-blue-400" /> : null}
                </span>
                {t(nama)}
              </span>
              <span className="text-xs font-normal text-white/75">{t(sub)}</span>
            </button>
          );
        })}
      </div>
    </dialog>
  );
}
