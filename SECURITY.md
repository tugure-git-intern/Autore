# Security Policy

Autore is an internal DevSecOps platform for PT Tugu Reasuransi Indonesia. It builds, scans and
deploys container images from a trusted pipeline. This document states what is supported, how to
report a problem, and what the platform already guarantees so reports focus on real gaps.

## Supported Versions

| Version | Supported |
|---|---|
| 0.5.x (current) | Yes, security fixes are released on `main` |
| 0.4.x and older | No |

Only the latest `0.5.x` release receives patches. Tags are rebuilt from `main`; older images are not
retro-patched.

## Reporting a Vulnerability

Do not open a public issue, pull request, or discussion for a security problem.

1. Preferred: GitHub Security Advisory for this repository (Security tab, "Report a vulnerability").
2. Alternative: email security@tugu-re.com.

Include as much of the following as you can:

- Affected component and version (`autore --version`, image tag or digest, pipeline version).
- Reproduction steps or a proof of concept against a local sandbox.
- Impact: what an attacker gains, and which boundary is crossed.
- Optional: a patch or mitigation you have verified.

## Response Targets

| Step | Target |
|---|---|
| Acknowledgement of report | 3 business days |
| Triage and severity decision | 7 business days |
| Fix released for critical and high severity | 30 days |
| Fix released for medium and low severity | 90 days |

If a fix needs longer, we say so with the reason and a mitigation.

## Scope

In scope:

- Rust CLI and launcher (`cli/`), including the quality and image gates.
- Shared pipeline library (`vars/autorePipeline.groovy`) and Jenkins job definitions.
- Dockerfile templates and generated projects (`cli/src/templates.rs`).
- Web dashboard and API (`web/`, `:9120` and `:9121`).
- Anything that lets an untrusted application repository influence the build host, the registry, or
  another application's artifacts.

Out of scope:

- Vulnerabilities in third-party base images: report them upstream. Autore's own gate reports them
  as build failures by design.
- Findings that require an already authenticated administrator or root on the build host, unless
  they cross a boundary documented below (for example reading another application's secrets).
- Denial of service by volume against a service that is only reachable on the tailnet or loopback.
- The known sandbox limitation documented in `README.md` as C-1 (runner user is in the `docker`
  group). It is a deliberate evaluation trade-off, tracked in
  `docs/PRODUCTION-ISOLATION-DESIGN.md`, not a reportable finding on its own.

## Hardening Baseline

These controls already exist. A report that they are missing is out of date:

- The image gate fails closed on `HIGH` and `CRITICAL` findings, and names the CVE, the package and
  the fixed version in the build log.
- The OS patch layer is rebuilt on every pipeline run (`ARG AUTORE_APT_REFRESH` plus `--pull`), so a
  cached layer cannot hide a stale package.
- No service binds `0.0.0.0`; the network surface is documented in `README.md`.
- Secrets live in `.env` files that are ignored by git; `gitleaks` runs in the pre-commit hook and as
  a blocking CI stage.
- Pipeline steps run from the admin-controlled shared library, never from the application repository.

## Disclosure Policy

We follow coordinated disclosure: the reporter and the maintainers agree on a date, normally when a
fix ships, up to 90 days. We credit reporters in the release notes unless they ask to stay anonymous.
