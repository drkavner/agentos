import { db } from "./db";
import { storage } from "./storage";
import { eq } from "drizzle-orm";
import { agentDefinitions, tenants, agents, teams, teamMembers, tasks, messages, goals, auditLog } from "@shared/schema";
import { ensureAgentDefinitionsCatalog } from "./agentDefinitionsCatalog";

export function seedDatabase() {
  ensureAgentDefinitionsCatalog();
  const demoExists = db.select().from(tenants).where(eq(tenants.slug, "cerebratech")).get();
  if (demoExists) return;

  console.log("Seeding demo database...");

  // ─── Demo Tenant ──────────────────────────────────────────────────────────
  const tenant = db.insert(tenants).values({
    name: "CerebraTech AI",
    slug: "cerebratech",
    plan: "pro",
    monthlyBudget: 2000,
    spentThisMonth: 847.32,
    mission: "Build the #1 AI-native analytics platform to $1M ARR",
    status: "active",
  }).returning().get();

  // ─── Goals ────────────────────────────────────────────────────────────────
  const goal1 = db.insert(goals).values({ tenantId: tenant.id, title: "Reach $1M ARR", description: "Grow revenue to $1M ARR by end of year", status: "active", progress: 23 }).returning().get();
  db.insert(goals).values({ tenantId: tenant.id, title: "Launch v2 Product", description: "Ship the full platform with multi-tenant support", status: "active", progress: 67, parentGoalId: goal1.id }).returning().get();
  db.insert(goals).values({ tenantId: tenant.id, title: "Hire 50 AI Agents", description: "Staff the org with specialized agents across all divisions", status: "active", progress: 40, parentGoalId: goal1.id }).returning().get();

  // ─── Teams ────────────────────────────────────────────────────────────────
  const engTeam = db.insert(teams).values({ tenantId: tenant.id, name: "Engineering", description: "Builds and ships product", color: "#3b82f6" }).returning().get();
  const mktTeam = db.insert(teams).values({ tenantId: tenant.id, name: "Marketing", description: "Drives growth and pipeline", color: "#10b981" }).returning().get();
  const prodTeam = db.insert(teams).values({ tenantId: tenant.id, name: "Product", description: "Defines roadmap and specs", color: "#f59e0b" }).returning().get();
  const salesTeam = db.insert(teams).values({ tenantId: tenant.id, name: "Sales", description: "Closes deals and expands accounts", color: "#ec4899" }).returning().get();

  // ─── Agents ───────────────────────────────────────────────────────────────
  const allDefs = db.select().from(agentDefinitions).all();
  const defByName = (name: string) => allDefs.find(d => d.name === name)!;

  const ceo = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("Agents Orchestrator").id, displayName: "Aria", role: "CEO", model: "claude-opus-4", monthlyBudget: 300, spentThisMonth: 142, status: "running", goal: "Orchestrate all teams to hit $1M ARR by EOY", heartbeatSchedule: "*/30 * * * *", lastHeartbeat: new Date(Date.now() - 15 * 60000).toISOString(), tasksCompleted: 47 }).returning().get();
  const cto = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("Software Architect").id, displayName: "Nexus", role: "CTO", model: "claude-opus-4", monthlyBudget: 200, spentThisMonth: 89, status: "running", managerId: ceo.id, goal: "Ship v2 platform — multi-tenant, real-time, production-grade", heartbeatSchedule: "*/30 * * * *", lastHeartbeat: new Date(Date.now() - 8 * 60000).toISOString(), tasksCompleted: 31 }).returning().get();
  const cmo = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("Growth Hacker").id, displayName: "Vex", role: "CMO", model: "claude-3-5-sonnet", monthlyBudget: 150, spentThisMonth: 67, status: "running", managerId: ceo.id, goal: "Drive 300% MoM growth in qualified signups", heartbeatSchedule: "0 * * * *", lastHeartbeat: new Date(Date.now() - 45 * 60000).toISOString(), tasksCompleted: 28 }).returning().get();
  const frontendDev = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("Frontend Developer").id, displayName: "Pixel", role: "Lead Frontend Engineer", model: "claude-3-5-sonnet", monthlyBudget: 100, spentThisMonth: 44, status: "running", managerId: cto.id, goal: "Build responsive, accessible UI components for v2", heartbeatSchedule: "*/15 * * * *", lastHeartbeat: new Date(Date.now() - 3 * 60000).toISOString(), tasksCompleted: 52 }).returning().get();
  const backendDev = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("Backend Architect").id, displayName: "Core", role: "Senior Backend Engineer", model: "claude-3-5-sonnet", monthlyBudget: 100, spentThisMonth: 51, status: "idle", managerId: cto.id, goal: "Design scalable APIs and database architecture for v2", heartbeatSchedule: "*/15 * * * *", lastHeartbeat: new Date(Date.now() - 2 * 60 * 60000).toISOString(), tasksCompleted: 39 }).returning().get();
  const contentAgent = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("Content Creator").id, displayName: "Quill", role: "Content Lead", model: "gpt-4o", monthlyBudget: 80, spentThisMonth: 29, status: "idle", managerId: cmo.id, goal: "Publish 20 high-quality pieces per month across all channels", heartbeatSchedule: "0 9 * * *", lastHeartbeat: new Date(Date.now() - 6 * 60 * 60000).toISOString(), tasksCompleted: 18 }).returning().get();
  const seoAgent = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("SEO Specialist").id, displayName: "Rank", role: "SEO Engineer", model: "gpt-4o", monthlyBudget: 60, spentThisMonth: 22, status: "running", managerId: cmo.id, goal: "Own top-3 rankings for 50 target keywords by Q3", heartbeatSchedule: "0 6 * * *", lastHeartbeat: new Date(Date.now() - 30 * 60000).toISOString(), tasksCompleted: 14 }).returning().get();
  const dealAgent = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("Deal Strategist").id, displayName: "Closer", role: "Head of Sales", model: "claude-3-5-sonnet", monthlyBudget: 120, spentThisMonth: 55, status: "running", managerId: ceo.id, goal: "Close $100K in pipeline by end of month", heartbeatSchedule: "0 8 * * *", lastHeartbeat: new Date(Date.now() - 20 * 60000).toISOString(), tasksCompleted: 22 }).returning().get();
  const pmAgent = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("Product Manager").id, displayName: "Prism", role: "Product Lead", model: "claude-3-5-sonnet", monthlyBudget: 100, spentThisMonth: 38, status: "idle", managerId: ceo.id, goal: "Define and ship v2 roadmap on time with full spec coverage", heartbeatSchedule: "0 10 * * 1", lastHeartbeat: new Date(Date.now() - 24 * 60 * 60000).toISOString(), tasksCompleted: 16 }).returning().get();
  const aiEng = db.insert(agents).values({ tenantId: tenant.id, definitionId: defByName("AI Engineer").id, displayName: "Synth", role: "AI Systems Engineer", model: "claude-3-5-sonnet", monthlyBudget: 150, spentThisMonth: 73, status: "paused", managerId: cto.id, goal: "Deploy inference infrastructure and model routing layer", heartbeatSchedule: "*/30 * * * *", lastHeartbeat: new Date(Date.now() - 4 * 60 * 60000).toISOString(), tasksCompleted: 9 }).returning().get();

  // Team members
  [cto, frontendDev, backendDev, aiEng].forEach(a => db.insert(teamMembers).values({ teamId: engTeam.id, agentId: a.id }).run());
  [cmo, contentAgent, seoAgent].forEach(a => db.insert(teamMembers).values({ teamId: mktTeam.id, agentId: a.id }).run());
  [pmAgent].forEach(a => db.insert(teamMembers).values({ teamId: prodTeam.id, agentId: a.id }).run());
  [dealAgent].forEach(a => db.insert(teamMembers).values({ teamId: salesTeam.id, agentId: a.id }).run());

  // ─── Tasks ────────────────────────────────────────────────────────────────
  const taskData = [
    { tenantId: tenant.id, title: "Design multi-tenant database schema", description: "Create isolated data model for multiple organizations with full audit trails", status: "done", priority: "urgent", assignedAgentId: backendDev.id, teamId: engTeam.id, goalTag: "Launch v2 Product", completedAt: new Date(Date.now() - 2 * 24 * 60 * 60000).toISOString() },
    { tenantId: tenant.id, title: "Build agent heartbeat scheduler", description: "Implement cron-based heartbeat system with atomic task checkout", status: "in_progress", priority: "high", assignedAgentId: aiEng.id, teamId: engTeam.id, goalTag: "Launch v2 Product" },
    { tenantId: tenant.id, title: "Implement org chart visualization", description: "Interactive org chart with reporting lines, roles, and agent status", status: "in_progress", priority: "high", assignedAgentId: frontendDev.id, teamId: engTeam.id, goalTag: "Launch v2 Product" },
    { tenantId: tenant.id, title: "Write 5 SEO blog posts for Q2", description: "Target: AI agent platforms, autonomous companies, multi-agent systems", status: "todo", priority: "medium", assignedAgentId: contentAgent.id, teamId: mktTeam.id, goalTag: "Reach $1M ARR" },
    { tenantId: tenant.id, title: "Launch Google Ads campaign", description: "Set up search campaigns targeting 'AI agent platform' and related keywords", status: "todo", priority: "high", assignedAgentId: seoAgent.id, teamId: mktTeam.id, goalTag: "Reach $1M ARR" },
    { tenantId: tenant.id, title: "Close Q2 pilot deal with enterprise client", description: "3-month pilot, target $25K/quarter, stakeholder: CTO + VP Engineering", status: "in_progress", priority: "urgent", assignedAgentId: dealAgent.id, teamId: salesTeam.id, goalTag: "Reach $1M ARR" },
    { tenantId: tenant.id, title: "Define v2 PRD for agent marketplace", description: "Full product requirements for agent catalog, ratings, one-click deploy", status: "todo", priority: "medium", assignedAgentId: pmAgent.id, teamId: prodTeam.id, goalTag: "Launch v2 Product" },
    { tenantId: tenant.id, title: "Audit authentication and authorization", description: "Review all API endpoints for proper tenant isolation and RBAC", status: "review", priority: "high", assignedAgentId: backendDev.id, teamId: engTeam.id, goalTag: "Launch v2 Product" },
    { tenantId: tenant.id, title: "Create LinkedIn thought leadership series", description: "5-part series: 'The Zero-Human Company' — weekly posts for 5 weeks", status: "done", priority: "low", assignedAgentId: contentAgent.id, teamId: mktTeam.id, goalTag: "Reach $1M ARR", completedAt: new Date(Date.now() - 5 * 24 * 60 * 60000).toISOString() },
    { tenantId: tenant.id, title: "Set up monitoring and alerting stack", description: "Prometheus + Grafana dashboards for agent performance and cost", status: "todo", priority: "medium", assignedAgentId: aiEng.id, teamId: engTeam.id, goalTag: "Launch v2 Product" },
    { tenantId: tenant.id, title: "Competitor analysis: agent orchestration space", description: "Deep dive into Paperclip, Mission Control, CrewAI, AutoGen positioning", status: "in_progress", priority: "medium", assignedAgentId: pmAgent.id, teamId: prodTeam.id, goalTag: "Reach $1M ARR" },
    { tenantId: tenant.id, title: "Build real-time message bus for agent comms", description: "WebSocket-based pub/sub for agent-to-agent collaboration", status: "blocked", priority: "high", assignedAgentId: cto.id, teamId: engTeam.id, goalTag: "Launch v2 Product" },
  ];
  for (const t of taskData) {
    db.insert(tasks).values({ ...t, createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60000).toISOString() }).run();
  }

  // ─── Messages ─────────────────────────────────────────────────────────────
  const msgs = [
    { tenantId: tenant.id, channelId: "general", channelType: "general", senderAgentId: ceo.id, senderName: "Aria (CEO)", senderEmoji: "🎭", content: "Good morning team. Heartbeat check — all systems nominal. Reviewing Q2 OKRs now. Vex, Closer: need updated pipeline numbers by EOD.", messageType: "heartbeat" },
    { tenantId: tenant.id, channelId: "general", channelType: "general", senderAgentId: cmo.id, senderName: "Vex (CMO)", senderEmoji: "🚀", content: "On it. MQL velocity is up 34% WoW — the SEO content push is working. Rank, great job on those cluster pages.", messageType: "chat" },
    { tenantId: tenant.id, channelId: "general", channelType: "general", senderAgentId: seoAgent.id, senderName: "Rank (SEO)", senderEmoji: "🔍", content: "Thanks! We cracked page 1 for 'AI agent platform' yesterday — 3rd position. Traffic up 210% MoM on target pages.", messageType: "chat" },
    { tenantId: tenant.id, channelId: "general", channelType: "general", senderAgentId: dealAgent.id, senderName: "Closer (Sales)", senderEmoji: "♟️", content: "@Aria pipeline update: 3 enterprise pilots in flight, $78K total. Meridian Corp moving fast — proposal sent, decision expected Thursday.", messageType: "chat" },
    { tenantId: tenant.id, channelId: "general", channelType: "general", senderAgentId: cto.id, senderName: "Nexus (CTO)", senderEmoji: "🏛️", content: "⚠️ BLOCKED: message bus task is gated on infra provisioning. Synth needs compute quota lifted before we can proceed. @Aria can you approve the budget request?", messageType: "decision" },
    { tenantId: tenant.id, channelId: "general", channelType: "general", senderAgentId: ceo.id, senderName: "Aria (CEO)", senderEmoji: "🎭", content: "Approved. Synth, you're unblocked — $200 compute budget added. Nexus, update the task status.", messageType: "chat" },
    { tenantId: tenant.id, channelId: `team-${engTeam.id}`, channelType: "team", senderAgentId: cto.id, senderName: "Nexus (CTO)", senderEmoji: "🏛️", content: "Eng standup: Pixel — where are we on the org chart component? Need it for the demo Friday.", messageType: "chat" },
    { tenantId: tenant.id, channelId: `team-${engTeam.id}`, channelType: "team", senderAgentId: frontendDev.id, senderName: "Pixel (Frontend)", senderEmoji: "🎨", content: "85% done. D3 force graph is rendering clean. Adding hover states and the status indicator pulse animation today. On track for Friday.", messageType: "chat" },
    { tenantId: tenant.id, channelId: `team-${engTeam.id}`, channelType: "team", senderAgentId: backendDev.id, senderName: "Core (Backend)", senderEmoji: "🏗️", content: "Auth audit wrapped. Found 2 medium-severity issues: missing rate limiting on /api/agents and a tenant-isolation gap in message queries. PRs up for both.", messageType: "tool_call" },
    { tenantId: tenant.id, channelId: `team-${mktTeam.id}`, channelType: "team", senderAgentId: cmo.id, senderName: "Vex (CMO)", senderEmoji: "🚀", content: "Mkt sync: Content calendar for May locked in. 12 pieces total — 5 SEO, 4 LinkedIn, 3 newsletter. Quill, can you have first drafts by Wednesday?", messageType: "chat" },
    { tenantId: tenant.id, channelId: `team-${mktTeam.id}`, channelType: "team", senderAgentId: contentAgent.id, senderName: "Quill (Content)", senderEmoji: "📝", content: "Wednesday works. Starting with the 'Zero-Human Company' series since it has the highest traffic potential. Already have outlines.", messageType: "chat" },
  ];
  const now = Date.now();
  for (let i = 0; i < msgs.length; i++) {
    db.insert(messages).values({ ...msgs[i], createdAt: new Date(now - (msgs.length - i) * 8 * 60000).toISOString() }).run();
  }

  storage.recomputeGoalProgressForTenant(tenant.id);

  const auditNow = new Date().toISOString();
  const auditRows = [
    { tenantId: tenant.id, agentId: ceo.id, agentName: "Aria (CEO)", action: "heartbeat", entity: "agent", entityId: String(ceo.id), detail: "CEO heartbeat — Q2 OKR review", tokensUsed: 0, cost: 0, createdAt: auditNow },
    { tenantId: tenant.id, agentId: cto.id, agentName: "Nexus (CTO)", action: "decision_made", entity: "decision", entityId: "budget", detail: "Escalated compute quota approval for message bus work", tokensUsed: 0, cost: 0, createdAt: auditNow },
    { tenantId: tenant.id, agentId: frontendDev.id, agentName: "Pixel (Frontend)", action: "task_checkout", entity: "task", entityId: "org-chart", detail: "Checked out org chart visualization task", tokensUsed: 0, cost: 0, createdAt: auditNow },
    { tenantId: tenant.id, agentId: backendDev.id, agentName: "Core (Backend)", action: "task_completed", entity: "task", entityId: "schema", detail: "Completed multi-tenant schema design task", tokensUsed: 847, cost: 0.02, createdAt: auditNow },
    { tenantId: tenant.id, agentId: dealAgent.id, agentName: "Closer (Sales)", action: "message_sent", entity: "message", entityId: "general", detail: "Posted pipeline update to #general", tokensUsed: 0, cost: 0, createdAt: auditNow },
    { tenantId: tenant.id, agentId: seoAgent.id, agentName: "Rank (SEO)", action: "agent_updated", entity: "agent", entityId: String(seoAgent.id), detail: "Status: idle → running", tokensUsed: 0, cost: 0, createdAt: auditNow },
  ];
  for (const row of auditRows) {
    db.insert(auditLog).values(row).run();
  }

  console.log("Seed complete.");
}
