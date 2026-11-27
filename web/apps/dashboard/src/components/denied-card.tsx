"use client";

import { ShieldOff } from "lucide-react";
import { useBahasa } from "./bahasa-provider";

/** Halaman untuk user yang login GitHub-nya sah tapi tidak ada di whitelist. */
export function DeniedCard({
  login,
  action,
}: {
  login: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const { t, tf } = useBahasa();

  return (
    <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]">
      <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
        <ShieldOff className="h-5 w-5 text-red-600 dark:text-red-300" aria-hidden="true" />
        {t("auth.ditolakJudul")}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {login ? tf("auth.ditolakAkun", { login }) : t("auth.ditolakAkunPolos")}
      </p>
      <p className="mt-2 text-sm text-muted">
        {t("auth.ditolakCaraPra")} <code>allowed-users.json</code>
        {t("auth.ditolakCaraPasca")}
      </p>
      <form action={action} className="mt-6">
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-gray-50 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)] dark:hover:bg-[var(--bg-canvas)]"
        >
          {t("auth.keluarMasuk")}
        </button>
      </form>
    </section>
  );
}
