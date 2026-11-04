import { Inbox } from "lucide-react";

// Borderless on purpose: this sits inside the already-bordered Aplikasi card,
// so a second frame here would double the edge. The heading is the only copy:
// callers already state the count, and the tile stays neutral (one accent max).
export function EmptyApplications() {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2.5 px-6 py-6 text-center text-muted">
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-gray-100 text-gray-600"
      >
        <Inbox className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-ink">Belum ada aplikasi yang didaftarkan.</p>
    </div>
  );
}
