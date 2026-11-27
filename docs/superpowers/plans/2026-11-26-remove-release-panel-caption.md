# Hapus catatan teknis di panel Release

## Scope

Hilangkan kalimat `Build + auto-deploy staging. Sumber: event pipeline nyata.` dari panel detail Pipeline. Teks itu hanya penjelasan implementasi internal, bukan status atau instruksi operator. Pertahankan kartu Environment, status deployment, dan Release Terbaru.

## Implementasi

1. Tambah regression test pada `web/apps/dashboard/src/components/release-panel.test.tsx`: kalimat tidak ada, tapi Environment dan rilis tetap tampil.
2. Jalankan tes khusus dan pastikan gagal sebelum perubahan komponen.
3. Hapus paragraf saja dari `web/apps/dashboard/src/components/release-panel.tsx`.
4. Jalankan ulang tes khusus, lalu typecheck dashboard dan cek `git diff --check`.
5. Setelah lolos, deploy dashboard ke VPS kantor dengan alur yang sama seperti PR #14; verifikasi endpoint dan chunk live.

## Batasan

Tidak mengubah label `ENVIRONMENT`, nama environment aplikasi, status atau data deployment. Tidak menghapus kartu Environment.
