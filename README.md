# AgentOS

Multi-tenant web app for running **AI agents** as a virtual organization: hire roles from an agent library, assign **tasks**, collaborate in **channels** (#general and per-team), and route execution through **adapters** (Hermes LLM, OpenClaw gateway, or CLI tools). Includes **CEO delegation**, **task review/approval**, **deliverables** (files extracted from agent output and downloadable as a zip), and real-time UI updates (SSE).

## What it’s for

- **Org workspace**: One or more tenants (organizations), each with its own agents, teams, tasks, goals, and budget.
- **Agent runtime**: Configure per-agent LLM routing (**OpenRouter** cloud or **Ollama** local), model, and adapter type.
- **Operations**: Kanban/list tasks, goals, dashboard, org chart, collaboration chat, and optional demo seed data.

## Requirements

- **Node.js** 18+ (recommended current LTS)
- **npm** (comes with Node)

Optional:

- **Ollama** — for local models (`http://127.0.0.1:11434` by default).
- **OpenRouter API key** — set in the app per organization (Settings) or via env for server-side use; use a **free** model id if you want zero spend (e.g. models ending in `:free` on OpenRouter).

## Run on your machine

From the project root:

```bash
npm install
npm run dev
```

- Applies DB migrations (`predev`), then starts the **API + Vite dev client** on one process.
- Default URL: **http://127.0.0.1:3000** (see `PORT` in `package.json` `dev` script).

If port **3000** is busy, change it when starting:

```bash
PORT=3001 npm run dev
```

### Optional: seed demo data

The demo org is only created when you opt in:

```bash
SEED=true npm run dev
```

Without `SEED=true`, the database keeps whatever tenants you already have.

### Production build

```bash
npm run build
npm start
```

Serves the built client from `dist/` with the same Express app.

## Configuration tips

- **LLM keys**: In the UI, open your organization’s settings and add an **OpenRouter** or **Ollama** key as needed. Agents inherit org defaults unless you override per agent.
- **Database**: SQLite (e.g. `data.db` in the project root after first run); migrations live under `migrations/`.
- **Typecheck**: `npm run check`

## Project layout (short)

| Path | Role |
|------|------|
| `server/` | Express API, agent adapters, LLM routing, deliverables |
| `client/` | React UI (Vite) |
| `shared/` | Shared types / schema |

---

MIT License (see `package.json`).
