"use client";

import { Card } from "@/components/ui/card";
import { PipelineSummary } from "@/components/pipeline/pipeline-summary";
import { StageMatrix } from "@/components/pipeline/stage-matrix";
import type { DashboardStatus } from "@/lib/contracts";
import { shortSha } from "@/lib/format";
import { stageRows } from "@/lib/stages";

/**
 * Pipeline terakhir **workspace** (bukan per aplikasi). Dipanggil hanya setelah
 * `cocokCommit` memastikan commit-nya memang milik aplikasi yang sedang dibuka, supaya
 * tahapan dan log tidak pernah tampil sebagai milik aplikasi lain.
 */
export function WorkspacePipeline({ pipeline }: { pipeline: DashboardStatus["latest_pipeline"] }) {
  return (
    <div className="space-y-4">
      <p className="text-xs uppercase tracking-wide text-muted">
        Pipeline terakhir workspace · commit {shortSha(pipeline.commit_sha)} · {pipeline.author || "—"}
      </p>

      <PipelineSummary pipeline={pipeline} />

      {pipeline.failure_reason.trim() ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {pipeline.failure_reason}
        </p>
      ) : null}

      {/* Matriks selebar halaman: 5 kartu + panah tidak muat di kolom sempit. */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">Tahapan Pipeline</h2>
        <div className="mt-4">
          <StageMatrix
            rows={stageRows(pipeline.stage_times, pipeline.finished_at, pipeline.status)}
            stages={pipeline.stages}
            pipelineStatus={pipeline.status}
          />
        </div>
      </Card>

      <Card className="min-w-0 p-5">
        <h2 id="pipeline-log-title" className="text-sm font-semibold text-ink">
          Detail Log
        </h2>
        <section
          aria-labelledby="pipeline-log-title"
          className="mt-4 rounded-md border border-gray-200 bg-gray-50"
        >
          <pre className="max-h-[26rem] overflow-auto p-4 font-mono text-xs leading-6 text-ink">
            {pipeline.raw_log.length === 0
              ? "Belum ada log."
              : pipeline.raw_log.map((line, index) => (
                  <span key={index} className="block whitespace-pre-wrap">
                    {line}
                  </span>
                ))}
          </pre>
        </section>
      </Card>
    </div>
  );
}