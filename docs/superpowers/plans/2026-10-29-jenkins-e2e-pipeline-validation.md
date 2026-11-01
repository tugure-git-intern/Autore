# Validasi End-to-End Jenkins 10-Tahap Fail-Closed — Implementation Plan

> **Untuk agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps pakai checkbox (`- [ ]`) untuk tracking. Eksekusi di VPS svru-gitdock1 (user tugure, ~/Autore), hasil tiap langkah di-paste ke sesi utama.

**Goal:** Membuktikan pipeline Jenkins 10-tahap fail-closed (`jenkins-shared-library/vars/autorePipeline.groovy`) berjalan end-to-end di sandbox: checkout GitHub → security gates → SonarQube SAST → build image & musl → Trivy image scan → Nexus immutable push + verifikasi digest → deploy by digest → audit Telegram (sukses DAN ditolak).

**Architecture:** Jenkins controller (container `autore-jenkins`, bind 127.0.0.1:8080) + agent systemd (`jenkins-agent.service`, label `vps-runner-1`) menjalankan shared library dari repo admin. Runner sudah punya SonarQube (:9000) & Nexus (:8082/:5000) yang ter-bootstrap otomatis. Pipeline memakai kredensial Jenkins (`sonarqube-token`, `nexus-credentials`, `telegram-bot-token`) dengan fallback ke skrip repo `./scripts/*`.

**Tech Stack:** Jenkins LTS jdk21, Groovy shared library, shell, Docker, SonarQube 26.10, Nexus 3.96, Trivy, Gitleaks, Rust CLI `autore`, Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-10-29-trivy-sonarqube-nexus-architecture.md`

## Global Constraints
- `GIT_COMMIT` wajib full 40-hex — stage 1 menolak SHORT_SHA/`latest`.
- Image tag immutable: `build-<N>-commit-<40hex>`; Nexus `ALLOW_ONCE` (redeploy dilarang).
- Agent wajib berlabel `vps-runner-1` (hardcode di `autorePipeline.groovy`).
- Fail-closed: satu stage gagal → abort + notifikasi Telegram.
- Tidak mengubah kode produksi. Perubahan hanya di `sandbox/`, `scripts/`, atau konfigurasi Jenkins bila diperlukan fix.
- Akses Jenkins UI via SSH tunnel: `ssh -L 8080:127.0.0.1:8080 tugure@<vps>` → buka `http://localhost:8080`.

## Review Focus
1. **Label agent tidak cocok** — dummy Jenkinsfile pakai `docker`, library pakai `vps-runner-1`. Task 0 harus cek label node aktual dan samakan.
2. **Kredensial Jenkins belum tentu ada** — `sonarqube-token`, `nexus-credentials`, `telegram-bot-token` wajib dibuat sebelum run.
3. **Shared library belum tentu terdaftar** — tanpa library, `autorePipeline` tidak bisa di-resolve.
4. **Checkout repo privat** — kalau repo tidak publik, butuh kredensial GitHub di Jenkins.
5. **Rantai artifact** — stage 7 butuh `dist/SHA256SUMS` (dari `build-musl-release.sh`), stage 9 butuh `.verified-image-digest` (dari `ci-nexus-publish.sh`). Pastikan urutan & file ada, kalau tidak stage gagal misterius.
6. **Port 8081 deploy** — sudah dipakai proses lain di VPS? Cek sebelum stage 9.
7. **Telegram** — `TELEGRAM_CHAT_ID` wajib numerik (validasi script) dan token bot valid; tes kirim manual dulu.

---

### Task 0: Audit State Jenkins di VPS (discovery)

**Files:** tidak ada perubahan — hanya membaca state.

- [ ] **Step 1: Cek container Jenkins, agent, dan akses UI**

```bash
docker ps --format '{{.Names}} {{.Status}}' | grep -i jenkins
systemctl is-active jenkins-agent.service
curl -s -o /dev/null -w 'jenkins-ui:%{http_code}\n' http://127.0.0.1:8080/login
```

Expected: container `autore-jenkins` Up, service `active`, UI `jenkins-ui:200` (atau 403 — masih normal, itu halaman login).

- [ ] **Step 2: Ambil kredensial admin Jenkins & cek node/label via API**

```bash
J=http://127.0.0.1:8080
JP=$(docker exec autore-jenkins cat /var/jenkins_home/secrets/initialAdminPassword)
echo "admin-pass: $JP"
curl -s -u admin:$JP $J/computer/api/json | python3 -c "import sys,json;d=json.load(sys.stdin);[print(c['displayName'], [l['name'] for l in c['assignedLabels']], c.get('offline')) for c in d['computer']]"
```

Expected: ada node `master` dan node agent (nama `jenkins-agent`/hostname VPS) dengan label yang memuat `vps-runner-1`. Kalau labelnya beda (misal `docker`), catat — perlu disamakan di Task 1.

- [ ] **Step 3: Cek kredensial & job yang sudah ada**

```bash
curl -s -u admin:$JP $J/credentials/store/system/domain/_/api/json | python3 -c "import sys,json;d=json.load(sys.stdin);print([c['id'] for c in d['credentials']])"
curl -s -u admin:$JP $J/api/json | python3 -c "import sys,json;d=json.load(sys.stdin);print('jobs:', [j['name'] for j in d['jobs']])"
```

Expected: catat id kredensial yang sudah ada (`sonarqube-token`, `nexus-credentials`, `telegram-bot-token`?) dan job yang sudah ada (misal `autore-dummy` dari Rabu). Yang kurang dicatat untuk dibuat.

- [ ] **Step 4: Cek runner: `autore` terpasang + ci-scripts + akses GitHub**

```bash
which autore && autore --version
ls /usr/local/lib/autore-ci/ 2>/dev/null || echo 'ci-lib: TIDAK ADA (pipeline akan pakai fallback ./scripts/)'
git ls-remote https://github.com/tugure-git-intern/Autore.git HEAD 2>&1 | head -2
```

Expected: `autore` terpasang (atau tercatat belum); `ci-lib` ada atau fallback; `git ls-remote` sukses (repo publik) atau butuh creds (repo privat).

- [ ] **Step 5: Cek port deploy 8081 & Telegram manual**

```bash
ss -tlnp 2>/dev/null | grep ':8081' || echo 'port 8081 KOSONG (aman untuk deploy)'
export TELEGRAM_BOT_TOKEN='<isi>' TELEGRAM_CHAT_ID='5868902139'
bash scripts/notify-telegram.sh 2>&1 | tail -3
```

Expected: port 8081 kosong; script kirim laporan → cek chat Telegram. (Token diisi dari kredensial yang ada / bot yang sudah dibuat Rabu.)

- [ ] **Step 6: Catat hasil audit** — tulis daftar: (a) label node aktual, (b) kredensial yang kurang, (c) apakah library & job sudah ada, (d) repo publik/privat, (e) port 8081. Serahkan ke Task 1.

### Task 1: Prerequisites & Konfigurasi Jenkins

**Files:** konfigurasi Jenkins (UI/API), bukan file repo.

- [ ] **Step 1: Buat kredensial yang kurang via Jenkins API**

```bash
J=http://127.0.0.1:8080
# sonarqube-token (string) — token dari SonarQube:
SQ=http://127.0.0.1:9000
SQTOK=$(curl -s -u admin:admin -X POST "$SQ/api/user_tokens/generate?name=jenkins" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -s -u admin:$JP -X POST "$J/credentials/store/system/domain/_/createCredentials" \
  --data-urlencode 'json={"": "0","credentials": {"scope":"GLOBAL","id":"sonarqube-token","secret":"'"$SQTOK"'","description":"SonarQube token","stapler-class":"org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl"}}'
# nexus-credentials (username/password):
NP=$(docker exec autore-nexus cat /nexus-data/admin.password)
curl -s -u admin:$JP -X POST "$J/credentials/store/system/domain/_/createCredentials" \
  --data-urlencode 'json={"": "0","credentials": {"scope":"GLOBAL","id":"nexus-credentials","username":"admin","password":"'"$NP"'","description":"Nexus admin","stapler-class":"com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl"}}'
# telegram-bot-token (string) — isi token bot yang dipakai Rabu:
curl -s -u admin:$JP -X POST "$J/credentials/store/system/domain/_/createCredentials" \
  --data-urlencode 'json={"": "0","credentials": {"scope":"GLOBAL","id":"telegram-bot-token","secret":"<TOKEN_BOT>","description":"Telegram bot","stapler-class":"org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl"}}'
```

Expected: `curl` balas 200/201; cek ulang `.../api/json` → tiga id muncul. (Kalau id sudah ada, langkah ini skip.)

- [ ] **Step 2: Samakan label agent dengan `vps-runner-1`**

Kalau node agent di Task 0 labelnya bukan `vps-runner-1`: atur di Jenkins UI → Manage Jenkins → Nodes → (agent) → Configure → Labels = `vps-runner-1` (boleh ditambah `docker` juga). Verifikasi:

```bash
curl -s -u admin:$JP $J/computer/api/json | python3 -c "import sys,json;d=json.load(sys.stdin);[print(c['displayName'],[l['name'] for l in c['assignedLabels']]) for c in d['computer'] if c['displayName']!='master']"
```

Expected: label agent memuat `vps-runner-1`.

- [ ] **Step 3: Daftarkan Shared Library**

Jenkins UI → Manage Jenkins → System → Global Pipeline Libraries → tambah:
- Name: `autore` (default `@Library('autore')`), Default version: `main`
- Retrieval: Modern SCM → Git → Project Repository: `https://github.com/tugure-git-intern/Autore.git` (tambah creds GitHub kalau privat)
- Library path: `jenkins-shared-library`

Expected: library tersimpan; tidak ada error saat save.

- [ ] **Step 4: Buat job pipeline yang memanggil `autorePipeline`**

Jenkins UI → New Item → Pipeline `autore-e2e` → Pipeline → Definition: Pipeline script:

```groovy
@Library('autore') _
autorePipeline()
```

(atau `autorePipeline(appName: 'autore-dummy', deployPort: 8081)` bila perlu override). Expected: job tersimpan, bisa di-`Build Now`.

### Task 2: Run Happy-Path End-to-End

**Files:** tidak ada perubahan awal; hanya fix bila stage gagal.

- [ ] **Step 1: Jalankan build pertama**

Jenkins UI → `autore-e2e` → Build Now (atau trigger via `curl -X POST -u admin:$JP $J/job/autore-e2e/build`). Pantau Console Output. Expected: agent `vps-runner-1` mengambil job; stage 1–9 berjalan.

- [ ] **Step 2: Verifikasi tiap stage (criteria sukses)**

| Stage | Bukti sukses |
|---|---|
| 1. Checkout & Audit | `IMMUTABLE_IMAGE_TAG` 40-hex; tidak tolak commit |
| 2. Static Guard & Gitleaks | tidak ada secret terdeteksi |
| 3. Trivy Source | tidak ada HIGH/CRITICAL |
| 4. Clippy & SonarQube | `Quality Gate LULUS (status: OK)` + `rust > 0` |
| 5. Build Image & musl | image ter-build; `dist/` berisi binary + `SHA256SUMS` |
| 6. Trivy Image & SBOM | scan-image lulus; `dist/sbom.cdx.json` ada |
| 7. Verify Checksums | `sha256sum -c` OK |
| 8. Push Nexus | `SUKSES` + digest terverifikasi; `.verified-image-digest` tertulis |
| 9. Deploy by Digest | deploy sukses; aplikasi respons di `:8081` |

- [ ] **Step 3: Iterasi fix kegagalan**

Untuk tiap stage gagal: baca error di Console Output, perbaiki (konfigurasi Jenkins / kredensial / skrip `scripts/` bila perlu), commit fix di branch + PR seperti alur sesi (jangan push langsung ke main), lalu re-run. Ulangi sampai stage 1–9 hijau.

- [ ] **Step 4: Smoke test aplikasi hasil deploy**

```bash
curl -s -o /dev/null -w 'deploy:%{http_code}\n' http://127.0.0.1:8081/
```

Expected: `deploy:200` (atau kode sukses sesuai dummy-app).

### Task 3: Verifikasi Audit Telegram (Sukses)

- [ ] **Step 1: Cek pesan Telegram** — buka chat bot; pesan laporan audit dari `post.always` harus masuk: commit SHA, branch, author, BUILD_NUMBER, status SUKSES.
- [ ] **Step 2: Kalau tidak masuk** — cek `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` (harus numerik), tes manual `scripts/notify-telegram.sh` dari workspace agent, pastikan `post.always` mengeksekusi (log `LAPORAN AUDIT TELEGRAM`).

### Task 4: Buktikan Fail-Closed (Uji Negatif)

**Files:** `sandbox/dummy-app/` (sementara, di-revert setelah uji).

- [ ] **Step 1: Sisipkan secret di dummy-app**

```bash
cd ~/Autore
printf 'AWS_ACCESS_KEY=%s\n' "$AWS_ACCESS_KEY" >> sandbox/dummy-app/app.py
git add sandbox/dummy-app/app.py
git commit -m "test(simulasi): sisipkan secret untuk uji fail-closed"
git push origin main
```

Expected: push sukses (repo main sandbox).

- [ ] **Step 2: Trigger build & verifikasi PENOLAKAN**

Build job `autore-e2e` (SCM polling menangkap push baru). Expected: pipeline **FAIL di stage 2 (Gitleaks)** atau stage 3 — build di-*abort*, status merah.

- [ ] **Step 3: Verifikasi Telegram penolakan** — pesan audit masuk dengan status **DITOLAK/FAILED** + detail pelanggaran.
- [ ] **Step 4: Revert sabotase**

```bash
cd ~/Autore
git revert --no-edit HEAD
git push origin main
```

Expected: repo kembali bersih; build berikutnya hijau kembali.

### Task 5: Verifikasi Immutability di Pipeline (Opsional Lanjutan)

- [ ] **Step 1: Re-run build pada commit yang sama** — jika tidak ada commit baru, pipeline stage 8 harus gagal dengan error ALLOW_ONCE/redeploy (bukti immutability ter-enforce di pipeline), ATAU gunakan commit baru (tag baru) → sukses. Dokumentasikan hasilnya.
- [ ] **Step 2: Verifikasi image di Nexus** — `docker pull 127.0.0.1:5000/autore-dummy@<digest>` berhasil; tag lama tidak bisa ditimpa.

### Task 6: Wrap-up & Dokumentasi

- [ ] **Step 1: Update spec/README** — tambahkan bagian "Hasil Validasi E2E Jenkins": tanggal, hasil tiap stage, bukti fail-closed, dan catatan fix yang ditemukan selama E2E.
- [ ] **Step 2: Update skill `autore-sandbox-setup`** — catat gotcha baru dari E2E (label agent, kredensial, rantai artifact).
- [ ] **Step 3: Bersihkan** — hapus image/build sementara, pastikan `git status` bersih, sinkronkan laptop (`git fetch && git checkout -B main origin/main`).
- [ ] **Step 4: Laporan harian** — siapkan entri aktivitas untuk hari E2E ini berdasarkan hasil nyata.

---

## Self-Review

1. **Spec coverage:** Semua 10 tahap (9 stage + post) punya kriteria di Task 2; fail-closed di Task 4; Telegram di Task 3; immutability di Task 5; dokumentasi di Task 6. Gap: tidak ada task khusus untuk `notify-telegram.sh` bila ada error — sudah tercakup di Task 3 Step 2.
2. **Step scan:** Setiap step punya satu aksi + hasil yang bisa dicek (expected output). Tidak ada step "handle edge cases".
3. **Konsistensi:** Label `vps-runner-1`, kredensial `sonarqube-token`/`nexus-credentials`/`telegram-bot-token`, chat_id `5868902139`, port 8081 — konsisten dengan `autorePipeline.groovy` dan `notify-telegram.sh`.
4. **Review Focus:** 7 poin di atas semua punya step (label → Task 0/1, kredensial → Task 1, library → Task 1, checkout privat → Task 0 Step 4 + Task 1 Step 3, rantai artifact → Task 2 Step 2/3, port 8081 → Task 0 Step 5, Telegram → Task 0 Step 5 + Task 3).
5. **Proportion:** Plan ringkas, perintah memakai variabel pendek (`J`, `JP`, `NP`, `SQTOK`) agar aman di-paste ke terminal (hindari baris >80 char).
