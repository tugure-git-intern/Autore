# Autore Contributor Handbook

Welcome to the Autore project. This document provides setup instructions, development workflows, quality gate rules, and pull request standards for all contributors.

---

## 1. Prerequisites and Local Environment Setup

### 1.1 Required Toolchains

- **Rust:** Version 1.85+ (install via `rustup`).
- **Node.js:** Version 20 LTS or higher, with `npm` 10+.
- **Gitleaks:** Version `v8.21.2` (pinned to match CI quality gates).
- **Git:** Version 2.30+.
- **Docker:** (Optional for local CLI dev, required for full container builds).

### 1.2 Repository Setup

```bash
# Clone the repository
git clone git@github.com:tugure-git-intern/Autore.git
cd Autore

# Build Core Rust CLI
cd cli
cargo build
cd ..

# Install Web Monorepo Dependencies
cd web
npm ci
cd ..
```

### 1.3 Web Environment Configuration

Copy the example environment configuration:
```bash
cp web/.env.example web/.env
```
Ensure required variables (`AUTORE_API_PORT=9121`, `NEXT_PUBLIC_API_URL=http://127.0.0.1:9121`) are configured. **Never commit secrets, tokens, or credential values to `web/.env`.**

---

## 2. Running Local Test Suites & Quality Gates

All tests must pass locally before creating a pull request or pushing to remote branches.

### 2.1 Core Rust CLI Checks (from `cli/`)

```bash
# Run unit and integration tests
cargo test --locked

# Enforce strict zero-warning linter
cargo clippy --all-targets -- -D warnings

# Verify release build
cargo build --release --locked
```

### 2.2 Web Monorepo Checks (from `web/`)

```bash
# Run all unit tests across contracts, api, and dashboard
npx vitest run

# Run TypeScript typechecks on all three packages
( cd packages/contracts && npx tsc --noEmit )
( cd apps/api && npx tsc --noEmit )
( cd apps/dashboard && npx tsc --noEmit )

# Verify production Next.js build
npm run build:dashboard

# Run browser E2E, mobile contract, and accessibility suites (needs web/.env)
npm run test:e2e                        # 77 Playwright tests across 7 spec files
npm run test:e2e -- e2e/a11y.spec.ts    # axe-core WCAG 2.1 AA: 6 routes + dark-mode toast
```

Playwright reads `AUTH_SECRET` / `NEXTAUTH_SECRET` from `web/.env` through dotenv-cli, so always use the
`npm run test:e2e` wrapper from `web/`. Running `npx playwright test` directly fails in global setup.
These browser suites are not part of the Jenkins Stage 5 web gate, so run them locally before pushing
changes that touch rendering, theming, navigation, or actions.

---

## 3. Pre-Commit Security Gate

Autore enforces a two-layer fail-closed security gate prior to every git commit.

### 3.1 Installing the Pre-Commit Hook

Install the hook using the Autore CLI:
```bash
autore hook install (or cargo run --bin autore -- hook install)
```
This writes `.git/hooks/pre-commit` managed by Autore. An existing user hook is backed up to
`pre-commit.user-backup` and chained after the gate. `autore hook status` verifies the hook is active;
`autore hook uninstall` removes it and restores the backup.

### 3.2 Pre-Commit Gate Layers

1. **Layer 1: Static Byte Guard:** Scans staged changes against known secret patterns, private key headers, and credential token formats.
2. **Layer 2: Native Gitleaks (`v8.21.2`):** Scans staged files via `gitleaks git --staged --redact --no-banner --exit-code 1`, using the same pinned version as the CI image. No Docker and no `--config` flag: a repository `.gitleaks.toml` without `[extend] useDefault = true` is rejected outright, because that config silently disables the default ruleset.

### 3.3 Emergency Bypass Policy

Bypassing the pre-commit gate via `AUTORE_HOOK_SKIP=1` is **strictly prohibited** in normal development. It is reserved solely for emergency administrative recovery and triggers mandatory security auditing in CI.

---

## 4. Trusted Runner Scripts and Binary Installation

On production and CI runner hosts:
- Pipeline security scripts are installed to `/usr/local/lib/autore-ci/` to prevent untrusted repository code from bypassing security gates.
- When modifying scripts in `scripts/ci-*.sh`, update the trusted runner copy:
  ```bash
  sudo install -o root -g root -m 0755 scripts/ci-web-tests.sh /usr/local/lib/autore-ci/ci-web-tests.sh
  ```
- When updating the Rust CLI, install the release binary to `/usr/local/bin/autore`:
  ```bash
  sudo install -o root -g root -m 0755 cli/target/release/autore /usr/local/bin/autore
  ```

---

## 5. Development Invariants and Style Guidelines

1. **Zero Emoji Rule:** Emojis are strictly banned in source code, commit messages, comments, UI text, and documentation. Use Lucide icons for UI and plain ASCII text for terminal outputs.
2. **TDD (Test-Driven Development):** Write the failing test first (RED), verify the failure, then implement the minimal solution (GREEN), and finally refactor.
3. **Contract First:** Any change to API communication must begin with updating types and validators in `web/packages/contracts`.
4. **Commit Conventions:** Follow Conventional Commits format:
   - `feat(...)`: New feature or capability.
   - `fix(...)`: Bug fix.
   - `refactor(...)`: Code restructuring without behavioral change.
   - `build(...)`: Build system, packaging, or dependency update.
   - `ci(...)`: CI/CD pipeline or runner script update.
   - `docs(...)`: Documentation addition or update.
   - `test(...)`: Adding or updating test suites.
   - `chore(...)`: Maintenance or configuration tasks.

---

## 6. Pull Request Checklist

Before submitting a pull request:
- [ ] `cargo test --locked` passes 100%.
- [ ] `cargo clippy --all-targets -- -D warnings` reports 0 warnings.
- [ ] `npx vitest run` passes 100% across all packages.
- [ ] `npx tsc --noEmit` reports 0 errors in `contracts`, `api`, and `dashboard`.
- [ ] `npm run build:dashboard` succeeds without error.
- [ ] `npm run test:e2e` passes (77 Playwright tests, including the axe-core WCAG 2.1 AA suite).
- [ ] Zero emojis in code, commits, and documentation.
- [ ] No secrets, keys, or credential tokens committed.
