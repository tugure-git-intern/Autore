# Perbaikan Sisa Bug Fitur Hapus App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup enam temuan review yang belum dikerjakan pada fitur hapus app Autore, seluruhnya di `web/` (API + paket kontrak), tanpa mengubah perilaku CLI.

**Architecture:** Semua perbaikan kecil dan berdiri sendiri di dalam berkas yang sudah ada: `actions.ts` (audit pada jalan gagal, gerbang keanggotaan app, pemisahan 404/503, tabel dispatch), `session.ts`/`roles.ts` (dukungan peta role), `index.ts` (urutan gerbang). Tidak ada berkas baru kecuali tes.

**Tech Stack:** TypeScript, Hono (API), Zod-free tipe lokal, Vitest, SolidJS hanya sebagai pembaca `actions-client` (tidak disentuh plan ini).

**Spec:** `.superpowers/sdd/2026-11-20-hapus-app-dashboard/progress.md` (daftar minor Task 4) dan `task-4-report.md`, `task-5-report.md`. Fitur aslinya: `docs/superpowers/plans/2026-11-20-hapus-app-dashboard.md`.

## Global Constraints

- Tanpa dependensi baru; tanpa perubahan pada `cli/` dan `web/apps/dashboard/`.
- Node 22 (web/.nvmrc) untuk semua gerbang: `cd web && npx vitest run && npm run lint && npm run typecheck`.
- Pesan dan nama fungsi berbahasa Indonesia mengikuti berkas sekitar.
- Nama app tetap wajib lolos `APP_ID = /^[A-Za-z0-9._-]{1,64}$/`.
- Kegagalan suite pra-ada `web/apps/dashboard/src/middleware.test.ts` (`Cannot find module @auth/core/jwt.js`) bukan tanggung jawab plan ini: jangan menyentuhnya, jangan mengubah konfigurasi vitest atau dependensi untuk mengakalinya.
- Perubahan CLI DILARANG: `autore hapus-app` adalah sumber kebenaran perilaku hapus.

## Review Focus

- Baris `registry.tsv` yang rusak (kurang kolom, port bukan angka, ada baris kosong/CRLF): API harus tetap bisa menilai keanggotaan app, karena CLI menghapus baris semacam itu. Satu tes Task 2 menutupnya.
- `autore status` gagal (CLI tidak ada, timeout, workspace rusak) tetapi registry punya baris: jawaban harus 503 "tidak bisa dipastikan", bukan 404. Task 3.
- `allowed` berbentuk `Map`: dulu semua login ditolak senyap 403. Satu tes Task 4.
- Audit untuk aksi permanen: timeout atau spawn gagal tidak boleh hilang dari jejak. Task 1.
- Nilai `kind` di luar `deploy`/`scan` masuk `run()`: harus ditolak, tidak boleh diam-diam menjalankan scan. Task 5.

---

### Task 1: Catat audit walau spawn gagal atau timeout

**Files:**
- Modify: `web/apps/api/src/actions.ts` (blok catch spawn di `run` ~271-276 dan di `remove` ~461-466)
- Test: `web/apps/api/src/actions.test.ts`

**Interfaces:**
- Consumes: `audit` yang sudah ada — `audit({ login, email, action, target, exit })`, `exit: number`.
- Produces: tidak ada tanda tangan baru. Baris audit memakai `exit: -1` untuk kegagalan spawn/timeout.

- [ ] **Step 1: Tulis tes gagal**

Tambahkan di `actions.test.ts`, mengikuti pola tes `remove` yang ada (spawn disuntik, audit dipalsukan):

```ts
it("remove mencatat audit walau spawn kehabisan waktu", async () => {
  // deps.spawn melempar Error dengan code "ETIMEDOUT"
  const res = await actions.remove("app-a", "app-a", { login: "alif", email: "a@b.c" });
  expect(res).toMatchObject({ ok: false, status: 504 });
  expect(deps.audit).toHaveBeenCalledWith({
    login: "alif", email: "a@b.c", action: "remove", target: "app-a", exit: -1,
  });
});

it("deploy mencatat audit walau spawn gagal dijalankan", async () => {
  // deps.spawn melempar Error dengan code "ENOENT"
  const res = await actions.run("deploy", "app-a", { login: "alif", email: "a@b.c" });
  expect(res).toMatchObject({ ok: false, status: 503 });
  expect(deps.audit).toHaveBeenCalledWith({
    login: "alif", email: "a@b.c", action: "deploy", target: "app-a", exit: -1,
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts`
Expected: FAIL — `deps.audit` tidak terpanggil pada kedua kasus.

- [ ] **Step 3: Implement audit sebelum `return` gagal**

Di kedua blok `catch (error)`, hitung pesan seperti sekarang, catat audit dulu, baru kembalikan hasil — pola sama dengan audit 422 yang sudah ada:

```ts
} catch (error) {
  const code = (error as { code?: unknown }).code;
  await audit({
    login: author?.login ?? "",
    email: author?.email ?? "",
    action: "remove", // atau `kind` di run()
    target: id,
    exit: -1,
  });
  return code === "ETIMEDOUT" ? failed(504, ...) : failed(503, ...);
}
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts`
Expected: PASS, tes 422 yang lama tetap lulus.

- [ ] **Step 5: Commit**

```bash
git add web/apps/api/src/actions.ts web/apps/api/src/actions.test.ts
git commit -m "fix(api): catat audit walau spawn gagal atau kehabisan waktu"
```

---

### Task 2: Keanggotaan app dari kolom pertama registry mentah

**Files:**
- Modify: `web/apps/api/src/actions.ts` (`appTerdaftar`, ~207-216)
- Test: `web/apps/api/src/actions.test.ts`

**Interfaces:**
- Consumes: `workspace` (string), `loadDashboardStatus(deps.run)` yang sudah ada.
- Produces: `appTerdaftar(id: string)` tidak lagi memakai `bacaRegistry`; keanggotaan registry dinilai dari `split("\t")[0].trim()` per baris.

- [ ] **Step 1: Tulis tes gagal**

```ts
it("remove menerima app berbaris registry legacy dua kolom", async () => {
  // registry.tsv berisi "legacy\t8000\n" dan "app-a\t8000\t8093\n"
  const res = await actions.remove("legacy", "legacy");
  expect(res).toMatchObject({ ok: true, status: 200 });
  expect(deps.spawn).toHaveBeenCalledWith(bin, ["hapus-app", "legacy", "--konfirmasi", "legacy"], expect.anything());
});

it("remove menerima app yang portnya bukan angka", async () => {
  // registry.tsv berisi "busuk\tbukan-angka\n"
  const res = await actions.remove("busuk", "busuk");
  expect(res).toMatchObject({ ok: true, status: 200 });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts`
Expected: FAIL — 404 `tidak terdaftar` (baris legacy dibuang `bacaRegistry`).

- [ ] **Step 3: Implement pembacaan kolom pertama**

```ts
const namaDiRegistry = (isi: string): string[] =>
  isi.split("\n").map((baris) => baris.split("\t")[0].trim()).filter((nama) => nama !== "");

async function appTerdaftar(id: string): Promise<boolean> {
  const isiRegistry = await readFile(join(workspace, "registry.tsv"), "utf8").catch(() => "");
  if (namaDiRegistry(isiRegistry).includes(id)) return true;
  ...
}
```

Komentar WHY: CLI menghapus baris legacy dan baris berport rusak, jadi API tidak boleh lebih ketat daripada CLI.

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/apps/api/src/actions.ts web/apps/api/src/actions.test.ts
git commit -m "fix(api): keanggotaan app dari kolom pertama registry mentah"
```

---

### Task 3: Bedakan 404 tidak terdaftar dari 503 tidak bisa dipastikan

**Files:**
- Modify: `web/apps/api/src/actions.ts` (`appTerdaftar` → `keberadaanApp`, pemakaian di `remove` ~444)
- Test: `web/apps/api/src/actions.test.ts`

**Interfaces:**
- Produces: `type KeberadaanApp = "ada" | "tidak-ada" | "tidak-bisa-dipastikan"` dan `async function keberadaanApp(id: string): Promise<KeberadaanApp>`. Registry yang tidak bisa dibaca (`readFile` gagal selain ENOENT) → `"tidak-bisa-dipastikan"`; `loadDashboardStatus` melempar → `"tidak-bisa-dipastikan"`.

- [ ] **Step 1: Tulis tes gagal**

```ts
it("remove menjawab 503 bila registry dan status tidak bisa diperiksa", async () => {
  // deps.run melempar; registry.tsv tidak ada / tidak terbaca
  const res = await actions.remove("app-a", "app-a");
  expect(res).toMatchObject({ ok: false, status: 503 });
  expect(deps.spawn).not.toHaveBeenCalled();
});

it("remove tetap 404 bila registry terbaca dan app memang tidak ada", async () => {
  const res = await actions.remove("hantu", "hantu");
  expect(res).toMatchObject({ ok: false, status: 404 });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts`
Expected: FAIL — kasus pertama masih 404.

- [ ] **Step 3: Implement tri-state dan pesannya**

Kembalikan `"ada"` bila nama ada di registry mentah atau di `status.data.applications`; `"tidak-ada"` bila registry terbaca DAN status berhasil DAN nama tidak ada di keduanya; sisanya `"tidak-bisa-dipastikan"`. Di `remove`:

```ts
const ada = await keberadaanApp(id);
if (ada === "tidak-bisa-dipastikan") {
  return failed(503, `tidak bisa memastikan keberadaan aplikasi "${id}": registry atau autore status gagal dibaca`);
}
if (ada === "tidak-ada") return failed(404, `aplikasi "${id}" tidak terdaftar`);
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts`
Expected: PASS (termasuk tes yatim dan tes 404 dari Task 4 fitur).

- [ ] **Step 5: Commit**

```bash
git add web/apps/api/src/actions.ts web/apps/api/src/actions.test.ts
git commit -m "fix(api): pisahkan 503 tidak bisa dipastikan dari 404 tidak terdaftar"
```

---

### Task 4: `allowed` berbentuk Map harus dibaca, bukan ditolak senyap

**Files:**
- Modify: `web/packages/contracts/src/roles.ts` (`parseAllowlist` ~33-52)
- Test: `web/packages/contracts/src/roles.test.ts`

**Interfaces:**
- Consumes: `normalizeLogin`, `parseRole` (sudah ada di berkas sama).
- Produces: `parseAllowlist(raw: unknown): Map<string, Role>` menerima `Map<string, Role>` dan `Map<string, unknown>` (nilai lewat `parseRole` seperti cabang objek).

- [ ] **Step 1: Tulis tes gagal**

```ts
it("membaca peta role berbentuk Map", () => {
  const users = parseAllowlist(new Map<string, string>([["Alif", "admin"], ["Budi", "qa"]]));
  expect(users.get("alif")).toBe("admin");
  expect(users.get("budi")).toBe("qa");
});

it("Map dengan role tidak sah dibuang, bukan diberi default", () => {
  const users = parseAllowlist(new Map<string, string>([["alif", "raja"]]));
  expect(users.size).toBe(0);
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run packages/contracts/src/roles.test.ts`
Expected: FAIL — peta kosong (Map masuk cabang objek, `Object.entries` kosong).

- [ ] **Step 3: Implement cabang Map**

Sebelum cabang objek, tambahkan `if (raw instanceof Map)` yang mengiterasi `raw.entries()` dengan aturan sama: login dinormalkan, role lewat `parseRole`, entri tidak sah dibuang, tetap fail closed.

- [ ] **Step 4: Jalankan seluruh gerbang web**

Run: `cd web && npx vitest run && npm run lint && npm run typecheck`
Expected: semua lulus kecuali `middleware.test.ts` pra-ada; typecheck bersih (tipe `ReadonlyMap` di `session.ts:123` kini benar-benar didukung).

- [ ] **Step 5: Commit**

```bash
git add web/packages/contracts/src/roles.ts web/packages/contracts/src/roles.test.ts
git commit -m "fix(contracts): parseAllowlist mendukung peta role berbentuk Map"
```

---

### Task 5: `run()` menolak jenis aksi yang bukan deploy/scan

**Files:**
- Modify: `web/apps/api/src/actions.ts` (`run` ~218-295, `ActionKind` pemakaian)
- Test: `web/apps/api/src/actions.test.ts`

**Interfaces:**
- Produces: `type KindJalankan = "deploy" | "scan"`; `run(kind: KindJalankan, appId?: string, author?: Identitas)`. Argumen perintah dari tabel: `{ deploy: (dir, author) => argvDeploy(dir, author), scan: (dir) => ["scan", "--no-docker", "--path", dir] }`.

- [ ] **Step 1: Tulis tes gagal**

```ts
it("run menolak jenis aksi yang tidak dikenal tanpa spawn", async () => {
  // panggilan runtime lewat cast, membuktikan tidak ada jalur diam-diam ke scan
  const res = await (actions.run as unknown as (k: string, id: string) => Promise<ActionResult>)("remove", "app-a");
  expect(res).toMatchObject({ ok: false, status: 400 });
  expect(deps.spawn).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/api/src/actions.test.ts`
Expected: FAIL — sekarang "remove" menjalankan scan.

- [ ] **Step 3: Implement tipe sempit + tabel dispatch**

Persempit parameter ke `KindJalankan`, ambil argv dari tabel, dan tambahkan cabang `else return failed(400, \`jenis aksi "${kind}" tidak dikenal\`)` untuk panggilan runtime di luar tipe. Sesuaikan pemanggil di `index.ts` bila typecheck menuntut (keduanya memakai literal `deploy`/`scan`, jadi tidak seharusnya berubah).

- [ ] **Step 4: Jalankan seluruh gerbang web**

Run: `cd web && npx vitest run && npm run lint && npm run typecheck`
Expected: lulus, kecuali suite pra-ada.

- [ ] **Step 5: Commit**

```bash
git add web/apps/api/src/actions.ts web/apps/api/src/actions.test.ts
git commit -m "fix(api): run() menolak jenis aksi di luar deploy dan scan"
```

---

### Task 6: Urutan gerbang rute remove dan catat batas yang diketahui

**Files:**
- Modify: `web/apps/api/src/index.ts` (~200-204)
- Modify: `docs/superpowers/plans/2026-11-20-hapus-app-dashboard.md` (bagian "Batas yang diketahui")
- Test: `web/apps/api/src/index.test.ts`

**Interfaces:**
- Produces: urutan middleware `/api/actions/remove` = sesi `dev` → peran `admin` → rate limiter; sesi berperan rendah ditolak 403 tanpa membakar kuota rate limiter.

- [ ] **Step 1: Tulis tes gagal**

```ts
it("dev yang menembak remove tidak membakar kuota rate limiter", async () => {
  // sesi dev; panggil rute lebih dari batas rate limiter; semua harus 403, tidak ada 429
  expect(statuses.every((s) => s === 403)).toBe(true);
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd web && npx vitest run apps/api/src/index.test.ts`
Expected: FAIL bila kuota limiter per-login habis lebih dulu (429 muncul).

- [ ] **Step 3: Pindahkan gerbang admin di atas rate limiter**

```ts
app.use("/api/actions/remove", requireSession(auth, "admin"));
app.use("/api/actions/*", rateLimiter);
```

Tambahkan komentar WHY: gerbang paling ketat lebih dulu supaya penolakan izin tidak memakan kuota. Tes 403/200 lama harus tetap lulus.

- [ ] **Step 4: Catat batas yang diketahui di plan fitur**

Tambahkan di `docs/superpowers/plans/2026-11-20-hapus-app-dashboard.md` bagian "Batas yang diketahui": app berbaris registry legacy bisa dihapus lewat CLI dan API, tetapi tidak muncul di daftar dashboard (sumber daftar `autore status` melewati baris itu), sehingga tombol Hapus belum menawarkannya.

- [ ] **Step 5: Jalankan seluruh gerbang web, lalu commit**

Run: `cd web && npx vitest run && npm run lint && npm run typecheck`

```bash
git add web/apps/api/src/index.ts web/apps/api/src/index.test.ts docs/superpowers/plans/2026-11-20-hapus-app-dashboard.md
git commit -m "fix(api): gerbang admin mendahului rate limiter di rute remove"
```

---

## Di Luar Cakupan (tiket terpisah)

- Menampilkan app berbaris legacy di daftar dashboard: menuntut `entri_registry` (CLI Rust) melonggarkan baris legacy — perubahan perilaku fitur lain, bukan bug hapus.
- Mengubah `cli/` agar `hapus_container`/`container_ada` memakai satu pemanggilan (`Option<bool>`): poles, bukan cacat.
- Perbaikan suite pra-ada `web/apps/dashboard/src/middleware.test.ts` (resolusi `@auth/core/jwt.js` di worktree dengan node_modules symlink).
