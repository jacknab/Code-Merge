# Certxa

A service-business platform merging two apps: a booking/salon management frontend and a second app (TBD). The booking app covers auth, bookings, front desk, POS, loyalty rewards, check-in, and waitlist.

## Run & Operate

- `pnpm --filter @workspace/booking run dev` — run the booking frontend (preview at `/`)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + react-router-dom v6, Tailwind v4, Vite 7
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/booking/src/` — main booking app source
- `artifacts/booking/src/pages/` — all page components
- `artifacts/booking/src/components/` — shared UI components and layout
- `shared/` — shared schema, permissions, routes, auth models (workspace package `@workspace/shared`)
- `artifacts/api-server/` — Express API backend

## Architecture decisions

- `shared/` is registered as a proper pnpm workspace package (`@workspace/shared`) so drizzle-orm/drizzle-zod resolve correctly when Vite processes the shared files
- `@shared` alias in vite.config.ts and tsconfig.json paths points to `../../shared`
- `@` alias points to `./src` within the booking artifact
- All Launchsite/Launchit! code was stripped completely — booking app is purely Certxa-branded

## Product

- Service-business SaaS platform (Certxa) targeting salon/service pros
- Features: bookings, front desk, POS, loyalty rewards, check-in, waitlist
- Multi-app workspace: booking frontend + second app to be merged (TBD)

## User preferences

- Strip all Launchsite/Launchit! code completely — no references should remain
- Merge two apps into one pnpm workspace; first app is the booking/salon management frontend

## Gotchas

- `shared/` must remain in pnpm-workspace.yaml packages list so drizzle-orm resolves correctly
- react-leaflet has peer dep warnings (wants React 18, workspace has 19) — acceptable, ignore
- API server workflow must be running for auth endpoints to work (otherwise 502s on login)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
