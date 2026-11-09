## Summary

Provide a concise summary of the problem, motivation, and solution.

## Changes

- Detailed list of changes made.
- Architectural boundary impact (CLI vs Web vs Pipeline).

## Test & Quality Gate Evidence

Check and paste output/evidence for every applicable item:

- [ ] `cargo test --locked` (all tests passed)
- [ ] `cargo clippy --all-targets -- -D warnings` (0 warnings)
- [ ] `npx vitest run` (all tests passed across contracts, api, dashboard)
- [ ] `npx tsc --noEmit` (0 errors across contracts, api, dashboard)
- [ ] `npm run build:dashboard` (production Next.js build succeeds)
- [ ] `autore hook install` / pre-commit gate verified locally

## Checklist

- [ ] Zero emoji rule respected across all files, commits, and comments.
- [ ] No secrets, tokens, or private credentials committed.
- [ ] Commit messages follow Conventional Commits standard.
- [ ] Shared contracts updated first if API responses or inputs changed.
