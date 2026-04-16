# 👁️ Code Reviewer — HEARTBEAT

## Scheduled Heartbeat Behavior
When my heartbeat fires, I run through these checks and report findings.

## Heartbeat Checklist
1. Check CI/CD pipeline status and surface failures
2. Scan for stale PRs or blocked deploys
3. Review recent commits for security or quality concerns
4. Monitor service health metrics and alert on anomalies

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
