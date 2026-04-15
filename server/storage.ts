import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import {
  tenants, agents, agentDefinitions, agentDefinitionSkills, teams, teamMembers,
  tasks, messages, goals, auditLog, ceoFiles, ceoInstructionSettings, paperclipIdentity,
  type InsertTenant, type Tenant,
  type InsertAgent, type Agent,
  type InsertAgentDefinition, type AgentDefinition,
  type UpsertAgentDefinitionSkills,
  type UpsertCeoFile,
  type CeoFile,
  type UpsertCeoInstructionSettings,
  type CeoInstructionSettings,
  type PaperclipIdentity,
  type InsertTeam, type Team,
  type InsertTeamMember, type TeamMember,
  type InsertTask, type Task,
  type InsertMessage, type Message,
  type InsertGoal, type Goal,
  type InsertAuditLog, type AuditLog,
} from "@shared/schema";
import { ensureCeoFilesTable } from "./ceoFiles";
import { ensureDir, ensureCeoInstructionSettingsTable, ensurePaperclipIdentityTable, managedRootPathForPaperclip } from "./ceoInstructions";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

export interface IStorage {
  // Tenants
  getTenants(): Tenant[];
  getTenant(id: number): Tenant | undefined;
  createTenant(data: InsertTenant): Tenant;
  updateTenant(id: number, data: Partial<InsertTenant>): Tenant | undefined;
  deleteTenant(id: number): void;
  clearDemoData(tenantId: number): void;

  // Agent Definitions
  getAgentDefinitions(): AgentDefinition[];
  getAgentDefinition(id: number): AgentDefinition | undefined;
  getAgentDefinitionsByDivision(division: string): AgentDefinition[];
  createAgentDefinition(data: InsertAgentDefinition): AgentDefinition;
  getAgentDefinitionSkills(tenantId: number, definitionId: number): { markdown: string; updatedAt: string } | undefined;
  upsertAgentDefinitionSkills(tenantId: number, definitionId: number, data: UpsertAgentDefinitionSkills): { markdown: string; updatedAt: string };

  // Agents
  getAgents(tenantId: number): Agent[];
  getAgent(id: number): Agent | undefined;
  createAgent(data: InsertAgent): Agent;
  updateAgent(id: number, data: Partial<InsertAgent> & { lastHeartbeat?: string | null; spentThisMonth?: number; tasksCompleted?: number }): Agent | undefined;
  deleteAgent(id: number): void;

  // Teams
  getTeams(tenantId: number): Team[];
  getTeam(id: number): Team | undefined;
  createTeam(data: InsertTeam): Team;
  updateTeam(id: number, data: Partial<InsertTeam>): Team | undefined;
  deleteTeam(id: number): void;

  // Team Members
  getTeamMembers(teamId: number): TeamMember[];
  addTeamMember(data: InsertTeamMember): TeamMember;
  removeTeamMember(teamId: number, agentId: number): void;

  // Tasks
  getTasks(tenantId: number): Task[];
  getTask(id: number): Task | undefined;
  createTask(data: InsertTask): Task;
  updateTask(id: number, data: Partial<InsertTask> & { completedAt?: string | null }): Task | undefined;
  deleteTask(id: number): void;

  // Messages
  getMessages(tenantId: number, channelId: string, limit?: number): Message[];
  createMessage(data: InsertMessage): Message;

  // Goals
  getGoals(tenantId: number): Goal[];
  createGoal(data: InsertGoal): Goal;
  updateGoal(id: number, data: Partial<InsertGoal>): Goal | undefined;
  recomputeGoalProgressForTenant(tenantId: number): void;

  // Audit Log
  getAuditLog(tenantId: number, limit?: number): AuditLog[];
  createAuditLog(data: InsertAuditLog): AuditLog;

  // CEO files
  getCeoFiles(tenantId: number): CeoFile[];
  upsertCeoFile(tenantId: number, filename: string, data: UpsertCeoFile): CeoFile;
  deleteCeoFile(tenantId: number, filename: string): void;

  // CEO instruction settings
  getCeoInstructionSettings(tenantId: number): CeoInstructionSettings;
  upsertCeoInstructionSettings(tenantId: number, data: UpsertCeoInstructionSettings): CeoInstructionSettings;

  // Paperclip identity (stable ids for ~/.paperclip paths)
  getOrCreatePaperclipIdentity(tenantId: number): PaperclipIdentity;
}

export class DatabaseStorage implements IStorage {
  private runTx<T>(fn: (tx: typeof db) => T): T {
    return db.transaction((tx) => fn(tx as unknown as typeof db));
  }

  /** Derive goal % from tasks where `task.goalTag` matches `goal.title`. */
  recomputeGoalProgressForTenant(tenantId: number) {
    const goalsList = db.select().from(goals).where(eq(goals.tenantId, tenantId)).all();
    const tasksList = db.select().from(tasks).where(eq(tasks.tenantId, tenantId)).all();
    for (const g of goalsList) {
      const related = tasksList.filter((t) => t.goalTag === g.title);
      if (related.length === 0) continue;
      const done = related.filter((t) => t.status === "done").length;
      const p = Math.min(100, Math.round((done / related.length) * 100));
      let nextStatus = g.status;
      if (p >= 100) nextStatus = "achieved";
      else if (g.status === "achieved" && p < 100) nextStatus = "active";
      if (p !== g.progress || nextStatus !== g.status) {
        db.update(goals).set({ progress: p, status: nextStatus }).where(eq(goals.id, g.id)).run();
      }
    }
  }

  // ─── Tenants ──────────────────────────────────────────────────────────────
  getTenants() { return db.select().from(tenants).all(); }
  getTenant(id: number) { return db.select().from(tenants).where(eq(tenants.id, id)).get(); }
  createTenant(data: InsertTenant) { return db.insert(tenants).values(data).returning().get(); }
  updateTenant(id: number, data: Partial<InsertTenant>) {
    return db.update(tenants).set(data).where(eq(tenants.id, id)).returning().get();
  }
  deleteTenant(id: number) {
    this.runTx((tx) => {
      tx.delete(tenants).where(eq(tenants.id, id)).run();
    });
  }

  clearDemoData(tenantId: number) {
    // With FKs + cascades, deleting the tenant-owned rows is safe.
    // Wrap in a transaction to avoid partial clears.
    this.runTx((tx) => {
      // Deleting teams will cascade to team_members.
      tx.delete(messages).where(eq(messages.tenantId, tenantId)).run();
      tx.delete(tasks).where(eq(tasks.tenantId, tenantId)).run();
      tx.delete(goals).where(eq(goals.tenantId, tenantId)).run();
      tx.delete(auditLog).where(eq(auditLog.tenantId, tenantId)).run();
      tx.delete(agents).where(eq(agents.tenantId, tenantId)).run();
      tx.delete(teams).where(eq(teams.tenantId, tenantId)).run();
    });
  }

  // ─── Agent Definitions ────────────────────────────────────────────────────
  getAgentDefinitions() { return db.select().from(agentDefinitions).all(); }
  getAgentDefinition(id: number) {
    return db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).get();
  }
  getAgentDefinitionsByDivision(division: string) {
    return db.select().from(agentDefinitions).where(eq(agentDefinitions.division, division)).all();
  }
  createAgentDefinition(data: InsertAgentDefinition) {
    return db.insert(agentDefinitions).values(data).returning().get();
  }

  getAgentDefinitionSkills(tenantId: number, definitionId: number) {
    const row = db
      .select({ markdown: agentDefinitionSkills.markdown, updatedAt: agentDefinitionSkills.updatedAt })
      .from(agentDefinitionSkills)
      .where(and(eq(agentDefinitionSkills.tenantId, tenantId), eq(agentDefinitionSkills.definitionId, definitionId)))
      .get();
    return row;
  }

  upsertAgentDefinitionSkills(tenantId: number, definitionId: number, data: UpsertAgentDefinitionSkills) {
    const now = new Date().toISOString();
    const existing = db
      .select({ id: agentDefinitionSkills.id })
      .from(agentDefinitionSkills)
      .where(and(eq(agentDefinitionSkills.tenantId, tenantId), eq(agentDefinitionSkills.definitionId, definitionId)))
      .get();
    if (existing) {
      return db
        .update(agentDefinitionSkills)
        .set({ markdown: data.markdown, updatedAt: now })
        .where(eq(agentDefinitionSkills.id, existing.id))
        .returning({ markdown: agentDefinitionSkills.markdown, updatedAt: agentDefinitionSkills.updatedAt })
        .get();
    }
    return db
      .insert(agentDefinitionSkills)
      .values({ tenantId, definitionId, markdown: data.markdown, updatedAt: now })
      .returning({ markdown: agentDefinitionSkills.markdown, updatedAt: agentDefinitionSkills.updatedAt })
      .get();
  }

  // ─── Agents ───────────────────────────────────────────────────────────────
  getAgents(tenantId: number) { return db.select().from(agents).where(eq(agents.tenantId, tenantId)).all(); }
  getAgent(id: number) { return db.select().from(agents).where(eq(agents.id, id)).get(); }
  createAgent(data: InsertAgent) { return db.insert(agents).values(data).returning().get(); }
  updateAgent(id: number, data: Partial<InsertAgent> & { lastHeartbeat?: string | null; spentThisMonth?: number; tasksCompleted?: number }) {
    return db.update(agents).set(data).where(eq(agents.id, id)).returning().get();
  }
  deleteAgent(id: number) { db.delete(agents).where(eq(agents.id, id)).run(); }

  // ─── Teams ────────────────────────────────────────────────────────────────
  getTeams(tenantId: number) { return db.select().from(teams).where(eq(teams.tenantId, tenantId)).all(); }
  getTeam(id: number) { return db.select().from(teams).where(eq(teams.id, id)).get(); }
  createTeam(data: InsertTeam) { return db.insert(teams).values(data).returning().get(); }
  updateTeam(id: number, data: Partial<InsertTeam>) {
    return db.update(teams).set(data).where(eq(teams.id, id)).returning().get();
  }
  deleteTeam(id: number) { db.delete(teams).where(eq(teams.id, id)).run(); }

  // ─── Team Members ─────────────────────────────────────────────────────────
  getTeamMembers(teamId: number) { return db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId)).all(); }
  addTeamMember(data: InsertTeamMember) { return db.insert(teamMembers).values(data).returning().get(); }
  removeTeamMember(teamId: number, agentId: number) {
    db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.agentId, agentId))).run();
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────
  getTasks(tenantId: number) { return db.select().from(tasks).where(eq(tasks.tenantId, tenantId)).orderBy(desc(tasks.id)).all(); }
  getTask(id: number) { return db.select().from(tasks).where(eq(tasks.id, id)).get(); }
  createTask(data: InsertTask) {
    const now = new Date().toISOString();
    const row = db.insert(tasks).values({ ...data, createdAt: now }).returning().get();
    this.recomputeGoalProgressForTenant(data.tenantId);
    return row;
  }
  updateTask(id: number, data: Partial<InsertTask> & { completedAt?: string | null }) {
    const update: any = { ...data };
    if (data.status === "done" && update.completedAt === undefined) {
      update.completedAt = new Date().toISOString();
    }
    const row = db.update(tasks).set(update).where(eq(tasks.id, id)).returning().get();
    if (row) this.recomputeGoalProgressForTenant(row.tenantId);
    return row;
  }
  deleteTask(id: number) {
    const t = this.getTask(id);
    db.delete(tasks).where(eq(tasks.id, id)).run();
    if (t) this.recomputeGoalProgressForTenant(t.tenantId);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────
  getMessages(tenantId: number, channelId: string, limit = 100) {
    return db.select().from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.channelId, channelId)))
      .orderBy(desc(messages.id))
      .limit(limit)
      .all()
      .reverse();
  }
  createMessage(data: InsertMessage) {
    const now = new Date().toISOString();
    // Drizzle's sqlite driver expects `text` columns to receive strings (or null).
    // Some callsites pass objects (e.g. `metadata`) via `as any`, which can crash
    // better-sqlite3 parameter binding at runtime.
    const anyData = data as any;
    const metadata =
      anyData?.metadata === undefined || anyData?.metadata === null
        ? undefined
        : typeof anyData.metadata === "string"
          ? anyData.metadata
          : JSON.stringify(anyData.metadata);

    const row: any = {
      ...anyData,
      channelType: anyData.channelType ?? "team",
      senderName: anyData.senderName ?? "System",
      senderEmoji: anyData.senderEmoji ?? "🤖",
      messageType: anyData.messageType ?? "chat",
      metadata,
      createdAt: now,
    };

    return db.insert(messages).values(row).returning().get();
  }

  // ─── Goals ────────────────────────────────────────────────────────────────
  getGoals(tenantId: number) { return db.select().from(goals).where(eq(goals.tenantId, tenantId)).all(); }
  createGoal(data: InsertGoal) { return db.insert(goals).values(data).returning().get(); }
  updateGoal(id: number, data: Partial<InsertGoal>) {
    return db.update(goals).set(data).where(eq(goals.id, id)).returning().get();
  }

  // ─── Audit Log ────────────────────────────────────────────────────────────
  getAuditLog(tenantId: number, limit = 200) {
    return db.select().from(auditLog)
      .where(eq(auditLog.tenantId, tenantId))
      .orderBy(desc(auditLog.id))
      .limit(limit)
      .all();
  }
  createAuditLog(data: InsertAuditLog) {
    const now = new Date().toISOString();
    return db.insert(auditLog).values({ ...data, createdAt: now }).returning().get();
  }

  // ─── CEO Files ────────────────────────────────────────────────────────────
  getCeoFiles(tenantId: number) {
    ensureCeoFilesTable();
    return db
      .select()
      .from(ceoFiles)
      .where(eq(ceoFiles.tenantId, tenantId))
      .orderBy(desc(ceoFiles.id))
      .all()
      .reverse();
  }

  upsertCeoFile(tenantId: number, filename: string, data: UpsertCeoFile) {
    ensureCeoFilesTable();
    const now = new Date().toISOString();
    const existing = db
      .select({ id: ceoFiles.id })
      .from(ceoFiles)
      .where(and(eq(ceoFiles.tenantId, tenantId), eq(ceoFiles.filename, filename)))
      .get();
    if (existing) {
      return db
        .update(ceoFiles)
        .set({ markdown: data.markdown, updatedAt: now })
        .where(eq(ceoFiles.id, existing.id))
        .returning()
        .get();
    }
    return db
      .insert(ceoFiles)
      .values({ tenantId, filename, markdown: data.markdown, updatedAt: now })
      .returning()
      .get();
  }

  deleteCeoFile(tenantId: number, filename: string) {
    ensureCeoFilesTable();
    db.delete(ceoFiles).where(and(eq(ceoFiles.tenantId, tenantId), eq(ceoFiles.filename, filename))).run();
  }

  getCeoInstructionSettings(tenantId: number) {
    ensureCeoFilesTable();
    ensureCeoInstructionSettingsTable();
    ensurePaperclipIdentityTable();
    const existing = db
      .select()
      .from(ceoInstructionSettings)
      .where(eq(ceoInstructionSettings.tenantId, tenantId))
      .get();
    if (existing) {
      // If this org was created before we switched to ~/.paperclip, auto-migrate the managed rootPath.
      if (existing.mode !== "external") {
        try {
          const ident = this.getOrCreatePaperclipIdentity(tenantId);
          const expected = managedRootPathForPaperclip(ident.companyId, ident.ceoPaperclipAgentId);
          if (existing.rootPath !== expected) {
            ensureDir(expected);
            // Best-effort copy existing on-disk bundle forward (paperclip -> cortex, or old -> new).
            try {
              const oldRoot = existing.rootPath;
              if (oldRoot && fs.existsSync(oldRoot)) {
                for (const name of fs.readdirSync(oldRoot)) {
                  if (!name.toLowerCase().endsWith(".md")) continue;
                  const src = path.join(oldRoot, name);
                  const dst = path.join(expected, name);
                  if (!fs.existsSync(dst)) {
                    fs.copyFileSync(src, dst);
                  }
                }
              }
            } catch {
              // ignore copy failures
            }
            return db
              .update(ceoInstructionSettings)
              .set({ rootPath: expected, updatedAt: new Date().toISOString() })
              .where(eq(ceoInstructionSettings.tenantId, tenantId))
              .returning()
              .get();
          }
        } catch {
          // ignore migration failures; return existing
        }
      }
      return existing;
    }
    const now = new Date().toISOString();
    const ident = this.getOrCreatePaperclipIdentity(tenantId);
    const rootPath = managedRootPathForPaperclip(ident.companyId, ident.ceoPaperclipAgentId);
    ensureDir(rootPath);
    return db
      .insert(ceoInstructionSettings)
      .values({ tenantId, mode: "managed", rootPath, entryFile: "AGENTS.md", updatedAt: now })
      .returning()
      .get();
  }

  upsertCeoInstructionSettings(tenantId: number, data: UpsertCeoInstructionSettings) {
    ensureCeoFilesTable();
    ensureCeoInstructionSettingsTable();
    ensurePaperclipIdentityTable();
    const now = new Date().toISOString();
    const existing = db
      .select({ tenantId: ceoInstructionSettings.tenantId })
      .from(ceoInstructionSettings)
      .where(eq(ceoInstructionSettings.tenantId, tenantId))
      .get();
    if (existing) {
      return db
        .update(ceoInstructionSettings)
        .set({ mode: data.mode, rootPath: data.rootPath, entryFile: data.entryFile, updatedAt: now })
        .where(eq(ceoInstructionSettings.tenantId, tenantId))
        .returning()
        .get();
    }
    return db
      .insert(ceoInstructionSettings)
      .values({ tenantId, mode: data.mode, rootPath: data.rootPath, entryFile: data.entryFile, updatedAt: now })
      .returning()
      .get();
  }

  getOrCreatePaperclipIdentity(tenantId: number) {
    ensurePaperclipIdentityTable();
    const existing = db
      .select()
      .from(paperclipIdentity)
      .where(eq(paperclipIdentity.tenantId, tenantId))
      .get();
    if (existing) return existing;

    const ceo = db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.role, "CEO")))
      .get();
    if (!ceo?.id) {
      throw new Error("Cannot create paperclip identity without CEO agent");
    }
    const now = new Date().toISOString();
    const row = {
      tenantId,
      companyId: randomUUID(),
      ceoAgentId: ceo.id,
      ceoPaperclipAgentId: randomUUID(),
      updatedAt: now,
    };
    return db
      .insert(paperclipIdentity)
      .values(row)
      .returning()
      .get();
  }
}

export const storage = new DatabaseStorage();
