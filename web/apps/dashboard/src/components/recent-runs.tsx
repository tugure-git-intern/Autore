import type { RunRecord } from "@/lib/contracts";
import { dash } from "@/lib/format";
import { formatDuration, relativeTime, shortSha } from "@/lib/format";
import { StatusBadge, type AppStatus } from "./status-badge";
import { ChartCard } from "./ui/chart-card";

const MAKS_BARIS = 5;

const KOLOM = ["Build", "Commit", "Penulis", "Status", "Durasi", "Waktu"] as const;

/**
 * Kolom yang tetap tampil di HP. Enam kolom butuh 745px sedangkan layar HP
 * 390px, jadi Commit/Penulis/Durasi menyusul di >= sm (640px) dan sisanya
 * (Build, Status, Waktu) sudah menjawab "apa yang terjadi, kapan".
 */
const TAMPIL_HP: Record<(typeof KOLOM)[number], boolean> = {
  Build: true,
  Commit: false,
  Penulis: false,
  Status: true,
  Durasi: false,
  Waktu: true,
};

const sembunyi = (nama: (typeof KOLOM)[number]) => (TAMPIL_HP[nama] ? "" : "hidden sm:table-cell");

/** Lima run terakhir. Waktu relatif dihitung saat render — bukan disimpan di payload. */
export function RecentRuns({ runs, stale = false }: { runs: readonly RunRecord[]; stale?: boolean }) {
  const baris = runs.slice(0, MAKS_BARIS);

  return (
    <ChartCard
      title="Recent Runs"
      subtitle="Lima build terakhir dari Jenkins"
      action={
        stale ? <span className="text-xs text-amber-600">data terakhir</span> : undefined
      }
    >
      {baris.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-white">Belum ada run</p>
      ) : (
        <div className="-mx-5 -mb-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-[#282c32] text-xs uppercase tracking-wide text-gray-500 dark:text-white">
              <tr>
                {KOLOM.map((judul) => (
                  <th key={judul} scope="col" className={`px-5 py-2 font-medium ${sembunyi(judul)}`}>
                    {judul}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {baris.map((run) => (
                <tr
                  key={`${run.app}#${run.number}`}
                  data-testid="recent-run-row"
                  className="border-t border-gray-200 dark:border-[#50638b]"
                >
                  <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">
                    {run.app} #{run.number}
                  </td>
                  <td className={`px-5 py-3 ${sembunyi("Commit")}`}>
                    <a
                      href={run.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-blue-600 dark:text-blue-300 hover:underline"
                    >
                      {shortSha(run.commit_sha)}
                    </a>
                  </td>
                  <td className={`px-5 py-3 text-gray-600 dark:text-white ${sembunyi("Penulis")}`}>
                    {dash(run.author)}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={run.status as AppStatus} />
                  </td>
                  <td className={`px-5 py-3 text-gray-600 dark:text-white ${sembunyi("Durasi")}`}>
                    {formatDuration(run.duration_ms)}
                  </td>
                  <td className="px-5 py-3 text-gray-600 dark:text-white">
                    <time dateTime={run.started_at}>{relativeTime(run.started_at)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}