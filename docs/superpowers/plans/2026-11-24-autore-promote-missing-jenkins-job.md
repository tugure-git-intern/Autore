# Autore Promote Jenkins Job Source Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure production promotion job always loads `Jenkinsfile.promote` from Autore repository `main`, repairing both missing and already-misconfigured Jenkins jobs.

**Architecture:** The CLI owns Jenkins job configuration. Before queuing an authorized promotion, refresh the managed job from `https://github.com/tugure-git-intern/Autore.git` on `main`, then trigger it with the existing release parameters. Stop passing application release repo metadata to this path; leave approval, four-eyes, digest, and production checks in the API and Jenkinsfile unchanged.

**Tech Stack:** Rust, TypeScript, Vitest, Jenkins HTTP API; local HTTP test fixture using Rust stdlib.

**Spec:** Incident evidence: `tes-dari-nol-promote #4` failed because Jenkins tried to load `Jenkinsfile.promote` from application repo `tes-dari-nol`; Autore's `Jenkinsfile.promote` is in `tugure-git-intern/Autore`. Existing uncommitted API changes currently forward application `repo_url`/`branch`, which does not fix this source mismatch.

## Global Constraints

- Configure only the managed promote job; do not change rollback or application build jobs.
- Job SCM must be `https://github.com/tugure-git-intern/Autore.git`, branch `main`, script path `Jenkinsfile.promote`.
- Refresh the existing job as well as creating a missing one; a 404-only recovery leaves the already-created broken job unchanged.
- Fail closed on Jenkins status codes: job lookup `200` means update, `404` means create, all other statuses fail. Determine supported success codes for create/update from the Jenkins endpoint contract; accept only those explicitly, and never queue after an unexpected status.
- Promote job config is Autore-managed and update replaces its full generated XML. Before implementation, inspect current `tes-dari-nol-promote` config read-only and list any required Jenkins-only settings; preserve required settings explicitly rather than silently deleting them.
- Preserve exact `PROMOTE_*` parameters and do not queue a build if job registration/update fails.
- Preserve QA approval, four-eyes, active staging digest, production ports, and Jenkinsfile validation/deployment gates.
- Tests use a local fake Jenkins only. A single authenticated read-only GET may inspect the existing promote job config for required Jenkins-only settings; do not trigger builds, modify live Jenkins, deploy, or push as part of implementation.

## Review Focus

- Existing promote job points at application repo: refresh config to Autore source before queueing.
- Promote job is absent: create it from Autore source, then queue once.
- Jenkins rejects registration/update or responds with non-success: do not queue build.
- Release repo metadata is missing or points to app repo: must not block promotion or select Jenkinsfile source.
- All eight `PROMOTE_*` parameters, especially release ID, actor, digest, and ports, remain intact.

---

### Task 1: Make CLI own canonical promote-job source and refresh before trigger

**Files:**
- Modify: `cli/src/jenkins.rs`
- Modify: `cli/src/release.rs`
- Test: `cli/src/jenkins.rs` and `cli/src/release.rs` unit tests

**Interfaces:**
- `jenkins.rs` defines canonical promote source (`https://github.com/tugure-git-intern/Autore.git`, `main`) and renders/registers promote jobs from it; callers cannot supply application repo metadata.
- `trigger_promote` updates or creates the managed job before calling `trigger_parameterized`; registration failure returns without queueing.

- [ ] Add renderer test asserting canonical repository URL, `*/main`, `Jenkinsfile.promote`, all eight `PROMOTE_*` parameters, and no SCM trigger.
- [ ] Add a local fake-Jenkins test for an existing job: its config update contains canonical source and occurs before one parameterized build request.
- [ ] Add fake-Jenkins coverage for absent job creation and registration failure; assert failure queues no build.
- [ ] Run focused Rust tests and confirm the new behavior tests fail against the current 404-only / caller-supplied-source path.
- [ ] Implement canonical-source registration and call it before triggering; remove `git_url`/`branch` inputs from `TriggerPromoteArgs` if no longer needed. Keep rollback source arguments unchanged.
- [ ] Run focused Rust tests; confirm existing parameterized-trigger behavior remains covered.

### Task 2: Stop API from passing application repo metadata

**Files:**
- Modify: `web/apps/api/src/release-promote.ts`
- Test: `web/apps/api/src/release-promote.test.ts`

**Interfaces:**
- API invokes `autore release trigger-promote` with existing release, actor, digest, and port arguments, but no `--git-url` or `--branch`.
- Promotion no longer depends on `Release.repo_url` or `Release.branch`; CLI's canonical source is authoritative for Jenkinsfile checkout.

- [ ] Add test proving an approved release whose source metadata is absent or points to its application repo still invokes CLI without `--git-url`/`--branch`.
- [ ] Run focused Vitest test and confirm it fails against the current metadata-forwarding behavior.
- [ ] Remove the promote API's repo/branch validation and arguments; preserve all current authorization and deployment checks.
- [ ] Run `npm test -- --run apps/api/src/release-promote.test.ts` and `npm run typecheck` from `web/`.

### Task 3: Verify, deploy gate, and handoff

**Files:**
- No additional files unless verification exposes a regression.

- [ ] Run focused Rust tests from `cli/` and API tests/typecheck from `web/`.
- [ ] Review diff and confirm rollback, build, approval, digest, and production deployment behavior did not change.
- [ ] Report code-test results separately from live Jenkins/deployment status.
- [ ] After separate deployment authorization: deploy web API and CLI together; read-only verify `tes-dari-nol-promote` source and that no promote build is queued/running and no successful production event already exists for the approved release. Only then have user click Promote once; verify the Jenkins build and production ledger/health before claiming success.

---

## Self-Review

- Fixed prior plan's wrong premise: forwarding release application repo cannot provide Autore's Jenkinsfile.
- Explicitly covers already-existing broken job; missing-job recovery alone would not repair it.
- Existing registration code updates job config when it already exists, so refreshing through that code avoids creating a second registration mechanism.
- Release metadata validation for application source is removed only from promotion; it remains available to other application workflows.
- Plan authorizes no live production action; deployment and the one authorized promotion attempt remain separate gates.