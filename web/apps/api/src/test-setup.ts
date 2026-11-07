// Tes tidak boleh menulis ke audit log mesin (`~/.local/state/autore/audit.log`).
// Sink default produksi tetap `catatAudit`; berkas ini hanya mengalihkan jalur keluarnya
// sekali per run vitest, sehingga tes baru pun tidak bisa mengotori jejak audit sungguhan.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.AUTORE_AUDIT_LOG = join(mkdtempSync(join(tmpdir(), "autore-audit-tes-")), "audit.log");
