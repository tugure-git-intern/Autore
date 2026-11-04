# Autore Web

Isolated npm workspace for the Autore dashboard front-end and its API shim.
Lives entirely under `web/` so the Rust CLI build stays untouched.

## Layout

```
web/
  apps/dashboard   Next.js 15 App Router UI   (port 9120)
  apps/api         Hono JSON API              (port 9121)
```

## Commands

Run from `web/`:

| Command                     | What it does                              |
| --------------------------- | ----------------------------------------- |
| `npm install`               | install workspace deps (hoisted)          |
| `npm run dev:dashboard`     | Next dev server on 0.0.0.0:9120           |
| `npm run dev:api`           | Hono dev server on 9121                   |
| `npm run build:dashboard`   | production build (`apps/dashboard/.next`) |
| `npm run start:dashboard`   | serve the production build on 9120        |
| `npm run start:api`         | serve the API on 9121 (override `PORT`)   |
| `npm test`                  | run every workspace test suite            |

Browser requests to `/api/*` on the dashboard are proxied to the Hono app on
`127.0.0.1:9121` (see `apps/dashboard/next.config.ts`).

## Requirements

Node 18.18+ (pinned to the toolchain the CLI release uses). Dependency
versions are pinned, not floated — bump them deliberately.

## Tests

`vitest` with a root config that fans out to each app: the dashboard uses
`jsdom` + Testing Library, the API uses plain `node`.

## E2E (Playwright)

Visual contract for the dashboard at 1280x720: `Dashboard` heading visible, no
horizontal overflow (`scrollWidth <= 1280`), the sidebar links to `/`,
`/applications` and `/pipeline`, no element with a gradient background, and no
`box-shadow` heavier than `box-shadow-sm`. Screenshots land in
`apps/dashboard/e2e/__screenshots__/` (gitignored) for a human to eyeball — no
golden image diff is frozen.

```bash
npx playwright install chromium   # one-off browser download
npm run build:dashboard           # e2e hits the production build
npm run start:api &               # Hono on 9121
npm run start:dashboard &         # Next on 9120
npm run test:e2e                  # == npm run test:e2e --workspace @autore/dashboard
```

Both services must already be up; the Playwright config does not start them.

## Deploy (systemd user units)

`deploy/autore-web-api.service` and `deploy/autore-web-dashboard.service` are
systemd *user* units: they run as the invoking user (`tugure`), no root, no
system units touched.

Build once before enabling — `next start` serves the existing `.next` output:

```bash
cargo build --release --manifest-path cli/Cargo.toml
npm run build:dashboard
```

Install and start (as `tugure`):

```bash
mkdir -p ~/.config/systemd/user
cp deploy/autore-web-api.service deploy/autore-web-dashboard.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now autore-web-api.service autore-web-dashboard.service
```

Health probes:

```bash
curl -fsS http://127.0.0.1:9121/healthz      # {"ok":true}
curl -fsS http://127.0.0.1:9121/api/status   # CLI status snapshot JSON
curl -fsS http://127.0.0.1:9120/ | grep -q Dashboard && echo dashboard ok
```

## Live status contract check

Proves the chain CLI → Hono (`9121`) → Next (`9120`) while the deployed
services keep running.

```bash
# Same workspace the deploy unit uses: registry.tsv and per-app build dirs.
AUTORE_WORKSPACE="$HOME/autore-workspace" \
  "$HOME/Autore/cli/target/release/autore" status --json | python3 -m json.tool
curl -fsS http://127.0.0.1:9121/api/status | python3 -m json.tool

# Both pages render their rows in the browser from /api/status, so the payload is
# the assertion; the HTML only proves the route answers.
curl -fsS http://127.0.0.1:9120/api/status | python3 -c '
import json,sys
payload=json.load(sys.stdin)
assert payload["stale"] is False
assert payload["data"]["applications"], "registry kosong: cek AUTORE_WORKSPACE"
print(len(payload["data"]["applications"]), "aplikasi terdaftar")
'
curl -fsS -o /dev/null -w "applications %{http_code}\n" http://127.0.0.1:9120/applications
curl -fsS -o /dev/null -w "pipeline %{http_code}\n" "http://127.0.0.1:9120/pipeline?app=tes-web"
```

Expected: the CLI and API dumps match, `<n> aplikasi terdaftar`, then
`applications 200` and `pipeline 200`. Grepping the HTML for row text does not
work: the dashboard fetches in the browser, so SSR emits only the loading
skeleton.

`AUTORE_WORKSPACE` must point at `$HOME/autore-workspace` — the directory the
Jenkins pipeline fills with `registry.tsv` and one build dir per app. Pointing
it at the repo root is not an error the API can detect: it just reports zero
applications.

Smoke the API alone on a spare port without touching `9121`. `PORT` defaults to
`9121` and the server binds loopback only:

```bash
cd web
PORT=9123 \
AUTORE_BIN="$HOME/Autore/cli/target/release/autore" \
AUTORE_WORKSPACE="$(mktemp -d)" \
  npm run start:api > /tmp/autore-api-smoke.log 2>&1 &
curl -fsS http://127.0.0.1:9123/api/status | python3 -c '
import json,sys
payload=json.load(sys.stdin)
assert payload["stale"] is False
assert payload["data"]["applications"] == []
print("api contract OK")
'
```

`stale: false` means the CLI answered; `stale: true` means the shim kept the
last good snapshot because the call failed.

Installing units, restarting production (`systemctl --user restart
autore-web-api.service autore-web-dashboard.service`) and deploying are
deliberate manual steps — never part of a check.

Logs, status and restart:

```bash
systemctl --user status autore-web-api.service autore-web-dashboard.service
journalctl --user -u autore-web-api.service -f
journalctl --user -u autore-web-dashboard.service -f
systemctl --user restart autore-web-dashboard.service
```

On a headless VPS, keep the units alive after logout with
`loginctl enable-linger tugure`.

The API binds loopback `127.0.0.1:9121`; the dashboard binds `0.0.0.0:9120`. The
legacy `autore serve` on `9119` is **untouched** — these units add the two new
web services alongside it.
