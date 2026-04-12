import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { seedDatabase } from "./seed";
import {
  insertTenantSchema, insertAgentSchema, insertTeamSchema,
  insertTeamMemberSchema, insertTaskSchema, insertMessageSchema,
  insertGoalSchema
} from "@shared/schema";

export async function registerRoutes(httpServer: Server, app: Express) {
  // Seed on startup
  seedDatabase();

  // ─── Tenants ──────────────────────────────────────────────────────────────
  app.get("/api/tenants", (req, res) => res.json(storage.getTenants()));
  app.get("/api/tenants/:id", (req, res) => {
    const t = storage.getTenant(Number(req.params.id));
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  });
  app.post("/api/tenants", (req, res) => {
    const parsed = insertTenantSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(storage.createTenant(parsed.data));
  });
  app.patch("/api/tenants/:id", (req, res) => {
    const t = storage.updateTenant(Number(req.params.id), req.body);
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  });
  app.delete("/api/tenants/:id", (req, res) => {
    storage.deleteTenant(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Agent Definitions ────────────────────────────────────────────────────
  app.get("/api/agent-definitions", (req, res) => res.json(storage.getAgentDefinitions()));
  app.get("/api/agent-definitions/division/:division", (req, res) =>
    res.json(storage.getAgentDefinitionsByDivision(req.params.division))
  );

  // ─── Agents ───────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/agents", (req, res) =>
    res.json(storage.getAgents(Number(req.params.tenantId)))
  );
  app.post("/api/tenants/:tenantId/agents", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    // Enforce agent cap
    const current = storage.getAgents(tenantId);
    if (current.length >= tenant.maxAgents) {
      return res.status(403).json({
        error: "agent_limit_reached",
        message: `Agent limit reached. This organization is capped at ${tenant.maxAgents} agents. Ask your admin to raise the limit in Settings.`,
        limit: tenant.maxAgents,
        current: current.length,
      });
    }
    const parsed = insertAgentSchema.safeParse({ ...req.body, tenantId });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(storage.createAgent(parsed.data));
  });
  app.patch("/api/agents/:id", (req, res) => {
    const a = storage.updateAgent(Number(req.params.id), req.body);
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(a);
  });
  app.delete("/api/agents/:id", (req, res) => {
    storage.deleteAgent(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Teams ────────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/teams", (req, res) =>
    res.json(storage.getTeams(Number(req.params.tenantId)))
  );
  app.post("/api/tenants/:tenantId/teams", (req, res) => {
    const parsed = insertTeamSchema.safeParse({ ...req.body, tenantId: Number(req.params.tenantId) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(storage.createTeam(parsed.data));
  });
  app.patch("/api/teams/:id", (req, res) => {
    const t = storage.updateTeam(Number(req.params.id), req.body);
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  });
  app.delete("/api/teams/:id", (req, res) => {
    storage.deleteTeam(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Team Members ─────────────────────────────────────────────────────────
  app.get("/api/teams/:teamId/members", (req, res) =>
    res.json(storage.getTeamMembers(Number(req.params.teamId)))
  );
  app.post("/api/teams/:teamId/members", (req, res) => {
    const parsed = insertTeamMemberSchema.safeParse({ teamId: Number(req.params.teamId), agentId: req.body.agentId });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(storage.addTeamMember(parsed.data));
  });
  app.delete("/api/teams/:teamId/members/:agentId", (req, res) => {
    storage.removeTeamMember(Number(req.params.teamId), Number(req.params.agentId));
    res.json({ ok: true });
  });

  // ─── Tasks ────────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/tasks", (req, res) =>
    res.json(storage.getTasks(Number(req.params.tenantId)))
  );
  app.post("/api/tenants/:tenantId/tasks", (req, res) => {
    const parsed = insertTaskSchema.safeParse({ ...req.body, tenantId: Number(req.params.tenantId) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(storage.createTask(parsed.data));
  });
  app.patch("/api/tasks/:id", (req, res) => {
    const t = storage.updateTask(Number(req.params.id), req.body);
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  });
  app.delete("/api/tasks/:id", (req, res) => {
    storage.deleteTask(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Messages ─────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/messages", (req, res) => {
    const { channelId } = req.query;
    if (!channelId) return res.status(400).json({ error: "channelId required" });
    res.json(storage.getMessages(Number(req.params.tenantId), channelId as string));
  });
  app.post("/api/tenants/:tenantId/messages", (req, res) => {
    const parsed = insertMessageSchema.safeParse({ ...req.body, tenantId: Number(req.params.tenantId) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(storage.createMessage(parsed.data));
  });

  // ─── Goals ────────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/goals", (req, res) =>
    res.json(storage.getGoals(Number(req.params.tenantId)))
  );
  app.post("/api/tenants/:tenantId/goals", (req, res) => {
    const parsed = insertGoalSchema.safeParse({ ...req.body, tenantId: Number(req.params.tenantId) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(storage.createGoal(parsed.data));
  });
  app.patch("/api/goals/:id", (req, res) => {
    const g = storage.updateGoal(Number(req.params.id), req.body);
    if (!g) return res.status(404).json({ error: "Not found" });
    res.json(g);
  });

  // ─── Audit Log ────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/audit", (req, res) =>
    res.json(storage.getAuditLog(Number(req.params.tenantId)))
  );

  // ─── Clear Demo Data ───────────────────────────────────────────────────────
  app.delete("/api/tenants/:tenantId/demo-data", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    storage.clearDemoData(tenantId);
    res.json({ ok: true, message: "Demo data cleared" });
  });

}
