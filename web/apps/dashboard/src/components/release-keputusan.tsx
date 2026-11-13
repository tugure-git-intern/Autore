"use client";

import { useState } from "react";
import { Button } from "./ui/button";

type Keputusan = "approve" | "reject";

/**
 * Tombol gerbang approval di kartu release. UI hanya menyembunyikan, API yang
 * menolak; role di prop sudah dihitung server dari allowlist, bukan dari token.
 */
export function ReleaseKeputusan({ releaseId }: { releaseId: string }) {
  const [alasan, setAlasan] = useState("");
  const [tanyaAlasan, setTanyaAlasan] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [kirim, setKirim] = useState(false);

  async function putuskan(keputusan: Keputusan) {
    setKirim(true);
    setPesan(null);
    const body = keputusan === "reject" ? { alasan } : {};
    try {
      const res = await fetch(`/api/releases/${encodeURIComponent(releaseId)}/${keputusan}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const hasil = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setPesan(hasil?.error ?? `permintaan gagal (${res.status})`);
        return;
      }
      window.location.reload();
    } catch {
      setPesan("jaringan gagal, coba lagi");
    } finally {
      setKirim(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button disabled={kirim} onClick={() => void putuskan("approve")}>
          Setujui
        </Button>
        <Button variant="ghost" disabled={kirim} onClick={() => setTanyaAlasan((lama) => !lama)}>
          Tolak
        </Button>
      </div>
      {tanyaAlasan ? (
        <div className="space-y-2">
          <label className="block text-xs text-muted" htmlFor={`alasan-${releaseId}`}>
            Alasan penolakan (wajib)
          </label>
          <textarea
            id={`alasan-${releaseId}`}
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-200 bg-white p-2 text-sm dark:border-[#50638b] dark:bg-[#353b43] dark:text-white"
          />
          <Button
            variant="ghost"
            disabled={kirim || alasan.trim() === ""}
            onClick={() => void putuskan("reject")}
          >
            Kirim penolakan
          </Button>
        </div>
      ) : null}
      {pesan ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {pesan}
        </p>
      ) : null}
    </div>
  );
}