"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { runAction, goToLogin, type ActionKind } from "@/lib/actions-client";

export interface ActionConfirmation {
  title: string;
  /** Peringatan efek samping; ditampilkan merah karena bisa mengubah repo pengguna. */
  warning?: string;
  confirmLabel: string;
}

interface ActionButtonProps {
  label: string;
  action: ActionKind;
  /** Hanya untuk scan: aplikasi yang diperiksa. Deploy memakai target dari server. */
  app?: string;
  variant?: "green" | "secondary";
  confirm?: ActionConfirmation;
  onDone?: () => void;
}

const RUNNING: Record<ActionKind, string> = {
  deploy: "Deploy sedang berjalan…",
  scan: "Scan keamanan sedang berjalan…",
};

const TONE: Record<"ok" | "error", string> = {
  ok: "border-gray-200 bg-white text-gray-700",
  error: "border-red-200 bg-red-50 text-red-700",
};

export function ActionButton({
  label,
  action,
  app,
  variant = "secondary",
  confirm,
  onDone,
}: ActionButtonProps) {
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // showModal memberi jebakan fokus + Escape; jsdom belum punya, jadi atribut
  // `open` jadi jalur cadangannya (dan itu yang diuji).
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (typeof element.showModal === "function" && !element.open) element.showModal();
      else element.setAttribute("open", "");
    } else {
      element.close?.();
      element.removeAttribute("open");
    }
  }, [open]);

  useEffect(() => {
    if (!toast || pending) return;
    const timer = setTimeout(() => setToast(null), 6_000);
    return () => clearTimeout(timer);
  }, [toast, pending]);

  async function dispatch() {
    setPending(true);
    setToast(null);
    const outcome = await runAction(action, app);
    setPending(false);
    setToast({ tone: outcome.ok ? "ok" : "error", text: outcome.message });
    onDone?.();
    // Pindah halaman setelah pesan tampil: user sempat melihat alasannya.
    if (outcome.redirectTo) goToLogin(outcome.redirectTo);
  }

  const notice = pending
    ? { role: "status", text: RUNNING[action], tone: "ok" as const }
    : toast
      ? { role: toast.tone === "error" ? "alert" : "status", text: toast.text, tone: toast.tone }
      : null;

  return (
    <span className="inline-flex flex-col items-end gap-2">
      <Button
        variant={variant}
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          if (confirm) setOpen(true);
          else void dispatch();
        }}
      >
        {pending ? (
          <>
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            Menjalankan…
          </>
        ) : (
          label
        )}
      </Button>

      {notice ? (
        <p
          role={notice.role}
          className={`max-w-xs rounded-md border px-3 py-2 text-xs ${TONE[notice.tone]}`}
        >
          {notice.text}
        </p>
      ) : null}

      {confirm ? (
        <dialog
          ref={dialog}
          aria-labelledby={titleId}
          className="rounded-lg border border-gray-200 bg-white p-4 text-left backdrop:bg-black/30"
        >
          <h2 id={titleId} className="text-sm font-semibold text-gray-900">
            {confirm.title}
          </h2>
          {confirm.warning ? (
            <p className="mt-2 max-w-sm text-xs font-medium text-red-600">{confirm.warning}</p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Batal</Button>
            <Button
              variant="green"
              onClick={() => {
                setOpen(false);
                void dispatch();
              }}
            >
              {confirm.confirmLabel}
            </Button>
          </div>
        </dialog>
      ) : null}
    </span>
  );
}
