"use client";

import { useState } from "react";
import type { Role, StatusRelease } from "@autore/contracts";
import { roleAtLeast } from "@autore/contracts";
import { Button } from "./ui/button";

type Aksi = "approve" | "reject" | "promote" | "rollback";

/**
 * Tombol aksi release di kartu: approval staging (qa), promosi production
 * (admin), rollback production (qa). UI hanya menyembunyikan, API yang
 * menolak; role di prop sudah dihitung server dari allowlist, bukan token.
 */
export function ReleaseKeputusan({
  releaseId,
  role,
  status,
}: {
  releaseId: string;
  role: Role | null;
  status: StatusRelease;
}) {
  const [alasan, setAlasan] = useState("");
  const [tanyaAlasan, setTanyaAlasan] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [galat, setGalat] = useState(false);
  const [kirim, setKirim] = useState(false);

  const efektif = role ?? "dev";
  const bolehSetujui = status === "menunggu_persetujuan" && roleAtLeast(efektif, "qa");
  const bolehPromosi = status === "disetujui" && roleAtLeast(efektif, "admin");
  const bolehRollback = status === "aktif" && roleAtLeast(efektif, "qa");

  async function jalankan(aksi: Aksi, body: unknown) {
    setKirim(true);
    setPesan(null);
    setGalat(false);
    try {
      const res = await fetch(`/api/releases/${encodeURIComponent(releaseId)}/${aksi}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const hasil = (await res.json().catch(() => null)) as { error?: string; job?: string } | null;
      if (!res.ok) {
        setGalat(true);
        setPesan(hasil?.error ?? `permintaan gagal (${res.status})`);
        return;
      }
      // Aksi 202 memicu job Jenkins; hasil akhir baru terlihat setelah build,
      // jadi kartu tidak dimuat ulang diam-diam sekarang.
      if (hasil?.job) {
        setPesan(`job ${hasil.job} dipicu, muat ulang halaman setelah build selesai`);
        return;
      }
      window.location.reload();
    } catch {
      setGalat(true);
      setPesan("jaringan gagal, coba lagi");
    } finally {
      setKirim(false);
    }
  }

  if (!bolehSetujui && !bolehPromosi && !bolehRollback) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {bolehSetujui ? (
          <>
            <Button disabled={kirim} onClick={() => void jalankan("approve", {})}>
              Setujui
            </Button>
            <Button variant="ghost" disabled={kirim} onClick={() => setTanyaAlasan((lama) => !lama)}>
              Tolak
            </Button>
          </>
        ) : null}
        {bolehPromosi ? (
          <Button disabled={kirim} onClick={() => void jalankan("promote", {})}>
            Promosikan ke Production
          </Button>
        ) : null}
        {bolehRollback ? (
          <Button
            variant="ghost"
            disabled={kirim}
            onClick={() => void jalankan("rollback", { environment: "production" })}
          >
            Rollback Production
          </Button>
        ) : null}
      </div>
      {bolehSetujui && tanyaAlasan ? (
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
            onClick={() => void jalankan("reject", { alasan })}
          >
            Kirim penolakan
          </Button>
        </div>
      ) : null}
      {pesan ? (
        <p
          role={galat ? "alert" : "status"}
          className={
            galat
              ? "text-xs text-red-600 dark:text-red-400"
              : "text-xs text-muted"
          }
        >
          {pesan}
        </p>
      ) : null}
    </div>
  );
}
