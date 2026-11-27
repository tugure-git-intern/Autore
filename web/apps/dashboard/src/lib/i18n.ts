/**
 * Kamus dua bahasa dashboard. Satu sumber untuk semua teks shell (navbar,
 * sidebar, menu kebab, modal).
 *
 * Aturan: istilah CI/CD (pipeline, build, deploy, commit, scan, Dockerfile,
 * Jenkinsfile) dan nama merek/lingkungan (Autore, Production, Staging) tidak
 * diterjemahkan — diterjemahkan justru bikin operator ragu. Nilai Indonesia
 * ditulis apa adanya; kamus Inggris wajib lengkap, `Record<KunciTerjemah, string>`
 * menolak kunci yang kurang saat type-check.
 */

export const BAHASA = ["id", "en"] as const;
export type Bahasa = (typeof BAHASA)[number];

/** Cookie yang dibaca `layout.tsx` di server; localStorage tidak perlu. */
export const COOKIE_BAHASA = "autore-bahasa";
export const BAHASA_BAWAAN: Bahasa = "id";

const ID = {
  "navbar.sinkron": "Sinkronkan",
  "navbar.bukaSidebar": "Buka sidebar",
  "navbar.tutupSidebar": "Tutup sidebar",

  "nav.dashboard": "Dashboard",
  "nav.aplikasi": "Daftar Aplikasi",
  "nav.aplikasiPendek": "Aplikasi",
  "nav.pipeline": "Pipeline & Log",
  "nav.pipelinePendek": "Pipeline",
  "nav.keamanan": "Keamanan",
  "nav.keamananPendek": "Keamanan",
  "nav.audit": "Catatan Audit",
  "nav.auditPendek": "Audit",
  "nav.pengaturan": "Pengaturan",
  "nav.pengaturanPendek": "Setelan",
  "nav.navigasiUtama": "Navigasi utama",
  "nav.navigasiBawah": "Navigasi bawah",
  "nav.ruangKerja": "Ruang Kerja CI/CD",

  "menu.lainnya": "Menu lainnya",
  "menu.aplikasi": "Menu aplikasi",
  "menu.penampilan": "Penampilan",
  "menu.bahasa": "Bahasa",

  "tampilan.judul": "Pilih Tema Tampilan",
  "tampilan.terang": "Terang",
  "tampilan.gelap": "Gelap",
  "tampilan.ikutiSistem": "Ikuti Sistem",
  "tampilan.kontras": "Kontras Tinggi",
  "tampilan.kontrasSub": "Meningkatkan kontras antara teks dan latar belakang.",
  "tampilan.tutup": "Tutup",

  "bahasa.judul": "Pilih Bahasa",
  "bahasa.indonesia": "Indonesia",
  "bahasa.inggris": "Inggris",
  "bahasa.subIndonesia": "Antarmuka ditampilkan dalam Bahasa Indonesia.",
  "bahasa.subInggris": "Antarmuka ditampilkan dalam Bahasa Inggris.",
} as const;

/** Kunci apa pun dari kamus; dipakai `t()` sehingga salah ketik = error tsc. */
export type KunciTerjemah = keyof typeof ID;

const EN: Record<KunciTerjemah, string> = {
  "navbar.sinkron": "Sync",
  "navbar.bukaSidebar": "Open sidebar",
  "navbar.tutupSidebar": "Close sidebar",

  "nav.dashboard": "Dashboard",
  "nav.aplikasi": "Applications",
  "nav.aplikasiPendek": "Apps",
  "nav.pipeline": "Pipeline & Log",
  "nav.pipelinePendek": "Pipeline",
  "nav.keamanan": "Security",
  "nav.keamananPendek": "Security",
  "nav.audit": "Audit Log",
  "nav.auditPendek": "Audit",
  "nav.pengaturan": "Settings",
  "nav.pengaturanPendek": "Settings",
  "nav.navigasiUtama": "Main navigation",
  "nav.navigasiBawah": "Bottom navigation",
  "nav.ruangKerja": "CI/CD Workspace",

  "menu.lainnya": "More options",
  "menu.aplikasi": "App menu",
  "menu.penampilan": "Appearance",
  "menu.bahasa": "Language",

  "tampilan.judul": "Choose Display Theme",
  "tampilan.terang": "Light",
  "tampilan.gelap": "Dark",
  "tampilan.ikutiSistem": "Follow System",
  "tampilan.kontras": "High Contrast",
  "tampilan.kontrasSub": "Increases contrast between text and background.",
  "tampilan.tutup": "Close",

  "bahasa.judul": "Choose Language",
  "bahasa.indonesia": "Indonesian",
  "bahasa.inggris": "English",
  "bahasa.subIndonesia": "Interface shown in Indonesian.",
  "bahasa.subInggris": "Interface shown in English.",
};

export const KAMUS: Record<Bahasa, Record<KunciTerjemah, string>> = { id: ID, en: EN };

/** Cookie apa pun bisa berisi apa saja; hanya dua nilai ini yang dipercaya. */
export function ialahBahasa(nilai: unknown): nilai is Bahasa {
  return typeof nilai === "string" && (BAHASA as readonly string[]).includes(nilai);
}

export function terjemah(bahasa: Bahasa, kunci: KunciTerjemah): string {
  return KAMUS[bahasa][kunci];
}
