#!/usr/bin/env bash
# scripts/watchdog-infra.sh — restart container infra yang tidak sehat, kabari Telegram.
#
# Sumber kebenaran status = healthcheck Docker di compose (bukan probe HTTP sendiri).
# Dipanggil timer systemd tiap menit; lihat docs/RUNBOOK-WATCHDOG.md.
set -euo pipefail

NAMA=(autore-nexus autore-sonarqube autore-jenkins)
declare -A AMBANG=([autore-nexus]=3 [autore-sonarqube]=5 [autore-jenkins]=3)
MAKS_RESTART=2

STATE_DIR="${AUTORE_WORKSPACE:-$HOME/autore-workspace}"
STATE="${STATE_DIR}/watchdog-infra.json"
NOTIFY="${AUTORE_NOTIFY_BIN:-/usr/local/lib/autore-ci/notify-kabar.sh}"
DRY_RUN=0

pakai() {
  cat <<'TXT'
Pakai: watchdog-infra.sh [--dry-run] [-h|--help]

  --dry-run    cetak keputusan, jangan restart apa pun dan jangan tulis state
  -h, --help   tampilkan bantuan ini

Env: AUTORE_WORKSPACE (dir state), AUTORE_NOTIFY_BIN (path notify-kabar.sh)
Uji: bash scripts/test-watchdog-infra.sh
TXT
}

status_health() {  # $1=container -> starting|healthy|unhealthy|none
  local v
  v="$(docker inspect "$1" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null | tr -d '[:space:]')"
  echo "${v:-none}"
}

status_running() {  # $1=container -> true|false
  local v
  v="$(docker inspect "$1" --format '{{.State.Running}}' 2>/dev/null | tr -d '[:space:]')"
  echo "${v:-false}"
}

baca_state() {  # $1=file $2=container -> set GAGAL RESTART
  local v
  v="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    d = {}
c = d.get(sys.argv[2]) or {}
print(int(c.get("gagal_beruntun", 0)), int(c.get("restart_terpakai", 0)))
' "$1" "$2")"
  GAGAL="${v% *}"
  RESTART="${v#* }"
}

tulis_state() {  # $1=file $2=container $3=gagal $4=restart
  local tmp="$1.tmp.$$"
  mkdir -p "$(dirname "$1")"
  python3 - "$1" "$2" "$3" "$4" "$tmp" <<'PY'
import json, sys
src, nama, gagal, restart, dst = sys.argv[1:6]
try:
    d = json.load(open(src))
except Exception:
    d = {}
d[nama] = {"gagal_beruntun": int(gagal), "restart_terpakai": int(restart)}
json.dump(d, open(dst, "w"), indent=2, sort_keys=True)
PY
  mv "$tmp" "$1"
}

kabar() {  # $1=teks
  if [[ ! -x "$NOTIFY" ]]; then
    echo "PERINGATAN: notify tidak ditemukan/tidak eksekutabel: $NOTIFY" >&2
    return 0
  fi
  "$NOTIFY" --teks "$1" || echo "PERINGATAN: gagal mengirim kabar" >&2
  return 0
}

catat() {  # $1=container $2=health $3=running $4=aksi
  printf '{"container":"%s","health":"%s","running":"%s","gagal_beruntun":%d,"restart_terpakai":%d,"aksi":"%s"}\n' \
    "$1" "$2" "$3" "$GAGAL" "$RESTART" "$4"
}

main() {
  mkdir -p "$STATE_DIR"
  local c health running ambang aksi
  for c in "${NAMA[@]}"; do
    ambang="${AMBANG[$c]}"
    health="$(status_health "$c")"
    running="$(status_running "$c")"
    baca_state "$STATE" "$c"
    aksi="pantau"

    if [[ "$health" == "healthy" ]]; then
      GAGAL=0
      RESTART=0
    elif [[ "$health" == "unhealthy" || "$running" != "true" ]]; then
      GAGAL=$((GAGAL + 1))
      # Bertindak tepat sekali saat ambang tercapai, bukan tiap menit sesudahnya.
      if (( GAGAL == ambang )); then
        if (( RESTART < MAKS_RESTART )); then
          aksi="restart"
          RESTART=$((RESTART + 1))
          GAGAL=0
          if (( DRY_RUN )); then
            printf '[dry-run] docker restart %s (restart ke-%d/%d)\n' "$c" "$RESTART" "$MAKS_RESTART"
          else
            docker restart "$c" >/dev/null || echo "PERINGATAN: docker restart $c gagal" >&2
            kabar "[Autore] ${c} tidak sehat (${ambang} menit); di-restart otomatis."
          fi
        else
          aksi="manual"
          if (( DRY_RUN )); then
            printf '[dry-run] %s perlu tindakan manual (%dx restart terpakai)\n' "$c" "$RESTART"
          else
            kabar "[Autore] ${c} tetap tidak sehat setelah ${MAKS_RESTART}x restart — perlu tindakan manual."
          fi
        fi
      fi
    fi
    # health == starting atau none saat container running: bukan bukti gagal, hitungan dibiarkan.

    if (( DRY_RUN )); then
      catat "$c" "$health" "$running" "$aksi"
    else
      tulis_state "$STATE" "$c" "$GAGAL" "$RESTART"
      catat "$c" "$health" "$running" "$aksi"
    fi
  done
}

while (( $# )); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) pakai; exit 0 ;;
    *) echo "ERROR: argumen tidak dikenal: $1" >&2; pakai >&2; exit 2 ;;
  esac
  shift
done

main
