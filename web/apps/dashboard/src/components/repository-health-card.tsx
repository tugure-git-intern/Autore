import { Medal } from "lucide-react";
import type { RepositoryHealth } from "@/lib/contracts";
import { AnimatedNumber } from "./ui/animated-number";

/**
 * Kartu kesehatan repo memakai pola `StatCard` (ikon di kiri judul, tinggi baris
 * judul dikunci `min-h-10`) supaya angkanya duduk di garis yang sama dengan empat
 * kartu metrik lain. Rincian kelas ikut ditampilkan supaya skor bisa diperiksa
 * asalnya, bukan angka telanjang.
 */
export function RepositoryHealthCard({ health }: { health: RepositoryHealth }) {
  return (
    <section className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-5 dark:border-[#50638b] dark:bg-[#353b43]">
      <div className="flex min-h-10 items-start gap-2.5">
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300"
        >
          <Medal className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="text-sm text-muted dark:text-white">Repository Health</p>
      </div>
      <p className="mt-3 whitespace-nowrap text-xl font-semibold tabular-nums tracking-tight text-ink dark:text-white">
        <AnimatedNumber value={health.score_percent} format={(n) => `${n}%`} />
      </p>
      <p className="mt-1 text-xs text-muted dark:text-[#c9d1d9]">
        {health.total_repos} repos · {health.gold} gold · {health.silver} silver · {health.bronze}{" "}
        bronze
      </p>
    </section>
  );
}
