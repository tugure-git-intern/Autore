import type { RunRecord } from "@/lib/contracts";
import { dash } from "@/lib/format";
import { formatDuration, relativeTime, shortSha } from "@/lib/format";
import { useBahasa } from "./bahasa-provider";
import { StatusBadge, type AppStatus } from "./status-badge";
import { ChartCard } from "./ui/chart-card";

const MAKS_BARIS = 5;

const KOLOM = [
  "riwayat.kolomBuild",
  "riwayat.kolomCommit",
  "riwayat.kolomPenulis",
  "riwayat.kolomStatus",
  "riwayat.kolomDurasi",
  "riwayat.kolomWaktu",
] as const;

type Kolom = (typeof KOLOM)[number];

/**
 * Kolom yang tetap tampil di HP. Enam kolom butuh 745px sedangkan layar HP
 * 390px, jadi Commit/Penulis/Durasi menyusul di >= sm (640px) dan sisanya
 * (Build, Status, Waktu) sudah menjawab "apa yang terjadi, kapan".
 */
const TAMPIL_HP: Record<Kolom, boolean> = {
  "riwayat.kolomBuild": true,
  "riwayat.kolomCommit": false,
  "riwayat.kolomPenulis": false,
  "riwayat.kolomStatus": true,
  "riwayat.kolomDurasi": false,
  "riwayat.kolomWaktu": true,
};

const sembunyi = (kolom: Kolom) => (TAMPIL_HP[kolom] ? "" : "hidden sm:table-cell");

/** Lima run terakhir. Waktu relatif dihitung saat render — bukan disimpan di payload. */
export function RecentRuns({ runs, stale = false }: { runs: readonly RunRecord[]; stale?: boolean }) {
  const { bahasa, t } = useBahasa();
  const baris = runs.slice(0, MAKS_BARIS);

  return (
    <ChartCard
      title={t("riwayat.judul")}
      subtitle={t("riwayat.sub")}
      action={
        stale ? (
          <span className="text-xs text-amber-600">{t("banner.dataTerakhir")}</span>
        ) : undefined
      }
    >
      {baris.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-white">{t("riwayat.kosong")}</p>
      ) : (
        <div className="-mx-5 -mb-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-[#282c32] text-xs uppercase tracking-wide text-gray-500 dark:text-white">
              <tr>
                {KOLOM.map((kolom) => (
                  <th key={kolom} scope="col" className={`px-5 py-2 font-medium ${sembunyi(kolom)}`}>
                    {t(kolom)}
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
                  <td className={`px-5 py-3 ${sembunyi("riwayat.kolomCommit")}`}>
                    <a
                      href={run.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-blue-600 dark:text-blue-300 hover:underline"
                    >
                      {shortSha(run.commit_sha)}
                    </a>
                  </td>
                  <td className={`px-5 py-3 text-gray-600 dark:text-white ${sembunyi("riwayat.kolomPenulis")}`}>
                    {dash(run.author)}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={run.status as AppStatus} />
                  </td>
                  <td className={`px-5 py-3 text-gray-600 dark:text-white ${sembunyi("riwayat.kolomDurasi")}`}>
                    {formatDuration(run.duration_ms)}
                  </td>
                  <td className="px-5 py-3 text-gray-600 dark:text-white">
                    <time dateTime={run.started_at}>
                      {relativeTime(run.started_at, Date.now(), bahasa)}
                    </time>
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