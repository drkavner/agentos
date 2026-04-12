import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Tenants (Organizations / Companies) ─────────────────────────────────────
export const tenants = sqliteTable("tenants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("starter"), // starter | pro | enterprise
  monthlyBudget: real("monthly_budget").notNull().default(500),
  spentThisMonth: real("spent_this_month").notNull().default(0),
  logoUrl: text("logo_url"),
  mission: text("mission"),
  status: text("status").notNull().default("active"), // active | paused | suspended
  maxAgents: integer("max_agents").notNull().default(25), // admin-set hard cap on deployed agents
});

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, spentThisMonth: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;

// ─── Agent Definitions (the catalog from agency-agents / ai-marketing-skills) ─
export const agentDefinitions = sqliteTable("agent_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  division: text("division").notNull(),
  specialty: text("specialty").notNull(),
  description: text("description").notNull(),
  whenToUse: text("when_to_use").notNull(),
  source: text("source").notNull().default("agency-agents"), // agency-agents | ai-marketing-skills | custom
  color: text("color").notNull().default("#4f98a3"),
});

export const insertAgentDefinitionSchema = createInsertSchema(agentDefinitions).omit({ id: true });
export type InsertAgentDefinition = z.infer<typeof insertAgentDefinitionSchema>;
export type AgentDefinition = typeof agentDefinitions.$inferSelect;

// ─── Agents (deployed instances within a tenant) ──────────────────────────────
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  definitionId: integer("definition_id").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(), // e.g. "CEO", "Head of Growth"
  model: text("model").notNull().default("claude-3-5-sonnet"),
  monthlyBudget: real("monthly_budget").notNull().default(50),
  spentThisMonth: real("spent_this_month").notNull().default(0),
  status: text("status").notNull().default("idle"), // idle | running | paused | terminated
  managerId: integer("manager_id"), // reports to this agent
  goal: text("goal"),
  heartbeatSchedule: text("heartbeat_schedule").notNull().default("*/30 * * * *"),
  lastHeartbeat: text("last_heartbeat"),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
});

export const insertAgentSchema = createInsertSchema(agents).omit({ id: true, spentThisMonth: true, tasksCompleted: true, lastHeartbeat: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

// ─── Teams ────────────────────────────────────────────────────────────────────
export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#4f98a3"),
});

export const insertTeamSchema = createInsertSchema(teams).omit({ id: true });
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teams.$inferSelect;

// ─── Team Members (agent ↔ team join) ────────────────────────────────────────
export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").notNull(),
  agentId: integer("agent_id").notNull(),
});

export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({ id: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembers.$inferSelect;

// ─── Tasks / Tickets ──────────────────────────────────────────────────────────
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"), // todo | in_progress | review | done | blocked
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  assignedAgentId: integer("assigned_agent_id"),
  createdById: integer("created_by_id"), // agent id
  teamId: integer("team_id"),
  goalTag: text("goal_tag"), // which company goal this traces to
  estimatedTokens: integer("estimated_tokens"),
  actualTokens: integer("actual_tokens"),
  dueDate: text("due_date"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, completedAt: true, createdAt: true, actualTokens: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// ─── Messages (agent-to-agent chat + task threads) ───────────────────────────
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  channelId: text("channel_id").notNull(), // "general" | "team-{id}" | "task-{id}" | "agent-{id}-{id}"
  channelType: text("channel_type").notNull().default("team"), // general | team | task | dm
  senderAgentId: integer("sender_agent_id"),
  senderName: text("sender_name").notNull().default("System"),
  senderEmoji: text("sender_emoji").notNull().default("🤖"),
  content: text("content").notNull(),
  messageType: text("message_type").notNull().default("chat"), // chat | system | tool_call | decision | heartbeat
  metadata: text("metadata"), // JSON blob for tool calls, decisions, etc.
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// ─── Goals ────────────────────────────────────────────────────────────────────
export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // active | achieved | paused
  parentGoalId: integer("parent_goal_id"),
  progress: integer("progress").notNull().default(0), // 0-100
});

export const insertGoalSchema = createInsertSchema(goals).omit({ id: true });
export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type Goal = typeof goals.$inferSelect;

// ─── Audit Log ────────────────────────────────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  agentId: integer("agent_id"),
  agentName: text("agent_name"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  detail: text("detail"),
  tokensUsed: integer("tokens_used").notNull().default(0),
  cost: real("cost").notNull().default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLog.$inferSelect;
