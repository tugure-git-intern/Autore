import {
  History,
  LayoutDashboard,
  Layers,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { roleAtLeast, type Role } from "@autore/contracts";
import type { KunciTerjemah } from "@/lib/i18n";

export type NavItem = {
  href: string;
  /** Kunci kamus, bukan teks: label ikut bahasa aktif saat dirender. */
  kunci: KunciTerjemah;
  icon: LucideIcon;
  /** Kosong = semua role. Isi = hanya role itu ke atas (dev < qa < admin). */
  peran?: Role;
};

// PRD shell menu. Real routes only; no create-app entry — registration stays in the CLI.
const NAV_ITEMS = [
  { href: "/", kunci: "nav.dashboard", icon: LayoutDashboard },
  { href: "/applications", kunci: "nav.aplikasi", icon: Layers },
  { href: "/pipeline", kunci: "nav.pipeline", icon: Workflow },
  { href: "/security", kunci: "nav.keamanan", icon: ShieldCheck },
  { href: "/audit", kunci: "nav.audit", icon: History },
  { href: "/settings", kunci: "nav.pengaturan", icon: Settings, peran: "admin" },
] as const satisfies readonly NavItem[];

export type HrefMenu = (typeof NAV_ITEMS)[number]["href"];

/**
 * Menu untuk satu role. Penyaringan di sini, satu tempat: sidebar desktop dan
 * bar bawah mobile tidak boleh punya daftar sendiri-sendiri. Menyembunyikan
 * menu BUKAN proteksi — API menolak non-admin di tiap endpoint tulis, dan
 * halaman `/settings` menjaga dirinya sendiri saat dibuka langsung.
 */
export function navItemsUntuk(role: Role | null | undefined): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => {
    const minimal = "peran" in item ? item.peran : undefined;
    return minimal === undefined || (role != null && roleAtLeast(role, minimal));
  });
}

/** Dashboard marks the root exactly; section routes also mark their subpaths. */
export function isActiveHref(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
