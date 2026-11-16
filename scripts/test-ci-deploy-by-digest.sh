#!/usr/bin/env bash
# Hermetic tests for ci-deploy-by-digest.sh.
# Stubs docker/curl so no real registry, container, or ledger is needed.
# ponytail: fixed fake digest/port covers contract; add live dummy app when E2E is desired.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/ci-deploy-by-digest.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

export AUTORE_WORKSPACE="$SCRATCH"
export APP_NAME="test-autore-dummy"
export BUILD_NUMBER="999"
export PATH="$SCRATCH/bin:$PATH"
export RESULT_JSON="$SCRATCH/.deploy-result.json"
mkdir -p "$SCRATCH/bin"

cat > "$SCRATCH/bin/docker" <<'STUBEOF'
#!/usr/bin/env bash
export AUTORE_WORKSPACE="${AUTORE_WORKSPACE:?}"
state="$AUTORE_WORKSPACE/stub-state"
mkdir -p "$state"
cmd="$1"
case "$cmd" in
  image)
    if [[ -f "$AUTORE_WORKSPACE/force-image-not-exist" ]]; then exit 1; fi
    fmt="$5"
    case "$fmt" in
      *'.Id'*) echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ;;
      *'.RepoDigests'*) echo '["localhost:5000/test-autore-dummy@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]' ;;
    esac
    ;;
  inspect)
    shift
    fmt="$2"
    case "$fmt" in
      *'.Config.Image'*)
        if [[ -f "$state/active-image" ]]; then cat "$state/active-image"; else exit 1; fi ;;
      *'autore.deployment_id'*)
        if [[ -f "$state/active-deploy-id" ]]; then cat "$state/active-deploy-id"; else exit 1; fi ;;
      *'.Image'*)
        if [[ -f "$state/active-image-id" ]]; then cat "$state/active-image-id"; else exit 1; fi ;;
      *'.HostPort'*)
        if [[ -f "$state/active-port" ]]; then echo "8081 8000/tcp"; else exit 1; fi ;;
      *) exit 1 ;;
    esac
    ;;
  pull)
    if [[ -f "$AUTORE_WORKSPACE/force-pull-fail" ]]; then echo "blob unknown" >&2; exit 1; fi
    ;;
  run)
    name="" image=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --name) name="$2"; shift 2 ;;
        -p) shift 2 ;;
        --label) shift 2 ;;
        -d) shift ;;
        *) image="$1"; shift ;;
      esac
    done
    if [[ "$name" == *"-active" ]]; then
      echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" > "$state/active-image-id"
      echo "$image" > "$state/active-image"
      echo "test-autore-dummy-999" > "$state/active-deploy-id"
    fi
    echo "container-id"
    ;;
  stop|rm)
    shift
    target="${@: -1}"
    if [[ "$target" == *"-active" ]]; then
      rm -f "$state/active-image-id" "$state/active-image" "$state/active-deploy-id"
    fi
    ;;
  logs) echo "stub logs" ;;
  *) echo "Unhandled docker cmd: $*" >&2; exit 1 ;;
esac
exit 0
STUBEOF

cat > "$SCRATCH/bin/curl" <<'STUBEOF'
#!/usr/bin/env bash
url="${@: -1}"
mode="${AUTORE_WORKSPACE}/stub-fail-health"
case "$url" in
  */health)
    if [[ -f "$mode" ]]; then exit 1; fi
    echo '{"status":"ok"}'
    ;;
  */fail) exit 1 ;;
  *) echo "ok" ;;
esac
exit 0
STUBEOF
chmod +x "$SCRATCH/bin/docker" "$SCRATCH/bin/curl"

IMAGE_REF="localhost:5000/test-autore-dummy@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

reset() {
  rm -f "$SCRATCH/.deploy-result.json" "$SCRATCH/stub-fail-health" \
    "$SCRATCH/force-pull-fail" "$SCRATCH/force-image-not-exist"
  rm -rf "$SCRATCH/stub-state"
}

assert() {
  local expected="$1" got="$2" msg="$3"
  if [[ "$expected" != "$got" ]]; then
    echo "FAIL: $msg (expected=$expected got=$got)" >&2
    exit 1
  fi
}

run_script() {
  "$@" >"$SCRATCH/out" 2>&1 || return $?
}

# 1. Deploy success writes outcome and deployment id.
reset
if ! run_script "$SCRIPT" "$IMAGE_REF"; then
  cat "$SCRATCH/out"; exit 1
fi
assert success "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outcome"])' "$SCRATCH/.deploy-result.json")" "deploy outcome"
assert "test-autore-dummy-999" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["deployment_id"])' "$SCRATCH/.deploy-result.json")" "deploy id"

# 2. Rollback by digest runs target directly and records rolled_back.
reset
if ! run_script env AUTORE_DEPLOY_MODE=rollback DEPLOY_PORT=8081 "$SCRIPT" "$IMAGE_REF"; then
  cat "$SCRATCH/out"; exit 1
fi
assert rolled_back "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outcome"])' "$SCRATCH/.deploy-result.json")" "rollback outcome"

# 3. Candidate health fails with old active: old image restored, rolled_back.
reset
mkdir -p "$SCRATCH/stub-state"
echo "old-image" > "$SCRATCH/stub-state/active-image"
echo "sha256:1111111111111111111111111111111111111111111111111111111111111111" > "$SCRATCH/stub-state/active-image-id"
echo "old-deploy-id" > "$SCRATCH/stub-state/active-deploy-id"
touch "$SCRATCH/stub-fail-health"
if run_script env HEALTH_ENDPOINT=/fail "$SCRIPT" "$IMAGE_REF"; then
  echo "FAIL: expected candidate smoke failure" >&2; exit 1
fi
assert rolled_back "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outcome"])' "$SCRATCH/.deploy-result.json")" "rollback after smoke failure"
assert old-deploy-id "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["active_after"]["deployment_id"])' "$SCRATCH/.deploy-result.json")" "old container active"

# 4. Candidate health fails without old active: failed_no_active.
reset
touch "$SCRATCH/stub-fail-health"
if run_script env HEALTH_ENDPOINT=/fail "$SCRIPT" "$IMAGE_REF"; then
  echo "FAIL: expected candidate smoke failure" >&2; exit 1
fi
assert failed_no_active "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outcome"])' "$SCRATCH/.deploy-result.json")" "no old active outcome"

# 5. Local image absent and blob download fails: hard error, no success outcome.
reset
touch "$SCRATCH/force-image-not-exist" "$SCRATCH/force-pull-fail"
if run_script "$SCRIPT" "$IMAGE_REF"; then
  echo "FAIL: expected pull failure" >&2; exit 1
fi
if grep -q 'SUKSES' "$SCRATCH/out"; then
  echo "FAIL: pull failure logged success" >&2; exit 1
fi

echo "PASS: ci-deploy-by-digest.sh (5 contract cases)"
