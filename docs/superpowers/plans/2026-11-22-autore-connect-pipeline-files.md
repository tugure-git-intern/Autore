# Autore Connect Pipeline Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `autore connect` create each missing pipeline file without overwriting files already present in the GitHub repository.

**Architecture:** Replace `connect`'s all-or-nothing `has_existing_pipeline_files` check with one templates-layer operation that independently ensures `Dockerfile`, `Jenkinsfile`, and `.dockerignore`. Keep existing files byte-for-byte; render only missing files using current shared templates and staging-port configuration. `autore dev` remains local-only and does not create `Jenkinsfile`.

**Tech Stack:** Rust 2021, existing `templates` module, `tempfile` dev dependency.

**Spec:** User expectation in this conversation: create app repo, push it, then use dashboard **Sambungkan Repo**; Autore must prepare missing pipeline files without asking developer to manually maintain them.

## Global Constraints

- Preserve existing repository files; never overwrite custom `Dockerfile`, `Jenkinsfile`, or `.dockerignore` during connect.
- Keep `autore dev` local-only; no GitHub or Jenkins actions in `dev`.
- Reuse `render_dockerfile`, `render_jenkinsfile`, and `render_dockerignore`; do not duplicate templates.
- Preserve connect sequencing: prepare files → commit/push → Jenkins registration and build.
- Existing unrelated working-tree changes are user work; do not reset, stash, or rewrite them.

## Review Focus

- Repo has only `Dockerfile` (the reported failure): add `Jenkinsfile` and `.dockerignore`, preserve Dockerfile.
- Repo has only `Jenkinsfile`: add Dockerfile and `.dockerignore`, preserve Jenkinsfile.
- Repo has partial files including a custom `.dockerignore`: preserve existing contents and create other missing files.
- Repo has all three files: write none; preserve all bytes.
- File-write failure partway through: return clear error and do not proceed to commit/push/Jenkins.

---

### Task 1: Add tested per-file generation for connect

**Files:**
- Modify: `cli/src/templates.rs`
- Test: `cli/src/templates.rs` unit tests

**Interfaces:**
- Consumes: `InitConfig`, `render_dockerfile`, `render_jenkinsfile`, `render_dockerignore`.
- Produces: a templates-layer function that writes only absent pipeline files and returns paths it created, or an error. Keep existing `generate_project_files_with` behavior unchanged for `init` callers.

- [ ] **Step 1: Add failing tests** for a directory containing only `Dockerfile`; assert returned paths are exactly the missing `Jenkinsfile` and `.dockerignore`, original Dockerfile bytes unchanged, and Jenkinsfile includes configured app name/staging port.
- [ ] **Step 2: Run the focused test** with `cd cli && cargo test templates::tests::connect_generates_only_missing_pipeline_files`; confirm it fails because function is absent.
- [ ] **Step 3: Add tests** for all files already present (empty created-path list and unchanged bytes) and partial `.dockerignore` / `Jenkinsfile` preservation.
- [ ] **Step 4: Implement the minimal helper** by independently checking each target path and rendering/writing only missing files. Keep existing generation function unchanged.
- [ ] **Step 5: Run focused template tests** with `cd cli && cargo test templates::tests`; confirm pass.

### Task 2: Wire connect to per-file generation

**Files:**
- Modify: `cli/src/connect.rs`
- Modify: `cli/src/main.rs` only if `has_existing_pipeline_files` becomes unused elsewhere (verify usages first).

**Interfaces:**
- Consumes: helper from Task 1; current `InitConfig` and staging port.
- Produces: connect calls helper after clone/configuration, prints created filenames or that existing files were retained, and fails before commit/push/Jenkins if preparation returns an error.

- [ ] **Step 1: Add a regression test** around a pure connect preparation helper (if practical without GitHub/Jenkins): existing Dockerfile remains unchanged and missing Jenkinsfile is generated.
- [ ] **Step 2: Run the focused regression test** and confirm current all-or-nothing branch fails the scenario.
- [ ] **Step 3: Replace** `has_existing_pipeline_files` conditional in `connect::jalankan` with per-file helper; preserve error cleanup for newly allocated workspace environment entry.
- [ ] **Step 4: Update output** so it accurately lists generated files and never says all pipeline files exist when some were just created.
- [ ] **Step 5: Run connect/template tests** with `cd cli && cargo test connect:: && cargo test templates::`; confirm pass.

### Task 3: Verify CLI and documentation contract

**Files:**
- Modify: `README.md` only if current command description omits that connect fills missing files.

- [ ] **Step 1: Run** `cd cli && cargo fmt --check && cargo clippy --all-targets -- -D warnings`.
- [ ] **Step 2: Run** `cd cli && cargo test`; confirm all tests pass.
- [ ] **Step 3: Review diff and working-tree status**; confirm no unrelated existing changes were altered and no `Jenkinsfile` behavior was added to `autore dev`.

---

## Self-Review

- Scope is one bug in connect's pipeline-file preparation; no dashboard, Jenkins API, or `autore dev` feature change required.
- Existing generated templates already contain current behavior; change is only which missing files get written.
- Tests cover reported Dockerfile-only case, each-preserve behavior, and all-present idempotence. Connect orchestration still requires a later live integration test with GitHub/Jenkins credentials; do not claim that external flow was verified by unit tests.
