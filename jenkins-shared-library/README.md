# Autore Jenkins Trusted Shared Library

Shared Library ini dikontrol oleh tim Infrastructure / Security Admin dan digunakan oleh seluruh aplikasi internal di lingkungan CI/CD Jenkins.

## Fitur Utama

- **Enforce Immutable Commit Tags:** Memvalidasi format commit SHA (full 40-hex) dan menolak tag mutable `:latest` atau `SHORT_SHA`.
- **Pre-Build Security Gates:** Menjalankan Autore Static Guard, Gitleaks, dan Trivy filesystem/misconfig scan (`HIGH,CRITICAL`).
- **SonarQube SAST & Quality Gate:** Mengimpor hasil `cargo clippy`, mem-polling Compute Engine task hingga `SUCCESS`, membaca Quality Gate via `analysisId`, dan memverifikasi `ncloc_language_distribution` `rust > 0`.
- **Post-Build Trivy Image Scan & SBOM:** Memverifikasi UID image `!= 0`, memindai vulnerability OS/library (`HIGH,CRITICAL`), dan menghasilkan CycloneDX SBOM.
- **Nexus Immutability & Authenticated Manifest Verification:** Memastikan policy repository Nexus adalah `ALLOW_ONCE` (*Disable redeploy*), mem-push image bertag commit, dan memverifikasi kesesuaian `Docker-Content-Digest` via authenticated `HEAD` request.
- **Deployment Berbasis Digest:** Menjalankan container kandidat dan melakukan pergantian aman berbasis `@sha256:<digest>`.

## Cara Penggunaan di Jenkinsfile Aplikasi

```groovy
@Library('autore-shared-library@main') _

autorePipeline(
    appName: 'dummy-app',
    deployPort: 8081,
    sonarCredentialsId: 'sonarqube-token',
    nexusCredentialsId: 'nexus-credentials',
    telegramCredentialsId: 'telegram-bot-token',
    telegramChatId: '5868902139'
)
```
