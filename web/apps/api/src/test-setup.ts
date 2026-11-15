// Tes tidak boleh menulis ke audit log mesin (`~/.local/state/autore/audit.log`).
// Sink default produksi tetap `catatAudit`; berkas ini hanya mengalihkan jalur keluarnya
// sekali per run vitest, sehingga tes baru pun tidak bisa mengotori jejak audit sungguhan.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.AUTORE_AUDIT_LOG = join(mkdtempSync(join(tmpdir(), "autore-audit-tes-")), "audit.log");

// Target environment tidak lagi di-hardcode di kode. Tes mengarahkannya ke berkas
// sementara supaya perilaku produksi (production tes-testing terkonfigurasi) tetap
// teruji tanpa menyentuh `~/autore-workspace/environments.json` milik mesin ini.
const dirLingkungan = mkdtempSync(join(tmpdir(), "autore-env-tes-"));
const berkasLingkungan = join(dirLingkungan, "environments.json");
writeFileSync(
  berkasLingkungan,
  JSON.stringify({
    "tes-testing": {
      staging: { target: "vps-staging", deploy_port: 8153 },
      production: { target: "127.0.0.1:8154", deploy_port: 8154, container_port: 8080 },
    },
  }),
);
process.env.AUTORE_ENVIRONMENTS = berkasLingkungan;
