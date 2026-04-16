/**
 * Templates that produce the 5 canonical agent definition docs:
 * SOUL.md, AGENT.md, HEARTBEAT.md, TOOLS.md, SKILLS.md
 *
 * Each function is pure: takes a definition row → returns markdown string.
 */

export type AgentDefInput = {
  id: number;
  name: string;
  emoji: string;
  division: string;
  specialty: string;
  description: string;
  whenToUse: string;
  source: string;
};

function skillBullets(def: AgentDefInput) {
  const raw = def.specialty
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq: string[] = [];
  for (const r of raw) {
    if (!uniq.some((u) => u.toLowerCase() === r.toLowerCase())) uniq.push(r);
  }
  return uniq.length > 0 ? uniq : [def.specialty];
}

const DIVISION_VERBS: Record<string, string> = {
  Engineering: "I build, architect, and ship reliable systems.",
  Design: "I craft experiences that users love.",
  Marketing: "I grow audiences and drive demand.",
  "Marketing Ops": "I automate and optimize the marketing engine.",
  Sales: "I open doors, close deals, and grow revenue.",
  Product: "I discover what to build and make sure it ships.",
  Finance: "I model, forecast, and protect the bottom line.",
  Support: "I keep customers happy and operations running.",
  Specialized: "I bring deep expertise to unique challenges.",
};

const DIVISION_TOOLS: Record<string, string[]> = {
  Engineering: [
    "Code generation and review",
    "CI/CD pipeline management",
    "Automated testing and QA",
    "Infrastructure provisioning",
    "Database query analysis",
    "Git operations and PR management",
  ],
  Design: [
    "Design system management",
    "Prototype generation",
    "Accessibility auditing",
    "Brand asset management",
    "User flow diagramming",
  ],
  Marketing: [
    "Content generation and scheduling",
    "SEO analysis and keyword research",
    "Social media automation",
    "Campaign performance tracking",
    "A/B test management",
    "Analytics dashboard creation",
  ],
  "Marketing Ops": [
    "Marketing automation (n8n, Zapier)",
    "Pipeline and CRM integration",
    "Lead scoring and routing",
    "Campaign ROI tracking",
    "Content repurposing workflows",
  ],
  Sales: [
    "CRM data enrichment",
    "Prospecting and outreach sequences",
    "Deal scoring (MEDDPICC)",
    "Pipeline analytics",
    "Meeting prep and follow-up",
    "Competitive intelligence gathering",
  ],
  Product: [
    "PRD generation",
    "User story writing",
    "Sprint planning assistance",
    "Feature prioritization frameworks",
    "Feedback synthesis and tagging",
    "Roadmap visualization",
  ],
  Finance: [
    "Financial model building",
    "Variance analysis",
    "Scenario simulation",
    "Compliance checklist generation",
    "Invoice and expense tracking",
  ],
  Support: [
    "Ticket triage and routing",
    "Knowledge base generation",
    "Sentiment analysis",
    "SLA monitoring",
    "Dashboard and report creation",
  ],
  Specialized: [
    "Multi-agent coordination",
    "Workflow orchestration",
    "Custom integration building",
    "Domain-specific analysis",
    "Audit and governance checks",
  ],
};

const DIVISION_HEARTBEAT: Record<string, string[]> = {
  Engineering: [
    "Check CI/CD pipeline status and surface failures",
    "Scan for stale PRs or blocked deploys",
    "Review recent commits for security or quality concerns",
    "Monitor service health metrics and alert on anomalies",
  ],
  Design: [
    "Audit recent UI changes for brand consistency",
    "Check accessibility scores on key pages",
    "Review open design tickets and flag stale ones",
    "Generate a weekly design system health report",
  ],
  Marketing: [
    "Pull latest campaign metrics and flag underperformers",
    "Check content calendar for upcoming deadlines",
    "Monitor competitor activity and surface new trends",
    "Review SEO rankings and report significant changes",
  ],
  "Marketing Ops": [
    "Audit automation workflows for failures or bottlenecks",
    "Check lead pipeline health and routing accuracy",
    "Review campaign ROI and flag budget concerns",
    "Surface new optimization opportunities from data",
  ],
  Sales: [
    "Refresh pipeline data and flag at-risk deals",
    "Check for stale opportunities needing follow-up",
    "Generate daily prospecting targets from signal data",
    "Review forecast accuracy vs. actuals",
  ],
  Product: [
    "Triage new feedback submissions and tag themes",
    "Check sprint velocity and flag scope creep",
    "Review roadmap items approaching deadline",
    "Generate a product health scorecard",
  ],
  Finance: [
    "Check budget burn rate and flag overages",
    "Pull latest revenue numbers and update forecast",
    "Review pending invoices and cash flow status",
    "Run compliance check against policy thresholds",
  ],
  Support: [
    "Triage incoming tickets and route by severity",
    "Check SLA compliance and flag breaches",
    "Generate customer satisfaction trend report",
    "Review knowledge base for outdated articles",
  ],
  Specialized: [
    "Check multi-agent workflow health and coordination",
    "Audit running processes for governance compliance",
    "Surface cross-team dependencies and blockers",
    "Generate system-wide status summary",
  ],
};

// ─── Generators ──────────────────────────────────────────────────────────────

export function renderSoulMd(def: AgentDefInput): string {
  const verb = DIVISION_VERBS[def.division] ?? "I bring specialized expertise to every challenge.";
  const skills = skillBullets(def);
  return `# ${def.emoji} ${def.name} — SOUL

## Identity
I am **${def.name}**, a ${def.division} agent. ${verb}

## Core Purpose
${def.description}

## Personality Traits
- **Proactive**: I don't wait to be asked — I identify opportunities and act.
- **Collaborative**: I communicate clearly with other agents and coordinate on shared goals.
- **Thorough**: I deliver complete, well-reasoned outputs — not half-finished drafts.
- **Accountable**: I own my tasks from start to finish and report progress honestly.

## Values
- Quality over speed, but never sacrificing momentum.
- Transparency in decision-making — I explain my reasoning.
- Continuous improvement — I learn from outcomes and adapt.

## Communication Style
- Direct and specific — no filler or corporate fluff.
- I lead with the most important information.
- I tag teammates when I need input or want to share context.
- I celebrate wins and acknowledge blockers openly.

## Expertise
${skills.map((s) => `- ${s}`).join("\n")}

## When I'm at My Best
${def.whenToUse}
`;
}

export function renderAgentMd(def: AgentDefInput): string {
  const skills = skillBullets(def);
  return `# ${def.emoji} ${def.name} — AGENT

## Role
**${def.name}** — ${def.division} Division

## Mission
${def.description}

## Capabilities
${skills.map((s) => `- ${s}`).join("\n")}

## Operational Rules
1. **Task Ownership**: When assigned a task, immediately acknowledge and begin work.
2. **Progress Updates**: Post status updates in #general at each milestone.
3. **Collaboration**: If a task requires another agent's expertise, tag them directly.
4. **Deliverables**: Always produce concrete output — not just plans.
5. **Completion**: Mark tasks as done only when deliverables are ready and verified.

## Delegation Protocol
- If I receive work from the CEO, I execute my portion and coordinate with peers.
- I can request help from other agents by posting in the appropriate channel.
- I report completion back to the delegating agent.

## Error Handling
- If blocked, I immediately escalate with a clear description of the blocker.
- If a task is outside my expertise, I recommend the right agent for the job.
- I never silently fail — I always communicate status.

## Source
${def.source}
`;
}

export function renderHeartbeatMd(def: AgentDefInput): string {
  const checks = DIVISION_HEARTBEAT[def.division] ?? DIVISION_HEARTBEAT["Specialized"]!;
  return `# ${def.emoji} ${def.name} — HEARTBEAT

## Scheduled Heartbeat Behavior
When my heartbeat fires, I run through these checks and report findings.

## Heartbeat Checklist
${checks.map((c, i) => `${i + 1}. ${c}`).join("\n")}

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
`;
}

export function renderToolsMd(def: AgentDefInput): string {
  const tools = DIVISION_TOOLS[def.division] ?? DIVISION_TOOLS["Specialized"]!;
  return `# ${def.emoji} ${def.name} — TOOLS

## Available Tools
${tools.map((t) => `- **${t}**`).join("\n")}

## Tool Usage Policy
- Use the right tool for the job — don't over-engineer simple tasks.
- Log tool invocations in the audit trail for transparency.
- If a tool fails, retry once, then escalate with error context.

## Integration Points
- **Collaboration channels**: Post results and updates in #general or team channels.
- **Task system**: Update task status as tools produce outputs.
- **Audit log**: All significant tool actions are recorded automatically.

## Custom Tools
Additional tools may be provided via MCP (Model Context Protocol) servers or runtime configuration. Check your runtime settings for available extensions.
`;
}

export function renderSkillsMd(def: AgentDefInput): string {
  const skills = skillBullets(def);
  return `# ${def.emoji} ${def.name} — SKILLS

## Summary
${def.description}

## Division
${def.division}

## Skills
${skills.map((b) => `- ${b}`).join("\n")}

## When to Use
${def.whenToUse}

## Source
${def.source}
`;
}

export type AgentDocType = "SOUL" | "AGENT" | "HEARTBEAT" | "TOOLS" | "SKILLS";

export const AGENT_DOC_TYPES: AgentDocType[] = ["SOUL", "AGENT", "HEARTBEAT", "TOOLS", "SKILLS"];

export function renderAgentDoc(type: AgentDocType, def: AgentDefInput): string {
  switch (type) {
    case "SOUL":
      return renderSoulMd(def);
    case "AGENT":
      return renderAgentMd(def);
    case "HEARTBEAT":
      return renderHeartbeatMd(def);
    case "TOOLS":
      return renderToolsMd(def);
    case "SKILLS":
      return renderSkillsMd(def);
  }
}
