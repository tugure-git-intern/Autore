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
| `npm run start:api`         | serve the API on 9121                     |
| `npm test`                  | run every workspace test suite            |

Browser requests to `/api/*` on the dashboard are proxied to the Hono app on
`127.0.0.1:9121` (see `apps/dashboard/next.config.ts`).

## Requirements

Node 18.18+ (pinned to the toolchain the CLI release uses). Dependency
versions are pinned, not floated — bump them deliberately.

## Tests

`vitest` with a root config that fans out to each app: the dashboard uses
`jsdom` + Testing Library, the API uses plain `node`.