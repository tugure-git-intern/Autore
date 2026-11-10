"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import type { SessionUser } from "@/lib/current-user";
import { Button } from "./ui/button";

export function UserMenu({ user }: { user: SessionUser }) {
  // Nama GitHub bisa kosong; login selalu ada karena whitelist yang mengizinkan.
  const label = user.name.trim() || user.login;

  return (
    <details className="relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-[#545F72] hover:bg-white/60 dark:text-white dark:hover:bg-[#353b43]">
        {user.image ? (
          <img
            src={user.image}
            alt={user.login}
            width={28}
            height={28}
            className="h-7 w-7 rounded-full border border-gray-200 dark:border-[#50638b]"
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-xs font-medium text-[#545F72] dark:border-[#50638b] dark:bg-[#353b43] dark:text-white"
          >
            {user.login.slice(0, 2).toUpperCase()}
          </span>
        )}
        {/* Nama pengguna disembunyikan di layar sempit: avatar + aria-label sudah
            cukup, dan topbar 64px harus muat bersama status + tombol Sync. */}
        <span className="hidden text-xs font-medium text-[#545F72] dark:text-white sm:inline">{label}</span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-gray-200 bg-white p-1 shadow-sm dark:border-[#50638b] dark:bg-[#353b43]">
        <p className="px-2 py-1 text-xs text-muted dark:text-[#c9d1d9]">@{user.login}</p>
        <Button
          variant="ghost"
          className="w-full justify-start dark:text-white dark:hover:bg-[#282c32]"
          onClick={() => void signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Keluar
        </Button>
      </div>
    </details>
  );
}
