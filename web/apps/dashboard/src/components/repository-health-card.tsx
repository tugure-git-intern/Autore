import { Medal } from "lucide-react";
import type { RepositoryHealth } from "@/lib/contracts";

/**
 * Kartu kesehatan repo. Sengaja bukan `StatCard`: rancangan Snorlx menaruh ikon
 * di kanan judul, sedangkan `StatCard` menaruhnya di kiri. Rincian kelas ikut
 * ditampilkan supaya angka skor bisa diperiksa asalnya, bukan angka telanjang.
 */
export function RepositoryHealthCard({ health }: { health: RepositoryHealth }) {
  return (
    <section className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-2.5">
        <p className="text-sm text-muted">Repository Health</p>
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600"
        >
          <Medal className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 whitespace-nowrap text-xl font-semibold tabular-nums tracking-tight text-ink">
        {health.score_percent}%
      </p>
      <p className="mt-1 text-xs text-muted">
        {health.total_repos} repos · {health.gold} gold · {health.silver} silver · {health.bronze}{" "}
        bronze
      </p>
    </section>
  );
}
