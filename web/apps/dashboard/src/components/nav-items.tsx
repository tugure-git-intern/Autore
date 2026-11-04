import { LayoutDashboard, Layers, Workflow } from "lucide-react";

// PRD shell menu. Real routes only; no create-app entry — registration stays in the CLI.
export const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/applications", label: "Daftar Aplikasi", icon: Layers },
  { href: "/pipeline", label: "Pipeline & Log", icon: Workflow },
] as const;

/** Dashboard marks the root exactly; section routes also mark their subpaths. */
export function isActiveHref(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Topbar context, from the same table as the sidebar active rule. The root has
 * no section of its own, so it shows the product instead of repeating the H1.
 */
export function routeTitle(pathname: string): string {
  const section = navItems.find(({ href }) => href !== "/" && isActiveHref(pathname, href));
  return section?.label ?? "Autore";
}
