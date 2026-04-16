# Agent Library

This folder is generated from the SQLite database.

Each agent definition gets a folder with 5 canonical docs:
- **SOUL.md** — Identity, personality, values
- **AGENT.md** — Role, mission, operational rules
- **HEARTBEAT.md** — Scheduled heartbeat behavior
- **TOOLS.md** — Available tools and integrations
- **SKILLS.md** — Core skills and when to use

Run: `npm run skills:generate`

Output path: `agent-library/agent-definitions/<slug>__<id>/`
