# Autore — DevSecOps & CI/CD Platform Tooling

Platform CI/CD terstandarisasi dan CLI developer tool berbasis **Rust** untuk mendukung otomatisasi build, pengujian, *security gate*, deployment container, dan pelacakan audit (*traceability*).

---

## Arsitektur Utama

1. **Dedicated Jenkins Runner (`runner/`)**
   - Memisahkan beban *build* dan *container execution* dari Jenkins Controller (Controller diatur memiliki `0` executor).
   - Berjalan sebagai service systemd (`jenkins-agent.service`) dengan koneksi **Inbound WebSocket**.
2. **CLI Tool `autore` Berbasis Rust (`cli/`)**
   - Binary native hasil kompilasi Rust tanpa ketergantungan runtime bahasa (seperti Python/Node).
   - Menyediakan 4 perintah inti:
     - `autore init`: Generator interaktif `Dockerfile`, `Jenkinsfile`, & `.dockerignore` standar (Python, Node.js, Java, Go) dengan proteksi *no-clobber* (`--force` untuk menimpa) dan validasi nama aplikasi.
     - `autore scan`: Pemindai keamanan otoritatif 3-lapis (*Static Byte Guard*, *Gitleaks*, dan *Trivy* dengan image Docker ter-pin SHA-256 digest, *fail-closed*). Gunakan `--no-docker` hanya untuk pre-commit lokal (*non-authoritative*).
     - `autore hook install`: Pemasang **Satpam Pintu 1 (Git Pre-Commit Hook)** yang mem-backup dan merangkai (*chain*) hook lama jika sudah ada.
     - `autore doctor`: Diagnostik kesiapan sistem (Git, Java 21, Docker, Compose, service Runner, binary global `/usr/local/bin/autore`, dan kapasitas disk).
3. **DevSecOps Security Gate (`scripts/security-check.sh`)**
   - **Lapis 1**: *Static Dangerous Code & Dockerfile Guard* (`os.system`, `eval`, `exec`, `shell=True`, non-root `USER`).
   - **Lapis 2**: *Gitleaks Secret Scanner* (berjalan via container Docker dengan `--redact`).
   - **Lapis 3**: *Trivy Vulnerability & Misconfig Scanner* (berjalan via container Docker untuk mendeteksi celah `CRITICAL`).
4. **Laporan Audit Bot Telegram (`scripts/notify-telegram.sh`)**
   - Mengirimkan laporan otomatis setiap selesai build (baik **SUKSES** maupun **GAGAL / KETANGKIS**) langsung ke Bot Telegram.
   - Mencatat identitas pelaku perubahan (*Author*, *Commit Hash*, *Branch*, *Build Number*, serta alasan jika ditolak satpam).

---

## Struktur Repositori

```text
Autore/
├── cli/                        # Source code CLI Rust (`autore`)
│   ├── Cargo.toml
│   └── src/
├── runner/                     # Provisioning & systemd service untuk Jenkins Runner
│   ├── setup-agent.sh
│   ├── install-agent-service.sh
│   └── jenkins-agent.service
├── scripts/                    # Skrip DevSecOps Gate & Notifikasi Audit Telegram
│   ├── security-check.sh
│   └── notify-telegram.sh
├── sandbox/                    # Lingkungan uji coba (Controller Compose + Dummy App)
│   ├── jenkins/docker-compose.yml
│   └── dummy-app/
└── docs/                       # Spesifikasi arsitektur & rencana implementasi
```

---

## Cara Cepat Menggunakan CLI `autore`

```bash
# 1. Cek kesehatan sistem & runner
autore doctor

# 2. Pindai keamanan kode proyek
autore scan --path .

# 3. Pasang pencegat otomatis sebelum git commit (Git Pre-Commit Hook)
autore hook install

# 4. Buat Dockerfile, Jenkinsfile, & .dockerignore untuk aplikasi baru
autore init
```

---

## Peringatan Keamanan Sandbox (C-1 & C-2) & Model Koneksi (H-6)

> **PENTING — KHUSUS SANDBOX:** Konfigurasi runner (`runner/setup-agent.sh`) dan controller (`sandbox/jenkins/docker-compose.yml`) di repositori ini adalah **lingkungan uji coba (Sandbox)** dan memiliki risiko arsitektural sementara yang wajib dipahami:
> 1. **C-1 (Grup `docker` = Setara Root Host):** User `jenkins` di runner sandbox berada di grup `docker`. **Jangan** menaruh kredensial produksi di runner ini dan **jangan** memasang konfigurasi grup `docker` ini sebagai runner produksi kantor.
> 2. **C-2 (`Jenkinsfile` di Repo Aplikasi):** Sebelum dipindahkan ke *Jenkins Trusted Shared Library* yang dikontrol admin, jangan menjalankan build otomatis terhadap branch/PR dari sumber yang tidak dipercaya (*untrusted PR*).
> 3. **H-6 (Loopback Binding `127.0.0.1:8080`):** Controller Jenkins diikat ke `127.0.0.1:8080`. Agent lokal di mesin yang sama terhubung langsung via loopback (`http://localhost:8080/`), sedangkan akses browser dari laptop menggunakan SSH tunnel (`ssh -L 8080:127.0.0.1:8080 <user>@<vps>`).
>
> Baca desain arsitektur isolasi produksi selengkapnya di: [`docs/PRODUCTION-ISOLATION-DESIGN.md`](docs/PRODUCTION-ISOLATION-DESIGN.md).
