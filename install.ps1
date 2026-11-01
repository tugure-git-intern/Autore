# install.ps1 — Installer 1-baris Autore CLI untuk Windows (PowerShell)
# Cara pakai:
#   irm https://raw.githubusercontent.com/tugure-git-intern/Autore/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$Repo = if ($env:AUTORE_GITHUB_REPO) { $env:AUTORE_GITHUB_REPO } else { "tugure-git-intern/Autore" }
$Version = if ($env:AUTORE_VERSION) { $env:AUTORE_VERSION } else { "latest" }
$BinAsset = "autore-windows-x86_64.exe"
$InstallDir = Join-Path $HOME ".autore\bin"
$TargetExe = Join-Path $InstallDir "autore.exe"

if ($Version -eq "latest") {
    $BaseUrl = "https://github.com/$Repo/releases/latest/download"
} else {
    $BaseUrl = "https://github.com/$Repo/releases/download/$Version"
}

Write-Host "==> Mengunduh Autore CLI ($BinAsset) dari $BaseUrl..." -ForegroundColor Cyan
$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("autore-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

try {
    $TmpExe = Join-Path $TmpDir $BinAsset
    $TmpSums = Join-Path $TmpDir "SHA256SUMS"

    Invoke-WebRequest -Uri "$BaseUrl/$BinAsset" -OutFile $TmpExe -UseBasicParsing
    Invoke-WebRequest -Uri "$BaseUrl/SHA256SUMS" -OutFile $TmpSums -UseBasicParsing

    Write-Host "==> Memverifikasi integritas SHA-256..." -ForegroundColor Cyan
    $ExpectedLine = Get-Content $TmpSums | Where-Object { $_ -match [regex]::Escape($BinAsset) } | Select-Object -First 1
    if (-not $ExpectedLine) {
        throw "Checksum untuk $BinAsset tidak ditemukan di SHA256SUMS"
    }
    $ExpectedHash = ($ExpectedLine -split "\s+")[0].ToLower()
    $ActualHash = (Get-FileHash -Path $TmpExe -Algorithm SHA256).Hash.ToLower()

    if ($ExpectedHash -ne $ActualHash) {
        throw "Verifikasi SHA-256 GAGAL! Expected: $ExpectedHash, Actual: $ActualHash"
    }
    Write-Host "  [OK] Checksum SHA-256 terverifikasi ($($ActualHash.Substring(0, 12))...)" -ForegroundColor Green

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path $TmpExe -Destination $TargetExe -Force

    # Tambahkan ke PATH User Windows secara permanen & sesi aktif saat ini
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $UserPath) { $UserPath = "" }
    if (($UserPath -split ";") -notcontains $InstallDir) {
        $NewUserPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
        [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
    }
    if (($env:Path -split ";") -notcontains $InstallDir) {
        $env:Path = "$env:Path;$InstallDir"
    }

    Write-Host ""
    Write-Host "==> Autore CLI berhasil dipasang di $TargetExe!" -ForegroundColor Green
    Write-Host "==> Ketik 'autore' di PowerShell atau CMD untuk memulai." -ForegroundColor Yellow
} finally {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}
