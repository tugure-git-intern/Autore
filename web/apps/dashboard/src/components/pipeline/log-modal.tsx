"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Log text arrives from the CLI; render it as React text nodes only, never as HTML. */
export function LogModal({
  lines,
  open,
  onOpenChange,
}: {
  lines: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener.current?.focus();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-modal-title"
        tabIndex={-1}
        className="w-full max-w-3xl rounded-lg border border-gray-200 bg-white"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 id="log-modal-title" className="text-sm font-semibold text-ink">
            Log Lengkap
          </h2>
          <Button variant="ghost" size="icon" aria-label="Tutup" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <pre className="max-h-[60vh] overflow-auto bg-gray-50 px-4 py-3 font-mono text-xs text-ink">
          {lines.length === 0
            ? "Belum ada log."
            : lines.map((line, index) => (
                <span key={index} className="block whitespace-pre-wrap">
                  {line}
                </span>
              ))}
        </pre>
      </div>
    </div>
  );
}