"use client";

import { useState } from "react";
import type { Role, StatusRelease } from "@autore/contracts";
import { roleAtLeast } from "@autore/contracts";
import { Check, RotateCcw, Rocket, Send, X } from "lucide-react";
import { Button } from "./ui/button";
import { useBahasa } from "./bahasa-provider";

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
  digantikan = false,
}: {
  releaseId: string;
  role: Role | null;
  status: StatusRelease;
  /** Rilis yang sudah digantikan build lebih baru di staging: cuma boleh ditolak. */
  digantikan?: boolean;
}) {
  const { t, tf } = useBahasa();
  const tfGagal = (status: number) => tf("rilis.permintaanGagal", { status });
  const tfJob = (job: string) => tf("rilis.jobDipicu", { job });
  const [alasan, setAlasan] = useState("");
  const [tanyaAlasan, setTanyaAlasan] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [galat, setGalat] = useState(false);
  const [kirim, setKirim] = useState(false);

  const efektif = role ?? "dev";
  const bolehTolak = status === "menunggu_persetujuan" && roleAtLeast(efektif, "qa");
  const bolehSetujui = bolehTolak && !digantikan;
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
        setPesan(hasil?.error ?? tfGagal(res.status));
        return;
      }
      // Aksi 202 memicu job Jenkins; hasil akhir baru terlihat setelah build,
      // jadi kartu tidak dimuat ulang diam-diam sekarang.
      if (hasil?.job) {
        setPesan(tfJob(hasil.job));
        return;
      }
      window.location.reload();
    } catch {
      setGalat(true);
      setPesan(t("rilis.jaringanGagal"));
    } finally {
      setKirim(false);
    }
  }

  if (!bolehSetujui && !bolehTolak && !bolehPromosi && !bolehRollback) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        {bolehSetujui ? (
          <Button variant="primary" disabled={kirim} onClick={() => void jalankan("approve", {})}>
            <Check size={16} aria-hidden="true" />
            {t("rilis.setujui")}
          </Button>
        ) : null}
        {bolehTolak ? (
          <Button
            variant="secondary"
            disabled={kirim}
            aria-expanded={tanyaAlasan}
            onClick={() => setTanyaAlasan((lama) => !lama)}
          >
            <X size={16} aria-hidden="true" />
            {t("rilis.tolak")}
          </Button>
        ) : null}
        {bolehPromosi ? (
          <Button variant="primary" disabled={kirim} onClick={() => void jalankan("promote", {})}>
            <Rocket size={16} aria-hidden="true" />
            {t("rilis.promosikan")}
          </Button>
        ) : null}
        {bolehRollback ? (
          <Button
            variant="secondary"
            disabled={kirim}
            onClick={() => void jalankan("rollback", { environment: "production" })}
          >
            <RotateCcw size={16} aria-hidden="true" />
            {t("rilis.rollback")}
          </Button>
        ) : null}
      </div>
      {bolehTolak && tanyaAlasan ? (
        <div className="space-y-2">
          <label className="block text-xs text-muted" htmlFor={`alasan-${releaseId}`}>
            {t("rilis.alasanWajib")}
          </label>
          <textarea
            id={`alasan-${releaseId}`}
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-200 bg-white p-2 text-sm dark:border-[#50638b] dark:bg-[#353b43] dark:text-white"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={kirim} onClick={() => setTanyaAlasan(false)}>
              <X size={16} aria-hidden="true" />
              {t("rilis.batal")}
            </Button>
            <Button
              variant="primary"
              disabled={kirim || alasan.trim() === ""}
              onClick={() => void jalankan("reject", { alasan })}
            >
              <Send size={16} aria-hidden="true" />
              {t("rilis.kirimPenolakan")}
            </Button>
          </div>
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
