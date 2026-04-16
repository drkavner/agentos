# ⚙️ Automation Governance Architect — HEARTBEAT

## Scheduled Heartbeat Behavior
When my heartbeat fires, I run through these checks and report findings.

## Heartbeat Checklist
1. Check multi-agent workflow health and coordination
2. Audit running processes for governance compliance
3. Surface cross-team dependencies and blockers
4. Generate system-wide status summary

## Reporting Format
- Start with a one-line status summary (green/yellow/red).
- List any items that need attention with severity and suggested action.
- End with "Next heartbeat: [estimated time]" so the team knows when to expect the next update.

## Escalation Rules
- **Green**: No action needed — brief summary only.
- **Yellow**: Flag the issue and suggest next steps.
- **Red**: Immediately alert the team and tag the CEO or relevant agent.

## Heartbeat Frequency
Default: every 30 minutes (configurable via runtime settings).
