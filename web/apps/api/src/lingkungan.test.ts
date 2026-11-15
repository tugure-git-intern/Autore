import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bacaLingkungan, jalurLingkungan } from "./lingkungan";

function berkas(isi: string): string {
  const jalur = join(mkdtempSync(join(tmpdir(), "autore-env-uji-")), "environments.json");
  writeFileSync(jalur, isi);
  return jalur;
}

it("L1 app terdaftar: target dan port dibaca dari berkas", () => {
  const jalur = berkas(
    JSON.stringify({
      "tes-testing": { production: { target: "127.0.0.1:8160", deploy_port: 8160, container_port: 8000 } },
    }),
  );
  expect(bacaLingkungan("tes-testing", jalur)).toEqual({
    productionTarget: "127.0.0.1:8160",
    productionDeployPort: 8160,
    productionContainerPort: 8000,
  });
});

it("L2 berkas tidak ada: production belum dikonfigurasi, bukan error", () => {
  expect(bacaLingkungan("tes-testing", "/tmp/tidak-ada-env-autore.json")).toEqual({
    productionTarget: null,
    productionDeployPort: null,
    productionContainerPort: null,
  });
});

it("L3 JSON rusak atau app lain: tetap belum dikonfigurasi", () => {
  const rusak = berkas("{ ini bukan json");
  expect(bacaLingkungan("tes-testing", rusak).productionTarget).toBeNull();
  const lain = berkas(JSON.stringify({ "app-lain": { production: { target: "127.0.0.1:9000" } } }));
  expect(bacaLingkungan("tes-testing", lain).productionTarget).toBeNull();
});

it("L4 nilai tidak masuk akal ditolak: target kosong, port di luar 1-65535", () => {
  const jalur = berkas(
    JSON.stringify({
      "tes-testing": { production: { target: "   ", deploy_port: 0, container_port: 70000 } },
    }),
  );
  expect(bacaLingkungan("tes-testing", jalur)).toEqual({
    productionTarget: null,
    productionDeployPort: null,
    productionContainerPort: null,
  });
});

it("L5 jalur default mengikuti AUTORE_WORKSPACE", () => {
  expect(jalurLingkungan({ AUTORE_WORKSPACE: "/tmp/ws-uji" } as NodeJS.ProcessEnv)).toBe(
    "/tmp/ws-uji/environments.json",
  );
});
