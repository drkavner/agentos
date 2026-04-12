import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import {
  tenants, agents, agentDefinitions, teams, teamMembers,
  tasks, messages, goals, auditLog,
  type InsertTenant, type Tenant,
  type InsertAgent, type Agent,
  type InsertAgentDefinition, type AgentDefinition,
  type InsertTeam, type Team,
  type InsertTeamMember, type TeamMember,
  type InsertTask, type Task,
  type InsertMessage, type Message,
  type InsertGoal, type Goal,
  type InsertAuditLog, type AuditLog,
} from "@shared/schema";

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
  getAgentDefinitionsByDivision(division: string): AgentDefinition[];
  createAgentDefinition(data: InsertAgentDefinition): AgentDefinition;

  // Agents
  getAgents(tenantId: number): Agent[];
  getAgent(id: number): Agent | undefined;
  createAgent(data: InsertAgent): Agent;
  updateAgent(id: number, data: Partial<InsertAgent>): Agent | undefined;
  deleteAgent(id: number): void;

  // Teams
  getTeams(tenantId: number): Team[];
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
  updateTask(id: number, data: Partial<InsertTask>): Task | undefined;
  deleteTask(id: number): void;

  // Messages
  getMessages(tenantId: number, channelId: string, limit?: number): Message[];
  createMessage(data: InsertMessage): Message;

  // Goals
  getGoals(tenantId: number): Goal[];
  createGoal(data: InsertGoal): Goal;
  updateGoal(id: number, data: Partial<InsertGoal>): Goal | undefined;

  // Audit Log
  getAuditLog(tenantId: number, limit?: number): AuditLog[];
  createAuditLog(data: InsertAuditLog): AuditLog;
}

export class DatabaseStorage implements IStorage {
  // ─── Tenants ──────────────────────────────────────────────────────────────
  getTenants() { return db.select().from(tenants).all(); }
  getTenant(id: number) { return db.select().from(tenants).where(eq(tenants.id, id)).get(); }
  createTenant(data: InsertTenant) { return db.insert(tenants).values(data).returning().get(); }
  updateTenant(id: number, data: Partial<InsertTenant>) {
    return db.update(tenants).set(data).where(eq(tenants.id, id)).returning().get();
  }
  deleteTenant(id: number) { db.delete(tenants).where(eq(tenants.id, id)).run(); }

  clearDemoData(tenantId: number) {
    // Delete in FK-safe order: teamMembers → teams, tasks, messages, goals, agents
    const teamRows = db.select({ id: teams.id }).from(teams).where(eq(teams.tenantId, tenantId)).all();
    const teamIds = teamRows.map(t => t.id);
    if (teamIds.length) teamIds.forEach(tid => db.delete(teamMembers).where(eq(teamMembers.teamId, tid)).run());
    if (teamIds.length) teamIds.forEach(tid => db.delete(teams).where(eq(teams.id, tid)).run());
    db.delete(tasks).where(eq(tasks.tenantId, tenantId)).run();
    db.delete(messages).where(eq(messages.tenantId, tenantId)).run();
    db.delete(goals).where(eq(goals.tenantId, tenantId)).run();
    db.delete(agents).where(eq(agents.tenantId, tenantId)).run();
  }

  // ─── Agent Definitions ────────────────────────────────────────────────────
  getAgentDefinitions() { return db.select().from(agentDefinitions).all(); }
  getAgentDefinitionsByDivision(division: string) {
    return db.select().from(agentDefinitions).where(eq(agentDefinitions.division, division)).all();
  }
  createAgentDefinition(data: InsertAgentDefinition) {
    return db.insert(agentDefinitions).values(data).returning().get();
  }

  // ─── Agents ───────────────────────────────────────────────────────────────
  getAgents(tenantId: number) { return db.select().from(agents).where(eq(agents.tenantId, tenantId)).all(); }
  getAgent(id: number) { return db.select().from(agents).where(eq(agents.id, id)).get(); }
  createAgent(data: InsertAgent) { return db.insert(agents).values(data).returning().get(); }
  updateAgent(id: number, data: Partial<InsertAgent>) {
    return db.update(agents).set(data).where(eq(agents.id, id)).returning().get();
  }
  deleteAgent(id: number) { db.delete(agents).where(eq(agents.id, id)).run(); }

  // ─── Teams ────────────────────────────────────────────────────────────────
  getTeams(tenantId: number) { return db.select().from(teams).where(eq(teams.tenantId, tenantId)).all(); }
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
    return db.insert(tasks).values({ ...data, createdAt: now }).returning().get();
  }
  updateTask(id: number, data: Partial<InsertTask>) {
    const update: any = { ...data };
    if (data.status === "done" && !data.completedAt) update.completedAt = new Date().toISOString();
    return db.update(tasks).set(update).where(eq(tasks.id, id)).returning().get();
  }
  deleteTask(id: number) { db.delete(tasks).where(eq(tasks.id, id)).run(); }

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
    return db.insert(messages).values({ ...data, createdAt: now }).returning().get();
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
}

export const storage = new DatabaseStorage();
