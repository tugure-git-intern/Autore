import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/**
 * Penjaga drift runtime. `.nvmrc` di root workspace `web/` adalah pin versi
 * Node, sedangkan service systemd memuat node lewat PATH. Tanpa tes ini repo
 * bisa menuntut Node 22 sementara service diam-diam masih jalan di Node 18.
 */
it("runtime Node memenuhi pin .nvmrc workspace web", () => {
  const berkas = join(dirname(fileURLToPath(import.meta.url)), "../../../.nvmrc");
  const diminta = Number(
    readFileSync(berkas, "utf8").trim().replace(/^v/, "").split(".")[0],
  );
  const sekarang = Number(process.versions.node.split(".")[0]);
  expect(sekarang).toBeGreaterThanOrEqual(diminta);
});
