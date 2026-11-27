#!/usr/bin/env bash
# Hermetic test untuk watchdog-infra.sh. Stub docker + notify, tanpa container nyata.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/watchdog-infra.sh"
[[ -f "$SCRIPT" ]] || { echo "GAGAL: $SCRIPT tidak ada" >&2; exit 1; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$SCRATCH/bin" "$SCRATCH/health" "$SCRATCH/running" "$SCRATCH/ws"

cat > "$SCRATCH/bin/docker" <<'STUB'
#!/usr/bin/env bash
cmd="$1"; shift
echo "$cmd $1" >> "$DOCKER_LOG"
case "$cmd" in
  inspect)
    c="$1"; fmt="$3"
    case "$fmt" in
      *Health.Status*) cat "$HEALTH_DIR/$c" 2>/dev/null || exit 1 ;;
      *State.Running*) cat "$RUNNING_DIR/$c" 2>/dev/null || exit 1 ;;
      *) exit 1 ;;
    esac ;;
  restart) exit 0 ;;
esac
STUB
chmod +x "$SCRATCH/bin/docker"

cat > "$SCRATCH/bin/notify" <<'STUB'
#!/usr/bin/env bash
[[ "${1:-}" == "--teks" ]] || { echo "notify: argumen salah: $*" >&2; exit 2; }
printf '%s\n' "${2:-}" >> "$KABAR"
STUB
chmod +x "$SCRATCH/bin/notify"

export PATH="$SCRATCH/bin:$PATH"
export AUTORE_WORKSPACE="$SCRATCH/ws"
export AUTORE_NOTIFY_BIN="$SCRATCH/bin/notify"
export HEALTH_DIR="$SCRATCH/health" RUNNING_DIR="$SCRATCH/running"
export DOCKER_LOG="$SCRATCH/docker.log" KABAR="$SCRATCH/kabar.txt"

NAMA=(autore-nexus autore-sonarqube autore-jenkins)
fail() { echo "GAGAL: $*" >&2; exit 1; }
assert_eq() { [[ "$1" == "$2" ]] || fail "${3:-} harap='$1' dapat='$2'"; }
jumlah_restart() { grep -c '^restart ' "$DOCKER_LOG" || true; }

reset_case() {
  rm -rf "$SCRATCH/health" "$SCRATCH/running" "$SCRATCH/ws" "$DOCKER_LOG" "$KABAR"
  mkdir -p "$SCRATCH/health" "$SCRATCH/running" "$SCRATCH/ws"
  : > "$DOCKER_LOG"; : > "$KABAR"
  local c
  for c in "${NAMA[@]}"; do
    echo healthy > "$SCRATCH/health/$c"
    echo true > "$SCRATCH/running/$c"
  done
}
run() { bash "$SCRIPT" "$@" >/dev/null; }

# 1. semua sehat -> tanpa restart, tanpa kabar
reset_case
run
assert_eq 0 "$(jumlah_restart)" "kasus-1 restart"
assert_eq 0 "$(wc -l < "$KABAR")" "kasus-1 kabar"

# 2. unhealthy 2x dengan ambang 3 -> belum restart
reset_case
echo unhealthy > "$HEALTH_DIR/autore-nexus"
run; run
assert_eq 0 "$(jumlah_restart)" "kasus-2 restart"

# 3. menit ke-3 -> tepat satu restart + satu kabar
run
assert_eq 1 "$(grep -c '^restart autore-nexus$' "$DOCKER_LOG" || true)" "kasus-3 restart"
assert_eq 1 "$(grep -c 'autore-nexus' "$KABAR" || true)" "kasus-3 kabar"

# 4. starting -> tidak dihitung gagal
reset_case
echo starting > "$HEALTH_DIR/autore-nexus"
for _ in 1 2 3 4 5; do run; done
assert_eq 0 "$(jumlah_restart)" "kasus-4 restart"

# 5. kuota restart habis -> tidak restart lagi, kabar minta tindakan manual
reset_case
echo unhealthy > "$HEALTH_DIR/autore-nexus"
printf '{"autore-nexus":{"gagal_beruntun":0,"restart_terpakai":2}}' > "$SCRATCH/ws/watchdog-infra.json"
run; run; run
assert_eq 0 "$(jumlah_restart)" "kasus-5 restart"
assert_eq 1 "$(grep -c 'tindakan manual' "$KABAR" || true)" "kasus-5 kabar manual"

# 6. --dry-run -> tidak pernah restart
reset_case
echo unhealthy > "$HEALTH_DIR/autore-nexus"
for _ in 1 2 3; do bash "$SCRIPT" --dry-run >/dev/null; done
assert_eq 0 "$(jumlah_restart)" "kasus-6 restart"

# 7. sembuh di tengah rentetan -> hitungan kembali nol
reset_case
echo unhealthy > "$HEALTH_DIR/autore-nexus"
run; run
echo healthy > "$HEALTH_DIR/autore-nexus"
run
echo unhealthy > "$HEALTH_DIR/autore-nexus"
run; run
assert_eq 0 "$(jumlah_restart)" "kasus-7 restart"

# 8. nilai JSON tidak boleh kosong / bernewline di tengah (docker inspect bisa
#    mencetak baris kosong lalu gagal saat key tidak ada)
reset_case
keluar="$(bash "$SCRIPT" --dry-run)"
while IFS= read -r baris; do
  [[ "$baris" =~ ^\{\"container\":\"[a-z-]+\",\"health\":\"(healthy|unhealthy|starting|none)\",\"running\":\"(true|false)\",.*\}$ ]] \
    || fail "kasus-8: baris JSON tidak valid: $(printf '%q' "$baris")"
done <<< "$keluar"

echo "LULUS: watchdog-infra (8 skenario)"
