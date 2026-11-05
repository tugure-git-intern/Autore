# Tombol Sync Berfungsi (Status + Runs + Active) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tombol Sync di topbar menyinkronkan ketiga endpoint baca (`/api/status`, `/api/runs`, `/api/active`) sekaligus, menampilkan spinner + disabled selama proses, memperbarui angka di layar, lalu memunculkan toast sukses/gagal.

**Architecture:** Satu pemilik data tetap di `StatusProvider` (sudah jadi pemilik `/api/status`). Tarik dua sumber lain ke jalur yang sama dengan mengekstrak `useRuns()` dari `OverviewAnalytics` dan menambah `refresh()` pada `useActivePipelines()`, lalu provider memegang ketiganya. `sync()` = `Promise.all` atas tiga fungsi refresh yang **mengembalikan boolean, bukan reject**, jadi spinner bertahan sampai ketiganya selesai dan toast ditentukan oleh "semua true". Tidak ada state ganda: tiap hook tetap satu-satunya penulis datanya, pemanggilnya berubah dari komponen lokal ke provider.

**Tech Stack:** Next.js 15 (App Router, client components), React 19, TypeScript, Tailwind v4, Vitest + Testing Library, Playwright.

**Spec:** permintaan bos alif (chat 2026-11-05) — lihat §Catatan temuan; tidak ada dokumen spec terpisah.

## Catatan temuan (kondisi nyata, bukan asumsi)

Tombol Sync **bukan** pajangan: `Navbar` sudah memanggil `status.refresh` dan sudah `disabled={refreshing}` (`navbar.tsx:79`, `app-shell.tsx:77`, tes `navbar.test.tsx:141` "refetches only /api/status"). Yang belum ada:

1. hanya `/api/status` yang ditarik; `/api/runs` dimiliki `OverviewAnalytics` (fetch sekali di `useEffect`, tanpa jalan refresh) dan `/api/active` dimiliki `useActivePipelines` (polling 10 s, tanpa jalan manual).
2. ikon `RefreshCw` tidak berputar.
3. belum ada toast sama sekali di pohon komponen (tidak ada `toast.tsx`, tidak ada keyframes toast di `globals.css`).

Implikasi: tes `navbar.test.tsx:141` mengunci perilaku lama ("only /api/status") dan **wajib diganti** di T5, bukan ditambal.

## Global Constraints

- Copy UI bahasa Indonesia, verbatim: `Data berhasil disinkronkan.` / `Gagal menyinkronkan data.`; label tombol tetap `Sync`.
- Light mode, border tipis, font Inter; dilarang gradien dan bayangan lebih berat dari `shadow-sm` (e2e `dashboard.spec.ts:58` mengunci ini).
- Sync **hanya** GET ke `/api/status`, `/api/runs`, `/api/active`. Dilarang menyentuh `/api/actions/*` (itu jalur trigger Jenkins).
- Semua panggilan `fetch` tetap `cache: "no-store"` (`status-client.ts:5`, `runs-client.ts:5`, `active-client.ts:5`).
- `next build` (typecheck) + `npx vitest run` + `npx dotenv -e .env -- npm run test:e2e --workspace @autore/dashboard` adalah gate; `cargo` tidak tersentuh di fase ini.
- Baseline terukur sebelum tugas ini: vitest **37 berkas / 289 tes**, e2e **27 passed**.

## Review Focus

1. Sync ditekan saat satu endpoint lambat: tombol harus tetap disabled sampai **ketiga** request selesai, dan klik kedua saat masih berjalan tidak boleh menambah request.
2. `/api/runs` gagal (503) tapi `/api/status` sukses: status baru tetap masuk layar, toast tetap **gagal**; satu kegagalan tidak boleh membatalkan data yang sudah tiba.
3. Pindah rute (unmount) saat sync berjalan: tidak ada `setState` setelah unmount dan tidak ada toast yang muncul di rute baru.
4. Dua sync cepat berurutan: hanya ada satu toast, timer auto-dismiss milik sync terakhir yang berlaku.
5. `stale: true` dari API (data lama tapi permintaan sukses): toast tetap **sukses**, karena banner basi per-section sudah menangani maknanya.

---

### Task 1: Hook `useRuns` (pemilik `/api/runs` yang bisa di-refresh)

**Files:**
- Create: `web/apps/dashboard/src/components/use-runs.ts`
- Create: `web/apps/dashboard/src/components/use-runs.test.tsx`

**Interfaces:**
- Consumes: `fetchRuns(signal?)` dari `@/lib/runs-client`; tipe `RunsPayload` dari `@/lib/contracts`.
- Produces:
```ts
export interface HasilRuns {
  data: RunsPayload | null;
  stale: boolean;      // data?.stale ?? (gagal ? true : false)  → true juga saat permintaan terakhir gagal
  memuat: boolean;     // belum ada data dan belum gagal
  gagal: boolean;
  refresh: () => Promise<boolean>;  // true = data baru masuk; TIDAK pernah reject
}
export function useRuns(): HasilRuns
```

- [ ] **Step 1: Write the failing test**

```tsx
// use-runs.test.tsx
it("memuat sekali di awal lalu refresh mengganti data tanpa mengosongkan yang lama", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(respons(RUNS_1))
    .mockResolvedValueOnce(respons(RUNS_2))
    .mockRejectedValueOnce(new Error("runs mati"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useRuns());
  await waitFor(() => expect(result.current.data?.runs[0].number).toBe(8));
  expect(fetchMock.mock.calls[0][0]).toBe("/api/runs");

  await expect(result.current.refresh()).resolves.toBe(true);   // data baru
  expect(result.current.data?.runs[0].number).toBe(21);

  await expect(result.current.refresh()).resolves.toBe(false);  // gagal: boolean, bukan reject
  expect(result.current.gagal).toBe(true);
  expect(result.current.data?.runs[0].number).toBe(21);         // data lama tetap tampil
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Autore/web && npx vitest run apps/dashboard/src/components/use-runs.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-runs"`.

- [ ] **Step 3: Implement `useRuns` in `use-runs.ts`**

Fetch awal di `useEffect` dengan `AbortController`; `refresh` melakukan fetch baru, `catch` → `setGagal(true)` dan return `false`. Abort saat unmount.

- [ ] **Step 4: Run test to verify it passes**

Run: ulangi perintah Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/apps/dashboard/src/components/use-runs.ts web/apps/dashboard/src/components/use-runs.test.tsx
git commit -m "feat(dashboard): useRuns — pemilik /api/runs yang bisa di-refresh manual"
```

---

### Task 2: `useActivePipelines` dapat jalan refresh manual

**Files:**
- Modify: `web/apps/dashboard/src/components/use-active-pipelines.ts`
- Modify: `web/apps/dashboard/src/components/use-active-pipelines.test.tsx`

**Interfaces:**
- Produces: `HasilActive.refresh: () => Promise<boolean>` (true = data masuk, tidak pernah reject). Polling 10 s dan aturan "tidak menumpuk permintaan" tetap: kalau ada permintaan berjalan, `refresh()` menunggu permintaan **itu** (tidak menambah hit ke Jenkins) dan mengembalikan hasilnya.

- [ ] **Step 1: Write the failing test**

```tsx
it("refresh manual menunggu permintaan yang sedang jalan, bukan menambah hit kedua", async () => {
  let lepas: (r: Response) => void = () => {};
  const fetchMock = vi.fn(() => new Promise<Response>((r) => { lepas = r; }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useActivePipelines());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  const janji = result.current.refresh();          // permintaan pertama masih menggantung
  expect(fetchMock).toHaveBeenCalledTimes(1);      // tidak ada hit kedua
  lepas(respons({ data: ACTIVE, stale: false }));
  await expect(janji).resolves.toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/dashboard/src/components/use-active-pipelines.test.tsx`
Expected: FAIL — `result.current.refresh is not a function`.

- [ ] **Step 3: Implement**

Simpan promise permintaan berjalan di dalam `useEffect` (mis. `let sedangJalan: Promise<boolean> | null`), ekspos lewat `setState`/`useRef` agar `refresh` di luar effect bisa memanggilnya; kalau tidak ada yang jalan, jalankan `muat()`.

- [ ] **Step 4: Run test to verify it passes** — perintah Step 2, Expected: PASS (tes lama tetap hijau).

- [ ] **Step 5: Commit** — `feat(dashboard): refresh manual pada useActivePipelines tanpa menumpuk permintaan`.

---

### Task 3: Komponen `Toast`

**Files:**
- Create: `web/apps/dashboard/src/components/toast.tsx`
- Create: `web/apps/dashboard/src/components/toast.test.tsx`

**Interfaces:**
- Produces:
```ts
export type JenisToast = "sukses" | "gagal";
export function Toast({ pesan, jenis, onTutup }: { pesan: string; jenis: JenisToast; onTutup: () => void }): JSX.Element
```
- `sukses` → `role="status"`, ikon `CheckCircle2`, `data-testid="toast"`; `gagal` → `role="alert"`, ikon `AlertTriangle`, border/teks merah. Posisi `fixed bottom-4 right-4 z-20`, `border`, `bg-white`, `shadow-sm`.

- [ ] **Step 1: Write the failing test**

```tsx
it("sukses pakai role status, gagal pakai role alert", () => {
  const { rerender } = render(<Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={() => {}} />);
  expect(screen.getByRole("status")).toHaveTextContent("Data berhasil disinkronkan.");
  rerender(<Toast pesan="Gagal menyinkronkan data." jenis="gagal" onTutup={() => {}} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Gagal menyinkronkan data.");
});

it("menutup sendiri setelah 4 detik", () => {
  vi.useFakeTimers();
  const onTutup = vi.fn();
  render(<Toast pesan="Data berhasil disinkronkan." jenis="sukses" onTutup={onTutup} />);
  vi.advanceTimersByTime(4000);
  expect(onTutup).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run apps/dashboard/src/components/toast.test.tsx`, Expected: import `./toast` tidak ketemu.

- [ ] **Step 3: Implement `toast.tsx`** — auto-dismiss via `useEffect` + `setTimeout(4000)` yang di-`clearTimeout` saat unmount/pesan berubah.

- [ ] **Step 4: Run test to verify it passes.** PASS.

- [ ] **Step 5: Commit** — `feat(dashboard): komponen Toast (role status/alert, tutup 4 detik)`.

---

### Task 4: Provider memegang tiga sumber + `sync()` + toast

**Files:**
- Modify: `web/apps/dashboard/src/components/app-shell.tsx`
- Create: `web/apps/dashboard/src/components/app-shell.test.tsx` (tes `sync` yang butuh provider; describe `AppShell` di `navbar.test.tsx` boleh tetap, tapi tes baru taruh di berkas ini)

**Interfaces:**
- Consumes: `useRuns()` (T1), `useActivePipelines()` (T2), `Toast` (T3).
- Produces (nilai context `useStatus()`):
```ts
export type StatusState = {
  state: ApiStatusResponse | null;
  loading: boolean;
  failed: boolean;
  refreshing: boolean;      // dipertahankan sebagai nama prop Navbar; artinya kini "sync berjalan"
  sync: () => Promise<boolean>;  // Promise.all tiga refresh; true = ketiganya sukses
  refresh: () => void;      // tetap ada untuk pemanggil lama (mis. onDone aksi deploy)
  reload: () => void;
  runs: HasilRuns;
  aktif: HasilActive;
  toast: { pesan: string; jenis: JenisToast } | null;
};
```
- `sync()` memakai `Promise.all([load(true), runs.refresh(), aktif.refresh()])` di mana `load(true)` diubah mengembalikan `Promise<boolean>`; `semuaSukses = hasil.every(Boolean)` lalu `setToast(semuaSukses ? { pesan: "Data berhasil disinkronkan.", jenis: "sukses" } : { pesan: "Gagal menyinkronkan data.", jenis: "gagal" })`. Toast di-render di `Shell` (`<Toast … onTutup={() => setToast(null)} />`), hanya kalau `toast !== null`, dan tidak dirender di rute `TANPA_KERANGKA` (`/login`, `/403`) karena `Shell` sudah early-return di situ.

- [ ] **Step 1: Write the failing test**

```tsx
// app-shell.test.tsx
it("satu klik Sync menarik tiga endpoint sekali, dan menampilkan toast sukses", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/status") return ok({ data: STATUS, stale: false });
    if (url === "/api/runs") return ok({ data: RUNS, stale: false });
    if (url === "/api/active") return ok({ data: ACTIVE, stale: false });
    throw new Error(`permintaan tidak terduga: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<AppShell user={USER}><div /></AppShell>);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  expect(screen.getByRole("button", { name: "Sync" })).toBeDisabled();

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
  expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
    "/api/active", "/api/active", "/api/runs", "/api/runs", "/api/status", "/api/status",
  ]);
  expect(await screen.findByText("Data berhasil disinkronkan.")).toBeVisible();
});

it("toast gagal saat salah satu endpoint menolak, dan tombol kembali aktif", async () => {
  // /api/runs dijawab 503 setiap kali; /api/status + /api/active normal
  // → expect findByText("Gagal menyinkronkan data.") dan tombol Sync tidak lagi disabled
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run apps/dashboard/src/components/app-shell.test.tsx`, Expected: FAIL.

- [ ] **Step 3: Implement di `app-shell.tsx`** — tambah state `runs`, `aktif`, `toast`; ubah `load` jadi mengembalikan `Promise<boolean>`; tambah `sync`; render `<Toast>` di `Shell`. `refreshing` = state selama `sync` berjalan (dipakai spinner/disabled).

- [ ] **Step 4: Run test to verify it passes.** PASS.

- [ ] **Step 5: Commit** — `feat(dashboard): satu Sync menarik status+runs+active dengan Promise.all dan toast hasilnya`.

---

### Task 5: Tombol Sync berputar dan tidak bisa diklik saat berjalan

**Files:**
- Modify: `web/apps/dashboard/src/components/navbar.tsx`
- Modify: `web/apps/dashboard/src/components/navbar.test.tsx` (tes `refetches only /api/status` di baris 141 **diganti**, bukan dipertahankan)

**Interfaces:**
- Consumes: prop `refreshing?: boolean` (tetap nama itu; artinya "sync berjalan").
- Produces: tombol `Sync` dengan `disabled={refreshing}`, ikon `<RefreshCw className={"h-4 w-4 motion-safe:animate-spin" | "h-4 w-4"} aria-hidden="true" />`, dan `aria-busy={refreshing}`.

- [ ] **Step 1: Write the failing test**

```tsx
it("berputar dan disabled selama sync, kembali normal setelah selesai", () => {
  const { rerender } = render(
    <Navbar title="Dashboard" connection={{ tone: "green", label: "Sistem Siap" }} onSync={() => {}} refreshing user={USER} />,
  );
  const tombol = screen.getByRole("button", { name: "Sync" });
  expect(tombol).toBeDisabled();
  expect(tombol).toHaveAttribute("aria-busy", "true");
  expect(tombol.querySelector("svg")?.getAttribute("class")).toContain("motion-safe:animate-spin");

  rerender(<Navbar title="Dashboard" connection={{ tone: "green", label: "Sistem Siap" }} onSync={() => {}} user={USER} />);
  expect(screen.getByRole("button", { name: "Sync" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Sync" }).querySelector("svg")?.getAttribute("class")).not.toContain("animate-spin");
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run apps/dashboard/src/components/navbar.test.tsx`, Expected: FAIL (`aria-busy` belum ada, kelas spin belum ada). Tes lama "refetches only /api/status" dihapus pada step ini karena mengunci perilaku yang sengaja dibuang.

- [ ] **Step 3: Implement di `navbar.tsx`.**

- [ ] **Step 4: Run test to verify it passes.** PASS.

- [ ] **Step 5: Commit** — `feat(dashboard): tombol Sync berputar dan terkunci selama sync`.

---

### Task 6: `OverviewAnalytics` membaca provider, bukan fetch sendiri

**Files:**
- Modify: `web/apps/dashboard/src/components/overview-analytics.tsx`
- Modify: `web/apps/dashboard/src/components/overview-analytics.test.tsx`

**Interfaces:**
- Consumes: `useStatus().runs` (`data`, `stale`, `memuat`, `gagal`) dan `useStatus().aktif` (`active`, `counts`, `stale`).
- Produces: komponen yang tidak lagi memanggil `fetchRuns`/`useActivePipelines` langsung — akibatnya Sync (T4) benar-benar menggerakkan angka di layar.

- [ ] **Step 1: Ubah tes lebih dulu** — bungkus render dengan `StatusProvider` (dan `vi.stubGlobal("fetch", …)` untuk tiga endpoint, bukan dua), lalu tambah:

```tsx
it("angka Recent Runs ikut berubah setelah Sync ditekan", async () => {
  // fetch mock: panggilan pertama /api/runs → run #8; panggilan kedua → run #21
  // render <StatusProvider><OverviewAnalytics /></StatusProvider>
  expect(await screen.findByText("tes-web #8")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  expect(await screen.findByText("tes-web #21")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run apps/dashboard/src/components/overview-analytics.test.tsx`, Expected: FAIL (belum ada tombol Sync di dalam provider ini — tambahkan `<Navbar …>` pada wrapper tes, atau tekan `sync()` lewat helper tombol di dalam provider tes).

- [ ] **Step 3: Implement** — buang `useEffect`/`useState`/`fetchRuns` dari komponen, baca dari `useStatus()`.

- [ ] **Step 4: Run test to verify it passes.** PASS.

- [ ] **Step 5: Commit** — `refactor(dashboard): OverviewAnalytics membaca runs+active dari provider`.

---

### Task 7: Bukti UI ikut ter-update di tingkat halaman

**Files:**
- Modify: `web/apps/dashboard/src/app/page.test.tsx`

- [ ] **Step 1: Tulis tes** — halaman penuh: setelah klik `Sync`, baris Recent Runs dan skor Repository Health berubah dari payload lama ke payload baru:

```tsx
test("Sync menukar isi layar ke payload baru tanpa reload", async () => {
  // /api/status pertama health 0%, kedua 10%; /api/runs pertama #8, kedua #21
  // render <StatusProvider><DashboardPage /></StatusProvider>
  expect(await screen.findByText("0%")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  expect(await screen.findByText("10%")).toBeInTheDocument();
  expect(await screen.findByText("tes-web #21")).toBeInTheDocument();
  expect(await screen.findByText("Data berhasil disinkronkan.")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run apps/dashboard/src/app/page.test.tsx`, Expected: FAIL.

- [ ] **Step 3: Perbaiki stub/mock yang perlu** (bukan kode produksi; kode produksi sudah selesai di T4–T6).

- [ ] **Step 4: Run test to verify it passes.** PASS.

- [ ] **Step 5: Commit** — `test(dashboard): bukti angka di layar berubah setelah Sync`.

---

### Task 8: e2e — spinner, toast, dan jaminan tidak memicu Jenkins

**Files:**
- Modify: `web/apps/dashboard/e2e/dashboard.spec.ts`

- [ ] **Step 1: Tulis tes** (deskripsi baru `tombol Sync`):

```ts
test("berputar, terkunci, menampilkan toast, dan tidak pernah POST (tidak memicu Jenkins)", async ({ page }) => {
  const bukanGet: string[] = [];
  const urlGet: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (r.method() !== "GET") bukanGet.push(`${r.method()} ${u}`);
    else if (/\/(api\/status|api\/runs|api\/active)$/.test(u)) urlGet.push(new URL(u).pathname);
  });

  await page.goto("/");
  const tombol = page.getByRole("button", { name: "Sync" });
  await tombol.click();
  await expect(tombol).toBeDisabled();
  // Kelas spin tidak cukup: pastikan animasinya benar-benar dibuat browser.
  expect(await tombol.locator("svg").evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);

  await expect(page.getByText("Data berhasil disinkronkan.")).toBeVisible();
  await expect(tombol).toBeEnabled();
  expect(new Set(urlGet)).toEqual(new Set(["/api/status", "/api/runs", "/api/active"]));
  expect(bukanGet).toEqual([]);
});

test("toast hilang sendiri setelah sekitar 4 detik", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.getByText("Data berhasil disinkronkan.")).toBeVisible();
  await expect(page.getByText("Data berhasil disinkronkan.")).toBeHidden({ timeout: 6000 });
});
```

- [ ] **Step 2: Jalankan, lihat RED** — `cd ~/Autore/web && export LD_LIBRARY_PATH=/tmp/pwdeps/root/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH && npx dotenv -e .env -- npm run test:e2e --workspace @autore/dashboard`
Expected: 2 tes baru FAIL; 27 tes lama tetap PASS.

- [ ] **Step 3: Perbaiki selektor/stub bila perlu** (kode produksi tidak berubah lagi).

- [ ] **Step 4: Bangun ulang dashboard produksi lalu ulangi** (e2e menembak `:9120` produksi):
`npm run build:dashboard && systemctl --user restart autore-web-dashboard`
Expected: **29 passed**.

- [ ] **Step 5: Commit** — `test(dashboard): e2e Sync — spinner, toast, dan tidak ada POST ke /api/actions`.

---

### Task 9: Gate akhir + kirim

**Files:** tidak ada berkas baru.

- [ ] **Step 1: Gate web**

```bash
cd ~/Autore/web
npx vitest run                     # target: 40 berkas / ~302 tes, 0 gagal
npx tsc -p apps/dashboard --noEmit # exit 0
npm run build:dashboard            # typecheck produksi
npx dotenv -e .env -- npm run test:e2e --workspace @autore/dashboard   # target: 29 passed
```

- [ ] **Step 2: Bukti visual** — skrip `live-health.cjs` dimodifikasi agar ikut menekan Sync dan menangkap toast: simpan ke `/tmp/sync-live.png`, tarik ke laptop.

- [ ] **Step 3: Commit + push**

```bash
git add -A && git commit -m "feat(dashboard): tombol Sync menarik status+runs+active dengan spinner dan toast"
git push origin main
```

---

## Batas yang disadari

- `/api/runs` di Hono punya cache 60 s dan `/api/active` 5 s; satu klik Sync bisa mengembalikan **isi cache yang sama** selama jendela itu. Toast tetap "sukses" karena permintaannya sukses — bukan janji bahwa angka berubah.
- Polling `/api/active` tiap 10 s tetap jalan seperti sekarang; `refresh()` berbagi permintaan yang sedang jalan supaya Jenkins tidak kena hit tambahan.
- Sync tidak menyentuh `/api/actions/*`: memicu build Jenkins tetap hanya lewat tombol Deploy / Jalankan Ulang (dengan modal konfirmasi).
- Toast tidak muncul di `/login` dan `/403` (keduanya memang tanpa kerangka).
