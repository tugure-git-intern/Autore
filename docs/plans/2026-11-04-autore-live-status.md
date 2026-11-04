# Autore Applications UI and Live Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish `/applications` as thin light-mode application table, then make Rust `autore status --json` flow through Hono on `:9121` into Next.js pages as validated real status data.

**Current context / assumptions:**

- Active Autore checkout on VPS: `~/Autore`; public dashboard runs from that checkout at `http://100.80.3.14:9120`; Hono binds only `127.0.0.1:9121`.
- `~/Autore` currently has user-owned, uncommitted Pipeline UI changes in `web/apps/dashboard/src/app/pipeline/page.tsx`, `page.test.tsx`, and `src/components/pipeline/stage-timeline.tsx`. Do not reset, reformat, stage, commit, or overwrite them.
- Earlier commits already added a partial implementation: `cli/src/status.rs`, `Commands::Status`, Hono adapter, and live dashboard provider. Do not duplicate them. Fix contract drift and wire remaining mock page to those pieces.
- Real CLI contract is defined by `cli/src/status.rs`: unavailable text is `""`, never `null`; `latest_pipeline.stages` is `string[]`, never objects. `latest_pipeline` is one global latest pipeline, not one pipeline per application.
- UI wording decision: use exact requested columns `Nama`, `Status Keamanan`, `Terakhir Update`, `Aksi`. `Status Keamanan` contains existing status badge plus `N temuan` text; this avoids an unrequested fifth column.
- No Jenkins build, release, Docker change, service restart, or deploy during implementation. Production rollout is a separate explicit approval step.

**Architecture:** Rust remains sole source of operational facts: it combines the atomic workspace snapshot, `registry.tsv`, and Docker presence, then emits one canonical JSON object on stdout. Hono executes only fixed argv `autore status --json`, rejects any payload not exactly matching that contract, caches only last valid payload, and exposes it as `{ data, stale }`. Next.js remains a reader: one `StatusProvider` fetches `/api/status`; `/applications` and `/pipeline` render that state without querying Docker, Jenkins, or Nexus.

**Tech Stack:** Rust + clap + serde/serde_json; Node 18 + Hono 4; Next.js 15 App Router, React 19, Tailwind 4, Vitest/Testing Library; systemd user units.

**Spec:** User request in this conversation; existing contract authority: `cli/src/status.rs` and `~/.hermes/skills/autore-cicd/SKILL.md` section “Web v1”.

## Global Constraints

- Run all Autore build/test commands on VPS, from `~/Autore` or its `web/` workspace root as stated.
- No new dependencies. Use existing Rust serde and Node `execFile` only.
- Hono must use fixed argv `["status", "--json"]`, `shell: false`, 5-second timeout. Browser input must never reach process execution.
- API validation must use exact object key sets and reject wrong types/extra fields. Invalid JSON never enters cache.
- API failure before first valid result returns `503 {"error":"Autore status unavailable"}`. Failure after valid result returns cached `data` with `stale: true`; UI displays existing red stale banner.
- Light-only UI: canvas `#FAFAFA`, surface `#FFFFFF`, `border-gray-200`/1px separation, no gradients, glass, or elevation above existing `shadow-sm` limit.
- CLI stdout under `--json` contains exactly one JSON object. Warnings go to stderr.
- Commit only task-owned paths. Do not include prior dirty pipeline files unless they are intentionally changed by Task 4 and user explicitly accepts that scope.

## Review Focus

- Snapshot missing/corrupt: CLI returns default shape, exits zero, stdout remains parseable JSON.
- Registry-only application: status stays `unknown`; UI must not paint it passed or show fake security success.
- Hono receives Rust empty strings: validation accepts them and forwards empty strings unchanged; no `null` conversion.
- Hono receives object stages or an unknown extra key: returns `503` before cache and never treats malformed output as current data.
- CLI failure after valid read: Hono serves exactly cached payload with `stale: true`; UI banner makes staleness visible.
- Multiple registered applications: table keeps each row’s `Detail` URL encoded and no horizontal overflow at 1280px.
- Pipeline route with `?app=<id>`: preserve existing layout; label can name selected app, but content remains global `latest_pipeline` until Rust contract gains per-app history.

---

## File map

| Path | Responsibility |
| --- | --- |
| `cli/src/status.rs` | Canonical DTO, snapshot load/save, registry + Docker aggregation, Rust tests. |
| `cli/src/main.rs` | clap `status --json` command handler; only stdout presentation layer. |
| `web/apps/api/src/status.ts` | Fixed-argv process runner, exact runtime validator, in-memory last-good cache. |
| `web/apps/api/src/status.test.ts` | API contract, cache, argv-injection, and exact-type tests. |
| `web/apps/dashboard/src/lib/contracts.ts` | TypeScript mirror of Rust shape; no nullable invented fields. |
| `web/apps/dashboard/src/app/applications/page.tsx` | Full-width live application table. |
| `web/apps/dashboard/src/app/applications/page.test.tsx` | Applications table and empty/stale behavior tests. |
| `web/apps/dashboard/src/app/pipeline/page.tsx` | Existing Pipeline layout switched from temporary static data to `StatusProvider` data. |
| `web/apps/dashboard/src/app/pipeline/page.test.tsx` | Pipeline real-data/stale/unknown-app behavior tests. |
| `web/README.md` | One operational check section for CLI → Hono → Next route. |

## Step-by-step tasks

### Task 0: Preserve baseline and create isolated branch

**Files:** none unless `.gitignore` lacks `.worktrees/`; do not change feature source.

**Interfaces:**
- Consumes: VPS repository `~/Autore` and its existing dirty Pipeline files.
- Produces: isolated feature worktree whose branch starts from current `main` without absorbing unrelated changes.

- [ ] **Step 1: Record baseline and verify scope**

Run on VPS:

```bash
cd ~/Autore
git status --short
git diff -- web/apps/dashboard/src/app/pipeline/page.tsx \
  web/apps/dashboard/src/app/pipeline/page.test.tsx \
  web/apps/dashboard/src/components/pipeline/stage-timeline.tsx
git check-ignore -q .worktrees || echo '.worktrees is not ignored'
```

Expected: only known Pipeline UI files are dirty; `.worktrees` is ignored. If other files are dirty, stop and ask user which belong to this feature before proceeding.

- [ ] **Step 2: Create linked worktree and verify clean feature baseline**

```bash
cd ~/Autore
git worktree add .worktrees/autore-live-status -b feat/autore-live-status
git -C .worktrees/autore-live-status status --short
git -C .worktrees/autore-live-status branch --show-current
```

Expected: empty status and branch `feat/autore-live-status`.

- [ ] **Step 3: Run narrow baseline suites**

```bash
cd ~/Autore/.worktrees/autore-live-status
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path cli/Cargo.toml status::tests
cd web && npm test -- --run apps/api/src/status.test.ts apps/dashboard/src/app/applications/page.test.tsx
```

Expected: both commands pass. If baseline fails, record exact failure and ask whether to repair it before feature work.

### Task 1: Harden Rust `autore status --json` contract

**Files:**
- Modify: `cli/src/status.rs`
- Modify: `cli/src/main.rs` only if a test exposes non-JSON stdout/stderr leakage
- Test: `cli/src/status.rs` `#[cfg(test)]` module and `cli/src/main.rs` test module

**Interfaces:**
- Produces exact JSON shape:

```rust
Snapshot {
    system_status: String,
    infra: Infra { jenkins: String, nexus: String },
    stats: Stats { total_apps: usize, running_containers: usize },
    applications: Vec<Application>,
    latest_pipeline: Pipeline,
}
```

- `Application.last_build` and `Application.commit_sha` are `String` and use `""` if unavailable.
- `Pipeline.failure_reason`, `security_summary`, `commit_sha`, and `author` are `String`; `Pipeline.stages` is `Vec<String>`; unavailable text is `""`.
- Command: `autore status --json` prints `status::canonical(&status::build(&serve::workspace_dir()))` once to stdout and exits `0` for absent/corrupt snapshot.

- [ ] **Step 1: Write failing Rust tests for machine-readable output behavior**

In `cli/src/status.rs`, add tests with these exact assertions:

```rust
#[test]
fn load_default_menghasilkan_kontrak_json_dengan_teks_kosong() {
    let tmp = TempDir::new().unwrap();
    let value: serde_json::Value = serde_json::from_str(&canonical(&build(tmp.path()))).unwrap();
    assert_eq!(value["latest_pipeline"]["failure_reason"], "");
    assert_eq!(value["latest_pipeline"]["security_summary"], "");
    assert_eq!(value["latest_pipeline"]["commit_sha"], "");
    assert_eq!(value["latest_pipeline"]["author"], "");
    assert_eq!(value["latest_pipeline"]["stages"], serde_json::json!([]));
}

#[test]
fn canonical_tidak_mengubah_teks_kosong_menjadi_null() {
    let json = canonical(&Snapshot::default());
    assert!(!json.contains(":null"), "{json}");
}
```

In `cli/src/main.rs`, add a clap-level test that `autore status --json` parses as `Commands::Status { json: true }` using the project’s existing `Cli::try_parse_from` convention.

- [ ] **Step 2: Run tests and verify RED**

```bash
cd ~/Autore/.worktrees/autore-live-status
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path cli/Cargo.toml load_default_menghasilkan_kontrak_json_dengan_teks_kosong canonical_tidak_mengubah_teks_kosong_menjadi_null -- --exact
```

Expected before implementation: at least the new regression test fails if any field is `null` or omitted. If both pass because implementation already satisfies them, keep them as regression coverage and document that current Rust contract was already correct; do not manufacture a code change.

- [ ] **Step 3: Make smallest contract-preserving Rust correction**

Keep the existing structs and `Commands::Status { json }` handler. Correct only defects exposed by Step 2:
- retain `String` types and `String::new()` defaults;
- keep `canonical()` as `serde_json::to_string(snapshot)`;
- never add `Option<String>` or a second JSON schema;
- ensure diagnostic `eprintln!` calls stay off stdout in JSON mode.

- [ ] **Step 4: Verify Rust unit and command-level behavior**

```bash
cd ~/Autore/.worktrees/autore-live-status
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path cli/Cargo.toml status::tests
workspace=$(mktemp -d)
AUTORE_WORKSPACE="$workspace" PATH="$HOME/.cargo/bin:$PATH" \
  cargo run --quiet --manifest-path cli/Cargo.toml -- status --json \
  | python3 -c 'import json,sys; x=json.load(sys.stdin); assert set(x)=={"system_status","infra","stats","applications","latest_pipeline"}; assert x["latest_pipeline"]["stages"]==[]; assert x["latest_pipeline"]["failure_reason"]==""; print("status JSON contract OK")'
```

Expected: Rust tests pass; final line exactly `status JSON contract OK`.

- [ ] **Step 5: Commit Rust contract work**

```bash
cd ~/Autore/.worktrees/autore-live-status
git add cli/src/status.rs cli/src/main.rs
git commit -m "feat(cli): harden status JSON contract"
```

Expected: commit includes only these files. If no production Rust change was needed, commit tests as `test(cli): lock status JSON contract` instead.

### Task 2: Make Hono validate Rust schema exactly and retain last good state

**Files:**
- Modify: `web/apps/api/src/status.ts`
- Modify: `web/apps/api/src/status.test.ts`

**Interfaces:**
- Consumes Task 1 JSON literal.
- Produces `loadDashboardStatus(run?: RunAutore): Promise<{ data: DashboardStatus; stale: boolean }>`.
- `DashboardStatus` must match Rust strings exactly; it must not use `string | null`, and stages must be `string[]` only.
- API routes stay `GET /healthz` and `GET /api/status` in `web/apps/api/src/index.ts`; no new routes.

- [ ] **Step 1: Replace API fixture with exact Rust payload and write failing validator tests**

In `web/apps/api/src/status.test.ts`, change fixture unavailable values from `null` to `""`. Add these tests:

```ts
it("accepts Rust empty-string fields and string stage ids", async () => {
  const { loadDashboardStatus } = await freshStatus();
  await expect(loadDashboardStatus(async () => JSON.stringify(fixture))).resolves.toEqual({
    data: fixture,
    stale: false,
  });
});

it("rejects nullable fields, stage objects, and extra fields", async () => {
  const { loadDashboardStatus } = await freshStatus();
  await expect(loadDashboardStatus(async () => JSON.stringify({
    ...fixture,
    latest_pipeline: { ...fixture.latest_pipeline, failure_reason: null },
  }))).rejects.toThrow("invalid Autore status JSON");
  await expect(loadDashboardStatus(async () => JSON.stringify({
    ...fixture,
    latest_pipeline: { ...fixture.latest_pipeline, stages: [{ id: "build" }] },
  }))).rejects.toThrow("invalid Autore status JSON");
  await expect(loadDashboardStatus(async () => JSON.stringify({ ...fixture, unexpected: true }))).rejects.toThrow(
    "invalid Autore status JSON",
  );
});
```

- [ ] **Step 2: Verify RED**

```bash
cd ~/Autore/.worktrees/autore-live-status/web
npm test -- --run apps/api/src/status.test.ts
```

Expected before implementation: nullable/stage-object cases are incorrectly accepted by current `isNullableString` and `isStages`, so test fails.

- [ ] **Step 3: Align types and guards in `web/apps/api/src/status.ts`**

Make exactly these changes:
- replace every `string | null` contract field with `string`;
- replace `isNullableString()` with `isString(value): value is string`;
- change `isStages()` to `Array.isArray(value) && value.every((stage) => typeof stage === "string")`;
- preserve `hasExactKeys`, `lastGood`, `execFile`, `shell: false`, 5-second timeout, and fixed argv unchanged;
- do not normalize payload values in Hono. Invalid producer data must fail closed.

- [ ] **Step 4: Verify API behavior and no regression**

```bash
cd ~/Autore/.worktrees/autore-live-status/web
npm test -- --run apps/api/src/status.test.ts
```

Expected: every API test passes, including `503` before cache, stale cache after failure, and injection-proof fixed argv tests.

- [ ] **Step 5: Commit Hono adapter work**

```bash
cd ~/Autore/.worktrees/autore-live-status
git add web/apps/api/src/status.ts web/apps/api/src/status.test.ts
git commit -m "fix(api): validate status JSON exactly"
```

### Task 3: Build requested `/applications` table on real provider data

**Files:**
- Modify: `web/apps/dashboard/src/app/applications/page.tsx`
- Modify: `web/apps/dashboard/src/app/applications/page.test.tsx`
- Modify only if type errors demand it: `web/apps/dashboard/src/lib/contracts.ts`

**Interfaces:**
- Consumes `useStatus()` and `ApplicationRecord` from existing shared dashboard provider.
- Produces one full-width `<table>` with headers `Nama`, `Status Keamanan`, `Terakhir Update`, `Aksi`.
- `Aksi` remains link `/pipeline?app=${encodeURIComponent(app.id)}`.

- [ ] **Step 1: Write failing behavior tests for requested table**

Replace/add tests in `page.test.tsx` using `StatusProvider` and mocked `/api/status` response containing two applications:

```ts
applications: [
  { id: "portal-klaim", name: "Portal Klaim", status: "passed", last_build: "2026-11-03T10:00:00Z", commit_sha: "405156b", security_issues: 0 },
  { id: "api-pegawai", name: "API Pegawai", status: "failed", last_build: "", commit_sha: "", security_issues: 2 },
]
```

Assert:

```ts
expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
  "Nama", "Status Keamanan", "Terakhir Update", "Aksi",
]);
expect(screen.getByRole("link", { name: "Detail" })).toHaveAttribute("href", "/pipeline?app=portal-klaim");
expect(screen.getByText("Lulus")).toBeVisible();
expect(screen.getByText("2 temuan")).toBeVisible();
expect(screen.getByText("—")).toBeVisible();
```

For multiple `Detail` links, use `screen.getAllByRole("link", { name: "Detail" })` and assert both exact hrefs, including encoded special-character ID in a dedicated test.

- [ ] **Step 2: Verify RED**

```bash
cd ~/Autore/.worktrees/autore-live-status/web
npm test -- --run apps/dashboard/src/app/applications/page.test.tsx
```

Expected: fail because current UI has five columns (`Status` and `Temuan Keamanan`) instead of exact four requested headers.

- [ ] **Step 3: Simplify `ApplicationsPage` to exact four columns**

In `page.tsx`:
- keep current `loading`, unavailable, stale banner, `EmptyApplications`, `StatusBadge`, `formatBuild`, `dash`, responsive wrapper, and thin `Card` border;
- rename heading to `Daftar Aplikasi` and subtitle to `<count> aplikasi terdaftar.`;
- merge current `Status` and `Temuan Keamanan` cells into `Status Keamanan`:

```tsx
<td className="px-5 py-4">
  <StatusBadge status={toBadge(app.status)} />
  <p className="mt-1 text-xs text-muted">
    {app.security_issues === 0 ? "0 temuan" : `${app.security_issues} temuan`}
  </p>
</td>
```

- render only app name (with ID as existing muted mono subline), formatted `last_build`, and encoded `Detail` link in remaining columns;
- do not add sorting, filters, pagination, create/delete actions, or new API data. They are unrequested.

- [ ] **Step 4: Verify dashboard UI tests and production build**

```bash
cd ~/Autore/.worktrees/autore-live-status/web
npm test -- --run apps/dashboard/src/app/applications/page.test.tsx
npm run build:dashboard
```

Expected: tests pass; Next build lists `/applications` and exits `0`.

- [ ] **Step 5: Commit applications UI**

```bash
cd ~/Autore/.worktrees/autore-live-status
git add web/apps/dashboard/src/app/applications/page.tsx \
  web/apps/dashboard/src/app/applications/page.test.tsx \
  web/apps/dashboard/src/lib/contracts.ts
git commit -m "feat(web): finish applications table"
```

Before committing, use `git diff --cached --name-only`; remove `contracts.ts` from the command if no edit was required.

### Task 4: Switch Pipeline page from static mock to validated live provider state

**Files:**
- Modify: `web/apps/dashboard/src/app/pipeline/page.tsx`
- Modify: `web/apps/dashboard/src/app/pipeline/page.test.tsx`
- Reuse without changing: `web/apps/dashboard/src/components/pipeline/pipeline-summary.tsx`, `stage-timeline.tsx`, `log-modal.tsx`

**Interfaces:**
- Consumes `useStatus()` response established by Task 2 and optional query `app`.
- Produces existing left timeline/right detail log layout with values from `data.latest_pipeline`, preserving light thin-border style.
- Global-data limitation: if selected `app` exists, its name may be shown in subtitle; the content is still `data.latest_pipeline`. Do not invent application-specific pipeline records.

- [ ] **Step 1: Write failing tests for real provider state**

Use mocked `fetch` with this exact API wrapper:

```ts
{
  data: {
    system_status: "passed",
    infra: { jenkins: "active", nexus: "active" },
    stats: { total_apps: 1, running_containers: 1 },
    applications: [{ id: "portal-klaim", name: "Portal Klaim", status: "passed", last_build: "2026-11-03T10:00:00Z", commit_sha: "405156b", security_issues: 0 }],
    latest_pipeline: {
      status: "passed", failure_reason: "", stages: ["checkout", "scan", "build", "pasang", "periksa"],
      security_summary: "Tidak ada temuan keamanan.", commit_sha: "405156b", author: "Mectov",
      raw_log: ["Pipeline selesai tanpa error."],
    },
  },
  stale: false,
}
```

Render inside `StatusProvider` with `useSearchParams` returning `app=portal-klaim`. Assert visible timeline labels and log line. Add a second test where first valid response is followed by rejected fetch, then assert stale banner `Gagal terhubung ke Jenkins. Menampilkan data terakhir.` while old details remain visible.

- [ ] **Step 2: Verify RED**

```bash
cd ~/Autore/.worktrees/autore-live-status/web
npm test -- --run apps/dashboard/src/app/pipeline/page.test.tsx
```

Expected: fail because temporary static mock page does not call provider or render stale state.

- [ ] **Step 3: Replace only mock data boundary**

Restore provider pattern already used by Applications page:
- `"use client"`, `Suspense`, `useSearchParams`, `useStatus`, error/retry and loading skeleton;
- select application only to render subtitle and reject unknown `app` ID with existing neutral copy;
- pass `state.data.latest_pipeline` directly to `PipelineSummary`, `StageTimeline`, and log panel;
- retain current two-column desktop grid, vertical timeline component, right log region, and all existing thin borders;
- do not change stage model: only the last recorded ID may inherit running/failed state.

- [ ] **Step 4: Verify route and whole dashboard**

```bash
cd ~/Autore/.worktrees/autore-live-status/web
npm test -- --run apps/dashboard/src/app/pipeline/page.test.tsx
npm test
npm run build:dashboard
```

Expected: pipeline test passes; all workspace dashboard/API tests pass; build exits `0` and lists `/pipeline`.

- [ ] **Step 5: Commit Pipeline live wiring**

```bash
cd ~/Autore/.worktrees/autore-live-status
git add web/apps/dashboard/src/app/pipeline/page.tsx \
  web/apps/dashboard/src/app/pipeline/page.test.tsx
git commit -m "feat(web): connect pipeline detail to live status"
```

Do not add `stage-timeline.tsx` unless this task changes it intentionally. This protects existing user-owned UI work.

### Task 5: End-to-end validation and documentation

**Files:**
- Modify: `web/README.md`
- Test: commands only

**Interfaces:**
- Documents local/VPS operational check; does not add runtime behavior.

- [ ] **Step 1: Write/update README verification block**

Add a concise “Live status contract check” section after existing health probes:

```bash
# Same service environment as deploy/autore-web-api.service.
AUTORE_BIN="$HOME/Autore/cli/target/release/autore" \
AUTORE_WORKSPACE="$HOME/Autore" \
  "$HOME/Autore/cli/target/release/autore" status --json | python3 -m json.tool
curl -fsS http://127.0.0.1:9121/api/status | python3 -m json.tool
curl -fsS http://127.0.0.1:9120/applications | grep -q "Daftar Aplikasi" && echo applications-ok
curl -fsS "http://127.0.0.1:9120/pipeline?app=portal-klaim" | grep -q "Detail Pipeline" && echo pipeline-ok
```

State that `:9121` is loopback-only and deployment/restart remains manual approval.

- [ ] **Step 2: Run full non-deploy verification**

```bash
cd ~/Autore/.worktrees/autore-live-status
PATH="$HOME/.cargo/bin:$PATH" cargo fmt --check --manifest-path cli/Cargo.toml
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path cli/Cargo.toml
PATH="$HOME/.cargo/bin:$PATH" cargo clippy --manifest-path cli/Cargo.toml --all-targets -- -D warnings
cd web && npm test && npm run build:dashboard
git diff --check
git status --short
```

Expected: every command exits `0`. `git status --short` contains only planned branch files; it must not contain service files or parent worktree changes.

- [ ] **Step 3: Run binary-to-Hono contract smoke test without changing services**

In one temporary terminal, launch only the feature-branch API against built binary; stop it when check ends:

```bash
cd ~/Autore/.worktrees/autore-live-status/web
AUTORE_BIN="$HOME/Autore/.worktrees/autore-live-status/cli/target/debug/autore" \
AUTORE_WORKSPACE="$(mktemp -d)" \
  npm run start:api > /tmp/autore-api-smoke.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
sleep 2
curl -fsS http://127.0.0.1:9121/api/status | python3 -c '
import json,sys
payload=json.load(sys.stdin)
assert payload["stale"] is False
assert payload["data"]["latest_pipeline"]["failure_reason"] == ""
assert payload["data"]["latest_pipeline"]["stages"] == []
print("api contract OK")
'
```

Expected: `api contract OK`. If port `9121` is occupied by production API, use an explicit temporary port only after adding a testable port override to the Hono startup entry; do not stop production service.

- [ ] **Step 4: Commit documentation**

```bash
cd ~/Autore/.worktrees/autore-live-status
git add web/README.md
git commit -m "docs(web): document live status checks"
```

### Task 6: Review and explicit-release gate

**Files:** no code change unless review finds a defect.

- [ ] **Step 1: Review branch changes only**

```bash
cd ~/Autore/.worktrees/autore-live-status
git log --oneline main..HEAD
git diff --check main...HEAD
git diff --stat main...HEAD
git diff main...HEAD -- cli/src/status.rs cli/src/main.rs web/apps/api/src/status.ts \
  web/apps/dashboard/src/app/applications/page.tsx web/apps/dashboard/src/app/pipeline/page.tsx
```

Expected: no service unit changes, no dependency lock churn, no Docker/Jenkins logic in TypeScript, no unexpected API fields.

- [ ] **Step 2: Request review before integration**

Show user:
- commits and changed paths;
- test/build output summary;
- intentional limitation: Pipeline detail is global latest pipeline, not per-application history;
- explicit question whether to merge/push/deploy.

- [ ] **Step 3: Only after explicit approval, integrate and deploy**

Integration must follow VPS source-of-truth process. First merge/cherry-pick feature branch into `main`, run full Task 5 checks from `~/Autore`, then:

```bash
cd ~/Autore
PATH="$HOME/.cargo/bin:$PATH" cargo build --release --manifest-path cli/Cargo.toml
cd web && npm run build:dashboard
systemctl --user restart autore-web-api.service autore-web-dashboard.service
systemctl --user is-active autore-web-api.service autore-web-dashboard.service
curl -fsS http://127.0.0.1:9121/healthz
curl -fsS http://127.0.0.1:9121/api/status | python3 -m json.tool
curl -fsS http://127.0.0.1:9120/applications | grep -q "Daftar Aplikasi" && echo applications-live
```

Expected: two `active` lines, `{"ok":true}`, parseable status JSON, and `applications-live`. Do not trigger Jenkins; deployment here is only dashboard/API systemd restart.

## Tests / validation matrix

| Layer | RED proof | GREEN command |
| --- | --- | --- |
| Rust contract | New default/empty JSON tests fail only if contract regressed | `cargo test --manifest-path cli/Cargo.toml status::tests` |
| Rust CLI | command output piped through Python JSON assertions | `cargo run --quiet --manifest-path cli/Cargo.toml -- status --json` |
| Hono parser/cache | nullable/object-stage payload tests fail against current permissive guards | `cd web && npm test -- --run apps/api/src/status.test.ts` |
| Applications | exact four-header test fails against current five-column table | `cd web && npm test -- --run apps/dashboard/src/app/applications/page.test.tsx` |
| Pipeline | provider/stale tests fail against current static mock | `cd web && npm test -- --run apps/dashboard/src/app/pipeline/page.test.tsx` |
| Full regression | N/A | `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cd web && npm test && npm run build:dashboard` |

## Risks, tradeoffs, and open questions

- **Known contract mismatch:** Rust emits empty strings but Hono currently accepts `null` and object stages. Task 2 fixes this intentionally fail-closed mismatch. During a rolling deploy, old binary/new API or new binary/old API can yield `503`; build Rust and restart both services together after approval.
- **Per-application pipeline truth is unavailable:** `latest_pipeline` is global. Current `/pipeline?app=` can validate selected application and display its name, but cannot prove that log belongs to it. Add `pipelines_by_application` only after Rust persists a keyed history; do not fake it now.
- **Security result precision:** Existing `security_issues` is count from persisted status. `0 temuan` means no persisted findings for an app with `passed`, not a new scan executed by page load. `unknown` remains neutral.
- **Cache scope:** `lastGood` is process memory. API restart loses cache; persistent cache is unnecessary now and would create stale-file lifecycle decisions.
- **Port smoke test:** Hono startup currently hardcodes `9121`. Do not kill production API for test. If production holds port, add a small `PORT` environment read only if needed and test it; otherwise use API unit tests plus deployed health after user approval.
- **Merge state:** parent `main` has user-owned uncommitted Pipeline files. Isolated worktree avoids them. Integration must be coordinated so merging does not overwrite those edits.

## Self-review

- Coverage: requested applications table, Rust command, Hono adapter, real Next data, thin light UI, and deployment verification each have an owning task.
- Type consistency: Rust strings/`Vec<String>` match Hono validation and dashboard contracts; no nullable or stage-object type remains.
- YAGNI: no shared package, DB, polling interval, per-app history, sorting/filtering, or new dependencies.
- Open limitation is explicit: global latest pipeline cannot be safely assigned to an arbitrary application.
