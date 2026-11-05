# Plan — Progress bar "hidup" di Active Pipelines (indeterminate + shimmer)

Tanggal: 2026-11-05 · Repo: `Autore` (VPS `100.80.3.14`, `~/Autore`) · Branch: `main` (HEAD `9da8f34`)
Peminta: bos alif · Mode: **TDD RED-GREEN**, satu commit per task, gate di pohon VPS.

---

## 1. Keluhan

> "progress bar biru yang nandain status Berjalan itu kalau di-screenshot kelihatan kayak kotak statis di kiri.
> Padahal di Snorlx, garisnya kelihatan banget 'hidup' dan terus bergerak."

Terverifikasi di kode — **keluhannya benar, bukan ilusi screenshot**:

`web/apps/dashboard/src/components/active-pipelines.tsx:86-91`

```tsx
{p.status === "running" ? (
  <div
    data-testid="progress-indeterminate"
    className="absolute bottom-0 left-0 h-0.5 w-1/3 bg-blue-500/70 motion-safe:animate-[geser_1.4s_ease-in-out_infinite]"
  />
) : null}
```

Kenapa terlihat seperti kotak mati:

1. Lebarnya cuma **sepertiga kartu** (`w-1/3`) dan tebalnya **2 px** (`h-0.5`) — di screenshot 1400 px itu blok kecil di kiri bawah.
2. `bg-blue-500/70` **solid**, tanpa bagian terang/gelap → tidak ada isyarat "ada yang bergerak".
3. Arahkan mata ke satu frame: pita 1/3 yang bergeser seragam memang terbaca sebagai kotak yang diam.
4. `overflow-hidden` di kartu (`:51`) memotong pita saat keluar kanan → tidak ada jejak gerak.

Keyframes hari ini (`app/globals.css:39-46`) sudah benar sebagai mesin:

```css
@keyframes geser { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
```

Masalahnya **desain visual**, bukan ada/tidaknya animasi. (Ingat: keputusan Phase 5 dulu "bar tidak perlu diubah"
— plan ini membalik keputusan itu atas permintaan baru bos alif; dicatat supaya tidak ada yang bingung nanti.)

---

## 2. Rancangan yang diusulkan (opsi A — tanpa gradien, **rekomendasi**)

Bar dibangun dari **track selebar kartu + dua pita solid yang bergerak sinkron dengan geser fasa**.
Tidak memakai gradien sama sekali, supaya dua kontrak yang sudah ada tetap utuh:

- unit `active-pipelines.test.tsx` — "tidak menambah gradien atau bayangan lebih berat dari shadow-sm"
  (`kelas.filter((k) => /gradient/.test(k))` wajib `[]`);
- e2e global — menolak `background-image` yang mengandung `gradient(` di **semua** elemen halaman
  (jadi `linear-gradient()` mentah dari `globals.css` pun gagal, bukan cuma kelas Tailwind).

### Markup baru (`active-pipelines.tsx`)

```tsx
{p.status === "running" ? (
  <div
    data-testid="progress-indeterminate"
    aria-hidden="true"
    className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-blue-500/15 motion-reduce:bg-blue-500"
  >
    <div
      data-testid="progress-band-belakang"
      className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-blue-400/50 [animation-delay:-1.2s] motion-safe:animate-[geser_1.6s_linear_infinite] motion-reduce:hidden"
    />
    <div
      data-testid="progress-band-depan"
      className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-blue-500 motion-safe:animate-[geser_1.6s_linear_infinite] motion-reduce:hidden"
    />
  </div>
) : null}
```

Yang berubah, sebut alasannya satu-satu:

| Perubahan | Alasan |
|---|---|
| `left-0 w-1/3` → `inset-x-0` pada track | bar **memenuhi lebar kartu** (permintaan eksplisit). |
| `h-0.5` → `h-1` | 2 px → 4 px; gerakan masih sopan tapi mata bisa lihat. Masih "garis tipis". |
| `bg-blue-500/70` (pita) → track `bg-blue-500/15` + pita `bg-blue-500` pekat | kontras track-sam pita bikin gerak kebaca; ini sumber efek "hidup". |
| +pita **ekor** `bg-blue-400/50`, `[animation-delay:-1.2s]` | dua pita bergerak sinkron tapi beda fasa → terbaca seperti shimmer/ekor komet, **tanpa gradien**. |
| pita `w-1/3` **dua-duanya sama** | `translateX(%)` relatif ke lebar elemen sendiri; kalau lebar pita beda, jarak tempuhnya beda dan keduanya tidak akan sefasa. Lebar sama = `300%` tetap berarti "keluar kanan". |
| `ease-in-out` → `linear` | gerakan konstan; `ease-in-out` bikin bar berhenti di ujung tiap putaran (terbaca tersendat). |
| `1.4s` → `1.6s` | siklus sedikit lebih panjang supaya dua pita tidak terasa panik. |
| `motion-reduce:hidden` pada pita + `motion-reduce:bg-blue-500` pada track | **prefers-reduced-motion → tidak ada gerakan**, tapinya tetap ada sebagai bar biru solid selebar kartu. Membiarkan pita diam di `translateX(0)` justru mengembalikan masalah "kotak statis di kiri". |
| `aria-hidden="true"` | bar dekoratif; status sesungguhnya sudah dibacakan badge "Berjalan". |

`globals.css`: **keyframes `geser` dipertahankan apa adanya** (nilainya sudah pas untuk pita `w-1/3`),
cuma komentarnya diperbarui supaya menyebut dua pita + fasa. Tidak ada `@keyframes` baru, tidak ada gradien.

### Opsi B (kalau bos alif mau gradien betulan seperti Snorlx)

`background-image: linear-gradient(90deg, transparent, #3b82f6, transparent)` yang digeser lewat
`background-position`. Konsekuensi jujur: **dua kontrak tes harus dilonggarkan** —
unit `/gradient/` dan e2e `gradient(` global — dengan pengecualian khusus
`[data-testid="progress-indeterminate"]`. Kita kehilangan penjaga "halaman ini bebas gradien" yang
dulu dipasang supaya light mode-nya tetap flat. **Rekomendasi: opsi A dulu**; kalau setelah dilihat
di browser belum "hidup" juga, baru naik ke opsi B. Plan ini mengeksekusi A; B disiapkan sebagai
langkah lanjutan, bukan sekarang.

---

## 3. Review Focus (hal yang paling mungkin bikin gw salah)

1. **Gradien terlarang.** Jalan pintas paling wajar (Tailwind `bg-gradient-to-r`) langsung memerahkan
   dua tes kontrak. Kalau nanti hasilnya kelihatan "kurang Snorlx", itu bukan bug kode — itu batas opsi A.
2. **`translateX%` relatif lebar elemen.** Salah satu pita dibuat lebih tipis (mis. `w-1/6`) = pita itu
   hanya jalan setengah jalur. Kedua pita **wajib** `w-1/3`.
3. **`getAnimations()` sekarang 2, bukan 1.** Tes e2e lama (`dashboard.spec.ts:222`) cuma menuntut
   `> 0`, jadi tetap lulus — tapi tes itu jadi tidak bermakna. Diganti (T4), bukan ditambal.
4. **`prefers-reduced-motion` di e2e wajib `emulateMedia`.** jsdom tidak mengevaluasi media query;
   asersi reduced-motion di unit test hanya bisa memeriksa **kelas**, bukan perilaku. Perilaku asli
   diverifikasi di e2e (T5).
5. **Ekornya bisa terlihat sebagai dua blok terpisah** kalau jarak fasa kebablasan. `-1.2s` dari siklus
   `1.6s` = jarak 3/4 jalur. Kalau di screenshot justru jadi dua kotak, putar `-1.2s` → `-1.45s`
   (jarak dekat, ekor menempel). Ini satu-satunya angka yang gw sengaja biarkan sebagai knob visual.
6. **`overflow-hidden` kartu** (`:51`) tetap memotong pita di tepi kanan — memang diinginkan, jangan dihapus.

---

## 4. Task (TDD; RED dulu, baru GREEN; satu commit per task)

### T1 — Unit: kontrak struktur bar (RED → GREEN)
`src/components/active-pipelines.test.tsx`:
- RED: tes baru `"bar indeterminate memenuhi lebar kartu dengan dua pita yang bergerak"` →
  track `data-testid="progress-indeterminate"` ber-class `inset-x-0` + `absolute` + `overflow-hidden`;
  ada **2** pita (`progress-band-depan`, `progress-band-belakang`); keduanya `w-1/3`, punya
  `motion-safe:animate-[geser` dan `rounded-full`; `animation-delay` salah satu **negatif** dan
  **berbeda** dari yang lain.
- GREEN: tulis markup opsi A.
- Commit: `feat(dashboard): bar indeterminate selebar kartu dengan dua pita solid berfasa`.

### T2 — Unit: reduced motion + anti-gradien (RED → GREEN)
- RED: tes `"reduced motion: pita hilang, tapinya tetap solid selebar kartu"` →
  tiap pita punya `motion-reduce:hidden`; track punya `motion-reduce:bg-blue-500`.
  Tambah asersi ke tes gradien yang sudah ada: tidak ada kelas `gradient` **dan** tidak ada kelas
  `bg-gradient-*` di dalam bar.
- GREEN: kalau T1 sudah menulis kelasnya, T2 hijau tanpa perubahan kode (artinya T1 kurang ketat →
  perbaiki asersi, bukan kodenya). Kalau merah, lengkapi kelasnya.
- Commit: `test(dashboard): kunci bar tetap terbaca saat prefers-reduced-motion`.

### T3 — Unit: regresi (tanpa perubahan kode)
- Pastikan tes lama tetap hijau: kartu `queued` tetap **tanpa** bar (`active-pipelines.test.tsx`),
  badge biru/kuning, branch strip, inisial penulis, empty state, "data terakhir".
- Commit: hanya kalau ada penyesuaian; kalau semua hijau, **tidak ada commit** (laporkan saja).

### T4 — E2E: ganti tes animasi lama jadi bukti gerak (RED → GREEN)
`e2e/dashboard.spec.ts:222` — ganti `"bar kemajuan benar-benar beranimasi (keyframes ada)"`:
- `expect(await bar.getAnimations().length)` → `toBe(2)` (dua pita; juga membuktikan `@keyframes geser` hidup).
- Ambil `x` pita depan (`getBoundingClientRect().x`) di tiga waktu: `t0`, `t0+300ms`, `t0+1600ms`.
  - `x(t0+300ms) != x(t0)` → **bar benar-benar bergerak** (bukti utama, bukan cuma kelas).
  - `|x(t0+1600ms) - x(t0)| <= 2` → siklus **berulang tanpa henti** (satu loop penuh ≈ 1.6 s).
- Tetap ambil screenshot bar saat `x` paling beda sebagai bukti visual (disimpan ke `/tmp`).
- Commit: `test(dashboard): bukti e2e bar benar-benar bergerak dan berulang`.

### T5 — E2E: prefers-reduced-motion (RED → GREEN)
- Tes baru: `page.emulateMedia({ reducedMotion: "reduce" })` → `masuk()` kartu berjalan →
  `expect(await bar.getAnimations().length).toBe(0)` (tidak ada gerak sama sekali) **dan**
  `bbox.width` track ≈ `bbox.width` kartu (`> 0.9 * lebar kartu`) → tetap terbaca sebagai bar solid.
- Commit: `test(dashboard): e2e reduced-motion menghentikan gerak, bar tetap selebar kartu`.

### T6 — Gate + bukti hidup
1. `npx vitest run` (target: ≥ 306 lulus, tanpa regresi).
2. `npx tsc -p apps/dashboard --noEmit` → exit 0.
3. `npm run build:dashboard` → `systemctl --user restart autore-web-dashboard` → `curl :9120` 200.
4. `npm run test:e2e` → target 29 lulus + 1 tes baru (jadi 30) dengan tes lama diganti, bukan ditambah buta.
5. Skrip `live-bar.cjs` melawan dashboard produksi: sampel `x` pita 6× tiap 300 ms + 3 screenshot
   `/tmp/bar-1.png`…`bar-3.png` → salin ke `~/.hermes/cache/scratch/p7b/bukti/`, cek dengan mata (vision).
6. Commit (kalau ada sisa) + push. **Stop dan lapor.**

---

## 5. Batas jujur plan ini

- **Gerakan tidak bisa dibuktikan lewat satu screenshot.** Buktinya: `x` berubah antar waktu + dua frame
  berbeda + `getAnimations() == 2`. Kalau bos alif mau bukti berupa **video**, gw bisa rekam
  (`playwright` context `recordVideo`, ~10 detik, MP4) sebagai task tambahan — bilang saja.
- Opsi A **tidak memakai gradien**, jadi hasilnya "pita bergerak + ekor", bukan "cahaya menyapu halus"
  seperti Snorlx kalau Snorlx memang pakai gradien. Beda rasa ini wajar; naik ke opsi B kalau kurang.
- Warna tetap biru Tailwind yang sekarang (`blue-500`/`blue-400`). Tidak ada warna baru di light mode.
- Tidak menyentuh `useActivePipelines` (polling 10 s), `StatusProvider`, tombol Sync, atau Jenkins.
  Ini murni CSS/markup satu komponen.
- Kartu `queued` (Menunggu) tidak dapat bar — perilaku sekarang dipertahankan (badge kuning saja).

## 7. Update eksekusi (2026-11-05, setelah plan disetujui)

Status: **semua task hijau**, gate bersih.

| Gate | Hasil | Sebelum |
|---|---|---|
| `npx vitest run` | **40 berkas / 308 tes lulus** | 40/306 |
| `npx tsc -p apps/dashboard --noEmit` | exit 0 | exit 0 |
| `npm run build:dashboard` + restart `:9120` | build sukses | — |
| Playwright e2e | **30 lulus** | 29 |

Commit (di atas `9da8f34`):

- `a313dca` feat(dashboard): bar indeterminate selebar kartu dengan dua pita solid berfasa
- `2b7d86c` test(dashboard): kunci bar tetap terbaca saat prefers-reduced-motion
- `6c3600d` feat(dashboard): komet rigid selebar 2/3 kartu untuk bar indeterminate
- `a2e2246` test(dashboard): e2e komet bergerak, menyambung, dan berhenti saat reduced-motion

### Deviasi dari rancangan (karena hasil ukur, bukan karena selera)

1. **Dua pita beda fasa DIBATALKAN.** Kelas `[animation-delay:-1.2s]` ternyata ditimpa
   shorthand `animate-[...]`: hasil ukur di browser `animationDelay: "0s"` walau kelasnya
   terpasang, jadi kedua pita duduk identik. Setelah delay dipindah ke dalam shorthand
   (`animate-[geser_1.6s_linear_infinite_-1.2s]`) dan diukur ulang, jarak kepala–ekor = **303 px**
   = satu lebar track — artinya pita ekor sudah wrap ke kanan saat kepala baru masuk kiri:
   pasangan itu **terpisah sekitar 25% siklus**. Delay fasa tidak bisa bikin ekor yang selalu menempel.
2. **Desain akhir: satu komet rigid.** Pembungkus `w-2/3` berisi ekor (kiri, `bg-blue-400/50`,
   `rounded-l-full`) + kepala (kanan, `bg-blue-500`, `rounded-r-full`) yang menempel tanpa celah
   di fase mana pun; hanya pembungkusnya yang beranimasi. Satu animasi, bukan dua.
3. **`@keyframes geser` nilai akhir 300% → 250%.** Jarak tempuh `translateX` relatif lebar elemen
   sendiri; komet 2/3 lebar track butuh 250% supaya keluar penuh di kanan. Nama keyframes tidak
   berubah, komentarnya diperbarui.
4. **Asersi e2e pertama lombok.** `getAnimations()` hanya melihat animasi di elemen itu sendiri,
   jadi di elemen track hasilnya `0` (animasinya di anak). Wajib `{ subtree: true }`. Ketahuan
   karena tes gerak gagal dengan `Expected: 2, Received: 0` sementara elemennya jelas bergerak.
5. **Satu commit, bukan dua (T4+T5).** Kedua tes itu di berkas yang sama; memecahnya jadi dua
   commit cuma akan memalsukan riwayat. Digabung di `a2e2246`.
6. **Commit `2b7d86c` sempat masuk saat suite merah** (perintah tes dan commit dirantai `;`).
   Sudah diamend setelah komponen dikembalikan; pelajarannya dicatat di skill `autore-cicd`:
   jangan pernah merantai tes dengan commit.

### Bukti terukur (dashboard produksi `:9120`, Playwright)

Fakta DOM: `animasi di track = 1`, `animasi di pita = 0`, `track w = 303 px`, `komet w = 202 px`
(= 2/3), `warnaTrack = oklab(... / 0.15)`, `warnaKepala = oklch(0.623 0.214 259.815)`,
`warnaEkor = oklab(... / 0.5)`.

Delapan sampel tiap 250 ms (posisi `x`, celah ekor→kepala):

```
xKepala: 210 → 328 → 438 → 549 → 667 → 777 → 888 → 291 (wrap)
celah  :   0     1     0     0     0     0     0     0   px
```

`rentang = 678 px`, `adaWrap = true`, `celahMaks = 1 px` → bergerak, mengulang, **selalu menempel**.

Reduced motion (`emulateMedia({ reducedMotion: "reduce" })`): `animasi = 0`,
`komet display = none`, `lebarBar = 303 px`, `warnaTrack = oklch(0.623 0.214 259.815)` (biru pekat)
→ diam, tapi tetap bar solid selebar kartu.

Berkas bukti (dilayani juga oleh server plan):
[video bar bergerak](/bar-bergerak.mp4) · [bar saat reduced-motion](/bar-reduced.png)
— video 7,7 detik, 640×300 @ 2x.

## 8. File yang disentuh

| File | Aksi |
|---|---|
| `web/apps/dashboard/src/components/active-pipelines.tsx` | ganti markup bar (baris 86-91) |
| `web/apps/dashboard/src/app/globals.css` | komentar keyframes `geser`; nilai keyframes **tidak berubah** |
| `web/apps/dashboard/src/components/active-pipelines.test.tsx` | +3 tes (struktur, reduced-motion, anti-gradien) |
| `web/apps/dashboard/e2e/dashboard.spec.ts` | ganti 1 tes animasi, +1 tes reduced-motion |
| `~/.hermes/plans/2026-11-05-autore-progress-bar-shimmer.md` | plan ini (otomatis tayang di :8899) |
| `~/Autore/docs/plans/…` | salinan tracked (ikut commit terakhir) |
| `~/.hermes/cache/scratch/p7b/live-bar.cjs` | skrip bukti hidup (baru) |
