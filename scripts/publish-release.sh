#!/usr/bin/env bash
# publish-release.sh — Unggah binary Linux musl, Windows .exe, dan SHA256SUMS ke GitHub Releases
# Otomatis membaca versi dari cli/Cargo.toml (mis. 0.3.0 -> tag v0.3.0).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(grep -E '^version\s*=\s*"' "${ROOT_DIR}/cli/Cargo.toml" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
TAG="v${VERSION}"
REPO="${AUTORE_GITHUB_REPO:-tugure-git-intern/Autore}"
ARTIFACT_DIR="${1:-/tmp}"

if [[ ! -f "${ARTIFACT_DIR}/autore-linux-x86_64-musl" ]]; then
  echo "ERROR: File aset tidak ditemukan: ${ARTIFACT_DIR}/autore-linux-x86_64-musl" >&2
  exit 1
fi

if [[ ! -f "${ARTIFACT_DIR}/autore-windows-x86_64.exe" && -f "/tmp/autore-windows-x86_64.exe" ]]; then
  cp "/tmp/autore-windows-x86_64.exe" "${ARTIFACT_DIR}/autore-windows-x86_64.exe"
fi

(
  cd "${ARTIFACT_DIR}"
  if [[ -f "autore-windows-x86_64.exe" ]]; then
    sha256sum autore-linux-x86_64-musl autore-windows-x86_64.exe > SHA256SUMS
  else
    sha256sum autore-linux-x86_64-musl > SHA256SUMS
  fi
)

echo "==> Mengunggah aset rilis ${TAG} ke GitHub (${REPO}) dari ${ARTIFACT_DIR}..."
TAG="${TAG}" REPO="${REPO}" ARTIFACT_DIR="${ARTIFACT_DIR}" python3 - <<'PY'
import json
import os
import urllib.error
import urllib.request

tag = os.environ["TAG"]
repo = os.environ["REPO"]
art_dir = os.environ["ARTIFACT_DIR"]

token = os.environ.get("GITHUB_TOKEN", "").strip()
if not token:
    cred_path = os.path.expanduser("~/.git-credentials")
    if os.path.exists(cred_path):
        cred = open(cred_path).read().strip()
        token = cred.split(":")[2].split("@")[0]
if not token:
    raise SystemExit("ERROR: GITHUB_TOKEN atau ~/.git-credentials tidak ditemukan")

headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/vnd.github+json",
}

try:
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases/tags/{tag}",
        headers=headers,
    )
    rel = json.loads(urllib.request.urlopen(req).read().decode())
except urllib.error.HTTPError:
    body = json.dumps({
        "tag_name": tag,
        "name": f"Autore CLI {tag}",
        "body": f"Rilis stabil {tag} Autore CLI (Linux x86_64 static musl & Windows x86_64 + SHA256SUMS).",
        "draft": False,
        "prerelease": False,
    }).encode()
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases",
        data=body,
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    rel = json.loads(urllib.request.urlopen(req).read().decode())

rid = rel["id"]
candidates = ["autore-linux-x86_64-musl", "autore-windows-x86_64.exe", "SHA256SUMS"]
assets = [name for name in candidates if os.path.exists(os.path.join(art_dir, name))]

for a in rel.get("assets", []):
    if a.get("name") in assets:
        aid = a["id"]
        del_req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/releases/assets/{aid}",
            headers=headers,
            method="DELETE",
        )
        urllib.request.urlopen(del_req)

for name in assets:
    data = open(os.path.join(art_dir, name), "rb").read()
    up_req = urllib.request.Request(
        f"https://uploads.github.com/repos/{repo}/releases/{rid}/assets?name={name}",
        data=data,
        headers={**headers, "Content-Type": "application/octet-stream"},
        method="POST",
    )
    urllib.request.urlopen(up_req)

print(f"✔ Release {tag} berhasil diperbarui ({', '.join(assets)}).")
PY
