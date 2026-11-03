import { Inbox } from "lucide-react";
import { Card } from "./ui/card";

export function EmptyApplications() {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-600"
      >
        <Inbox className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-ink">Belum ada aplikasi yang didaftarkan.</p>
      <p className="max-w-sm text-sm text-muted">
        Daftarkan aplikasi lewat CLI Autore. Halaman ini hanya menampilkan data dari{" "}
        <code className="font-mono text-xs">autore status --json</code>.
      </p>
    </Card>
  );
}
