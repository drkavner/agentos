import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
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
  /** Execution adapter for all agents in this org: library hires run through this plane. */
  adapterType: text("adapter_type").notNull().default("hermes"), // hermes | openclaw
  /** Per-org Ollama API base (e.g. http://127.0.0.1:11434). Falls back to server OLLAMA_BASE_URL when empty. */
  ollamaBaseUrl: text("ollama_base_url"),
});

/** Which execution plane runs deployed agents for this org (library hires use the org default). */
export const tenantAdapterTypeEnum = z.enum([
  "hermes",
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "cursor",
  "openclaw",
]);
export type TenantAdapterType = z.infer<typeof tenantAdapterTypeEnum>;
export const TENANT_ADAPTER_LABELS: Record<TenantAdapterType, string> = {
  hermes: "Hermes Agent",
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  opencode: "OpenCode",
  cursor: "Cursor",
  openclaw: "OpenClaw Gateway",
};

export const insertTenantSchema = createInsertSchema(tenants)
  .omit({ id: true, spentThisMonth: true })
  .extend({
    adapterType: tenantAdapterTypeEnum.optional(),
    /** If false, skip auto-creating the CEO agent on org creation. */
    useCeoAgent: z.boolean().optional(),
    /** Optional defaults applied to the auto-created CEO agent at org creation time. */
    ceoLlmProvider: z.enum(["openrouter", "ollama"]).optional(),
    ceoModel: z.string().min(1).max(200).optional(),
  });
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

// ─── Agent Definition Skills Overrides (per tenant/org editable skills.md) ───
export const agentDefinitionSkills = sqliteTable(
  "agent_definition_skills",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    definitionId: integer("definition_id").notNull().references(() => agentDefinitions.id, { onDelete: "cascade" }),
    markdown: text("markdown").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    tenantDefIdx: index("agent_def_skills_tenant_def_idx").on(t.tenantId, t.definitionId),
  }),
);

export const upsertAgentDefinitionSkillsSchema = z.object({
  markdown: z.string().min(1).max(20000),
});
export type UpsertAgentDefinitionSkills = z.infer<typeof upsertAgentDefinitionSkillsSchema>;

// ─── Agents (deployed instances within a tenant) ──────────────────────────────
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  definitionId: integer("definition_id").notNull().references(() => agentDefinitions.id, { onDelete: "restrict" }),
  /** Optional override for cards / org chart; falls back to agent_definitions.emoji when null. */
  emoji: text("emoji"),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(), // e.g. "CEO", "Head of Growth"
  model: text("model").notNull().default("claude-3-5-sonnet"),
  monthlyBudget: real("monthly_budget").notNull().default(50),
  spentThisMonth: real("spent_this_month").notNull().default(0),
  status: text("status").notNull().default("idle"), // idle | running | paused | terminated
  // Self-referencing FKs are omitted here to avoid TS circular inference issues.
  // Manager relationships are enforced at the application layer.
  managerId: integer("manager_id"), // reports to this agent
  goal: text("goal"),
  heartbeatSchedule: text("heartbeat_schedule").notNull().default("*/30 * * * *"),
  lastHeartbeat: text("last_heartbeat"),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
}, (t) => ({
  tenantIdx: index("agents_tenant_id_idx").on(t.tenantId),
}));

export const insertAgentSchema = createInsertSchema(agents).omit({ id: true, spentThisMonth: true, tasksCompleted: true, lastHeartbeat: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

// ─── Teams ────────────────────────────────────────────────────────────────────
export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#4f98a3"),
}, (t) => ({
  tenantIdx: index("teams_tenant_id_idx").on(t.tenantId),
}));

export const insertTeamSchema = createInsertSchema(teams).omit({ id: true });
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teams.$inferSelect;

// ─── Team Members (agent ↔ team join) ────────────────────────────────────────
export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
}, (t) => ({
  teamIdx: index("team_members_team_id_idx").on(t.teamId),
  agentIdx: index("team_members_agent_id_idx").on(t.agentId),
}));

export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({ id: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembers.$inferSelect;

// ─── Tasks / Tickets ──────────────────────────────────────────────────────────
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"), // todo | in_progress | review | done | blocked
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  assignedAgentId: integer("assigned_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdById: integer("created_by_id").references(() => agents.id, { onDelete: "set null" }), // agent id
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  parentTaskId: integer("parent_task_id"), // CEO delegation chain / goal hierarchy
  goalTag: text("goal_tag"), // which company goal this traces to
  estimatedTokens: integer("estimated_tokens"),
  actualTokens: integer("actual_tokens"),
  dueDate: text("due_date"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  tenantIdx: index("tasks_tenant_id_idx").on(t.tenantId),
  statusIdx: index("tasks_tenant_status_idx").on(t.tenantId, t.status),
}));

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, completedAt: true, createdAt: true, actualTokens: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// ─── Messages (agent-to-agent chat + task threads) ───────────────────────────
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(), // "general" | "team-{id}" | "task-{id}" | "agent-{id}-{id}"
  channelType: text("channel_type").notNull().default("team"), // general | team | task | dm
  senderAgentId: integer("sender_agent_id").references(() => agents.id, { onDelete: "set null" }),
  senderName: text("sender_name").notNull().default("System"),
  senderEmoji: text("sender_emoji").notNull().default("🤖"),
  content: text("content").notNull(),
  messageType: text("message_type").notNull().default("chat"), // chat | system | tool_call | decision | heartbeat
  metadata: text("metadata"), // JSON blob for tool calls, decisions, etc.
  createdAt: text("created_at").notNull(),
}, (t) => ({
  tenantChannelIdx: index("messages_tenant_channel_idx").on(t.tenantId, t.channelId),
}));

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// ─── Goals ────────────────────────────────────────────────────────────────────
export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // active | achieved | paused
  // Self-referencing FK omitted (TS circular inference). Enforced in app logic.
  parentGoalId: integer("parent_goal_id"),
  progress: integer("progress").notNull().default(0), // 0-100
}, (t) => ({
  tenantIdx: index("goals_tenant_id_idx").on(t.tenantId),
}));

export const insertGoalSchema = createInsertSchema(goals).omit({ id: true });
export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type Goal = typeof goals.$inferSelect;

// ─── Audit Log ────────────────────────────────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").references(() => agents.id, { onDelete: "set null" }),
  agentName: text("agent_name"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  detail: text("detail"),
  tokensUsed: integer("tokens_used").notNull().default(0),
  cost: real("cost").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  tenantIdx: index("audit_log_tenant_id_idx").on(t.tenantId),
}));

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLog.$inferSelect;

// ─── CEO Files (per-tenant editable AGENTS/HEARTBEAT/SOUL/TOOLS) ─────────────
export const ceoFiles = sqliteTable(
  "ceo_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(), // e.g. AGENTS.md
    markdown: text("markdown").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    tenantFileIdx: index("ceo_files_tenant_filename_idx").on(t.tenantId, t.filename),
  }),
);

export const upsertCeoFileSchema = z.object({
  filename: z.string().min(1).max(128),
  markdown: z.string().min(1).max(50000),
});
export type UpsertCeoFile = z.infer<typeof upsertCeoFileSchema>;

export type CeoFile = typeof ceoFiles.$inferSelect;

export const upsertCeoInstructionSettingsSchema = z.object({
  mode: z.enum(["managed", "external"]),
  rootPath: z.string().min(1).max(2000),
  entryFile: z.string().min(1).max(128),
});
export type UpsertCeoInstructionSettings = z.infer<typeof upsertCeoInstructionSettingsSchema>;

export const ceoInstructionSettings = sqliteTable(
  "ceo_instruction_settings",
  {
    tenantId: integer("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("managed"), // managed | external
    rootPath: text("root_path").notNull(),
    entryFile: text("entry_file").notNull().default("AGENTS.md"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    tenantIdx: index("ceo_instruction_settings_tenant_idx").on(t.tenantId),
  }),
);

export type CeoInstructionSettings = typeof ceoInstructionSettings.$inferSelect;

// ─── Paperclip Identity (stable ids for ~/.paperclip paths) ──────────────────
export const paperclipIdentity = sqliteTable(
  "paperclip_identity",
  {
    tenantId: integer("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(), // uuid
    ceoAgentId: integer("ceo_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    ceoPaperclipAgentId: text("ceo_paperclip_agent_id").notNull(), // uuid
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    tenantIdx: index("paperclip_identity_tenant_idx").on(t.tenantId),
  }),
);

export type PaperclipIdentity = typeof paperclipIdentity.$inferSelect;
