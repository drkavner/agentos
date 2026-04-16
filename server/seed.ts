import { db } from "./db";
import { storage } from "./storage";
import { eq } from "drizzle-orm";
import { agentDefinitions, tenants, agents, teams, teamMembers, tasks, messages, goals, auditLog } from "@shared/schema";
import { ensureAgentDefinitionsCatalog } from "./agentDefinitionsCatalog";

export function removeDemoTenantIfPresent() {
  const demo = db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, "cerebratech")).get() as any;
  if (!demo?.id) return false;
  storage.deleteTenant(Number(demo.id));
  return true;
}

export function seedDatabase() {
  ensureAgentDefinitionsCatalog();
  const demoExists = db.select().from(tenants).where(eq(tenants.slug, "cerebratech")).get();
  if (demoExists) return;

  console.log("Seeding demo database (financial org)...");

  // ─── Demo Tenant ──────────────────────────────────────────────────────────
  const tenant = db.insert(tenants).values({
    name: "Meridian FP&A",
    slug: "cerebratech",
    plan: "pro",
    monthlyBudget: 2500,
    spentThisMonth: 612.48,
    mission: "Run autonomous finance: close faster, forecast accurately, stay audit-ready",
    status: "active",
  }).returning().get();

  // ─── Goals ────────────────────────────────────────────────────────────────
  const rootGoal = db
    .insert(goals)
    .values({
      tenantId: tenant.id,
      title: "Hit quarterly EBITDA target",
      description: "Deliver margin plan with variance under 2% vs board model",
      status: "active",
      progress: 31,
    })
    .returning()
    .get();
  db.insert(goals)
    .values({
      tenantId: tenant.id,
      title: "Automate month-end close",
      description: "Reduce close calendar from 8 days to 4 with reconciliations in-product",
      status: "active",
      progress: 52,
      parentGoalId: rootGoal.id,
    })
    .returning()
    .get();
  db.insert(goals)
    .values({
      tenantId: tenant.id,
      title: "SOC2 + financial controls readiness",
      description: "Evidence pack for access reviews, change management, and GL audit trail",
      status: "active",
      progress: 28,
      parentGoalId: rootGoal.id,
    })
    .returning()
    .get();

  // ─── Teams ────────────────────────────────────────────────────────────────
  const fpaTeam = db.insert(teams).values({ tenantId: tenant.id, name: "FP&A", description: "Forecasting, budgets, board reporting", color: "#6366f1" }).returning().get();
  const taxTeam = db.insert(teams).values({ tenantId: tenant.id, name: "Tax & Treasury", description: "Cash, investments, tax provision, nexus", color: "#10b981" }).returning().get();
  const acctTeam = db.insert(teams).values({ tenantId: tenant.id, name: "Accounting & Close", description: "GL, rev rec, reconciliations", color: "#f59e0b" }).returning().get();
  const riskTeam = db.insert(teams).values({ tenantId: tenant.id, name: "Risk & Compliance", description: "Policy, audit liaison, controls testing", color: "#ef4444" }).returning().get();

  // ─── Agents ───────────────────────────────────────────────────────────────
  const allDefs = db.select().from(agentDefinitions).all();
  const defByName = (name: string) => allDefs.find((d) => d.name === name)!;

  const ceo = db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      definitionId: defByName("Agents Orchestrator").id,
      displayName: "Sterling",
      role: "CEO",
      model: "claude-opus-4",
      monthlyBudget: 320,
      spentThisMonth: 118,
      status: "running",
      goal: "Align capital allocation, risk appetite, and reporting cadence across finance",
      heartbeatSchedule: "*/30 * * * *",
      lastHeartbeat: new Date(Date.now() - 12 * 60000).toISOString(),
      tasksCompleted: 22,
    })
    .returning()
    .get();

  const cfo = db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      definitionId: defByName("Finance Ops CFO").id,
      displayName: "Morgan",
      role: "CFO",
      model: "claude-opus-4",
      monthlyBudget: 260,
      spentThisMonth: 96,
      status: "running",
      managerId: ceo.id,
      goal: "Own P&L integrity, liquidity, and investor-grade reporting",
      heartbeatSchedule: "*/30 * * * *",
      lastHeartbeat: new Date(Date.now() - 9 * 60000).toISOString(),
      tasksCompleted: 34,
    })
    .returning()
    .get();

  const controller = db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      definitionId: defByName("Analytics Reporter").id,
      displayName: "Iris",
      role: "Corporate Controller",
      model: "claude-3-5-sonnet",
      monthlyBudget: 140,
      spentThisMonth: 54,
      status: "running",
      managerId: cfo.id,
      goal: "Month-end close, consolidations, and policy guardrails for GL",
      heartbeatSchedule: "0 */4 * * *",
      lastHeartbeat: new Date(Date.now() - 45 * 60000).toISOString(),
      tasksCompleted: 41,
    })
    .returning()
    .get();

  const fpaLead = db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      definitionId: defByName("Financial Analyst").id,
      displayName: "Atlas",
      role: "VP FP&A",
      model: "claude-3-5-sonnet",
      monthlyBudget: 180,
      spentThisMonth: 71,
      status: "running",
      managerId: cfo.id,
      goal: "Rolling forecasts, scenario models, and board deck narrative",
      heartbeatSchedule: "0 7 * * *",
      lastHeartbeat: new Date(Date.now() - 20 * 60000).toISOString(),
      tasksCompleted: 29,
    })
    .returning()
    .get();

  const taxLead = db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      definitionId: defByName("Tax Strategist").id,
      displayName: "Shield",
      role: "Head of Tax",
      model: "gpt-4o",
      monthlyBudget: 120,
      spentThisMonth: 48,
      status: "idle",
      managerId: cfo.id,
      goal: "Provision accuracy, ETR planning, and nexus / transfer pricing hygiene",
      heartbeatSchedule: "0 8 * * 1",
      lastHeartbeat: new Date(Date.now() - 3 * 60 * 60000).toISOString(),
      tasksCompleted: 17,
    })
    .returning()
    .get();

  const treasury = db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      definitionId: defByName("Investment Researcher").id,
      displayName: "Vault",
      role: "Treasury Manager",
      model: "gpt-4o",
      monthlyBudget: 110,
      spentThisMonth: 39,
      status: "running",
      managerId: cfo.id,
      goal: "Cash positioning, 13-week cash flow, counterparty and FX exposure",
      heartbeatSchedule: "0 6 * * *",
      lastHeartbeat: new Date(Date.now() - 35 * 60000).toISOString(),
      tasksCompleted: 24,
    })
    .returning()
    .get();

  const revFinance = db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      definitionId: defByName("Pipeline Analyst").id,
      displayName: "Gauge",
      role: "Revenue Operations Finance",
      model: "claude-3-5-sonnet",
      monthlyBudget: 130,
      spentThisMonth: 62,
      status: "running",
      managerId: cfo.id,
      goal: "ARR bridge, billings vs collections, and rev rec memos for product lines",
      heartbeatSchedule: "0 9 * * *",
      lastHeartbeat: new Date(Date.now() - 50 * 60000).toISOString(),
      tasksCompleted: 19,
    })
    .returning()
    .get();

  const staffAcct = db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      definitionId: defByName("Financial Analyst").id,
      displayName: "Ledger",
      role: "Senior Accountant",
      model: "gpt-4o",
      monthlyBudget: 90,
      spentThisMonth: 28,
      status: "idle",
      managerId: controller.id,
      goal: "Reconciliations, JE support, and flux analysis by cost center",
      heartbeatSchedule: "*/20 * * * *",
      lastHeartbeat: new Date(Date.now() - 90 * 60000).toISOString(),
      tasksCompleted: 36,
    })
    .returning()
    .get();

  const riskLead = db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      definitionId: defByName("Legal Compliance Checker").id,
      displayName: "Audit",
      role: "Internal Controls Lead",
      model: "claude-3-5-sonnet",
      monthlyBudget: 100,
      spentThisMonth: 44,
      status: "paused",
      managerId: ceo.id,
      goal: "Control testing, evidence requests, and remediation tracking for auditors",
      heartbeatSchedule: "0 10 * * 2",
      lastHeartbeat: new Date(Date.now() - 48 * 60 * 60000).toISOString(),
      tasksCompleted: 11,
    })
    .returning()
    .get();

  // Team members
  [fpaLead, revFinance].forEach((a) => db.insert(teamMembers).values({ teamId: fpaTeam.id, agentId: a.id }).run());
  [taxLead, treasury].forEach((a) => db.insert(teamMembers).values({ teamId: taxTeam.id, agentId: a.id }).run());
  [controller, staffAcct].forEach((a) => db.insert(teamMembers).values({ teamId: acctTeam.id, agentId: a.id }).run());
  [riskLead].forEach((a) => db.insert(teamMembers).values({ teamId: riskTeam.id, agentId: a.id }).run());
  [cfo].forEach((a) => db.insert(teamMembers).values({ teamId: fpaTeam.id, agentId: a.id }).run());

  // ─── Tasks (all finance-themed) ───────────────────────────────────────────
  const taskData = [
    {
      tenantId: tenant.id,
      title: "Build rolling 13-week cash flow model",
      description: "Driver-based forecast tied to ARR collections, payroll, and vendor terms; stress case +250/-150 bps revenue",
      status: "in_progress",
      priority: "high",
      assignedAgentId: treasury.id,
      teamId: taxTeam.id,
      goalTag: "Hit quarterly EBITDA target",
    },
    {
      tenantId: tenant.id,
      title: "Board deck: Q2 financial narrative",
      description: "EBITDA bridge, margin walk, and capex vs plan; appendix with segment economics",
      status: "todo",
      priority: "urgent",
      assignedAgentId: fpaLead.id,
      teamId: fpaTeam.id,
      goalTag: "Hit quarterly EBITDA target",
    },
    {
      tenantId: tenant.id,
      title: "Document SaaS revenue recognition memo",
      description: "ASC 606 for multi-element contracts, professional services, and usage overages",
      status: "in_progress",
      priority: "high",
      assignedAgentId: revFinance.id,
      teamId: fpaTeam.id,
      goalTag: "Automate month-end close",
    },
    {
      tenantId: tenant.id,
      title: "Intercompany reconciliation pack",
      description: "Eliminations for three subs; tie-out to GL and FX remeasurement policy",
      status: "todo",
      priority: "medium",
      assignedAgentId: staffAcct.id,
      teamId: acctTeam.id,
      goalTag: "Automate month-end close",
    },
    {
      tenantId: tenant.id,
      title: "Sales tax nexus scan — new states",
      description: "Economic nexus thresholds, registration calendar, and filing owner matrix",
      status: "todo",
      priority: "high",
      assignedAgentId: taxLead.id,
      teamId: taxTeam.id,
      goalTag: "SOC2 + financial controls readiness",
    },
    {
      tenantId: tenant.id,
      title: "SOX ITGC evidence for financial apps",
      description: "Access reviews, change tickets, and backup samples for ERP + billing",
      status: "review",
      priority: "high",
      assignedAgentId: riskLead.id,
      teamId: riskTeam.id,
      goalTag: "SOC2 + financial controls readiness",
    },
    {
      tenantId: tenant.id,
      title: "Variance analysis: opex vs budget",
      description: "Top 15 drivers with owner and action plan; reforecast FY outlook",
      status: "done",
      priority: "medium",
      assignedAgentId: fpaLead.id,
      teamId: fpaTeam.id,
      goalTag: "Hit quarterly EBITDA target",
      completedAt: new Date(Date.now() - 3 * 24 * 60 * 60000).toISOString(),
    },
    {
      tenantId: tenant.id,
      title: "Treasury policy: investment counterparties",
      description: "Approved list, limits, and monthly attestation workflow",
      status: "done",
      priority: "low",
      assignedAgentId: treasury.id,
      teamId: taxTeam.id,
      goalTag: "SOC2 + financial controls readiness",
      completedAt: new Date(Date.now() - 5 * 24 * 60 * 60000).toISOString(),
    },
    {
      tenantId: tenant.id,
      title: "Close checklist automation (workday 1–5)",
      description: "Task owners, dependencies, and blocker routing to Morgan",
      status: "blocked",
      priority: "urgent",
      assignedAgentId: controller.id,
      teamId: acctTeam.id,
      goalTag: "Automate month-end close",
    },
    {
      tenantId: tenant.id,
      title: "ARR bridge: CRM to GL tie-out",
      description: "Reconcile subscription starts/churn to deferred revenue roll-forward",
      status: "in_progress",
      priority: "high",
      assignedAgentId: revFinance.id,
      teamId: fpaTeam.id,
      goalTag: "Hit quarterly EBITDA target",
    },
  ];

  for (const t of taskData) {
    db.insert(tasks).values({ ...t, createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60000).toISOString() }).run();
  }

  // ─── Messages ─────────────────────────────────────────────────────────────
  db.insert(messages)
    .values({
      tenantId: tenant.id,
      channelId: "general",
      channelType: "general",
      senderAgentId: null,
      senderName: "System",
      senderEmoji: "💬",
      content:
        "Meridian FP&A workspace is ready. Collaboration fills from agent runs and heartbeats—use #general for exec sync and team channels for close, tax, and treasury workstreams.",
      messageType: "system",
      createdAt: new Date().toISOString(),
    })
    .run();

  storage.recomputeGoalProgressForTenant(tenant.id);

  const auditNow = new Date().toISOString();
  const auditRows = [
    { tenantId: tenant.id, agentId: ceo.id, agentName: "Sterling (CEO)", action: "heartbeat", entity: "agent", entityId: String(ceo.id), detail: "Weekly capital and liquidity review", tokensUsed: 0, cost: 0, createdAt: auditNow },
    { tenantId: tenant.id, agentId: cfo.id, agentName: "Morgan (CFO)", action: "message_sent", entity: "message", entityId: "general", detail: "CFO cadence — forecast vs budget", tokensUsed: 0, cost: 0, createdAt: auditNow },
    { tenantId: tenant.id, agentId: controller.id, agentName: "Iris (Controller)", action: "task_checkout", entity: "task", entityId: "close", detail: "Picked up close checklist automation", tokensUsed: 0, cost: 0, createdAt: auditNow },
    { tenantId: tenant.id, agentId: fpaLead.id, agentName: "Atlas (FP&A)", action: "task_completed", entity: "task", entityId: "variance", detail: "Shipped opex variance pack", tokensUsed: 620, cost: 0.01, createdAt: auditNow },
  ];
  for (const row of auditRows) {
    db.insert(auditLog).values(row).run();
  }

  console.log("Seed complete.");
}
