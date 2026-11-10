"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log pesan error secara aman tanpa mencetak stack trace ke antarmuka pengguna
    console.error("Dashboard error caught by boundary:", error.message);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div
        role="alert"
        aria-live="assertive"
        className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center gap-3 text-red-600">
          <AlertTriangle className="h-6 w-6 shrink-0" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-gray-900">
            Terjadi Kesalahan pada Aplikasi
          </h2>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          Gagal memuat komponen antarmuka. Layanan API mungkin sedang dalam pemeliharaan atau terjadi gangguan koneksi jaringan.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            variant="primary"
            onClick={() => reset()}
            className="inline-flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Coba Lagi
          </Button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Kembali ke Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
