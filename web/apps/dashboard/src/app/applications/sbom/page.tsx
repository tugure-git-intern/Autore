"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { SbomTable } from "@/components/sbom-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type SbomPayload } from "@/lib/contracts";
import { dash } from "@/lib/format";
import { fetchSbom } from "@/lib/sbom-client";

type Hasil =
  | { tahap: "memuat" }
  /** `payload: null` = aplikasi ini belum punya SBOM (404), bukan kegagalan. */
  | { tahap: "siap"; payload: SbomPayload | null }
  | { tahap: "gagal" };

const KEMBALI = { href: "/applications", label: "Kembali ke Detail Aplikasi" };

export default function SbomPage() {
  return (
    <Suspense fallback={<Memuat />}>
      <SbomDetail />
    </Suspense>
  );
}

function Kembali() {
  return (
    <a
      href={KEMBALI.href}
      className="mb-4 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {KEMBALI.label}
    </a>
  );
}

function Memuat() {
  return (
    <section aria-label="Memuat SBOM" aria-busy="true">
      <Skeleton className="h-7 w-52" />
      <Skeleton className="mt-4 h-64" />
    </section>
  );
}

function SbomDetail() {
  const app = useSearchParams().get("app") ?? "";
  const [hasil, setHasil] = useState<Hasil>({ tahap: "memuat" });

  const muat = useCallback(
    async (signal?: AbortSignal) => {
      setHasil({ tahap: "memuat" });
      try {
        const payload = await fetchSbom(app, signal);
        if (!signal?.aborted) setHasil({ tahap: "siap", payload });
      } catch {
        if (!signal?.aborted) setHasil({ tahap: "gagal" });
      }
    },
    [app],
  );

  useEffect(() => {
    const kontrol = new AbortController();
    if (app) void muat(kontrol.signal);
    return () => kontrol.abort();
  }, [app, muat]);

  if (!app) {
    return (
      <div>
        <Kembali />
        <Card className="p-6">
          <p className="font-medium text-ink">Aplikasi tidak disebutkan.</p>
          <p className="mt-1 text-sm text-muted">
            Buka halaman ini dari tombol “Lihat SBOM” di daftar aplikasi.
          </p>
        </Card>
      </div>
    );
  }

  if (hasil.tahap === "memuat") return <Memuat />;

  if (hasil.tahap === "gagal") {
    return (
      <div>
        <Kembali />
        <Card className="p-6">
          <div role="alert">
            <p className="font-medium text-red-700">Gagal memuat SBOM.</p>
            <p className="mt-1 text-sm text-red-600">
              Server tidak mengembalikan datanya. Coba lagi sebentar.
            </p>
          </div>
          <Button className="mt-4" onClick={() => void muat()}>
            Coba lagi
          </Button>
        </Card>
      </div>
    );
  }

  const { payload } = hasil;

  return (
    <div>
      <Kembali />
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-ink">SBOM — {app}</h1>
      </div>

      {payload === null ? (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-500" aria-hidden="true" />
            <div>
              <p className="font-medium text-ink">SBOM belum tersedia untuk aplikasi ini.</p>
              <p className="mt-1 text-sm text-muted">
                Daftar dependensi dihasilkan pada tahap 6 (Trivy &amp; SBOM) pipeline. Jalankan
                pipeline aplikasinya sampai tahap itu selesai, lalu buka halaman ini lagi.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            {payload.total} paket · dibuat {dash(payload.generated_at)}
          </p>
          <SbomTable payload={payload} />
        </>
      )}
    </div>
  );
}
