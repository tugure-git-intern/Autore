# Dashboard Rollback Digest Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop historical rolled-back deployments from triggering the digest warning while preserving warnings for inconsistent deployments currently active in an environment.

**Architecture:** Keep release folding and ledger data unchanged. In `ReleaseEnvironmentBoard`, compare release digests only for deployment IDs referenced by an environment's `active_deployment_id`; make warning text state that it concerns active deployments. Add component tests for inactive rollback history and active mismatches.

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

**Spec:** User-approved behavior in this task: historical rollback attempts are not active deployments and must not trigger this warning; an active deployment with a missing release or mismatched/empty release digest must still trigger it. Do not edit VPS ledger or deployment records.

## Global Constraints

- Do not delete, rewrite, or append events to `release-state.json`.
- Do not change API response schema or release-folding behavior.
- Keep warning behavior in dashboard presentation layer; active means an ID present in an environment's `active_deployment_id`.
- Preserve warning for active deployment whose release is missing or whose digest differs.

## Review Focus

- An inactive `rolled_back` deployment with null/mismatched release digest does not trigger warning; test this in the component test.
- An active deployment with mismatched digest still triggers warning; retain and strengthen existing test.
- An active deployment whose release is missing still triggers warning; test this explicitly.
- Environments with null active pointers do not make historical deployments active; test with rollback fixture.
- Warning count and IDs include only active mismatches; assert text and listed IDs.

---

### Task 1: Scope digest warning to active deployments

**Files:**
- Modify: `web/apps/dashboard/src/components/release-environment-board.tsx:284-310`
- Test: `web/apps/dashboard/src/components/release-environment-board.test.tsx:157-162`

**Interfaces:**
- Consumes: `Environment.active_deployment_id`, `Deployment.id`, `Deployment.release_id`, `Deployment.image_digest`, `Release.id`, `Release.image_digest`.
- Produces: same component props and existing `deployment-inkonsisten` test ID; warning lists only mismatched active deployments and labels them as active.

- [ ] **Step 1: Add regression tests**

  Update the existing mismatch test to explicitly point an environment at the mismatched deployment and verify warning lists that deployment. Add a test with a mismatched/null-digest rollback deployment that is not referenced by either environment's `active_deployment_id`; verify no warning. Add a case where the active deployment references an unknown release; verify warning still appears.

- [ ] **Step 2: Run focused tests and verify regression**

  Run from `web/`: `npx vitest run apps/dashboard/src/components/release-environment-board.test.tsx`

  Expected before implementation: inactive rollback test fails because current component warns for every mismatch; active mismatch and missing-release tests pass.

- [ ] **Step 3: Filter warning candidates by active deployment IDs**

  In `release-environment-board.tsx`, build the active-ID set from `environments`, then restrict `inkonsisten` to deployment IDs in that set before comparing release existence and digest. Update visible copy to say active deployments, not historical deployments.

- [ ] **Step 4: Verify focused tests and types**

  Run from `web/`: `npx vitest run apps/dashboard/src/components/release-environment-board.test.tsx` and `npm run typecheck`.

  Expected: both commands exit 0; active mismatch and missing-release warnings remain visible, inactive rollback mismatch produces no warning.

- [ ] **Step 5: Review diff**

  Confirm only component, component test, and this plan changed; confirm no ledger/API files changed and warning IDs are derived only from active deployment pointers.
