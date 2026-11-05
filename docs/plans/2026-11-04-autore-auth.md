# Autore Phase 4 — Authentication & Authorization (GitHub OAuth + Whitelist)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development atau superpowers:executing-plans. Langkah pakai checkbox (`- [ ]`). Setiap task WAJIB RED dulu (tes gagal, outputnya ditempel), baru GREEN.

**Goal:** Dashboard `:9120` dan API aksi `:9121` berhenti jadi "terbuka karena tailnet". Login lewat GitHub OAuth (Auth.js v5), username dibatasi whitelist, semua route kecuali `/login` + `/api/auth/*` diproteksi middleware, dan `POST /api/actions/*` menolak 401 tanpa session sah.

**Architecture:** GitHub OAuth jadi satu-satunya verifikator identitas (tanpa password, tanpa credential store, tanpa database — `strategy: "jwt"`). Username GitHub yang lolos whitelist disimpan di dalam JWE cookie `authjs.session-token`. Dashboard memakai cookie itu untuk 3 hal: `middleware.ts` (proteksi route), `auth()` (username di UserMenu), `signOut()` (logout). Hono TIDAK memanggil Next.js sama sekali; ia mendekripsi cookie yang sama dengan `getToken()` dari `@auth/core/jwt` memakai `AUTH_SECRET` + `salt` = nama cookie. Jadi tidak ada shared session store, tidak ada network hop, dan API tetap bisa menolak sendiri.

**Tech Stack:** Next 15.5.28 (App Router, `src/`), React 19.1.1, `next-auth` `5.0.0-beta.32` + `@auth/core` `0.41.3` (dua-duanya dipin eksak — versi `@auth/core` di API harus sama persis dengan yang dipakai `next-auth`, kalau tidak dekripsi JWE bisa meleset), Hono 4.13.16, Vitest 3.2.7, Playwright 1.49.1.

**Spec:** permintaan user Phase 4 (verbatim di bagian Decisions) + `docs/plans/2026-11-04-autore-visual-analytics.md` (Phase 3, keadaan awal).

## Global Constraints

- Node `v18.19.1` di VPS. Semua dependency baru dipin **eksak**.
- **Tidak ada sistem password manual.** Tidak ada `Credentials` provider, tidak ada field password, tidak ada tabel user. Verifikasi identitas 100% milik GitHub.
- Session tidak sah/expired → **redirect ke `/login`** (middleware untuk HTML, `actions-client.ts` untuk XHR 401).
- Username tidak ada di whitelist → **`/403`** ("Akses Ditolak"), bukan `/login` (biar jelas bedanya "belum login" vs "login tapi ditolak").
- Rahasia (`GITHUB_SECRET`, `NEXTAUTH_SECRET`) **tidak pernah** masuk repo, log, pesan commit, atau output terminal. `.env` sudah di-ignore `.gitignore:3:.env`.
- Semua kerja di VPS (`ssh vps`, `~/Autore`). Tes: `npx vitest run` (dari `web/`), `npx tsc -p apps/dashboard/tsconfig.json --noEmit`, `npm run build:dashboard`.
- Visual halaman baru: Light Mode, border `border-gray-200`, font Inter, tombol GitHub di tengah, tanpa gradient/shadow berat (kontrak e2e Phase 3).
- Copy bahasa Indonesia.

## Decisions (dan alasan)

1. **Nama environment variable: dipakai nama yang diminta user** (`GITHUB_ID`, `GITHUB_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `AUTORE_ALLOWED_USERS`), **tapi di `auth.ts` dibaca eksplisit** (`GITHUB_ID ?? AUTH_GITHUB_ID`, `AUTH_SECRET ?? NEXTAUTH_SECRET`). Alasannya: Auth.js v5 lebih suka prefix `AUTH_*` dan `NEXTAUTH_*` cuma alias — dengan pembacaan eksplisit, dua-duanya jalan dan tidak ada tebakan env yang bikin "login tiba-tiba `MissingSecretError`".
2. **`AUTH_TRUST_HOST=true` wajib** di `.env`: dashboard di belakang tailnet, host header bukan `localhost`, v5 menolak host tak dikenal kalau flag ini mati.
3. **Whitelist = `web/allowed-users.json`**, sumber kebenaran. `AUTORE_ALLOWED_USERS` (comma-separated) kalau **tidak kosong** menimpa file itu. Username dinormalkan `toLowerCase()` + `trim()` di kedua sisi — GitHub username case-insensitive, whitelist `Alif` harus cocok dengan login `alif`.
4. **`.env` tinggal di `web/.env`** dan disuntik lewat `EnvironmentFile=` di kedua unit systemd. Bukan `web/apps/dashboard/.env`: Next hanya memuat `.env` dari direktori app-nya sendiri, sementara Hono (`tsx`) tidak memuat `.env` sama sekali — satu file + `EnvironmentFile` bikin satu sumber rahasia untuk dua proses.
5. **Cookie yang diverifikasi Hono** = `authjs.session-token` (http) atau `__Secure-authjs.session-token` (https); `salt` HARUS sama dengan nama cookie yang ketemu (HKDF memakai nama cookie sebagai salt). Isinya JWE `A256CBC-HS512`.
6. **`/api/status`, `/api/runs`, `/healthz` tetap terbuka** (read-only, dan Hono hanya listen di `127.0.0.1` sehingga cuma bisa dijangkau lewat proxy dashboard). Yang wajib 401 hanya `POST /api/actions/*` — sesuai permintaan.
7. **Middleware TIDAK menyaring `/api/*`.** Alasannya: redirect 307 ke `/login` menghasilkan HTML di dalam `fetch()` XHR — klien melihat "200 tapi isinya halaman login", bukan 401. Boundary API dipegang Hono (`401` JSON), boundary halaman dipegang middleware.
8. **Revocation:** `session.maxAge` disetel `8 * 60 * 60` (bukan default 30 hari) dan middleware mengecek whitelist di **setiap** request. Jadi menghapus user dari `allowed-users.json` + restart dashboard langsung mengeluarkan dia di request berikutnya, tanpa menunggu cookie kedaluwarsa.
9. **Gate kedua di Hono (opsional, 5 baris):** kalau `AUTORE_ALLOWED_USERS` di-set, API juga menolak `403` saat `token.login` tidak ada di daftar. Kalau kosong, API percaya tanda tangan token saja. Ditulis jujur di README supaya tidak jadi rasa aman palsu.
10. **`allowed-users.json` bacaannya di-`import` (bundle), bukan `fs.readFileSync`.** Konsisten dengan pola Next, edge-safe untuk middleware. Konsekuensi: mengubah whitelist butuh rebuild + restart — itu memang proses deploy normal di sini.

## Known Risks

1. **`@auth/core/jwt` masih "akan direfaktor"** (peringatan resmi Auth.js) dan docs-nya menyatakan JWT-nya "untuk dipakai app yang menerbitkannya". Kita tetap pakai sesuai permintaan user, tapi semua pemakaian dikurung di satu file (`apps/api/src/session.ts`) + tes kontrak, sehingga kalau API-nya berubah, penggantinya cuma satu tempat. Fallback kalau benar-benar rusak: route handler dashboard memanggil `auth()` lalu meneruskan ke Hono dengan header internal dari rahasia bersama.
2. **Versi `@auth/core` harus identik** di `@autore/dashboard` (via `next-auth`) dan `@autore/api`. `npm ls @auth/core` wajib menunjukkan satu versi.
3. **E2E Playwright belum ikut Phase 3** (`dashboard.spec.ts` masih meng-assert 3 link sidebar, padahal sekarang 4, dan belum tahu auth). Task 10 memperbaikinya sekaligus memberi sesi palsu yang sah lewat `encode()`.
4. **`npm install` menambah `next-auth` + `@auth/core`** — butuh akses registry dari VPS (biasanya ada; kalau mati, pakai `npm ci` dari cache lalu lapor).

---

### Task 1: Dependency Auth.js + `.env.example` + guard gitignore

**Files:**
- Modify: `web/apps/dashboard/package.json` (deps eksak)
- Modify: `web/apps/api/package.json` (dep `@auth/core` eksak)
- Create: `web/.env.example`
- Modify: `web/README.md` (bagian Environment)

**Interfaces:**
- Produces: `next-auth@5.0.0-beta.32` di `@autore/dashboard`; `@auth/core@0.41.3` di `@autore/api` (dan transitif di dashboard).

- [ ] **Step 1: Pasang dependency (eksak)**

```bash
ssh vps 'cd ~/Autore/web && npm install --save-exact --workspace apps/dashboard next-auth@5.0.0-beta.32 \
  && npm install --save-exact --workspace apps/api @auth/core@0.41.3'
```

- [ ] **Step 2: Verifikasi satu versi `@auth/core`** — `npm ls @auth/core` harus menampilkan **satu** entri `0.41.3` (deduped boleh). Dua versi = stop, lapor.

- [ ] **Step 3: Tulis `web/.env.example`**

```dotenv
# Autore dashboard + API — salin ke web/.env, jangan pernah commit .env
# Client ID/Secret dari GitHub OAuth App (akun tugure-git-intern)
GITHUB_ID=
GITHUB_SECRET=
# Rahasia cookie sesi (openssl rand -base64 32)
NEXTAUTH_SECRET=
# URL dashboard dari sudut pandang browser
NEXTAUTH_URL=http://100.80.3.14:9120
# Wajib di v5 saat tidak jalan di localhost
AUTH_TRUST_HOST=true
# Whitelist tambahan (comma-separated). Kosong = pakai allowed-users.json
AUTORE_ALLOWED_USERS=
```

- [ ] **Step 4: Guard gitignore** — `ssh vps 'cd ~/Autore && git check-ignore -v web/.env && git check-ignore -v web/.env.example; echo "exit=$?"'`. Harapan: `web/.env` **ter-ignore**, `web/.env.example` **tidak** (perintah `check-ignore` untuk `.env.example` harus `exit=1`).

- [ ] **Step 5: Commit**

```bash
git add web/apps/*/package.json web/package-lock.json web/.env.example web/README.md
git commit -m "chore(web): pasang next-auth v5 dan siapkan contoh environment auth"
```

---

### Task 2: Loader whitelist (murni, tanpa IO)

**Files:**
- Create: `web/allowed-users.json`
- Create: `web/apps/dashboard/src/lib/allowlist.ts`
- Test: `web/apps/dashboard/src/lib/allowlist.test.ts`

**Interfaces:**
- Produces: `parseAllowedUsers(raw: string | undefined): string[]`, `normalizeLogin(login: string): string`, `isAllowed(login: string, list: readonly string[]): boolean`, `allowedList(fileList: readonly string[], envValue: string | undefined): string[]`.

- [ ] **Step 1: Tulis tes yang gagal** — `allowlist.test.ts`

```ts
import { allowedList, isAllowed, normalizeLogin, parseAllowedUsers } from "./allowlist";

it("normalisasi username jadi huruf kecil dan tanpa spasi tepi", () => {
  expect(normalizeLogin("  AliF ")).toBe("alif");
});

it("cocok walau beda kapitalisasi antara whitelist dan login GitHub", () => {
  expect(isAllowed("Alif", ["alif", "tugure-git-intern"])).toBe(true);
  expect(isAllowed("alif", ["Alif"])).toBe(true);
});

it("menolak login kosong dan username di luar daftar", () => {
  expect(isAllowed("", ["alif"])).toBe(false);
  expect(isAllowed("budi", ["alif"])).toBe(false);
});

it("env AUTORE_ALLOWED_USERS menimpa file kalau tidak kosong", () => {
  expect(parseAllowedUsers("alif, Tugure-git-intern ,, ")).toEqual(["alif", "tugure-git-intern"]);
  expect(allowedList(["dari-file"], "alif")).toEqual(["alif"]);
  expect(allowedList(["dari-file"], "   ")).toEqual(["dari-file"]);
  expect(allowedList(["dari-file"], undefined)).toEqual(["dari-file"]);
  expect(allowedList([], undefined)).toEqual([]);
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL** — `npx vitest run apps/dashboard/src/lib/allowlist.test.ts` → `Failed to resolve import "./allowlist"`.

- [ ] **Step 3: Implementasi** — `allowed-users.json` (root `web/`):

```json
["alif", "tugure-git-intern"]
```

`allowlist.ts`: `normalizeLogin` = `trim().toLowerCase()`; `parseAllowedUsers` = split `,`, `normalizeLogin` tiap item, buang kosong, dedup; `allowedList(file, env)` = `parseAllowedUsers(env).length ? parse(env) : file.map(normalizeLogin)`; `isAllowed(login, list)` = `!!normalizeLogin(login) && list.includes(normalizeLogin(login))`.

- [ ] **Step 4: Tes hijau** — file itu PASS, suite penuh tetap hijau.

- [ ] **Step 5: Commit** — `feat(web): loader whitelist allowed-users.json dengan override env`

---

### Task 3: Callback Auth.js (tolak di luar whitelist, simpan `login` ke token)

**Files:**
- Create: `web/apps/dashboard/src/lib/auth-callbacks.ts` (murni)
- Test: `web/apps/dashboard/src/lib/auth-callbacks.test.ts`

**Interfaces:**
- Produces: `githubLogin(profile: unknown, user: unknown): string`, `signInAllowed(params: { profile?: unknown; user?: unknown }, list: readonly string[]): boolean`, `stampLogin(params: { token: JWT; profile?: unknown; user?: unknown }): JWT`, `exposeLogin(params: { session: Session; token: JWT }): Session`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
it("menolak user di luar whitelist", () => {
  expect(signInAllowed({ profile: { login: "orang-lain" } }, ["alif"])).toBe(false);
});

it("menerima user di whitelist walau beda kapitalisasi", () => {
  expect(signInAllowed({ profile: { login: "Tugure-Git-Intern" } }, ["tugure-git-intern"])).toBe(true);
});

it("menolak kalau profil tidak memuat login sama sekali", () => {
  expect(signInAllowed({ profile: {} }, ["alif"])).toBe(false);
  expect(signInAllowed({}, ["alif"])).toBe(false);
});

it("menyimpan login ke token dan meneruskannya ke session", () => {
  const token = stampLogin({ token: {}, profile: { login: "Alif" } });
  expect(token.login).toBe("alif");
  const session = exposeLogin({ session: { user: { name: "Alif" } }, token });
  expect((session.user as { login?: string }).login).toBe("alif");
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL** — resolve `./auth-callbacks` gagal.

- [ ] **Step 3: Implementasi** — semua fungsi murni (tanpa import runtime dari `next-auth`, hanya `import type`), sehingga bisa dites tanpa mock. `stampLogin` ambil `profile.login`, fallback `user.name`; kalau kosong → `token.login = ""` (dan middleware akan menolaknya).

- [ ] **Step 4: Tes hijau** + suite penuh hijau.

- [ ] **Step 5: Commit** — `feat(web): callback auth whitelist dan penyimpanan username github`

---

### Task 4: Konfigurasi NextAuth + route handler + halaman `/login` dan `/403`

**Files:**
- Create: `web/apps/dashboard/src/auth.config.ts` (edge-safe: provider + callbacks + `pages`)
- Create: `web/apps/dashboard/src/auth.ts` (`NextAuth(...)`: secret, trustHost, session, export `handlers/auth/signIn/signOut`)
- Create: `web/apps/dashboard/src/app/api/auth/[...nextauth]/route.ts`
- Create: `web/apps/dashboard/src/app/login/page.tsx`
- Create: `web/apps/dashboard/src/app/403/page.tsx`
- Test: `web/apps/dashboard/src/app/login/page.test.tsx`

**Interfaces:**
- Consumes: `auth-callbacks.ts` (Task 3), `allowlist.ts` (Task 2).
- Produces: `auth()`, `signIn()`, `signOut()`, `handlers` dari `@/auth`; route `/login`, `/403`.

- [ ] **Step 1: Tulis tes yang gagal** — `login/page.test.tsx`

```tsx
it("menampilkan satu tombol GitHub, tanpa field password apa pun", () => {
  render(<LoginPage />);
  expect(screen.getByRole("button", { name: /Lanjut dengan GitHub/i })).toBeVisible();
  expect(screen.queryByLabelText(/password/i)).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("menjelaskan bahwa akses dibatasi whitelist", () => {
  render(<LoginPage />);
  expect(screen.getByText(/hanya akun yang terdaftar/i)).toBeVisible();
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL** — `Failed to resolve import "./page"` (atau `../page`).

- [ ] **Step 3: Implementasi**
  - `auth.config.ts`: `providers: [GitHub]`, `pages: { signIn: "/login", error: "/403" }`, `callbacks: { signIn, jwt, session, authorized }` yang memanggil fungsi Task 3; `authorized` default `true` (proteksi sesungguhnya di middleware supaya pesannya bisa dibedakan `/login` vs `/403`).
  - `auth.ts`:

```ts
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID ?? process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET ?? process.env.AUTH_GITHUB_SECRET,
    }),
  ],
});
```

  - `app/api/auth/[...nextauth]/route.ts`: `export const { GET, POST } = handlers;`
  - `/login`: server component, tombol pakai **form action** `signIn("github", { redirectTo: "/" })` (tanpa JS state), kartu `rounded-lg border border-gray-200 bg-white p-6`, logo GitHub dari `lucide-react` (`Github`), teks "Masuk hanya untuk akun GitHub yang terdaftar."
  - `/403`: halaman statis "Akses Ditolak", sebutkan username yang login (kalau ada, dari `auth()`), plus tombol logout (`signOut`) dan tautan kembali ke `/login`.

- [ ] **Step 4: Tes hijau** + `npx tsc -p apps/dashboard/tsconfig.json --noEmit` exit 0 + `npm run build:dashboard` sukses.

- [ ] **Step 5: Commit** — `feat(web): github oauth lewat next-auth v5 dengan halaman login dan 403`

---

### Task 5: `middleware.ts` — proteksi semua route + pembedaan `/login` vs `/403`

**Files:**
- Create: `web/apps/dashboard/src/middleware.ts`
- Test: `web/apps/dashboard/src/middleware.test.ts` (wajib pragma `// @vitest-environment node`)

**Interfaces:**
- Produces: `export const config = { matcher: [...] }`, default export `auth(...)`-wrapped middleware.

- [ ] **Step 1: Tulis tes yang gagal** — pakai cookie asli, bukan mock:

```ts
// @vitest-environment node
import { encode } from "@auth/core/jwt";
import { randomBytes } from "node:crypto";
const SECRET = randomBytes(40).toString("hex"); // rahasia uji, dibuat saat runtime
const cookieFor = (login: string, exp = Math.floor(Date.now() / 1000) + 60) =>
  encode({ token: { login, sub: "1", exp }, secret: SECRET, salt: "authjs.session-token" });

it("mengarahkan ke /login saat tanpa cookie", ...);              // 302/307 + location berawal /login
it("mengarahkan ke /403 saat login tidak ada di whitelist", ...); // location berawal /403
it("meloloskan request saat cookie sah dan login di whitelist", ...); // NextResponse.next (status 200, tanpa location)
it("memperlakukan token kedaluwarsa sebagai belum login", ...);   // exp masa lalu → /login
it("membiarkan /login, /403 dan /api/auth/* lewat tanpa cookie", ...);
```

- [ ] **Step 2: Jalankan, pastikan GAGAL** — `Failed to resolve import "./middleware"`.

- [ ] **Step 3: Implementasi** — middleware memakai `NextAuth(authConfig).auth` sebagai pembungkus supaya `req.auth` tersedia (edge-safe: `auth.config.ts` tanpa adapter/`fs`), lalu:

```
kalau pathname ∈ { "/login", "/403" } atau mulai "/api/auth" → lanjut
kalau !req.auth?.user → redirect /login?callbackUrl=<pathname>
kalau !isAllowed(login, allowedList(file, env)) → redirect /403
selain itu → lanjut
```

`matcher` mengecualikan aset statis dan `/api/*` (keputusan #7): `["/((?!api|_next/static|_next/image|favicon.ico).*)"]`. Kalau `AUTH_SECRET` tidak ada, middleware **melempar** (fail closed) — bukan mengizinkan.

- [ ] **Step 4: Tes hijau** + suite penuh hijau (`npx vitest run`).

- [ ] **Step 5: Commit** — `feat(web): middleware proteksi route dengan whitelist dan halaman 403`

---

### Task 6: UserMenu di Topbar (avatar + username + logout)

**Files:**
- Create: `web/apps/dashboard/src/components/user-menu.tsx`
- Modify: `web/apps/dashboard/src/components/navbar.tsx` (`initials` → prop `user`, render `UserMenu`)
- Modify: `web/apps/dashboard/src/components/app-shell.tsx` (ambil `auth()` di server component, kirim `user` ke `Navbar`)
- Test: `web/apps/dashboard/src/components/user-menu.test.tsx`, Modify: `navbar.test.tsx`

**Interfaces:**
- Consumes: `session.user` (`name`, `image`, `login`).
- Produces: `<UserMenu user={{ name: string; login: string; image?: string | null }} />`; `Navbar` prop baru `user`.

- [ ] **Step 1: Tulis tes yang gagal**

```tsx
it("menampilkan avatar dan username github", () => {
  render(<UserMenu user={{ name: "Alif", login: "tugure-git-intern" }} />);
  expect(screen.getByText("tugure-git-intern")).toBeVisible();
  expect(screen.getByRole("img", { name: /tugure-git-intern/i })).toBeVisible();
});

it("memakai inisial saat avatar GitHub tidak tersedia", () => {
  render(<UserMenu user={{ name: "Alif", login: "alif", image: null }} />);
  expect(screen.getByText("AL")).toBeVisible();
});

it("punya tombol Keluar yang memanggil signOut", async () => { ... });  // mock next-auth/react
```

- [ ] **Step 2: Jalankan, pastikan GAGAL** — resolve `./user-menu` gagal; `navbar.test.tsx` masih pakai prop `initials`.

- [ ] **Step 3: Implementasi** — `UserMenu` = `<details>`/popover sederhana (tanpa dependency baru): avatar (`next/image` tidak perlu — `<img>` 28px, `alt=login`), username, tombol "Keluar" → `signOut({ callbackUrl: "/login" })` dari `next-auth/react`. `navbar.tsx` ganti blok inisial `AR`; `app-shell.tsx` jadi server component yang `await auth()` lalu melempar `user` ke `Navbar` (shell tetap client karena status provider: pisahkan `<Navbar>` props agar `user` datang dari server via `AppShell` pembungkus baru).
  ⚠️ `AppShell` sekarang dipakai `<RootLayout>`; kalau `await auth()` di dalamnya bikin route jadi dinamis, **biarkan dinamis** — jangan matikan proteksi demi halaman statis.

- [ ] **Step 4: Tes hijau** — termasuk `navbar.test.tsx` yang diperbarui + suite penuh.

- [ ] **Step 5: Commit** — `feat(web): user menu avatar dan logout di topbar`

---

### Task 7: Hono menolak `401` tanpa session sah

**Files:**
- Create: `web/apps/api/src/session.ts` (satu-satunya tempat yang menyentuh `@auth/core/jwt`)
- Create: `web/apps/api/src/session.test.ts`
- Modify: `web/apps/api/src/index.ts` (pasang middleware ke `/api/actions/*`)
- Test: `web/apps/api/src/index.test.ts` (tambah kasus 401)

**Interfaces:**
- Produces: `verifySession(request: Request, secret: string): Promise<{ login: string } | null>`, `requireSession(options?: { secret?: string; allowed?: string[] }): MiddlewareHandler`.

- [ ] **Step 1: Tulis tes yang gagal** — cookie asli dari `encode()`:

```ts
const SECRET = randomBytes(40).toString("hex"); // rahasia uji, dibuat saat runtime
const sesi = (login: string, exp = Math.floor(Date.now() / 1000) + 60) =>
  encode({ token: { login, sub: "1", exp }, secret: SECRET, salt: "authjs.session-token" });

it("menolak 401 tanpa cookie sesi", async () => {
  const app = createApp(run, actions, runs, { secret: SECRET });
  const res = await app.request("/api/actions/deploy", { method: "POST" });
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ ok: false, status: 401 });
});

it("menerima aksi saat cookie sah", ...);                    // 200
it("menolak 401 saat ditandatangani rahasia lain", ...);
it("menolak 401 saat token kedaluwarsa", ...);
it("menerima cookie ber-prefix __Secure- selagi salt-nya ikut", ...);
it("mengembalikan 503 fail-closed saat AUTH_SECRET belum di-set", ...);
it("tidak menyentuh GET /api/status dan GET /api/runs", ...);  // tetap 200 tanpa cookie
```

- [ ] **Step 2: Jalankan, pastikan GAGAL** — `expect(res.status).toBe(401)` dapat `200`/`503` (perilaku sekarang: tanpa auth sama sekali).

- [ ] **Step 3: Implementasi** — `verifySession` mencoba `getToken({ req, secret, salt: nama, cookieName: nama })` untuk dua nama cookie berurutan, ambil `token.login`; null kalau gagal/tanpa login. `requireSession` = 503 `{ ok: false, status: 503, error: "AUTH_SECRET belum di-set di unit API" }` kalau rahasia kosong (fail closed, jangan pernah 200), 401 `{ ok: false, status: 401, error: "Session tidak sah. Login ulang di dashboard." }` kalau token ditolak, dan `403` kalau `allowed` di-set tapi login tidak ada di dalamnya. Pasang: `app.use("/api/actions/*", requireSession({ secret, allowed }))` dengan `secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET`, `allowed = parseAllowedUsers(process.env.AUTORE_ALLOWED_USERS)` (kosong → `undefined`).

- [ ] **Step 4: Tes hijau** — `npx vitest run apps/api` + suite penuh.

- [ ] **Step 5: Commit** — `feat(api): tolak 401 tanpa session github yang sah di endpoint aksi`

---

### Task 8: UI bereaksi pada session kedaluwarsa

**Files:**
- Modify: `web/apps/dashboard/src/lib/actions-client.ts`
- Test: `web/apps/dashboard/src/lib/actions-client.test.ts`

**Interfaces:**
- Produces: `runAction` tetap `Promise<ActionOutcome>`, tapi `ActionOutcome` dapat `{ ok: false, message, redirectTo?: string }`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
it("menerjemahkan 401 jadi arahan login ulang", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
  const hasil = await runAction("deploy");
  expect(hasil).toMatchObject({ ok: false, redirectTo: "/login" });
  expect(hasil.message).toMatch(/sesi .*berakhir|login ulang/i);
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL** — sekarang hasil cuma `{ ok: false, message: "Session tidak sah..." }` tanpa `redirectTo`.

- [ ] **Step 3: Implementasi** — `runAction` mengembalikan `redirectTo: "/login"` saat `response.status === 401 || 403`; pemanggil (`action-button.tsx`) melakukan `window.location.assign(hasil.redirectTo)` setelah modal ditutup (satu tempat, bukan pindah-pindah). Tombol modal "Jalankan Ulang" (Task Phase 2) tetap ada dan tetap memakai peringatan merah yang sama.

- [ ] **Step 4: Tes hijau** — termasuk tes `action-button.test.tsx` yang diperbarui.

- [ ] **Step 5: Commit** — `feat(web): arahkan ke login saat sesi api ditolak`

---

### Task 9: Deploy — satu `.env`, dua unit systemd, dokumentasi

**Files:**
- Modify: `web/deploy/autore-web-api.service`, `web/deploy/autore-web-dashboard.service`
- Modify: `web/README.md` (ganti catatan "trusted internal network only" dengan seksi Auth)

**Interfaces:**
- Produces: `EnvironmentFile=-%h/Autore/web/.env` di dua unit.

- [ ] **Step 1: Ubah unit** — tambah di bagian `[Service]` **kedua** unit:

```
EnvironmentFile=-/home/tugure/Autore/web/.env
```

(`-` = jangan gagal kalau file belum ada, supaya urutan pemasangan `.env` tidak mematikan service.)

- [ ] **Step 2: Salin unit yang baru + tulis README** — seksi "Auth (GitHub OAuth + whitelist)": alur login, di mana whitelist, arti `AUTORE_ALLOWED_USERS`, apa saja yang terbuka (`/api/status`, `/api/runs`, `/healthz`) dan apa yang 401 (`POST /api/actions/*`), plus batas jujur: API percaya tanda tangan token kalau `AUTORE_ALLOWED_USERS` kosong; hapus catatan "tanpa login dulu (tailnet-only)" supaya tidak jadi dokumentasi bohong.

- [ ] **Step 3: Verifikasi** — `ssh vps 'systemctl --user daemon-reload && systemctl --user restart autore-web-api autore-web-dashboard && systemctl --user is-active autore-web-api autore-web-dashboard'` → dua-duanya `active`.

- [ ] **Step 4: Commit** — `docs(web): dokumentasi auth dan env untuk unit deploy`

---

### Task 10: E2E jujur + verifikasi akhir

**Files:**
- Modify: `web/apps/dashboard/e2e/dashboard.spec.ts`
- Create: `web/apps/dashboard/e2e/global-setup.ts`
- Modify: `web/apps/dashboard/playwright.config.ts`

**Interfaces:**
- Produces: `storageState` berisi cookie `authjs.session-token` sah yang dibuat `encode()` dari `AUTH_SECRET`.

- [ ] **Step 1: Tulis tes yang gagal** — dua tambahan:
  - `GET /` tanpa sesi → `expect(page).toHaveURL(/\/login/)` (kontrak baru).
  - daftar sidebar jadi **4** link (`/`, `/applications`, `/pipeline`, `/security`) — ini menandai e2e yang ketinggalan Phase 3, bukan regresi baru.

- [ ] **Step 2: Jalankan, pastikan GAGAL** — `npm run test:e2e` (Playwright perlu browser; kalau `npx playwright install` belum ada di VPS, jalankan sekali dan catat di README).

- [ ] **Step 3: Implementasi** — `global-setup.ts` menulis `e2e/.auth/state.json` berisi cookie sesi untuk `127.0.0.1:9120` + `100.80.3.14:9120`, dipakai `use: { storageState }`. Tes screenshot tetap ada (sekarang dengan sesi).

- [ ] **Step 4: Tes hijau** — `npm run test:e2e` hijau; `npx vitest run` penuh hijau; `npx tsc --noEmit` exit 0; `npm run build:dashboard` sukses.

- [ ] **Step 5: Commit** — `test(web): e2e dengan sesi palsu dan kontrak redirect login`

---

## Definition of Done (verifikasi manual, bukan klaim)

1. `.env` diisi user di `web/.env`, unit di-restart → `/usr/local/bin` tidak berubah, dua service `active`.
2. `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9121/api/actions/deploy -X POST -H 'content-type: application/json' -d '{"app":"tes-web"}'` → **401** (sebelum Phase 4: 200/422). `curl -sI http://127.0.0.1:9121/api/status` → **200**.
3. Browser (tanpa cookie) → `http://100.80.3.14:9120/` **redirect `/login`**; `/applications`, `/pipeline`, `/security` sama.
4. Login GitHub sebagai akun di whitelist → masuk ke `/`, UserMenu tampil avatar + username; tombol Keluar kembali ke `/login`.
5. Login GitHub dengan akun **di luar** whitelist → mendarat di `/403` "Akses Ditolak", bukan masuk ke dashboard.
6. Setelah login: tombol Deploy di halaman aplikasi jalan (200) dan build baru muncul di Recent Runs; `grep` HTML chunk tidak lagi memuat halaman dashboard dalam keadaan ter-autentikasi-lewat-bypass apa pun.
7. Screenshot 4 halaman (login, dashboard, pipeline, 403) disimpan; laporan menyebut path-nya.
8. `git log --oneline -10` memuat 10 commit task di atas, working tree bersih, sudah `push` ke `main`.
