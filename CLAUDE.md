# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server:** `npm run dev` — starts Express + Vite on port 5000
- **Type check:** `npm run check` (runs `tsc`)
- **Build:** `npm run build` — Vite for client, esbuild for server → `dist/`
- **Production:** `npm run start` — runs `dist/index.cjs`
- **DB push:** `npm run db:push` — apply schema changes via drizzle-kit

No test runner or linter is configured.

## Architecture

Full-stack TypeScript app: React SPA + Express API + SQLite (Drizzle ORM).

### Three code zones

- **`client/`** — React 18 SPA using Wouter (hash-based routing), React Query for data fetching, shadcn/ui (Radix + Tailwind) for UI, Framer Motion for animations
- **`server/`** — Express 5 REST API. `routes.ts` defines all `/api/*` endpoints. `storage.ts` implements `IStorage` interface with `DatabaseStorage` class (Drizzle). `seed.ts` populates agent definitions and demo data on first run
- **`shared/schema.ts`** — Single source of truth for both DB schema (Drizzle tables) and request validation (Zod schemas). Imported by both client and server

### Path aliases (tsconfig + vite)

- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`

### Database

SQLite file (`data.db`) with WAL mode and foreign keys enforced. Schema has 9 tables: tenants, agentDefinitions, agents, teams, teamMembers, tasks, messages, goals, auditLog.

### Multi-tenant model

Most entities are scoped to a tenant. API routes follow `/api/tenants/:tenantId/<resource>` pattern. Tenants have plan tiers (starter/pro/enterprise) with agent caps enforced on creation.

### Build pipeline

`script/build.ts` runs Vite for the client and esbuild for the server. The server bundle explicitly allowlists ~40 dependencies for bundling (to reduce cold-start); the rest are external. Server output is CJS (`dist/index.cjs`), client output goes to `dist/public/`.

### Frontend patterns

- Pages live in `client/src/pages/`, layout in `components/AppShell.tsx`
- UI primitives in `components/ui/` (shadcn/ui, don't edit directly — regenerate with shadcn CLI)
- API calls use React Query's `useQuery`/`useMutation` with the helper in `lib/queryClient.ts`
- Tailwind uses HSL CSS variables for theming with class-based dark mode
