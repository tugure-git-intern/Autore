# Kunci branch otomatis

Autore memasang branch protection di GitHub setiap kali repo lahir atau
dionboard. Tujuannya satu: kode yang sudah jalan tidak bisa dirusak tanpa
lewat PR, dan tidak ada langkah manual yang harus diingat orang.

## Dua tingkat

| Tingkat | Yang dipasang | Untuk siapa |
|---|---|---|
| `ringan` | force-push dan hapus branch dimatikan | repo pribadi, eksperimen, kerja sendiri |
| `penuh` | `ringan` + PR wajib + 1 review + admin ikut aturan | repo kantor, repo tim, semua yang di-deploy |

Sekali repo masuk `penuh`, Autore **tidak pernah** menurunkannya ke `ringan`.
Menjalankan ulang perintah hanya bisa menambah kunci, tidak mengurangi.

## Siapa dapat apa

Urutan keputusan ada di `cli/src/kebijakan.rs` (`putuskan`) dan dibaca dari
`~/.config/autore/kebijakan.conf`:

```ini
# akun kantor → penuh. akun pribadi → ringan.
akun_kantor=tugure-git-intern,tugure-reasuransi
akun_pribadi=MAliffadlan

# repo baru tanpa --org lahir di org ini, khusus akun kantor
org_default=tugure-reasuransi

# akun yang tidak terdaftar
mode_baru=penuh

# jumlah review wajib untuk mode penuh
review_wajib=1
```

Aturannya berurutan, yang pertama menang (`cli/src/kebijakan.rs:112`):

1. `--kunci` disebut di CLI → nilai itu
2. pemilik repo sebuah organisasi → `penuh`
3. pemilik repo ada di `akun_pribadi` → `ringan`
4. pemilik repo ada di `akun_kantor` → `penuh`
5. repo punya ≥2 kolaborator → `penuh`
6. sisanya → `mode_baru`

Tidak ada berkas kebijakan = semua `penuh` dengan 1 review. Perilaku aman
sebagai default, tanpa konfigurasi.

`org_default` hanya berlaku kalau token yang dipakai milik akun kantor. Di
laptop dengan token `MAliffadlan`, repo pribadi tetap lahir di akun sendiri.

## Kapan dipasang

| Perintah | Urutan |
|---|---|
| `autore quick-start` | repo dibuat → kode di-push → Jenkins jalan → branch dikunci |
| `autore connect` | clone → push → Jenkins jalan → branch dikunci |
| `autore kunci-repo` | langsung kunci, tanpa clone/push/build |

Push selalu lebih dulu, kunci sesudahnya. Kalau dibalik, commit pipeline
pertama akan ditolak karena belum lewat PR.

## Kunci repo yang sudah ada

```bash
autore kunci-repo --repo tugure-reasuransi/nama-repo
autore kunci-repo --repo nama-repo --branch develop --kunci ringan
```

Tanpa `--branch`, branch default dibaca dari GitHub. Tanpa `--kunci`, tingkat
ditentukan berkas kebijakan. Bisa dijalankan berkali-kali: yang sudah terkunci
dilaporkan "sudah terkunci" dan tidak ada permintaan tulis tambahan.

## Kalau gagal

| Pesan | Arti |
|---|---|
| `HTTP 403` | token bukan admin repo. Branch protection butuh izin admin. |
| `HTTP 404 ... belum ada` | repo belum punya commit di branch itu. Push dulu. |
| `Secret scanning: ... 404` | secret scanning butuh repo publik atau paket GitHub Advanced Security. Kunci branch tetap terpasang. |

Token dibaca dari `AUTORE_GITHUB_TOKEN`, lalu `GH_TOKEN`/`GITHUB_TOKEN`, lalu
`~/.config/autore/github_token`, lalu `~/.git-credentials`.

## Cek hasilnya

```bash
autore kunci-repo --repo <owner>/<repo>   # ulangi: harus bilang "sudah terkunci"
gh api repos/<owner>/<repo>/branches/main/protection
```

Yang harus terlihat untuk `penuh`: `required_approving_review_count: 1`,
`allow_force_pushes.enabled: false`, `allow_deletions.enabled: false`,
`enforce_admins.enabled: true`.
