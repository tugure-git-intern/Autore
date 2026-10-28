# Plan 1 — Sandbox Runner + Pipeline Hijau End-to-End

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Di VPS playground, satu Jenkins controller (Docker) menyuruh satu runner terpisah (VPS host: Java + Docker, systemd) untuk build → tes → deploy aplikasi dummy, sampai pipeline hijau end-to-end.

**Architecture:** Controller Jenkins jalan di container sebagai *pengganti sementara* controller kantor, dengan executor built-in = 0 (controller tidak boleh menjalankan job). Runner adalah VPS host itu sendiri — persis bentuk runner yang nanti dipasang di kantor (Java + Docker + agent sebagai service systemd, koneksi inbound via WebSocket). Build & tes aplikasi terjadi di dalam `docker build`, jadi runner hanya butuh Docker, bukan runtime per bahasa.

**Tech Stack:** Ubuntu 24.04, OpenJDK 21 (headless), Docker (`docker.io` + `docker-compose-v2` dari repo Ubuntu), `jenkins/jenkins:lts-jdk21`, Jenkins inbound agent (`agent.jar`, `-webSocket`), Python 3.12 stdlib (aplikasi dummy).

**Spec:** [`docs/superpowers/specs/2026-10-28-platform-cicd-autore-design.md`](../specs/2026-10-28-platform-cicd-autore-design.md) — plan ini = Fase 1 spec. Fase lain (DevSecOps gate, CLI Rust, porting ke kantor) jadi plan terpisah setelah plan ini hijau.

## Global Constraints

- Repo `Autore` **publik**: dilarang commit kode/data kantor, hostname/IP internal, password, atau agent secret. Aplikasi uji = dummy saja.
- Semua port yang dibuka di VPS bind ke `127.0.0.1` saja (akses dari laptop lewat SSH tunnel).
- Built-in node controller: **# of executors = 0**.
- Nama runner: `vps-runner-1`, label: `docker`. Jenkinsfile wajib `agent { label 'docker' }`.
- Tag image: `build-<BUILD_NUMBER>-commit-<sha7>`. Tidak pernah `latest`.
- Langkah bertanda 👤 butuh `sudo` → dijalankan **manusia** (agent AI tidak punya sudo di VPS ini).
- Semua script setup harus idempotent (aman dijalankan ulang).

## Review Focus

1. **Tes unit gagal** → pipeline merah, tahap Deploy tidak jalan, container lama tetap hidup. (Task 5, Step 6)
2. **Runner offline / VPS reboot** → service agent hidup lagi sendiri; selama offline job **mengantre**, bukan jalan di controller. (Task 4, Step 5; Task 3, Step 4)
3. **Stage tes ke-skip diam-diam** — BuildKit melewati stage multi-stage yang tidak dirujuk. Stage final wajib `COPY --from=test`. (Task 1, Step 5)
4. **Secret agent bocor** — tidak lewat argumen CLI (terlihat di `ps`/history), file `600` milik `jenkins`, tidak pernah masuk git. (Task 4, Step 1 & 4)
5. **Deploy ulang saat container lama masih ada / port 8081 terpakai** → container lama diganti bersih, bukan error "name already in use". (Task 5, Step 5)

## Prasyarat (sebelum Task 1)

- 👤 Set identitas git di VPS: `git config --global user.name "..."` dan `user.email "..."`.
- 👤 Siapkan cara push ke GitHub (PAT atau SSH key) — dibutuhkan sebelum Task 5.

## File Structure

```text
Autore/
├── .gitignore                         # tolak *.secret, .env
├── runner/
│   ├── setup-agent.sh                 # 👤 install Java 21, Docker, user jenkins (idempotent)
│   ├── install-agent-service.sh       # 👤 unduh agent.jar, simpan secret, pasang systemd
│   └── jenkins-agent.service          # unit systemd agent
├── sandbox/
│   ├── jenkins/docker-compose.yml     # controller pengganti (khusus sandbox)
│   └── dummy-app/
│       ├── app.py                     # HTTP server stdlib
│       ├── test_app.py                # unittest
│       ├── Dockerfile                 # stage test → stage final
│       └── Jenkinsfile                # pipeline pertama
└── docs/superpowers/{specs,plans}/
```

---

### Task 1: Aplikasi dummy + Dockerfile yang menjalankan tes

**Files:**
- Create: `sandbox/dummy-app/app.py`, `sandbox/dummy-app/test_app.py`, `sandbox/dummy-app/Dockerfile`, `.gitignore`

**Interfaces:**
- Produces: `make_server(host: str, port: int) -> http.server.HTTPServer`; `GET /health` → `200`, body JSON `{"status": "ok"}`; `GET /` → `200`, body `Hello from Autore sandbox`; path lain → `404`. Server default `0.0.0.0:8000` saat `python app.py`.

- [ ] **Step 1: Tulis tes yang gagal** — `test_app.py` (unittest): `setUpClass` menjalankan `make_server("127.0.0.1", 0)` di thread daemon, ambil port dari `server.server_address[1]`.
  - `test_health_returns_ok`: status `200`, `json.loads(body) == {"status": "ok"}`
  - `test_root_returns_greeting`: status `200`, body `== "Hello from Autore sandbox"`
  - `test_unknown_path_returns_404`: `GET /nope` → `urllib.error.HTTPError` dengan `code == 404`
- [ ] **Step 2: Jalankan, pastikan gagal** — `cd sandbox/dummy-app && python3 -m unittest -v` → FAIL/ERROR (`ModuleNotFoundError: No module named 'app'`).
- [ ] **Step 3: Implement `make_server` di `app.py`** — `http.server.BaseHTTPRequestHandler` + `HTTPServer`; blok `if __name__ == "__main__"` serve di `0.0.0.0:8000`.
- [ ] **Step 4: Jalankan, pastikan lulus** — `python3 -m unittest -v` → `Ran 3 tests ... OK`.
- [ ] **Step 5: Dockerfile** — base `python:3.12-slim`. Stage `test`: copy kedua file ke `/app`, `RUN python -m unittest -v`. Stage final: `COPY --from=test /app/app.py /app/app.py` (wajib dari stage `test`, supaya BuildKit tidak melewati tes), `EXPOSE 8000`, `CMD ["python", "app.py"]`, jalan sebagai user non-root.
- [ ] **Step 6: `.gitignore`** — isi: `*.secret`, `.env`, `__pycache__/`.
- [ ] **Step 7: Commit** — `git add .gitignore sandbox/dummy-app && git commit -m "feat(sandbox): dummy app with tested Dockerfile"`

*(Verifikasi `docker build` dilakukan di Task 3 Step 5, setelah Docker terpasang.)*

### Task 2: Script setup runner

**Files:**
- Create: `runner/setup-agent.sh`

**Interfaces:**
- Produces: user sistem `jenkins` (home `/home/jenkins`), anggota grup `docker`; dir `/home/jenkins/agent` milik `jenkins`; `java` 21 di PATH; `docker` + `docker compose`.

- [ ] **Step 1: Tulis `setup-agent.sh`** — `#!/usr/bin/env bash`, `set -euo pipefail`; keluar dengan pesan jelas bila bukan root; `apt-get install -y openjdk-21-jre-headless docker.io docker-compose-v2 curl`; `systemctl enable --now docker`; buat user `jenkins` hanya jika belum ada (`id jenkins`); `usermod -aG docker jenkins`; opsi `--add-user <nama>` untuk menambah user lain (mis. `tugure`) ke grup `docker`.
- [ ] **Step 2: Cek sintaks** — `bash -n runner/setup-agent.sh` → tanpa output, exit 0.
- [ ] **Step 3: 👤 Jalankan** — `sudo ./runner/setup-agent.sh --add-user tugure`, lalu logout/login ulang.
- [ ] **Step 4: 👤 Jalankan ulang (idempotensi)** — perintah yang sama → exit 0, tanpa error "user already exists".
- [ ] **Step 5: Verifikasi** — `java -version` → `openjdk version "21`; `sudo -u jenkins docker info --format '{{.ServerVersion}}'` → versi tercetak; `docker compose version` (sebagai `tugure`) → versi tercetak.
- [ ] **Step 6: Commit** — `git commit -m "feat(runner): idempotent agent host setup script"`

> ⚠️ Anggota grup `docker` setara root di mesin itu. Wajar untuk playground pribadi; untuk runner kantor dicatat di dokumentasi dan dikonfirmasi ke leader.

### Task 3: Controller Jenkins pengganti (sandbox)

**Files:**
- Create: `sandbox/jenkins/docker-compose.yml`

**Interfaces:**
- Produces: Jenkins UI di `http://localhost:8080/` (dari VPS; dari laptop via tunnel), Jenkins URL tersetel `http://localhost:8080/`, node `vps-runner-1` (label `docker`, launch: inbound, **Use WebSocket** dicentang, remote root `/home/jenkins/agent`).

- [ ] **Step 1: Compose** — service `jenkins`, image `jenkins/jenkins:lts-jdk21`, `container_name: autore-jenkins`, `ports: ["127.0.0.1:8080:8080"]`, volume bernama `jenkins_home:/var/jenkins_home`, `restart: unless-stopped`. Port 50000 tidak dibuka (agent pakai WebSocket).
- [ ] **Step 2: Jalankan** — `cd sandbox/jenkins && docker compose up -d`; `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/login` → `200` (tunggu ±1 menit saat start pertama).
- [ ] **Step 3: 👤 Setup UI** — dari laptop: `ssh -L 8080:localhost:8080 tugure@<ip-vps>`, buka `http://localhost:8080`. Password awal: `docker exec autore-jenkins cat /var/jenkins_home/secrets/initialAdminPassword`. Install suggested plugins, buat admin, Jenkins URL = `http://localhost:8080/`.
- [ ] **Step 4: 👤 Matikan executor controller** — Manage Jenkins → Nodes → Built-In Node → Configure → **Number of executors = 0**. Verifikasi: halaman Nodes menampilkan Built-In Node tanpa executor.
- [ ] **Step 5: Verifikasi image dummy bisa di-build** — `docker build -t autore-dummy:manual sandbox/dummy-app` → log memuat `Ran 3 tests` dan `OK`; lalu `docker image rm autore-dummy:manual`.
- [ ] **Step 6: 👤 Daftarkan node** — Manage Jenkins → Nodes → New Node `vps-runner-1` (Permanent), executors `2`, remote root `/home/jenkins/agent`, label `docker`, Launch: *Launch agent by connecting it to the controller*, centang **Use WebSocket**. Simpan; salin **secret** dari halaman node (jangan ditempel ke chat/commit).
- [ ] **Step 7: Commit** — `git commit -m "feat(sandbox): local Jenkins controller compose"`

### Task 4: Agent sebagai service systemd

**Files:**
- Create: `runner/jenkins-agent.service`, `runner/install-agent-service.sh`

**Interfaces:**
- Consumes: user `jenkins` & Java (Task 2); node `vps-runner-1` + secret (Task 3).
- Produces: `/opt/jenkins-agent/agent.jar`; `/etc/jenkins-agent/agent.env` berisi `JENKINS_URL`, `AGENT_NAME`, `AGENT_WORKDIR=/home/jenkins/agent`; `/etc/jenkins-agent/secret` (mode `600`, owner `jenkins`); service `jenkins-agent`.

- [ ] **Step 1: `install-agent-service.sh`** — usage `sudo ./runner/install-agent-service.sh <JENKINS_URL> <AGENT_NAME>`; secret dibaca via `read -rsp "Agent secret: "` (**bukan** argumen, supaya tidak muncul di `ps`/history); unduh `${JENKINS_URL%/}/jnlpJars/agent.jar`; tulis env + secret dengan permission di atas; salin unit ke `/etc/systemd/system/`; `systemctl daemon-reload && systemctl enable --now jenkins-agent`. Idempotent (overwrite file, restart service).
- [ ] **Step 2: Unit `jenkins-agent.service`** — `User=jenkins`, `EnvironmentFile=/etc/jenkins-agent/agent.env`, `ExecStart=/usr/bin/java -jar /opt/jenkins-agent/agent.jar -url ${JENKINS_URL} -name ${AGENT_NAME} -secret @/etc/jenkins-agent/secret -webSocket -workDir ${AGENT_WORKDIR}`, `Restart=always`, `RestartSec=10`, `After=network-online.target docker.service`, `WantedBy=multi-user.target`.
- [ ] **Step 3: Cek sintaks** — `bash -n runner/install-agent-service.sh` → exit 0; `systemd-analyze verify runner/jenkins-agent.service` → tanpa error selain peringatan path EnvironmentFile belum ada.
- [ ] **Step 4: 👤 Pasang** — `sudo ./runner/install-agent-service.sh http://localhost:8080/ vps-runner-1`, tempel secret. Verifikasi: `systemctl is-active jenkins-agent` → `active`; `sudo stat -c '%a %U' /etc/jenkins-agent/secret` → `600 jenkins`; halaman Nodes → `vps-runner-1` **online**.
- [ ] **Step 5: 👤 Uji tahan banting** — `sudo systemctl restart jenkins-agent` → node online lagi ≤ 30 detik. Opsional: `sudo reboot` → setelah boot, controller & node online tanpa intervensi.
- [ ] **Step 6: Commit** — `git status` memastikan tidak ada file secret; `git commit -m "feat(runner): systemd jenkins inbound agent"`

### Task 5: Pipeline pertama (hijau end-to-end)

**Files:**
- Create: `sandbox/dummy-app/Jenkinsfile`

**Interfaces:**
- Consumes: label `docker` (Task 3/4), Dockerfile (Task 1).
- Produces: container `autore-dummy` di `127.0.0.1:8081` dengan image `autore-dummy:build-<N>-commit-<sha7>`.

- [ ] **Step 1: Jenkinsfile** (declarative):
  - `agent { label 'docker' }`; `options { buildDiscarder(logRotator(numToKeepStr: '20')); disableConcurrentBuilds() }`
  - **Audit Info**: set `env.SHORT_SHA` dari `git rev-parse --short=7 HEAD`, `env.IMAGE_TAG = "build-${BUILD_NUMBER}-commit-${SHORT_SHA}"`; echo commit penuh, branch, author (`git log -1 --pretty='%an <%ae>'`), pemicu (`currentBuild.getBuildCauses()*.shortDescription.join(', ')`), `NODE_NAME`.
  - **Build & Test**: `docker build --label org.opencontainers.image.revision=${GIT_COMMIT} -t autore-dummy:${IMAGE_TAG} sandbox/dummy-app`
  - **Deploy (sandbox)**: `docker rm -f autore-dummy || true` lalu `docker run -d --name autore-dummy --restart unless-stopped -p 127.0.0.1:8081:8000 autore-dummy:${IMAGE_TAG}`
  - **Smoke Test**: `curl -fsS http://127.0.0.1:8081/health` dengan retry hingga 10× jeda 1 detik; gagal → stage merah.
  - `post { always { deleteDir() } }`
- [ ] **Step 2: 👤 Push** — `git push origin main` (Jenkins mengambil kode dari GitHub).
- [ ] **Step 3: 👤 Buat job** — New Item `autore-dummy` → Pipeline → *Pipeline script from SCM* → Git `https://github.com/tugure-git-intern/Autore.git`, branch `*/main`, Script Path `sandbox/dummy-app/Jenkinsfile`. (Webhook GitHub tidak bisa menjangkau VPS internal → pakai *Build Now*; opsi Poll SCM dibahas di plan berikutnya.)
- [ ] **Step 4: Build Now → verifikasi hijau** — console memuat `Running on vps-runner-1`, `Ran 3 tests`, `OK`, dan `{"status": "ok"}`; status SUCCESS. Di VPS: `docker ps --filter name=autore-dummy --format '{{.Image}}'` → `autore-dummy:build-1-commit-<sha7>` yang cocok dengan `git rev-parse --short=7 HEAD`.
- [ ] **Step 5: Build ulang** — Build Now kedua → SUCCESS, `docker ps` menunjukkan tag `build-2-...`, tidak ada error "Conflict. The container name is already in use".
- [ ] **Step 6: Uji gerbang tes (Review Focus #1)** — di branch `test/break-build`: ubah ekspektasi greeting di `test_app.py` supaya gagal, push, buat job sementara untuk branch tsb (atau ubah branch job), Build → **FAILURE** di stage *Build & Test*, stage Deploy ter-skip, dan `docker ps` masih menunjukkan image `build-2-...`. Kembalikan job ke `*/main`, hapus branch.
- [ ] **Step 7: Uji antre saat runner mati (Review Focus #2)** — 👤 `sudo systemctl stop jenkins-agent`, Build Now → job berstatus *waiting for next available executor* (tidak jalan di controller); 👤 `sudo systemctl start jenkins-agent` → job jalan dan SUCCESS.
- [ ] **Step 8: Commit & push** — `git commit -m "feat(sandbox): first end-to-end pipeline on dedicated runner" && git push`

---

## Definisi Selesai Plan 1

Pipeline `autore-dummy` hijau di `vps-runner-1`, controller punya 0 executor, image ter-tag dengan commit, tes yang gagal memblokir deploy, dan runner pulih sendiri setelah restart.

## Plan berikutnya (belum ditulis)

- **Plan 2 — DevSecOps & Audit:** Gitleaks + Trivy di pipeline, notifikasi tim. *Perlu keputusan:* kanal notifikasi (Telegram / Teams / Slack / email?).
- **Plan 3 — CLI Rust `autore`:** `init` / `scan` / `doctor` / `agent setup`, menanamkan template yang sudah terbukti di Plan 1–2. *Perlu info:* tech stack aplikasi tim (Node? Java? PHP? .NET?).
- **Plan 4 — Porting ke kantor + pilot + handover.** *Perlu info & izin leader:* versi Jenkins kantor (cek kompatibilitas Java 21 agent), mesin runner, aplikasi pilot.
