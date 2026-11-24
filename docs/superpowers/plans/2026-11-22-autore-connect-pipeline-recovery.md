# Autore Connect Pipeline Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make **Sambungkan Repo** report and preserve partial success accurately when GitHub push succeeds but Jenkins registration/build fails, while filling missing pipeline files without overwriting existing ones.

**Architecture:** Keep `autore connect` as orchestration authority and the API as truthful result/audit bridge. The CLI must stop before later steps on each failure, return nonzero with an exact stage marker, and preserve repo/files already pushed; API must not present nonzero exit as full success. Reuse the existing per-file pipeline helper in the active worktree and test the cross-boundary contracts at Rust CLI and API levels.

**Tech Stack:** Rust 2021 CLI, TypeScript Hono API, Vitest; existing Git/Jenkins CLI integrations.

**Spec:** User-reported flow: pushing initial app repo to GitHub, then connecting it in Autore dashboard appeared to fail at some stage while app still appeared in dashboard. Existing `docs/superpowers/plans/2026-11-22-autore-connect-pipeline-files.md` covers per-file generation; this plan covers recovery/result semantics and integration of that fix.

## Global Constraints

- Never overwrite existing `Dockerfile`, `Jenkinsfile`, or `.dockerignore` in a connected repo.
- Preserve current order: clone → fill missing pipeline files → commit/push → register Jenkins job → trigger/observe initial build.
- Failure at any stage must return nonzero; do not label a failed connect as success.
- A successful GitHub push is durable partial progress; Jenkins failure must not delete the local clone, revert the push, or hide app from registry.
- Do not allocate/record ports before push succeeds; do not leak an allocated port if a later prerequisite fails.
- Preserve exact stage/error details in CLI output and API response; avoid raw secret-bearing Git stderr.
- Keep `autore dev` local-only and out of this change.
- Leave unrelated existing worktree modifications untouched.

## Review Focus

- Push succeeds, Jenkins config missing: API reports failure and identifies Jenkins setup; repo and generated/pushed files remain available.
- Push succeeds, job creation fails: no success response; app remains visible and can be retried without duplicate clone/push side effects.
- Jenkins job is created, first build fails: report job/build stage distinctly; no false green.
- Clone, file write, commit, or push fails: stop immediately; no Jenkins registration and no registry port allocation.
- Repeat connect after partial success: return actionable conflict/recovery guidance, not generic “folder exists” without next step.

---

### Task 1: Specify and test CLI failure-stage contract

**Files:**
- Modify: `cli/src/connect.rs`
- Test: `cli/src/connect.rs` unit tests (or existing CLI integration tests if orchestration seams already exist)

**Interfaces:**
- Keep current `ConnectOpts` and `jalankan` entry points unless tests prove a minimal injectable seam necessary.
- CLI output should include stable human-readable stage labels for `clone`, `pipeline files`, `commit`, `push`, `Jenkins registration`, and `initial build`; no new generic framework.

- [x] Add failing tests for missing Jenkins config after successful push and Jenkins job/build failure after successful push; assert nonzero exit, stage-specific message, and no claim of complete success.
- [x] Confirm tests fail against current implementation.
- [x] Implement minimal stage-specific error propagation; preserve pushed repo and any files already committed.
- [x] Add regression test that failure before push does not register Jenkins or record ports; assert using existing seams/observable filesystem state.
- [x] Run focused tests: `cd cli && cargo test connect::`.

### Task 2: Make retries safe after durable push

**Files:**
- Modify: `cli/src/connect.rs`
- Test: `cli/src/connect.rs` tests or `cli/tests/connect_cli.rs` (use existing test layout)

**Interfaces:**
- Reuse current app-name validation, clone behavior, pipeline generation helper, and Jenkins registration functions.
- Retry path must recognize existing app checkout as a prior partial connect only when repo identity can be verified; never silently adopt an unrelated existing directory.

- [x] Add failing tests for retry after previous connect pushed successfully but Jenkins registration failed; verify it does not overwrite files or create a duplicate repo.
- [x] Add failing test for unrelated existing directory; verify rejection remains safe.
- [x] Implement smallest safe resume behavior: verify checkout remote matches requested normalized GitHub URL, preserve existing files, ensure missing pipeline files, then continue from the first incomplete Jenkins step.
- [x] If current CLI cannot reliably distinguish “push completed” from other partial state, do not guess; return exact recovery instructions and preserve current safe refusal.
- [x] Run focused tests and `cd cli && cargo fmt --check`.

### Task 3: Surface partial failure accurately in dashboard API

**Files:**
- Modify: `web/apps/api/src/actions.ts`
- Test: `web/apps/api/src/actions.test.ts`

**Interfaces:**
- Keep existing `ActionResult` contract unless a typed stage field is required; derive stage from a stable CLI output marker only if marker is unambiguous and covered by tests.
- Preserve current audit behavior, recording nonzero exit for failed connect.

- [x] Add failing API test: connect spawn returns nonzero after successful-push/Jenkins-stage marker; assert `ok: false`, status `422`, failure stage in returned message/output, and audit exit code nonzero.
- [x] Add failing test ensuring API does not return repo-success fields or success toast data for the failed result.
- [x] Implement minimal mapping from CLI output to truthful failure response; do not reinterpret all nonzero results as success merely because repo URL appears in stdout.
- [x] Run API tests with repository's existing package script (inspect `web/apps/api/package.json` and use its test command).

### Task 4: Verify dashboard feedback and end-to-end contract

**Files:**
- Inspect/modify: `web/apps/dashboard` connect action feedback only if current UI drops API failure output.
- Test: existing dashboard connect action tests; add only if current coverage misses error display.

- [x] Trace `/api/actions/connect` result handling to the dashboard toast/dialog; add test that nonzero Jenkins-stage result is shown as failure with CLI detail.
- [x] Run focused Rust and API/dashboard tests; then run all relevant package test scripts.
- [x] Review all diffs and `git status`; confirm existing user changes remain untouched and no secrets appear in outputs/tests.

## Self-Review

- Covers the observed mismatch: failure must not be masked by registry visibility, and visibility must remain because push may already be durable.
- Plan explicitly keeps the separate pipeline-file preservation fix in scope only as an integrated prerequisite, not a second redesign.
- Retry semantics are gated by remote identity verification; if that cannot be proven with existing interfaces, fail safely with exact recovery guidance rather than adopting a directory.
- External Jenkins/GitHub integration remains unverified until run against the VPS and test repo; unit tests alone do not prove live credentials or server behavior.
