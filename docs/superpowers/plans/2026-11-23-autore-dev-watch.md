# `autore dev` Automatic Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `autore dev` automatically sync/restart Python and Node.js projects and rebuild compiled/custom Docker projects as files change.

**Architecture:** Keep Autore's CLI as orchestrator and use Docker Compose Watch for cross-platform file monitoring, avoiding a new Rust watcher or dependency. Generate a temporary Compose file outside the project; give each run a unique project identity, validate Compose 2.23.0+, and let Compose manage its own service lifecycle. Add an explicit marker and narrowly scoped writable `/app` permissions to generated Python/Node templates so only those generated images use sync; custom Dockerfiles rebuild instead.

**Tech Stack:** Existing Rust CLI, Docker Compose Watch, temporary Compose YAML.

**Spec:** `docs/superpowers/specs/2026-11-23-autore-dev-watch-design.md`

## Global Constraints

- Require Docker Compose 2.23.0+; `sync+restart` was added in 2.23.0.
- Do not add Rust dependencies.
- Preserve user `Dockerfile` and `.dockerignore` bytes; preserve existing dev behavior outside the watch runner.
- Keep GitHub/Jenkins/production paths untouched.
- Exclude `.git`, generated dependency/build directories, `.env`, `.env.*`, `*.secret`, `*.pem`, `*.key`, and `*.p12` from watch sync.
- Use a unique Compose project name per run; never remove or adopt another process's containers or images.
- Test Linux and Windows path/quoting and cancellation contracts; no secrets or user files in test writes.

## Review Focus

- Compose older than 2.23.0 or malformed version output: fail before creating a service with an actionable message.
- Compose project name collision / already-used port: fail without stopping any existing container.
- Ctrl+C, spawn failure, and Compose failure: clean only the current invocation's temporary definition and its Compose project.
- Custom Dockerfile or unmarked old generated Dockerfile: use rebuild-only behavior; never assume its workdir is `/app`.
- Python/Node generated image: synced files writable by its non-root runtime user; process still runs non-root.
- Dependency edits, secret files, `.git`, and build directories: each maps to the spec's rebuild/ignore rule.

---

### Task 1: Add watch metadata to generated templates

**Files:**
- Modify: `cli/src/templates.rs`
- Test: `cli/src/templates.rs` unit tests

**Interfaces:**
- Produced: generated Python/Node Dockerfiles contain one exact marker comment identifying Autore's watch-ready `/app` contract; generated Dockerfiles add a narrowly scoped `chown`/permission operation for `/app` before `USER appuser` or `USER node`. Java/Go templates stay unchanged.

- [ ] **Step 1: Add failing template tests** asserting Python/Node markers precede `USER`, `/app` becomes writable to the existing runtime user, and Java/Go output contains neither marker nor new sync permission.
- [ ] **Step 2: Run** `cd cli && cargo test templates::tests::generated_watch_contract`; confirm test fails on the absent marker/permissions.
- [ ] **Step 3: Implement** marker and minimal ownership update only in Python/Node runtime stages; retain non-root `USER` directives and all other template behavior.
- [ ] **Step 4: Run** `cd cli && cargo test templates::tests`; confirm pass.

### Task 2: Build pure Compose watch configuration

**Files:**
- Modify: `cli/src/dev.rs`
- Test: `cli/src/dev.rs` unit tests

**Interfaces:**
- Add `fn compose_watch_yaml(dir: &Path, stack: TechStack, sync_enabled: bool) -> Result<String, String>`; it returns Compose YAML with absolute project path, selected port mapping, generated-stack watch rules or rebuild-only custom/compiled rules, and ignores from spec.
- Add deterministic helpers for generated-watch marker detection and unique Compose project name validation.
- Keep `arg_build` and current `arg_run` contracts until the final runner switches to Compose.

- [ ] **Step 1: Add failing tests** for Python/Node sync+restart and rebuild manifests, Java/Go rebuild, custom rebuild-only behavior, ignore patterns, absolute paths containing spaces, host port mapping, and generated-marker detection.
- [ ] **Step 2: Run** `cd cli && cargo test dev::tests::compose_watch_yaml`; confirm failures before implementation.
- [ ] **Step 3: Implement** YAML generation with a small correctly escaped scalar helper (no new YAML crate); use dependency patterns from design spec exactly. Keep generated and custom Dockerfile behavior separate.
- [ ] **Step 4: Run** focused tests, then validate a produced fixture using installed Compose: `docker compose -f <fixture> config` and check normalized `develop.watch` rules.

### Task 3: Validate Compose Watch capability and manage temporary files

**Files:**
- Modify: `cli/src/dev.rs`
- Test: `cli/src/dev.rs` unit tests

**Interfaces:**
- Add `fn parse_compose_version(output: &str) -> Result<(u64, u64, u64), String>` and `fn compose_watch_supported(version: (u64, u64, u64)) -> bool`; prerelease/build suffixes parse safely and minimum is 2.23.0.
- Add an RAII temporary Compose-file guard using only stdlib, outside the project directory, removed on normal/error/drop paths.
- Add an injectable command-construction seam for deterministic tests without Docker or global `PATH` mutation.

- [ ] **Step 1: Add failing version tests**: accept 2.23.0 and newer including distro suffix; reject 2.22.9, malformed output, missing version.
- [ ] **Step 2: Run** `cd cli && cargo test dev::tests::compose_watch_supported`; confirm failures.
- [ ] **Step 3: Implement** version probe via `docker compose version --short`; return an actionable minimum-version error before image build or container start.
- [ ] **Step 4: Add temp-file lifecycle tests** proving cleanup on explicit cleanup and drop, and ensure path is outside project dir.
- [ ] **Step 5: Run** focused `dev::tests`; confirm pass.

### Task 4: Switch `autore dev` to Compose Watch lifecycle

**Files:**
- Modify: `cli/src/dev.rs`
- Test: `cli/src/dev.rs` unit tests and `cli/tests/dev_cli.rs`

**Interfaces:**
- Replace direct `docker build`, prior `<app>-dev` container deletion, and `docker run` with: validate Compose version → preserve/create pipeline files → choose free port → determine marker-based sync mode → write temp Compose file → run `docker compose -p <unique-id> -f <temp-file> up --build --watch --remove-orphans` in project dir.
- `DevArgs` and CLI flags remain unchanged.
- Do not create a stable `<app>-dev` identity; Compose project ID is unique per invocation.

- [ ] **Step 1: Add failing orchestration tests** with fake command runner: validate order; verify old named container is never removed; version failure happens before build/up; port conflict never starts Compose; startup failure cleans temp config; Ctrl+C invokes cleanup only for generated project ID.
- [ ] **Step 2: Run** focused tests and integration contract `cd cli && cargo test dev_cli`; confirm new expected Compose behavior fails before code.
- [ ] **Step 3: Implement** process execution and cancellation handling. Use `up --watch` to start/watch; on interruption run `docker compose -p <same-id> -f <same-file> down --remove-orphans` without `--rmi` or volume deletion. Preserve child exit status where available.
- [ ] **Step 4: Add CLI contract tests**: unsupported Compose diagnostic; output clearly says URL and Ctrl+C; path with spaces stays one argv/file path; current command line syntax remains `autore dev`.
- [ ] **Step 5: Run** `cd cli && cargo test dev::tests && cargo test --test dev_cli`; confirm pass.

### Task 5: Document behavior and verify cross-platform build

**Files:**
- Modify: `README.md`
- Modify: existing focused Rust tests as needed; do not add unrelated workflows.

- [ ] **Step 1: Update** `README.md` `autore dev` row: watches changes automatically, ordinary Python/Node changes sync+restart, Java/Go/custom changes rebuild, requires Docker Compose 2.23+; initial build may still take minutes.
- [ ] **Step 2: Run** `cd cli && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`.
- [ ] **Step 3: Run** Linux release/cross-build commands only if existing CI script supports them; inspect `docs/github-actions-ci-release.yml`, ensure code compiles for `x86_64-pc-windows-gnu`, and report any environment/toolchain blocker exactly.
- [ ] **Step 4: Live check** with a temp Python project and installed Compose: start `autore dev`, edit a watched source file, confirm no image rebuild and sync/restart; change dependency file, confirm rebuild; Ctrl+C, confirm Compose project gone. Repeat CLI invocation on Windows CI/build target for path parsing where available.
- [ ] **Step 5: Review** `git diff --check`, `git diff`, and `git status --short`; verify existing unrelated files remain untouched and no commit/push performed.

---

## Self-Review

- Covers every design requirement: watch default, stack-specific actions, rebuild manifests, exclusions, non-root permission, Docker Compose version gate, temporary config, unique project identity, port safety, Ctrl+C cleanup, README, and Windows/Linux path behavior.
- Never adopts the existing `<app>-dev` cleanup behavior; generated old Dockerfile without marker falls back to rebuild-only.
- The real edit/sync/rebuild/stop cycle remains required for completion; unit/config tests alone are insufficient evidence for hot watch behavior.
- No commits in the plan; user owns commit/push decision.
