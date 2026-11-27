"use client";

import { Github } from "lucide-react";
import { useBahasa } from "./bahasa-provider";

/**
 * Satu-satunya jalur masuk: tombol GitHub. Tidak ada field password, tidak ada
 * form pendaftaran — identitas 100% dipegang GitHub.
 */
export function LoginCard({ action }: { action: (formData: FormData) => void | Promise<void> }) {
  const { t } = useBahasa();
  return (
    <section className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 dark:border-[var(--color-line)] dark:bg-[var(--bg-canvas)]">
      <h1 className="text-lg font-semibold tracking-tight text-ink">{t("auth.masuk")}</h1>
      <p className="mt-1 text-sm text-muted">{t("auth.masukSub")}</p>
      <form action={action} className="mt-6">
        <button
          type="submit"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-gray-50 dark:border-[var(--color-line)] dark:bg-[var(--bg-sidebar)] dark:text-[var(--color-ink)] dark:hover:bg-[var(--bg-canvas)]"
        >
          <Github className="h-4 w-4" aria-hidden="true" />
          {t("auth.lanjutGithub")}
        </button>
      </form>
      <p className="mt-4 text-xs text-muted">
        {t("auth.catatan")}
      </p>
    </section>
  );
}
