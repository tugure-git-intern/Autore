"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = mounted ? (resolvedTheme ?? theme ?? "light") : "light";
  const isDark = current === "dark";

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-label={isDark ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
      title={isDark ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-gray-300/80 bg-white/80 px-2.5 py-2 text-[#545F72] transition-colors hover:bg-white hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:border-[#50638b] dark:bg-[#353b43] dark:text-white dark:hover:bg-[#3d444d] dark:hover:text-white"
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-white" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4 text-[#545F72]" aria-hidden="true" />
      )}
    </button>
  );
}
