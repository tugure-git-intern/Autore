export interface AuditEntry {
  ts: string;
  login: string;
  email: string;
  action: string;
  target: string;
  /** null = baris tidak mencatat kode keluar; UI tidak boleh mengarang Sukses/Gagal. */
  exit: number | null;
}

export interface AuditResponse {
  data: AuditEntry[];
  total: number;
}

export async function fetchAuditLog(signal?: AbortSignal): Promise<AuditResponse> {
  const res = await fetch("/api/audit/log", {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!res.ok) {
    throw new Error(`Gagal memuat audit log: HTTP ${res.status}`);
  }

  const json = (await res.json()) as { data?: unknown; total?: unknown };
  const data = Array.isArray(json?.data) ? (json.data as AuditEntry[]) : [];
  const total = typeof json?.total === "number" ? json.total : data.length;

  return { data, total };
}
