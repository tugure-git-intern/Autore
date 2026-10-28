# Autore — DevSecOps & CI/CD Platform Tooling

Platform CI/CD terstandarisasi dan CLI developer tool berbasis **Rust** untuk mendukung otomatisasi build, pengujian, *security gate*, deployment container, dan pelacakan audit (*traceability*).

---

## Arsitektur Utama

1. **Dedicated Jenkins Runner (`runner/`)**
   - Memisahkan beban *build* dan *container execution* dari Jenkins Controller (Controller diatur memiliki `0` executor).
   - Berjalan sebagai service systemd (`jenkins-agent.service`) dengan koneksi **Inbound WebSocket**.
2. **CLI Tool `autore` Berbasis Rust (`cli/`)**
   - Binary mandiri (*single static binary*) tanpa ketergantungan runtime tambahan.
   - Menyediakan 4 perintah inti:
     - `autore init`: Generator interaktif `Dockerfile` & `Jenkinsfile` standar (Python, Node.js, Java, Go).
     - `autore scan`: Pemindai keamanan kode sumber, pendeteksi *hardcoded secret*, dan pemeriksa *non-root* `Dockerfile`.
     - `autore hook install`: Pemasang **Satpam Pintu 1 (Git Pre-Commit Hook)** agar kode berbahaya langsung ditolak saat `git commit`.
     - `autore doctor`: Diagnostik kesiapan sistem (Git, Java 21, Docker, Compose, service Runner, dan kapasitas disk).
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

# 4. Buat Dockerfile & Jenkinsfile untuk aplikasi baru
autore init
```
