# cortex

This is the core “Cortex runtime” skill. It defines how skills are discovered, applied, and made available to agents at run time.

## What this skill provides
- A consistent **execution contract**: agents run with a stable workspace, deterministic inputs, and explicit outputs.
- A **skills directory** concept: enabled skills are linked/assembled into an effective `CODEX_HOME/skills/` folder before a run.
- A **tenant boundary**: skills are evaluated per organization/tenant so different orgs can have different capabilities and constraints.

## How it behaves in AgentOS
- Skills are treated as **markdown artifacts** that can be viewed/edited and later used to influence prompts/runs.
- The effective skills set is applied **when an agent runs**, not merely when it’s viewed in the UI.

## Intended usage
Use this skill as the baseline for all organizations. It is required for consistent behavior across runs.

