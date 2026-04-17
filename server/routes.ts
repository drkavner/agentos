import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { ApiError } from "./apiError";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { Writable } from "stream";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { setupTenantSseRoute } from "./tenantEvents";
import { auditAndInvalidate, invalidateTenant, invalidateTenantsList } from "./realtimeSideEffects";
import { getEffectiveDefinitionSkills } from "./skillsRuntime";
import { collaborationAfterUserMessage } from "./openclawAdapter";
import { dispatchAgentRun } from "./dispatchAgentRun";
import { listDeliverables, createDeliverableZip, processAgentDeliverable } from "./deliverables";
import { buildAgentSystemPrompt } from "./agentPrompts";
import {
  getLlmServerStatus,
  listOllamaModels,
  normalizeLlmRouting,
  resolveOllamaBaseUrl,
  sanitizeOllamaProbeUrl,
} from "./llmClient";
import {
  getTenantOllamaApiKey,
  upsertTenantOllamaApiKey,
  getTenantOpenRouterApiKey,
  upsertTenantOpenRouterApiKey,
} from "./tenantSecrets";
import {
  insertTenantSchema, insertAgentSchema, insertTeamSchema,
  insertTeamMemberSchema, insertTaskSchema, insertMessageSchema,
  insertGoalSchema,
  upsertAgentDefinitionSkillsSchema,
  upsertCeoFileSchema,
  upsertCeoInstructionSettingsSchema,
} from "@shared/schema";
import { ensureDir, safeJoin, listMarkdownFiles, readFileUtf8, writeFileUtf8, deleteFileIfExists, managedRootPathForPaperclip } from "./ceoInstructions";
import { ensureCortexSkillsTables } from "./cortexSkills";
import {
  createAgentApiKey,
  ensureAgentConfigurationTables,
  getAgentProfile,
  getAgentRuntimeSettings,
  listAgentApiKeys,
  secondsToCron,
  upsertAgentProfile,
  upsertAgentRuntimeSettings,
} from "./agentConfiguration";
import { ensureAgentRunsTables, getAgentRun, getRunEvents, listAgentRuns } from "./agentRuns";
import { ensureAgentBudgetTables, getAgentBudgetSettings, updateAgentBudgetSettings } from "./agentBudgets";
import {
  ensureCeoControlTable,
  getCeoControlMode,
  setCeoControlMode,
  setCeoEnabled,
  getCeoControlSettings,
} from "./ceoControl";
import { createDefaultCeoForTenant } from "./ceoBootstrap";
import { maybeDelegateCeoIncomingTask, maybeAutoCloseParentCeoTask } from "./ceoDelegation";

// dispatchAgentRun imported from ./dispatchAgentRun

const patchTenantSchema = insertTenantSchema.partial();

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function renderDefinitionSkillsMd(def: { id: number; name: string; division: string; specialty: string; description: string; whenToUse: string; source: string }) {
  const skills = def.specialty
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bullets = skills.length ? skills : [def.specialty];
  return `# ${def.name} — Skills

## Summary
${def.description}

## Division
${def.division}

## Skills
${bullets.map((b) => `- ${b}`).join("\n")}

## When to use
${def.whenToUse}

## Source
${def.source}
`;
}

function zodDetails(error: unknown) {
  // Keep response small + consistent for clients.
  // (ZodError has .issues, but we avoid importing Zod types here.)
  return error;
}

export async function registerRoutes(httpServer: Server, app: Express) {
  setupTenantSseRoute(app, (id) => storage.getTenant(id));

  // ─── Tenants ──────────────────────────────────────────────────────────────
  app.get("/api/tenants", (req, res) => res.json(storage.getTenants()));
  app.get("/api/tenants/:id", (req, res) => {
    const t = storage.getTenant(Number(req.params.id));
    if (!t) throw new ApiError(404, "not_found", "Tenant not found");
    res.json(t);
  });

  /** List models from the org’s Ollama instance (`GET …/api/tags`). Optional `?url=` probes before saving the org URL. */
  app.get("/api/tenants/:tenantId/ollama/models", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    const rawQ = typeof req.query.url === "string" ? req.query.url : null;
    const override = sanitizeOllamaProbeUrl(rawQ);
    const base = override ?? resolveOllamaBaseUrl(tenant.ollamaBaseUrl);
    const secret = getTenantOllamaApiKey(tenantId);
    const result = await listOllamaModels(base, { apiKey: secret.apiKey });
    if (!result.ok) {
      throw new ApiError(502, "ollama_list_failed", result.error);
    }
    res.json({ baseUsed: result.baseUsed, models: result.models });
  });
  console.log("[express] Registered GET /api/tenants/:tenantId/ollama/models (Ollama model list)");

  /** Probe an arbitrary Ollama base URL without needing an org yet (used by onboarding wizard). */
  app.get("/api/ollama/models", async (req, res) => {
    const rawQ = typeof req.query.url === "string" ? req.query.url : null;
    const override = sanitizeOllamaProbeUrl(rawQ);
    if (!override) throw new ApiError(400, "validation_error", "url required");
    const result = await listOllamaModels(override, { apiKey: null });
    if (!result.ok) {
      throw new ApiError(502, "ollama_list_failed", result.error);
    }
    res.json({ baseUsed: result.baseUsed, models: result.models });
  });
  console.log("[express] Registered GET /api/ollama/models (Ollama probe)");

  // ─── Ollama Cloud API Key (per-tenant, stored server-side) ────────────────
  app.get("/api/tenants/:tenantId/ollama/api-key", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const s = getTenantOllamaApiKey(tenantId);
    res.json({ configured: !!s.apiKey, updatedAt: s.updatedAt });
  });

  app.put("/api/tenants/:tenantId/ollama/api-key", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const apiKey = String(req.body?.apiKey ?? "").trim();
    if (!apiKey || apiKey.length < 10 || apiKey.length > 4000) {
      throw new ApiError(400, "validation_error", "Invalid apiKey");
    }
    const saved = upsertTenantOllamaApiKey(tenantId, apiKey);
    auditAndInvalidate(tenantId, ["audit"], {
      action: "ollama_api_key_saved",
      entity: "tenant_secret",
      entityId: String(tenantId),
      detail: "Saved Ollama API key (stored server-side)",
      tokensUsed: 0,
      cost: 0,
    });
    res.json({ ok: true, configured: saved.configured, updatedAt: saved.updatedAt });
  });

  app.delete("/api/tenants/:tenantId/ollama/api-key", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const saved = upsertTenantOllamaApiKey(tenantId, null);
    auditAndInvalidate(tenantId, ["audit"], {
      action: "ollama_api_key_cleared",
      entity: "tenant_secret",
      entityId: String(tenantId),
      detail: "Cleared Ollama API key",
      tokensUsed: 0,
      cost: 0,
    });
    res.json({ ok: true, configured: saved.configured, updatedAt: saved.updatedAt });
  });

  // ─── OpenRouter API Key (per-tenant, stored server-side) ──────────────────
  app.get("/api/tenants/:tenantId/openrouter/api-key", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const s = getTenantOpenRouterApiKey(tenantId);
    res.json({ configured: !!s.apiKey, updatedAt: s.updatedAt });
  });

  app.put("/api/tenants/:tenantId/openrouter/api-key", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const apiKey = String(req.body?.apiKey ?? "").trim();
    if (!apiKey || apiKey.length < 10 || apiKey.length > 4000) {
      throw new ApiError(400, "validation_error", "Invalid apiKey");
    }
    const saved = upsertTenantOpenRouterApiKey(tenantId, apiKey);
    auditAndInvalidate(tenantId, ["audit"], {
      action: "openrouter_api_key_saved",
      entity: "tenant_secret",
      entityId: String(tenantId),
      detail: "Saved OpenRouter API key (stored server-side)",
      tokensUsed: 0,
      cost: 0,
    });
    res.json({ ok: true, configured: saved.configured, updatedAt: saved.updatedAt });
  });

  app.delete("/api/tenants/:tenantId/openrouter/api-key", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const saved = upsertTenantOpenRouterApiKey(tenantId, null);
    auditAndInvalidate(tenantId, ["audit"], {
      action: "openrouter_api_key_cleared",
      entity: "tenant_secret",
      entityId: String(tenantId),
      detail: "Cleared OpenRouter API key",
      tokensUsed: 0,
      cost: 0,
    });
    res.json({ ok: true, configured: saved.configured, updatedAt: saved.updatedAt });
  });

  app.post("/api/tenants", (req, res) => {
    const parsed = insertTenantSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));
    const { ceoLlmProvider, ceoModel, useCeoAgent, ...tenantData } = parsed.data as any;
    let t: any;
    try {
      t = storage.createTenant(tenantData);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const code = String(e?.code ?? "");
      if (code === "SQLITE_CONSTRAINT_UNIQUE" || msg.includes("UNIQUE constraint failed: tenants.slug")) {
        throw new ApiError(409, "slug_taken", "Organization slug is already in use. Choose a different name.", {
          slug: tenantData?.slug,
        });
      }
      throw e;
    }
    auditAndInvalidate(t.id, ["tenant"], {
      action: "org_created",
      entity: "tenant",
      entityId: String(t.id),
      detail: `Created organization "${t.name}"`,
      tokensUsed: 0,
      cost: 0,
    });

    // Be tolerant: some clients may send booleans as strings.
    const rawUseCeo = (req.body as any)?.useCeoAgent;
    const normalizedUseCeo =
      rawUseCeo === false || rawUseCeo === "false" || rawUseCeo === 0 || rawUseCeo === "0"
        ? false
        : rawUseCeo === true || rawUseCeo === "true" || rawUseCeo === 1 || rawUseCeo === "1"
          ? true
          : useCeoAgent;
    const ceoEnabled = normalizedUseCeo !== false;
    setCeoEnabled(t.id, ceoEnabled);
    if (ceoEnabled) {
      // Map the org adapter to per-agent adapter type + CLI command
      const orgAdapter = String(t.adapterType ?? "hermes");
      const cliAdapterMap: Record<string, { adapterType: "hermes" | "openclaw" | "cli"; command: string }> = {
        hermes: { adapterType: "hermes", command: "" },
        "claude-code": { adapterType: "cli", command: "claude" },
        codex: { adapterType: "cli", command: "codex" },
        "gemini-cli": { adapterType: "cli", command: "gemini" },
        opencode: { adapterType: "cli", command: "opencode" },
        cursor: { adapterType: "cli", command: "cursor" },
        openclaw: { adapterType: "openclaw", command: "" },
      };
      const mapped = cliAdapterMap[orgAdapter] ?? { adapterType: "hermes" as const, command: "" };

      try {
        createDefaultCeoForTenant(t.id, t.name, {
          llmProvider: ceoLlmProvider,
          model: ceoModel,
          adapterType: mapped.adapterType,
          command: mapped.command,
        });
      } catch (e: any) {
        throw new ApiError(
          500,
          "ceo_bootstrap_failed",
          "Organization was created but default CEO setup failed. Restart the server to repair, or delete this org and try again.",
          { cause: String(e?.message ?? e) },
        );
      }
    } else {
      // Safety net: ensure no CEO agent exists if disabled (handles legacy rows or partial failures).
      try {
        const existing = storage.getAgents(t.id);
        for (const a of existing) {
          if (String(a.role).toLowerCase() === "ceo") {
            storage.deleteAgent(a.id);
          }
        }
      } catch {
        // ignore
      }
    }

    // If CEO is disabled, also sanitize the starter task template to avoid "CEO" wording.
    // (This keeps the UX consistent even if the client sent an older description.)
    if (!ceoEnabled) {
      try {
        const tasks = storage.getTasks(t.id);
        for (const task of tasks) {
          if (!task?.description) continue;
          const desc = String(task.description);
          const next = desc
            .replace(/\bYou are the CEO\b[^\n]*\n?/gi, "")
            .replace(/\bCEO\b/gi, "")
            .trim();
          if (next !== desc) {
            storage.updateTask(task.id, { description: next } as any);
          }
        }
      } catch {
        // ignore
      }
    }

    invalidateTenantsList();
    res.json(t);
  });

  // ─── CEO Files (AGENTS/HEARTBEAT/SOUL/TOOLS) ───────────────────────────────
  app.get("/api/tenants/:tenantId/ceo/instructions/settings", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const s = storage.getCeoInstructionSettings(tenantId);
    res.json(s);
  });

  app.put("/api/tenants/:tenantId/ceo/instructions/settings", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const parsed = upsertCeoInstructionSettingsSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));
    const s = storage.upsertCeoInstructionSettings(tenantId, parsed.data);

    // External mode UX: ensure the entry file exists (and only that file is required).
    if (parsed.data.mode === "external") {
      try {
        ensureDir(parsed.data.rootPath);
        const entry = safeJoin(parsed.data.rootPath, parsed.data.entryFile || "AGENTS.md");
        if (!fs.existsSync(entry)) {
          writeFileUtf8(entry, "# Agent instructions\n\n");
        }
      } catch {
        // ignore: external path may not be writable
      }
    }

    auditAndInvalidate(tenantId, ["ceo_files"], {
      action: "ceo_instruction_settings_saved",
      entity: "ceo_instruction_settings",
      entityId: String(tenantId),
      detail: `Saved CEO instruction settings (${parsed.data.mode})`,
      tokensUsed: 0,
      cost: 0,
    });
    res.json({ ok: true, ...s });
  });

  app.get("/api/tenants/:tenantId/ceo/files", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const settings = storage.getCeoInstructionSettings(tenantId);
    const mode = settings.mode === "external" ? "external" : "managed";
    const ident = mode === "managed" ? storage.getOrCreatePaperclipIdentity(tenantId) : null;
    const rootPath = mode === "managed"
      ? managedRootPathForPaperclip(ident!.companyId, ident!.ceoPaperclipAgentId)
      : settings.rootPath;
    const entryFile = settings.entryFile || "AGENTS.md";

    const defaults: Record<string, string> = {
      "AGENTS.md": `You are the CEO. Your job is to lead the company, not to do individual contributor work.\nYou own strategy, prioritization, and cross-functional coordination.\n\n## Delegation (critical)\nYou MUST delegate work rather than doing it yourself.\n\nRouting rules:\n- Code, bugs, features, infra, devtools → CTO\n- Marketing, content, social media, growth, devrel → CMO\n- UX, design, user research, design-system → UXDesigner\n`,
      "HEARTBEAT.md": `# HEARTBEAT.md — CEO Heartbeat Checklist\n\nRun this checklist on every heartbeat.\n\n1. Identity and Context\n2. Local Planning Check\n3. Approval Follow-Up\n4. Get Assignments\n5. Delegation\n6. Exit\n`,
      "SOUL.md": `# SOUL.md — CEO Persona\n\n- Default to action\n- Delegate execution\n- Stay close to the customer\n`,
      "TOOLS.md": `# Tools\n\n(Your tools will go here. Add notes about them as you acquire and use them.)\n`,
    };

    if (!rootPath) throw new ApiError(400, "missing_root_path", "Root path is required");
    ensureDir(rootPath);

    // If managed mode: ensure on-disk bundle exists (mirror DB or defaults).
    if (mode === "managed") {
      const existingDb = storage.getCeoFiles(tenantId);
      if (existingDb.length === 0) {
        for (const [filename, markdown] of Object.entries(defaults)) {
          storage.upsertCeoFile(tenantId, filename, { filename, markdown });
        }
        auditAndInvalidate(tenantId, ["ceo_files"], {
          action: "ceo_files_created",
          entity: "ceo_files",
          entityId: String(tenantId),
          detail: "Backfilled default CEO instruction files",
          tokensUsed: 0,
          cost: 0,
        });
      }
      const dbFiles = storage.getCeoFiles(tenantId);
      for (const f of dbFiles) {
        const full = safeJoin(rootPath, f.filename);
        if (!fs.existsSync(full)) {
          writeFileUtf8(full, f.markdown);
        }
      }
    } else {
      // External: never seed defaults. Only show what's truly on disk.
    }

    let names = listMarkdownFiles(rootPath);
    if (mode === "external") {
      // External mode should expose ONLY the configured entry file in the UI,
      // even if the folder contains other markdown files.
      const want = entryFile || "AGENTS.md";
      names = names.filter((n) => n === want);
    }
    const now = new Date().toISOString();
    const out = names.map((filename) => {
      const full = safeJoin(rootPath, filename);
      const markdown = readFileUtf8(full);
      // Keep DB mirror in sync for Managed (and also useful for search/audit).
      if (mode === "managed") {
        storage.upsertCeoFile(tenantId, filename, { filename, markdown });
      }
      return { id: 0, tenantId, filename, markdown, updatedAt: now, rootPath, entryFile };
    });
    res.json(out);
  });

  app.put("/api/tenants/:tenantId/ceo/files/:filename", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const filename = String(req.params.filename || "");
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const settings = storage.getCeoInstructionSettings(tenantId);
    const mode = settings.mode === "external" ? "external" : "managed";
    const ident = mode === "managed" ? storage.getOrCreatePaperclipIdentity(tenantId) : null;
    const rootPath = mode === "managed"
      ? managedRootPathForPaperclip(ident!.companyId, ident!.ceoPaperclipAgentId)
      : settings.rootPath;
    if (!rootPath) throw new ApiError(400, "missing_root_path", "Root path is required");
    ensureDir(rootPath);

    const parsed = upsertCeoFileSchema.safeParse({ filename, markdown: req.body?.markdown });
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));
    const full = safeJoin(rootPath, filename);
    writeFileUtf8(full, parsed.data.markdown);
    const row =
      mode === "managed"
        ? storage.upsertCeoFile(tenantId, filename, parsed.data)
        : { id: 0, tenantId, filename, markdown: parsed.data.markdown, updatedAt: new Date().toISOString() };
    auditAndInvalidate(tenantId, ["ceo_files"], {
      action: "ceo_file_saved",
      entity: "ceo_file",
      entityId: filename,
      detail: `Saved ${filename}`,
      tokensUsed: 0,
      cost: 0,
    });
    res.json(row);
  });

  app.delete("/api/tenants/:tenantId/ceo/files/:filename", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const filename = String(req.params.filename || "");
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    const settings = storage.getCeoInstructionSettings(tenantId);
    const mode = settings.mode === "external" ? "external" : "managed";
    const ident = mode === "managed" ? storage.getOrCreatePaperclipIdentity(tenantId) : null;
    const rootPath = mode === "managed"
      ? managedRootPathForPaperclip(ident!.companyId, ident!.ceoPaperclipAgentId)
      : settings.rootPath;
    if (rootPath) {
      try {
        const full = safeJoin(rootPath, filename);
        deleteFileIfExists(full);
      } catch {
        // ignore
      }
    }
    if (mode === "managed") {
      storage.deleteCeoFile(tenantId, filename);
    }
    auditAndInvalidate(tenantId, ["ceo_files"], {
      action: "ceo_file_deleted",
      entity: "ceo_file",
      entityId: filename,
      detail: `Deleted ${filename}`,
      tokensUsed: 0,
      cost: 0,
    });
    res.json({ ok: true });
  });

  // ─── CEO Skills Library (Cortex skills) ────────────────────────────────────
  app.get("/api/tenants/:tenantId/ceo/skills", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    ensureCortexSkillsTables();
    const rows = db.all(sql`
      SELECT
        l.slug as slug,
        l.name as name,
        l.updated_at as updatedAt,
        COALESCE(t.selected, 1) as selected
      FROM cortex_skills_library l
      LEFT JOIN tenant_cortex_skills t
        ON t.slug = l.slug AND t.tenant_id = ${tenantId}
      ORDER BY l.slug ASC
    `) as any[];
    const required = new Set(["cortex", "cortex-create-agent", "cortex-create-plugin", "para-memory-files"]);
    res.json(rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      required: required.has(r.slug),
      selected: required.has(r.slug) ? true : !!r.selected,
      updatedAt: r.updatedAt,
    })));
  });

  app.get("/api/tenants/:tenantId/ceo/skills/:slug", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const slug = String(req.params.slug || "");
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    ensureCortexSkillsTables();
    const row = db.get(sql`
      SELECT slug, name, markdown, updated_at as updatedAt
      FROM cortex_skills_library
      WHERE slug = ${slug}
    `) as any | undefined;
    if (!row) throw new ApiError(404, "not_found", "Skill not found");
    res.json({ slug: row.slug, name: row.name, markdown: row.markdown, updatedAt: row.updatedAt });
  });

  app.patch("/api/tenants/:id", (req, res) => {
    const id = Number(req.params.id);
    const parsed = patchTenantSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));
    const t = storage.updateTenant(id, parsed.data);
    if (!t) throw new ApiError(404, "not_found", "Tenant not found");
    auditAndInvalidate(id, ["tenant"], {
      action: "org_updated",
      entity: "tenant",
      entityId: String(id),
      detail: "Organization settings updated",
      tokensUsed: 0,
      cost: 0,
    });
    invalidateTenant(id, ["tenant"]);
    invalidateTenantsList();
    res.json(t);
  });
  app.delete("/api/tenants/:id", (req, res) => {
    const id = Number(req.params.id);
    invalidateTenant(id, ["agents", "tasks", "goals", "messages", "teams", "audit", "tenant"]);
    auditAndInvalidate(id, ["tenant", "agents", "tasks", "goals", "messages", "teams", "audit"], {
      action: "org_deleted",
      entity: "tenant",
      entityId: String(id),
      detail: "Organization deleted",
      tokensUsed: 0,
      cost: 0,
    });
    storage.deleteTenant(id);
    invalidateTenantsList();
    res.json({ ok: true });
  });

  // ─── Agent Definitions ────────────────────────────────────────────────────
  app.get("/api/agent-definitions", (req, res) => res.json(storage.getAgentDefinitions()));

  app.post("/api/agent-definitions", (req, res) => {
    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError(400, "validation_error", "name is required");
    const data = {
      name,
      emoji: String(body.emoji ?? "🤖").trim(),
      division: String(body.division ?? "Custom").trim(),
      specialty: String(body.specialty ?? "").trim(),
      description: String(body.description ?? "").trim(),
      whenToUse: String(body.whenToUse ?? "").trim(),
      source: "custom" as const,
      color: String(body.color ?? "#6366f1").trim(),
    };
    const def = storage.createAgentDefinition(data);
    res.status(201).json(def);
  });
  app.get("/api/agent-definitions/division/:division", (req, res) =>
    res.json(storage.getAgentDefinitionsByDivision(req.params.division))
  );
  app.get("/api/agent-definitions/:id/skills", async (req, res) => {
    const id = Number(req.params.id);
    const def = storage.getAgentDefinition(id);
    if (!def) throw new ApiError(404, "not_found", "Agent definition not found");

    const outRoot = path.join(process.cwd(), "agent-library", "agent-definitions");
    const folder = `${slugify(def.name)}__${def.id}`;
    const skillsPath = path.join(outRoot, folder, "skills.md");

    const tenantId = Number(req.query.tenantId);
    if (!Number.isFinite(tenantId) || !storage.getTenant(tenantId)) {
      // Preserve old behavior when no tenant is provided.
      try {
        const md = await fs.promises.readFile(skillsPath, "utf-8");
        res.json({ markdown: md, source: "file" });
        return;
      } catch {
        res.json({
          markdown: renderDefinitionSkillsMd({
            id: def.id,
            name: def.name,
            division: def.division,
            specialty: def.specialty,
            description: def.description,
            whenToUse: def.whenToUse,
            source: def.source,
          }),
          source: "generated",
        });
        return;
      }
    }

    const effective = await getEffectiveDefinitionSkills(tenantId, def.id);
    res.json(effective);
  });

  app.get("/api/agent-definitions/:id/docs", async (req, res) => {
    const id = Number(req.params.id);
    const def = storage.getAgentDefinition(id);
    if (!def) throw new ApiError(404, "not_found", "Agent definition not found");
    const { getAgentDocs } = await import("./skillsRuntime");
    const docs = await getAgentDocs(id);
    if (!docs) throw new ApiError(404, "not_found", "Agent docs not found");
    res.json(docs);
  });

  app.put("/api/tenants/:tenantId/agent-definitions/:definitionId/skills", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const definitionId = Number(req.params.definitionId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    if (!storage.getAgentDefinition(definitionId)) throw new ApiError(404, "not_found", "Agent definition not found");

    const parsed = upsertAgentDefinitionSkillsSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));

    const row = storage.upsertAgentDefinitionSkills(tenantId, definitionId, parsed.data);
    auditAndInvalidate(tenantId, ["audit"], {
      action: "skills_updated",
      entity: "agent_definition",
      entityId: String(definitionId),
      detail: "Updated Agent Library skills.md",
      tokensUsed: 0,
      cost: 0,
    });
    invalidateTenant(tenantId, ["tenant"]);
    res.json({ ok: true, ...row });
  });

  // Runtime context: adapters use this to run agents with the exact skills.md.
  app.get("/api/tenants/:tenantId/agents/:agentId/runtime-context", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    const agent = storage.getAgent(agentId);
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");
    const def = storage.getAgentDefinition(agent.definitionId);
    if (!def) throw new ApiError(404, "not_found", "Agent definition not found");

    const skills = await getEffectiveDefinitionSkills(tenantId, def.id);
    ensureAgentConfigurationTables();
    const runtime = getAgentRuntimeSettings(agentId);
    const systemPrompt = await buildAgentSystemPrompt(tenantId, agentId);

    res.json({
      tenant: { id: tenant.id, name: tenant.name, adapterType: tenant.adapterType },
      agent,
      definition: def,
      skills,
      runtime,
      systemPrompt,
    });
  });

  // In-app run: Hermes (LLM loop) or OpenClaw (recorded run + gateway-oriented message). Same URL for UI parity.
  app.post("/api/tenants/:tenantId/agents/:agentId/hermes/run-once", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const tenantRow = storage.getTenant(tenantId);
    if (!tenantRow) throw new ApiError(404, "not_found", "Tenant not found");

    const result = await dispatchAgentRun(tenantId, agentId, { reason: "manual" });
    if (!result.ok) {
      throw new ApiError(400, "cannot_run", `Run failed (${result.adapter}): ${result.reason ?? result.error ?? "unknown"}`);
    }
    auditAndInvalidate(tenantId, ["agents", "tasks", "messages", "goals"], {
      agentId,
      agentName: storage.getAgent(agentId)?.displayName ?? undefined,
      action: `${result.adapter}_run_once`,
      entity: "agent",
      entityId: String(agentId),
      detail: `Run completed via ${result.adapter} adapter`,
      tokensUsed: result.tokensUsed ?? 0,
      cost: result.costUsd ?? 0,
    });
    res.json(result);
  });

  // ─── Agents ───────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/agents", (req, res) =>
    res.json(storage.getAgents(Number(req.params.tenantId)))
  );
  app.post("/api/tenants/:tenantId/agents", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    // Enforce agent cap
    const current = storage.getAgents(tenantId);
    if (current.length >= tenant.maxAgents) {
      throw new ApiError(
        403,
        "agent_limit_reached",
        `Agent limit reached. This organization is capped at ${tenant.maxAgents} agents. Ask your admin to raise the limit in Settings.`,
        { limit: tenant.maxAgents, current: current.length },
      );
    }
    const hireBody: Record<string, unknown> = { ...(req.body as object), tenantId };
    const llmProvider = normalizeLlmRouting(hireBody.llmProvider);
    delete hireBody.llmProvider;
    const rawAdapterType = String(hireBody.adapterType ?? "hermes").toLowerCase();
    delete hireBody.adapterType;
    const rawCommand = String(hireBody.command ?? "").trim();
    delete hireBody.command;
    const rawModel = String(hireBody.runtimeModel ?? "").trim();
    delete hireBody.runtimeModel;
    const rawThinkingEffort = String(hireBody.thinkingEffort ?? "auto");
    delete hireBody.thinkingEffort;
    const rawExtraArgs = String(hireBody.extraArgs ?? "");
    delete hireBody.extraArgs;
    const rawHeartbeatEnabled = hireBody.heartbeatEnabled !== undefined ? !!hireBody.heartbeatEnabled : true;
    delete hireBody.heartbeatEnabled;

    const parsed = insertAgentSchema.safeParse(hireBody);
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));

    // Auto-assign to CEO if no manager specified
    if (!parsed.data.managerId) {
      const existing = storage.getAgents(tenantId);
      const ceo = existing.find((a) => a.role === "CEO");
      if (ceo) parsed.data.managerId = ceo.id;
    }

    const agent = storage.createAgent(parsed.data);
    ensureAgentConfigurationTables();

    const adapterType = (["hermes", "openclaw", "cli"].includes(rawAdapterType) ? rawAdapterType : "hermes") as any;
    upsertAgentRuntimeSettings(agent.id, {
      llmProvider,
      adapterType,
      command: rawCommand,
      model: rawModel,
      thinkingEffort: (["auto", "low", "medium", "high"].includes(rawThinkingEffort) ? rawThinkingEffort : "auto") as any,
      extraArgs: rawExtraArgs,
      heartbeatEnabled: rawHeartbeatEnabled,
    });
    auditAndInvalidate(tenantId, ["agents"], {
      agentId: agent.id,
      agentName: agent.displayName,
      action: "agent_hired",
      entity: "agent",
      entityId: String(agent.id),
      detail: `Deployed ${agent.displayName} as ${agent.role}`,
      tokensUsed: 0,
      cost: 0,
    });
    if (String(agent.status) === "running") {
      void (async () => {
        try {
          await dispatchAgentRun(tenantId, agent.id, { reason: "start" });
        } catch {
          // ignore
        }
      })();
    }
    res.json(agent);
  });

  // Agent configuration (profile + runtime settings + API keys)
  app.get("/api/tenants/:tenantId/agents/:agentId/configuration", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const agent = storage.getAgent(agentId);
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");
    ensureAgentConfigurationTables();
    // Ensure a row exists so defaults are materialized in DB.
    upsertAgentRuntimeSettings(agentId, {});
    res.json({
      profile: getAgentProfile(agentId),
      runtime: getAgentRuntimeSettings(agentId),
      apiKeys: listAgentApiKeys(agentId),
    });
  });

  app.put("/api/tenants/:tenantId/agents/:agentId/configuration", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const agent = storage.getAgent(agentId);
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");
    ensureAgentConfigurationTables();

    const body: any = req.body ?? {};
    if (body.profile) upsertAgentProfile(agentId, body.profile);
    if (body.runtime) {
      upsertAgentRuntimeSettings(agentId, body.runtime);

      // Make heartbeat controls "real": sync to agent status + cron schedule
      if (body.runtime.heartbeatEverySec !== undefined) {
        const cron = secondsToCron(Number(body.runtime.heartbeatEverySec));
        storage.updateAgent(agentId, { heartbeatSchedule: cron });
      }
      if (body.runtime.heartbeatEnabled !== undefined) {
        const enabled = !!body.runtime.heartbeatEnabled;
        const nextStatus = enabled ? "running" : (agent.status === "terminated" ? "terminated" : "idle");
        storage.updateAgent(agentId, { status: nextStatus });
      }
    }

    auditAndInvalidate(tenantId, ["agents"], {
      agentId,
      agentName: agent.displayName,
      action: "agent_config_updated",
      entity: "agent",
      entityId: String(agentId),
      detail: "Updated agent runtime settings",
      tokensUsed: 0,
      cost: 0,
    });
    res.json({
      profile: getAgentProfile(agentId),
      runtime: getAgentRuntimeSettings(agentId),
      apiKeys: listAgentApiKeys(agentId),
    });
  });

  app.post("/api/tenants/:tenantId/agents/:agentId/api-keys", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const agent = storage.getAgent(agentId);
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");
    ensureAgentConfigurationTables();
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw new ApiError(400, "validation_error", "Key name required");
    const created = createAgentApiKey(agentId, name);
    auditAndInvalidate(tenantId, ["agents"], {
      agentId,
      agentName: agent.displayName,
      action: "api_key_created",
      entity: "agent_api_key",
      entityId: String(agentId),
      detail: `Created API key "${name}"`,
      tokensUsed: 0,
      cost: 0,
    });
    res.json({ token: created.token, last4: created.last4, createdAt: created.createdAt });
  });

  // Test environment: verify adapter + run policy + (Hermes) dry run
  app.post("/api/tenants/:tenantId/agents/:agentId/test-environment", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    const agent = storage.getAgent(agentId);
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");

    ensureAgentConfigurationTables();
    // materialize defaults
    upsertAgentRuntimeSettings(agentId, {});
    const runtime = getAgentRuntimeSettings(agentId);

    const modelId = (runtime.model || "").trim() || agent.model;
    const tenantKey = getTenantOllamaApiKey(tenantId);
    const tenantOrKey = getTenantOpenRouterApiKey(tenantId);
    const llm = getLlmServerStatus(runtime.llmProvider, modelId, tenant.ollamaBaseUrl, {
      ollamaApiKeyConfigured: !!tenantKey.apiKey,
      openRouterApiKeyConfigured: !!tenantOrKey.apiKey,
    });

    let result: any = {
      ok: true,
      adapterType: tenant.adapterType,
      runtime,
      llm,
    };
    const run = await dispatchAgentRun(tenantId, agentId, { reason: "manual" });
    result = { ...result, run };
    if (!run.ok) result.ok = false;

    auditAndInvalidate(tenantId, ["audit", "agents", "messages", "tasks", "goals"], {
      agentId,
      agentName: agent.displayName,
      action: "test_environment",
      entity: "agent",
      entityId: String(agentId),
      detail: tenant.adapterType === "hermes" ? "Tested Hermes environment (run-once)" : "Tested environment settings",
      tokensUsed: 0,
      cost: 0,
    });

    res.json(result);
  });

  // Runs log (real)
  app.get("/api/tenants/:tenantId/agents/:agentId/runs", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    const agent = storage.getAgent(agentId);
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");
    ensureAgentRunsTables();
    res.json(listAgentRuns(tenantId, agentId, Number(req.query.limit ?? 50)));
  });

  app.get("/api/tenants/:tenantId/agents/:agentId/runs/:runId", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const runId = Number(req.params.runId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    const agent = storage.getAgent(agentId);
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");
    ensureAgentRunsTables();
    const run = getAgentRun(runId);
    if (!run || run.tenantId !== tenantId || run.agentId !== agentId) throw new ApiError(404, "not_found", "Run not found");
    res.json({ run, events: getRunEvents(runId) });
  });

  // Agent budget (real)
  app.get("/api/tenants/:tenantId/agents/:agentId/budget", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    const agent = storage.getAgent(agentId);
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");

    ensureAgentBudgetTables();
    const settings = getAgentBudgetSettings(agentId);
    const spent = agent.spentThisMonth ?? 0;
    const cap = settings.enabled ? (settings.capUsd ?? agent.monthlyBudget ?? null) : null;
    const remaining = cap != null ? Math.max(0, cap - spent) : null;
    const health =
      cap == null
        ? "healthy"
        : spent / Math.max(1, cap) >= settings.softAlertPct
          ? "warning"
          : "healthy";

    res.json({
      settings,
      observed: { spentUsd: spent, capUsd: cap, remainingUsd: remaining },
      health,
    });
  });

  app.put("/api/tenants/:tenantId/agents/:agentId/budget", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    const agent = storage.getAgent(agentId);
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");

    ensureAgentBudgetTables();
    const enabled = req.body?.enabled;
    const capUsd = req.body?.capUsd;
    const softAlertPct = req.body?.softAlertPct;
    const next = updateAgentBudgetSettings(agentId, { enabled, capUsd, softAlertPct });

    // Keep legacy agent.monthlyBudget in sync when a cap is configured.
    if (next.enabled && next.capUsd != null) {
      storage.updateAgent(agentId, { monthlyBudget: Number(next.capUsd) } as any);
    }

    auditAndInvalidate(tenantId, ["agents", "audit"], {
      agentId,
      agentName: agent.displayName,
      action: "budget_updated",
      entity: "agent_budget",
      entityId: String(agentId),
      detail: next.enabled ? `Budget cap enabled (${next.capUsd ?? "—"})` : "Budget cap disabled",
      tokensUsed: 0,
      cost: 0,
    });

    res.json({ ok: true, settings: next });
  });

  // CEO control: "agent" vs "me"
  app.get("/api/tenants/:tenantId/ceo/control", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    ensureCeoControlTable();
    const s = getCeoControlSettings(tenantId);
    res.json({ tenantId, enabled: s.enabled, mode: s.mode, updatedAt: s.updatedAt });
  });

  app.put("/api/tenants/:tenantId/ceo/control", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    ensureCeoControlTable();
    const requestedEnabled = req.body?.enabled;
    const enabled = typeof requestedEnabled === "boolean" ? requestedEnabled : undefined;
    const mode = String(req.body?.mode ?? getCeoControlMode(tenantId)) === "me" ? "me" : "agent";

    if (enabled === false) {
      setCeoEnabled(tenantId, false);
      // Safety: delete any CEO agent rows if disabling.
      try {
        const agents = storage.getAgents(tenantId);
        for (const a of agents) {
          if (String(a.role).toLowerCase() === "ceo") storage.deleteAgent(a.id);
        }
      } catch {
        // ignore
      }
    } else if (enabled === true) {
      setCeoEnabled(tenantId, true);
    }

    const saved = setCeoControlMode(tenantId, mode);

    // Side effects: if CEO is "me", pause/disable automated runs; if "agent", re-enable.
    const ceo = storage.getAgents(tenantId).find((a) => String(a.role).toLowerCase() === "ceo") ?? null;
    if (ceo) {
      if (mode === "me") {
        upsertAgentRuntimeSettings(ceo.id, { heartbeatEnabled: false });
        storage.updateAgent(ceo.id, { status: "paused" } as any);
      } else {
        upsertAgentRuntimeSettings(ceo.id, { heartbeatEnabled: true });
        storage.updateAgent(ceo.id, { status: "running" } as any);
      }
    }

    auditAndInvalidate(tenantId, ["audit", "agents"], {
      action: "ceo_control_updated",
      entity: "ceo_control",
      entityId: String(tenantId),
      detail:
        enabled === false
          ? "CEO disabled"
          : enabled === true
            ? "CEO enabled"
            : mode === "me"
              ? "CEO is now controlled by you"
              : "CEO returned to agent control",
      tokensUsed: 0,
      cost: 0,
      agentId: ceo?.id ?? null,
      agentName: ceo?.displayName ?? null,
    } as any);

    res.json({ ok: true, ...saved });
  });

  app.patch("/api/agents/:id", async (req, res) => {
    const id = Number(req.params.id);
    const prev = storage.getAgent(id);
    const a = storage.updateAgent(id, req.body);
    if (!a) throw new ApiError(404, "not_found", "Agent not found");
    const statusNote =
      req.body?.status != null && prev?.status !== req.body.status
        ? `Status: ${prev?.status} → ${req.body.status}`
        : "Agent updated";
    auditAndInvalidate(a.tenantId, ["agents"], {
      agentId: a.id,
      agentName: a.displayName,
      action: "agent_updated",
      entity: "agent",
      entityId: String(a.id),
      detail: statusNote,
      tokensUsed: 0,
      cost: 0,
    });

    const becameRunning = req.body?.status === "running" && prev?.status !== "running";
    if (becameRunning) {
      void (async () => {
        try {
          await dispatchAgentRun(a.tenantId, a.id, { reason: "start" });
        } catch {
          // don't block status updates if the run fails
        }
      })();
    }
    res.json(a);
  });
  app.delete("/api/agents/:id", (req, res) => {
    const id = Number(req.params.id);
    const agent = storage.getAgent(id);
    if (!agent) throw new ApiError(404, "not_found", "Agent not found");
    const isCeo = String(agent.role).toLowerCase() === "ceo";
    auditAndInvalidate(agent.tenantId, ["agents", "teams"], {
      agentId: agent.id,
      agentName: agent.displayName,
      action: "agent_deleted",
      entity: "agent",
      entityId: String(agent.id),
      detail: `Removed ${agent.displayName}`,
      tokensUsed: 0,
      cost: 0,
    });
    storage.deleteAgent(id);
    if (isCeo) {
      // If CEO is deleted, mark CEO disabled so bootstrap repair won't recreate it.
      setCeoEnabled(agent.tenantId, false);
    }
    res.json({ ok: true });
  });

  app.post("/api/agents/:id/heartbeat", (req, res) => {
    const id = Number(req.params.id);
    const agent = storage.getAgent(id);
    if (!agent) throw new ApiError(404, "not_found", "Agent not found");
    const body = req.body ?? {};
    const detail = typeof body.detail === "string" ? body.detail : "Heartbeat: agent checked in";
    const tokensUsed = Number(body.tokensUsed) || 0;
    const cost = Number(body.cost) || 0;
    const now = new Date().toISOString();
    const nextSpent = cost > 0 ? agent.spentThisMonth + cost : agent.spentThisMonth;
    storage.updateAgent(id, { lastHeartbeat: now, ...(cost > 0 ? { spentThisMonth: nextSpent } : {}) });
    const updated = storage.getAgent(id);
    if (!updated) throw new ApiError(404, "not_found", "Agent not found");
    auditAndInvalidate(agent.tenantId, ["agents"], {
      agentId: id,
      agentName: agent.displayName,
      action: "heartbeat",
      entity: "agent",
      entityId: String(id),
      detail,
      tokensUsed,
      cost,
    });
    res.json(updated);
  });

  // ─── Teams ────────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/teams", (req, res) =>
    res.json(storage.getTeams(Number(req.params.tenantId)))
  );
  app.post("/api/tenants/:tenantId/teams", (req, res) => {
    const parsed = insertTeamSchema.safeParse({ ...req.body, tenantId: Number(req.params.tenantId) });
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));
    const team = storage.createTeam(parsed.data);
    auditAndInvalidate(team.tenantId, ["teams"], {
      action: "team_created",
      entity: "team",
      entityId: String(team.id),
      detail: `Created team "${team.name}"`,
      tokensUsed: 0,
      cost: 0,
    });
    res.json(team);
  });
  app.patch("/api/teams/:id", (req, res) => {
    const t = storage.updateTeam(Number(req.params.id), req.body);
    if (!t) throw new ApiError(404, "not_found", "Team not found");
    auditAndInvalidate(t.tenantId, ["teams"], {
      action: "team_updated",
      entity: "team",
      entityId: String(t.id),
      detail: "Team settings updated",
      tokensUsed: 0,
      cost: 0,
    });
    res.json(t);
  });
  app.delete("/api/teams/:id", (req, res) => {
    const id = Number(req.params.id);
    const team = storage.getTeam(id);
    if (!team) throw new ApiError(404, "not_found", "Team not found");
    auditAndInvalidate(team.tenantId, ["teams", "agents"], {
      action: "team_deleted",
      entity: "team",
      entityId: String(id),
      detail: `Deleted team "${team.name}"`,
      tokensUsed: 0,
      cost: 0,
    });
    storage.deleteTeam(id);
    res.json({ ok: true });
  });

  // ─── Team Members ─────────────────────────────────────────────────────────
  app.get("/api/teams/:teamId/members", (req, res) =>
    res.json(storage.getTeamMembers(Number(req.params.teamId)))
  );
  app.post("/api/teams/:teamId/members", (req, res) => {
    const parsed = insertTeamMemberSchema.safeParse({ teamId: Number(req.params.teamId), agentId: req.body.agentId });
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));
    const m = storage.addTeamMember(parsed.data);
    const team = storage.getTeam(m.teamId);
    const agent = storage.getAgent(m.agentId);
    if (team) {
      auditAndInvalidate(team.tenantId, ["teams", "agents"], {
        agentId: m.agentId,
        agentName: agent?.displayName ?? undefined,
        action: "team_member_added",
        entity: "team",
        entityId: String(m.teamId),
        detail: agent ? `${agent.displayName} joined the team` : "Agent joined team",
        tokensUsed: 0,
        cost: 0,
      });
    }
    res.json(m);
  });
  app.delete("/api/teams/:teamId/members/:agentId", (req, res) => {
    const teamId = Number(req.params.teamId);
    const agentId = Number(req.params.agentId);
    const team = storage.getTeam(teamId);
    const agent = storage.getAgent(agentId);
    storage.removeTeamMember(teamId, agentId);
    if (team) {
      auditAndInvalidate(team.tenantId, ["teams", "agents"], {
        agentId,
        agentName: agent?.displayName ?? undefined,
        action: "team_member_removed",
        entity: "team",
        entityId: String(teamId),
        detail: agent ? `${agent.displayName} left the team` : "Agent removed from team",
        tokensUsed: 0,
        cost: 0,
      });
    }
    res.json({ ok: true });
  });

  // ─── Team Instruction Files (markdown) ────────────────────────────────────
  // Stored on disk (no DB migration): `team-instructions/tenant-{tid}/team-{teamId}/*.md`
  function teamInstructionsRoot(tenantId: number, teamId: number) {
    return path.resolve("team-instructions", `tenant-${tenantId}`, `team-${teamId}`);
  }

  function safeSlug(raw: string) {
    return String(raw || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "item";
  }

  type TeamLock = { locked: boolean; owner?: string; lockedAt?: string };
  function teamLockPath(tenantId: number, teamId: number) {
    return safeJoin(teamInstructionsRoot(tenantId, teamId), ".lock.json");
  }
  function readTeamLock(tenantId: number, teamId: number): TeamLock {
    try {
      const p = teamLockPath(tenantId, teamId);
      if (!fs.existsSync(p)) return { locked: false };
      const raw = readFileUtf8(p);
      const obj = JSON.parse(raw || "{}") as TeamLock;
      if (!obj || !obj.locked) return { locked: false };
      return { locked: true, owner: obj.owner, lockedAt: obj.lockedAt };
    } catch {
      return { locked: false };
    }
  }
  function writeTeamLock(tenantId: number, teamId: number, lock: TeamLock) {
    const root = teamInstructionsRoot(tenantId, teamId);
    ensureDir(root);
    writeFileUtf8(teamLockPath(tenantId, teamId), JSON.stringify(lock, null, 2));
  }

  app.get("/api/tenants/:tenantId/teams/:teamId/files", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const teamId = Number(req.params.teamId);
    const tenant = storage.getTenant(tenantId);
    const team = storage.getTeam(teamId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    if (!team || team.tenantId !== tenantId) throw new ApiError(404, "not_found", "Team not found");

    const rootPath = teamInstructionsRoot(tenantId, teamId);
    ensureDir(rootPath);

    const buildDefaults = (t: { name: string; description?: string | null }) => {
      const name = String(t.name || "Team");
      const desc = String(t.description || "").trim();
      const key = `${name} ${desc}`.toLowerCase();

      const sharedHeader = `# Team: ${name}\n\n${desc ? `> ${desc}\n\n` : ""}`;

      const teamBase = (focusBullets: string[], interfacesBullets: string[], cadenceBullets: string[], artifactsBullets: string[]) =>
        `${sharedHeader}## Focus\n${focusBullets.map((b) => `- ${b}`).join("\n")}\n\n## Interfaces\n${interfacesBullets.map((b) => `- ${b}`).join("\n")}\n\n## Cadence\n${cadenceBullets.map((b) => `- ${b}`).join("\n")}\n\n## Artifacts\n${artifactsBullets.map((b) => `- ${b}`).join("\n")}\n\n## Operating principles\n- Keep updates concise\n- Escalate blockers early\n- Prefer measurable outputs\n- Document decisions\n`;

      if (key.includes("financ") || key.includes("fp&a") || key.includes("treasury") || key.includes("account")) {
        return {
          "TEAM.md": teamBase(
            ["Forecasting, runway, and board-ready financial reporting", "Covenants, cash, and spend visibility"],
            ["CEO / leadership for decisions", "Engineering for cost drivers + product metrics", "Vendors/banks for treasury ops"],
            ["Weekly: forecast refresh + risks", "Monthly: close + board pack draft", "Ad-hoc: scenario modeling"],
            ["Forecast model + assumptions table", "Runway memo", "Board-ready KPI dashboard", "Risk register (finance)"],
          ),
          "INSTRUCTIONS.md": `# Instructions — Finance\n\n## Primary outcomes\n- Accurate forecast (weekly / monthly)\n- Runway + burn clarity\n- Board-ready reporting\n- Risk & compliance hygiene\n\n## How to execute tasks\n- Start with assumptions and inputs\n- Show calculations and checks\n- Provide a clear narrative summary\n- Include a table for numbers whenever possible\n\n## What to report back in Collaboration\n- Current state + key numbers\n- Decisions needed (with options)\n- Risks / blockers and mitigation\n- Next steps + owner\n`,
        };
      }

      if (key.includes("engineer") || key.includes("product") || key.includes("build") || key.includes("platform")) {
        return {
          "TEAM.md": teamBase(
            ["Ship product features safely and quickly", "Keep APIs stable and the system reliable"],
            ["CEO / leadership for priorities", "Finance for metrics + constraints", "Support for customer feedback"],
            ["Daily: short async updates in team channel", "Weekly: planning + review", "On-demand: incident response"],
            ["PRDs / acceptance criteria (as markdown)", "Release notes", "Runbooks", "Architecture notes"],
          ),
          "INSTRUCTIONS.md": `# Instructions — Engineering\n\n## Primary outcomes\n- Ship working features safely\n- Maintain reliability + performance\n- Keep APIs and data consistent\n\n## How to execute tasks\n- Clarify acceptance criteria\n- Implement smallest working slice\n- Add tests where practical\n- Provide runnable steps and file outputs\n\n## What to report back in Collaboration\n- What shipped (with links/files)\n- What’s blocked and why\n- Risks / edge cases\n- Follow-ups and ownership\n`,
        };
      }

      if (key.includes("health") || key.includes("wellness") || key.includes("people") || key.includes("hr")) {
        return {
          "TEAM.md": teamBase(
            ["Employee wellness programs and measurable outcomes", "Safe, evidence-based guidance (non-medical)"],
            ["CEO / leadership for sponsorship", "Legal/Compliance for privacy + safety constraints", "All teams as stakeholders"],
            ["Weekly: program update + participation metrics", "Monthly: survey insights + experiments", "Quarterly: program review"],
            ["Wellness program playbook", "Survey instruments + analysis plan", "KPI dashboard spec", "Safety/privacy checklist"],
          ),
          "INSTRUCTIONS.md": `# Instructions — Health & Wellness\n\n## Primary outcomes\n- Increase participation in wellness programs\n- Improve self-reported wellbeing (survey)\n- Provide safe, evidence-based guidance\n- Respect privacy and compliance constraints\n\n## How to execute tasks\n- Prefer evidence-based recommendations\n- Avoid medical diagnosis; add safety disclaimers when needed\n- Make programs measurable (baseline → goal → tracking)\n- Keep materials concise and reusable (markdown playbooks)\n\n## What to report back in Collaboration\n- Program plan + key deliverables\n- Participation metrics + survey insights\n- Risks (privacy/safety) + mitigations\n- Next experiments + timeline\n`,
        };
      }

      return {
        "TEAM.md": teamBase(
          ["Define what this team owns", "Define what success means and how it’s measured"],
          ["Other teams that depend on us", "Teams we depend on"],
          ["Weekly: plan + review", "Monthly: metrics check-in"],
          ["Playbook (how we work)", "Metrics + dashboards", "Decision log"],
        ),
        "INSTRUCTIONS.md": `# Instructions\n\n## Primary outcomes\n- Define what this team owns\n- Define success metrics\n\n## How to execute tasks\n- Keep scope tight\n- Produce concrete outputs\n- Validate assumptions\n\n## What to report back in Collaboration\n- Progress + blockers\n- Deliverables + next steps\n`,
      };
    };

    const defaults: Record<string, string> = buildDefaults(team);

    // Backfill defaults if folder is empty, or if files still match the old generic defaults.
    const existing = listMarkdownFiles(rootPath);
    if (existing.length === 0) {
      for (const [filename, markdown] of Object.entries(defaults)) {
        writeFileUtf8(safeJoin(rootPath, filename), markdown);
      }
      auditAndInvalidate(tenantId, ["teams"], {
        action: "team_files_created",
        entity: "team",
        entityId: String(teamId),
        detail: `Created default instruction files for team "${team.name}"`,
        tokensUsed: 0,
        cost: 0,
      });
    } else {
      const oldGenericTeam = `# Team: ${team.name}\n\n## Focus\nDescribe what this team owns and what “good” looks like.\n\n## Operating principles\n- Keep updates concise\n- Escalate blockers early\n- Prefer measurable outputs\n`;
      const oldGenericInstructions = `# Instructions\n\n- Primary outcomes this team is responsible for\n- How tasks should be executed\n- What to report back in Collaboration\n`;

      try {
        const teamPath = safeJoin(rootPath, "TEAM.md");
        const instPath = safeJoin(rootPath, "INSTRUCTIONS.md");
        if (fs.existsSync(teamPath)) {
          const cur = readFileUtf8(teamPath);
          const isOldTeam =
            cur.trim() === oldGenericTeam.trim() ||
            // upgrade earlier "baseTeam" variant that was identical across teams
            (!cur.includes("## Interfaces") && cur.includes("## Focus") && cur.includes("## Operating principles"));
          if (isOldTeam) writeFileUtf8(teamPath, defaults["TEAM.md"]!);
        }
        if (fs.existsSync(instPath)) {
          const cur = readFileUtf8(instPath);
          if (cur.trim() === oldGenericInstructions.trim()) writeFileUtf8(instPath, defaults["INSTRUCTIONS.md"]!);
        }
      } catch {
        // best-effort
      }
    }

    const now = new Date().toISOString();
    const names = listMarkdownFiles(rootPath);
    const out = names
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((filename) => ({
        id: 0,
        tenantId,
        teamId,
        filename,
        markdown: readFileUtf8(safeJoin(rootPath, filename)),
        updatedAt: now,
      }));
    res.json(out);
  });

  // Team lock (prevents other users from editing team files)
  app.get("/api/tenants/:tenantId/teams/:teamId/lock", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const teamId = Number(req.params.teamId);
    const tenant = storage.getTenant(tenantId);
    const team = storage.getTeam(teamId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    if (!team || team.tenantId !== tenantId) throw new ApiError(404, "not_found", "Team not found");
    ensureDir(teamInstructionsRoot(tenantId, teamId));
    res.json(readTeamLock(tenantId, teamId));
  });

  app.post("/api/tenants/:tenantId/teams/:teamId/lock", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const teamId = Number(req.params.teamId);
    const tenant = storage.getTenant(tenantId);
    const team = storage.getTeam(teamId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    if (!team || team.tenantId !== tenantId) throw new ApiError(404, "not_found", "Team not found");
    const owner = String(req.body?.owner || "").trim() || "unknown";
    const cur = readTeamLock(tenantId, teamId);
    if (cur.locked && cur.owner && cur.owner !== owner) throw new ApiError(423, "locked", `Team is locked by ${cur.owner}`);
    const next: TeamLock = { locked: true, owner, lockedAt: new Date().toISOString() };
    writeTeamLock(tenantId, teamId, next);
    auditAndInvalidate(tenantId, ["teams"], {
      action: "team_locked",
      entity: "team",
      entityId: String(teamId),
      detail: `Team "${team.name}" locked by ${owner}`,
      tokensUsed: 0,
      cost: 0,
    });
    res.json(next);
  });

  app.delete("/api/tenants/:tenantId/teams/:teamId/lock", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const teamId = Number(req.params.teamId);
    const tenant = storage.getTenant(tenantId);
    const team = storage.getTeam(teamId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    if (!team || team.tenantId !== tenantId) throw new ApiError(404, "not_found", "Team not found");
    const owner = String(req.body?.owner || "").trim() || "unknown";
    const cur = readTeamLock(tenantId, teamId);
    if (cur.locked && cur.owner && cur.owner !== owner) throw new ApiError(423, "locked", `Team is locked by ${cur.owner}`);
    const next: TeamLock = { locked: false };
    writeTeamLock(tenantId, teamId, next);
    auditAndInvalidate(tenantId, ["teams"], {
      action: "team_unlocked",
      entity: "team",
      entityId: String(teamId),
      detail: `Team "${team.name}" unlocked by ${owner}`,
      tokensUsed: 0,
      cost: 0,
    });
    res.json(next);
  });

  // Publish team docs to Collaboration (as deliverable-style messages in team channel)
  app.post("/api/tenants/:tenantId/teams/:teamId/publish", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const teamId = Number(req.params.teamId);
    const tenant = storage.getTenant(tenantId);
    const team = storage.getTeam(teamId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    if (!team || team.tenantId !== tenantId) throw new ApiError(404, "not_found", "Team not found");

    const rootPath = teamInstructionsRoot(tenantId, teamId);
    ensureDir(rootPath);
    const names = listMarkdownFiles(rootPath);
    const teamSlug = safeSlug(team.name);
    const blocks = names
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((fn) => {
        const md = readFileUtf8(safeJoin(rootPath, fn));
        return `## File: team-docs/${teamSlug}/${fn}\n\`\`\`md\n${md}\n\`\`\``;
      })
      .join("\n\n");

    const content =
      `Team docs published for **${team.name}**.\n\n` +
      `Download full team export (.zip): /api/tenants/${tenantId}/teams/${teamId}/export\n\n` +
      blocks;

    const msg = storage.createMessage({
      tenantId,
      channelId: `team-${teamId}`,
      channelType: "team",
      senderAgentId: null,
      senderName: "System",
      senderEmoji: "📦",
      content,
      messageType: "system",
      metadata: JSON.stringify({ teamId, publishedDocs: true }),
    } as any);

    auditAndInvalidate(tenantId, ["messages"], {
      action: "team_docs_published",
      entity: "team",
      entityId: String(teamId),
      detail: `Published docs for team "${team.name}" to Collaboration`,
      tokensUsed: 0,
      cost: 0,
    });

    res.json({ ok: true, messageId: msg.id });
  });

  app.put("/api/tenants/:tenantId/teams/:teamId/files/:filename", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const teamId = Number(req.params.teamId);
    const filename = String(req.params.filename || "");
    const tenant = storage.getTenant(tenantId);
    const team = storage.getTeam(teamId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    if (!team || team.tenantId !== tenantId) throw new ApiError(404, "not_found", "Team not found");

    const owner = String(req.body?.owner || "").trim() || "unknown";
    const lock = readTeamLock(tenantId, teamId);
    if (lock.locked && lock.owner && lock.owner !== owner) {
      throw new ApiError(423, "locked", `Team is locked by ${lock.owner}`);
    }

    const markdown = String(req.body?.markdown ?? "");
    if (!filename || filename.length > 120) throw new ApiError(400, "validation_error", "Invalid filename");
    if (!filename.toLowerCase().endsWith(".md")) throw new ApiError(400, "validation_error", "Filename must end with .md");
    if (markdown.length > 20000) throw new ApiError(400, "validation_error", "Markdown too large");

    const rootPath = teamInstructionsRoot(tenantId, teamId);
    ensureDir(rootPath);
    writeFileUtf8(safeJoin(rootPath, filename), markdown);

    auditAndInvalidate(tenantId, ["teams"], {
      action: "team_file_saved",
      entity: "team",
      entityId: String(teamId),
      detail: `Saved ${filename} for team "${team.name}"`,
      tokensUsed: 0,
      cost: 0,
    });

    res.json({ ok: true, tenantId, teamId, filename, markdown, updatedAt: new Date().toISOString() });
  });

  app.delete("/api/tenants/:tenantId/teams/:teamId/files/:filename", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const teamId = Number(req.params.teamId);
    const filename = String(req.params.filename || "");
    const tenant = storage.getTenant(tenantId);
    const team = storage.getTeam(teamId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    if (!team || team.tenantId !== tenantId) throw new ApiError(404, "not_found", "Team not found");
    if (!filename || !filename.toLowerCase().endsWith(".md")) throw new ApiError(400, "validation_error", "Invalid filename");

    const owner = String(req.body?.owner || "").trim() || "unknown";
    const lock = readTeamLock(tenantId, teamId);
    if (lock.locked && lock.owner && lock.owner !== owner) {
      throw new ApiError(423, "locked", `Team is locked by ${lock.owner}`);
    }

    const rootPath = teamInstructionsRoot(tenantId, teamId);
    try {
      deleteFileIfExists(safeJoin(rootPath, filename));
    } catch {
      // ignore
    }
    auditAndInvalidate(tenantId, ["teams"], {
      action: "team_file_deleted",
      entity: "team",
      entityId: String(teamId),
      detail: `Deleted ${filename} for team "${team.name}"`,
      tokensUsed: 0,
      cost: 0,
    });
    res.json({ ok: true });
  });

  // Agent docs bundle for a deployed agent (SOUL/AGENT/HEARTBEAT/TOOLS + effective SKILLS)
  app.get("/api/tenants/:tenantId/agents/:agentId/docs", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const agentId = Number(req.params.agentId);
    const tenant = storage.getTenant(tenantId);
    const agent = storage.getAgent(agentId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    if (!agent || agent.tenantId !== tenantId) throw new ApiError(404, "not_found", "Agent not found");
    const def = storage.getAgentDefinition(agent.definitionId);
    if (!def) throw new ApiError(404, "not_found", "Agent definition not found");

    const { getAgentDocs } = await import("./skillsRuntime");
    const docs = await getAgentDocs(def.id);
    if (!docs) throw new ApiError(404, "not_found", "Agent docs not found");
    const skills = await getEffectiveDefinitionSkills(tenantId, def.id);

    res.json({
      tenant: { id: tenant.id, name: tenant.name },
      agent: { id: agent.id, displayName: agent.displayName, role: agent.role, definitionId: agent.definitionId },
      definition: { id: def.id, name: def.name, division: def.division },
      files: [
        { filename: "SOUL.md", markdown: docs.SOUL.markdown },
        { filename: "AGENT.md", markdown: docs.AGENT.markdown },
        { filename: "HEARTBEAT.md", markdown: docs.HEARTBEAT.markdown },
        { filename: "TOOLS.md", markdown: docs.TOOLS.markdown },
        { filename: "SKILLS.md", markdown: skills.markdown },
      ],
    });
  });

  // Export a team as a zip: includes team instruction files + docs for each team member agent.
  app.get("/api/tenants/:tenantId/teams/:teamId/export", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const teamId = Number(req.params.teamId);
    const tenant = storage.getTenant(tenantId);
    const team = storage.getTeam(teamId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    if (!team || team.tenantId !== tenantId) throw new ApiError(404, "not_found", "Team not found");

    const rootPath = teamInstructionsRoot(tenantId, teamId);
    ensureDir(rootPath);

    const members = storage.getTeamMembers(teamId);
    const agents = members
      .map((m) => storage.getAgent(m.agentId))
      .filter(Boolean)
      .filter((a) => (a as any).tenantId === tenantId) as any[];

    const { getAgentDocs } = await import("./skillsRuntime");

    const zip = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const writeable = new Writable({
        write(chunk, _encoding, cb) {
          chunks.push(chunk as Buffer);
          cb();
        },
      });

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", reject);
      archive.on("warning", (err) => {
        if ((err as any)?.code !== "ENOENT") reject(err);
      });
      writeable.on("finish", () => resolve(Buffer.concat(chunks)));
      archive.pipe(writeable);

      // Team files
      const teamFiles = listMarkdownFiles(rootPath);
      for (const filename of teamFiles) {
        const full = safeJoin(rootPath, filename);
        if (fs.existsSync(full)) {
          archive.file(full, { name: `team/${filename}` });
        }
      }

      // Agent docs for members (generated on the fly)
      (async () => {
        for (const a of agents) {
          const def = storage.getAgentDefinition(a.definitionId);
          if (!def) continue;
          const docs = await getAgentDocs(def.id);
          if (!docs) continue;
          const skills = await getEffectiveDefinitionSkills(tenantId, def.id);
          const folder = `agents/${safeSlug(a.displayName)}_${a.id}`;
          archive.append(docs.SOUL.markdown, { name: `${folder}/SOUL.md` });
          archive.append(docs.AGENT.markdown, { name: `${folder}/AGENT.md` });
          archive.append(docs.HEARTBEAT.markdown, { name: `${folder}/HEARTBEAT.md` });
          archive.append(docs.TOOLS.markdown, { name: `${folder}/TOOLS.md` });
          archive.append(skills.markdown, { name: `${folder}/SKILLS.md` });
        }
        archive.finalize();
      })().catch(reject);
    });

    const safeName = safeSlug(team.name || "team");
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename=\"team-${safeName}-${teamId}.zip\"`);
    res.send(zip);
  });

  // ─── Tasks ────────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/tasks", (req, res) =>
    res.json(storage.getTasks(Number(req.params.tenantId)))
  );
  app.post("/api/tenants/:tenantId/tasks", (req, res) => {
    const parsed = insertTaskSchema.safeParse({ ...req.body, tenantId: Number(req.params.tenantId) });
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));
    const task = storage.createTask(parsed.data);
    auditAndInvalidate(task.tenantId, ["tasks", "goals"], {
      agentId: task.assignedAgentId ?? undefined,
      action: "task_created",
      entity: "task",
      entityId: String(task.id),
      detail: task.title,
      tokensUsed: 0,
      cost: 0,
    });
    const delegated = maybeDelegateCeoIncomingTask(task.id);
    if (!delegated && task.assignedAgentId) {
      void (async () => {
        try {
          await dispatchAgentRun(task.tenantId, task.assignedAgentId!, { reason: "start", bypassCooldown: true });
        } catch {
          // best-effort
        }
      })();
    }
    res.json(task);
  });
  app.patch("/api/tasks/:id", (req, res) => {
    const id = Number(req.params.id);
    const prev = storage.getTask(id);
    const t = storage.updateTask(id, req.body);
    if (!t) throw new ApiError(404, "not_found", "Task not found");
    const statusChanged = !!prev && prev.status !== t.status;
    if (statusChanged) {
      // Always log status transitions (covers todo/review/blocked/etc.)
      auditAndInvalidate(t.tenantId, ["tasks", "goals"], {
        agentId: t.assignedAgentId ?? undefined,
        action: "task_status_changed",
        entity: "task",
        entityId: String(t.id),
        detail: `${prev!.status} → ${t.status}: ${t.title}`,
        tokensUsed: 0,
        cost: 0,
      });
    }

    // Keep special "semantic" actions too.
    if (prev && t.status === "done" && prev.status !== "done") {
      auditAndInvalidate(t.tenantId, ["tasks", "goals"], {
        agentId: t.assignedAgentId ?? undefined,
        action: "task_completed",
        entity: "task",
        entityId: String(t.id),
        detail: t.title,
        tokensUsed: t.actualTokens ?? 0,
        cost: 0,
      });
      maybeAutoCloseParentCeoTask(t);
    } else if (prev && t.status === "in_progress" && prev.status !== "in_progress") {
      auditAndInvalidate(t.tenantId, ["tasks", "goals"], {
        agentId: t.assignedAgentId ?? undefined,
        action: "task_checkout",
        entity: "task",
        entityId: String(t.id),
        detail: `Started: ${t.title}`,
        tokensUsed: 0,
        cost: 0,
      });
    } else if (!statusChanged) {
      invalidateTenant(t.tenantId, ["tasks", "goals"]);
    }

    const assigneeChanged = !!prev && prev.assignedAgentId !== t.assignedAgentId;
    let delegatedByPatch = false;
    if (assigneeChanged || (!prev && t.assignedAgentId)) {
      delegatedByPatch = maybeDelegateCeoIncomingTask(t.id);
    }
    if (assigneeChanged && t.assignedAgentId && !delegatedByPatch) {
      void (async () => {
        try {
          await dispatchAgentRun(t.tenantId, t.assignedAgentId!, { reason: "start", bypassCooldown: true });
        } catch {
          // best-effort
        }
      })();
    }
    res.json(t);
  });
  app.delete("/api/tasks/:id", (req, res) => {
    const id = Number(req.params.id);
    const task = storage.getTask(id);
    if (!task) throw new ApiError(404, "not_found", "Task not found");
    auditAndInvalidate(task.tenantId, ["tasks", "goals"], {
      agentId: task.assignedAgentId ?? undefined,
      action: "task_deleted",
      entity: "task",
      entityId: String(id),
      detail: task.title,
      tokensUsed: 0,
      cost: 0,
    });
    storage.deleteTask(id);
    res.json({ ok: true });
  });

  // ─── Task Approval / Rejection ──────────────────────────────────────────

  app.post("/api/tasks/:id/approve", (req, res) => {
    const id = Number(req.params.id);
    const task = storage.getTask(id);
    if (!task) throw new ApiError(404, "not_found", "Task not found");
    if (task.status !== "review") throw new ApiError(400, "invalid_status", "Task is not in review status");

    storage.updateTask(id, { status: "done", completedAt: new Date().toISOString() } as any);
    auditAndInvalidate(task.tenantId, ["tasks", "goals"], {
      agentId: task.assignedAgentId ?? undefined,
      action: "task_approved",
      entity: "task",
      entityId: String(id),
      detail: `Approved: ${task.title}`,
      tokensUsed: 0,
      cost: 0,
    });

    maybeAutoCloseParentCeoTask({ ...task, status: "done" } as any);
    res.json({ ok: true, task: storage.getTask(id) });
  });

  app.post("/api/tasks/:id/reject", async (req, res) => {
    const id = Number(req.params.id);
    const task = storage.getTask(id);
    if (!task) throw new ApiError(404, "not_found", "Task not found");
    if (task.status !== "review") throw new ApiError(400, "invalid_status", "Task is not in review status");

    const feedback = (req.body?.feedback ?? "").trim();

    storage.updateTask(id, { status: "in_progress" } as any);
    auditAndInvalidate(task.tenantId, ["tasks", "goals"], {
      agentId: task.assignedAgentId ?? undefined,
      action: "task_rejected",
      entity: "task",
      entityId: String(id),
      detail: `Changes requested: ${task.title}${feedback ? ` — "${feedback}"` : ""}`,
      tokensUsed: 0,
      cost: 0,
    });

    if (feedback) {
      const description = task.description ?? "";
      const updatedDesc = `${description}\n\n--- Reviewer Feedback ---\n${feedback}`;
      storage.updateTask(id, { description: updatedDesc } as any);
    }

    if (task.assignedAgentId) {
      void (async () => {
        try {
          await dispatchAgentRun(task.tenantId, task.assignedAgentId!, {
            reason: "manual",
            bypassCooldown: true,
          });
        } catch { /* best-effort */ }
      })();
    }

    res.json({ ok: true, task: storage.getTask(id) });
  });

  // ─── Task Detail (messages + runs for a specific task) ──────────────────
  app.get("/api/tenants/:tenantId/tasks/:taskId/detail", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const taskId = Number(req.params.taskId);
    const task = storage.getTask(taskId);
    if (!task || task.tenantId !== tenantId) throw new ApiError(404, "not_found", "Task not found");

    const agentId = task.assignedAgentId;
    const agent = agentId ? storage.getAgent(agentId) : null;

    // Collect channels: general + any team channels the agent belongs to
    const channelSet = new Set(["general"]);
    if (task.teamId) channelSet.add(`team-${task.teamId}`);
    if (agentId) {
      const teams = storage.getTeams(tenantId);
      for (const team of teams) {
        const members = storage.getTeamMembers(team.id);
        if (members.some((m: any) => m.agentId === agentId)) {
          channelSet.add(`team-${team.id}`);
        }
      }
    }

    // Gather messages from this agent, prioritizing task-specific ones
    const taskMessages: any[] = [];
    const parentId = task.parentTaskId;
    const taskTitle = task.title;
    for (const ch of Array.from(channelSet)) {
      const msgs = storage.getMessages(tenantId, ch);
      for (const m of msgs) {
        if (!agentId || m.senderAgentId !== agentId) continue;
        const meta = typeof m.metadata === "string" ? (() => { try { return JSON.parse(m.metadata || "{}"); } catch { return {}; } })() : (m.metadata ?? {});
        const isTaskRelated = meta.taskId === taskId || meta.taskId === parentId;
        // Also match messages posted during/after this task was created
        const isAfterTaskCreation = new Date(m.createdAt) >= new Date(task.createdAt);
        if (isTaskRelated || isAfterTaskCreation) {
          taskMessages.push(m);
        }
      }
    }

    // Deduplicate and sort by id, take most recent
    const uniqueMsgs = taskMessages
      .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
      .sort((a, b) => b.id - a.id)
      .slice(0, 20)
      .reverse();

    // Get recent runs for this agent, with events
    const rawRuns = agentId ? listAgentRuns(tenantId, agentId).slice(0, 5) : [];
    const runs = rawRuns.map((r) => ({
      ...r,
      events: getRunEvents(r.id),
    }));

    // Get child tasks if this is a parent
    const allTasks = storage.getTasks(tenantId);
    const children = allTasks.filter(
      (t) => t.parentTaskId === taskId || String(t.description ?? "").includes(`parentTaskId:${taskId}`),
    );

    res.json({
      task,
      agent: agent ? { id: agent.id, displayName: agent.displayName, role: agent.role } : null,
      messages: uniqueMsgs,
      runs,
      children,
    });
  });

  // ─── Deliverables ────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/tasks/:taskId/deliverables", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const taskId = Number(req.params.taskId);
    const task = storage.getTask(taskId);
    if (!task || task.tenantId !== tenantId) throw new ApiError(404, "not_found", "Task not found");
    const items = listDeliverables(tenantId, taskId);
    res.json({ taskId, hasFiles: items.length > 0, items });
  });

  app.get("/api/tenants/:tenantId/tasks/:taskId/deliverables/download", async (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const taskId = Number(req.params.taskId);
    const task = storage.getTask(taskId);
    if (!task || task.tenantId !== tenantId) throw new ApiError(404, "not_found", "Task not found");

    const zip = await createDeliverableZip(tenantId, taskId, task.title);
    if (!zip) throw new ApiError(404, "no_deliverables", "No deliverable files found");

    const safeName = task.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || `task-${taskId}`;
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="${safeName}.zip"`);
    res.set("Content-Length", String(zip.length));
    res.send(zip);
  });

  app.post("/api/tenants/:tenantId/tasks/:taskId/deliverables/reprocess", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const taskId = Number(req.params.taskId);
    const task = storage.getTask(taskId);
    if (!task || task.tenantId !== tenantId) throw new ApiError(404, "not_found", "Task not found");

    // Scan all relevant channels (general + all team channels) so deliverables can be extracted
    // even when agents post their work in a team channel (Collaboration).
    const channelIds: string[] = ["general"];
    const teams = storage.getTeams(tenantId);
    for (const t of teams) channelIds.push(`team-${t.id}`);

    const allMessages = channelIds.flatMap((cid) => storage.getMessages(tenantId, cid));
    let totalFiles = 0;
    for (const msg of allMessages) {
      if (!msg.senderAgentId || !msg.content.includes("```")) continue;
      const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata || "{}") : (msg.metadata ?? {});
      const msgTaskId = meta.taskId ?? taskId;
      if (msgTaskId !== taskId && !task.parentTaskId) continue;
      const agent = storage.getAgent(msg.senderAgentId);
      if (!agent) continue;
      const files = processAgentDeliverable(tenantId, msgTaskId, agent.displayName, msg.content);
      totalFiles += files.length;
    }
    res.json({ ok: true, taskId, filesExtracted: totalFiles });
  });

  // ─── Messages ─────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/messages", (req, res) => {
    const { channelId } = req.query;
    if (!channelId) throw new ApiError(400, "validation_error", "channelId required");
    res.json(storage.getMessages(Number(req.params.tenantId), channelId as string));
  });
  app.post("/api/tenants/:tenantId/messages", (req, res) => {
    const parsed = insertMessageSchema.safeParse({ ...req.body, tenantId: Number(req.params.tenantId) });
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));
    const msg = storage.createMessage(parsed.data);
    auditAndInvalidate(msg.tenantId, ["messages"], {
      agentId: msg.senderAgentId ?? undefined,
      agentName: msg.senderName,
      action: "message_sent",
      entity: "message",
      entityId: String(msg.id),
      detail: msg.content.length > 200 ? `${msg.content.slice(0, 200)}…` : msg.content,
      tokensUsed: 0,
      cost: 0,
    });
    void collaborationAfterUserMessage(
      msg.tenantId,
      msg.channelId,
      msg.senderName,
      msg.messageType,
      msg.content,
    ).catch((err) => {
      console.warn("collaborationAfterUserMessage failed", {
        tenantId: msg.tenantId,
        channelId: msg.channelId,
        senderName: msg.senderName,
        messageType: msg.messageType,
        error: String(err?.message ?? err),
      });
    });
    res.json(msg);
  });

  // ─── Goals ────────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/goals", (req, res) =>
    res.json(storage.getGoals(Number(req.params.tenantId)))
  );
  app.post("/api/tenants/:tenantId/goals", (req, res) => {
    const parsed = insertGoalSchema.safeParse({ ...req.body, tenantId: Number(req.params.tenantId) });
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid request", zodDetails(parsed.error));
    const g = storage.createGoal(parsed.data);
    auditAndInvalidate(g.tenantId, ["goals"], {
      action: "goal_created",
      entity: "goal",
      entityId: String(g.id),
      detail: g.title,
      tokensUsed: 0,
      cost: 0,
    });
    res.json(g);
  });
  app.patch("/api/goals/:id", (req, res) => {
    const g = storage.updateGoal(Number(req.params.id), req.body);
    if (!g) throw new ApiError(404, "not_found", "Goal not found");
    auditAndInvalidate(g.tenantId, ["goals"], {
      action: "goal_updated",
      entity: "goal",
      entityId: String(g.id),
      detail: g.title,
      tokensUsed: 0,
      cost: 0,
    });
    res.json(g);
  });

  // ─── Audit Log ────────────────────────────────────────────────────────────
  app.get("/api/tenants/:tenantId/audit", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!storage.getTenant(tenantId)) throw new ApiError(404, "not_found", "Tenant not found");
    res.json(storage.getAuditLog(tenantId));
  });

  // ─── Clear Demo Data ───────────────────────────────────────────────────────
  app.delete("/api/tenants/:tenantId/demo-data", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    const tenant = storage.getTenant(tenantId);
    if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
    storage.clearDemoData(tenantId);
    auditAndInvalidate(tenantId, ["agents", "tasks", "goals", "messages", "teams", "audit"], {
      action: "demo_data_cleared",
      entity: "tenant",
      entityId: String(tenantId),
      detail: "Cleared demo data",
      tokensUsed: 0,
      cost: 0,
    });
    invalidateTenant(tenantId, ["agents", "tasks", "goals", "messages", "teams", "audit", "tenant"]);
    res.json({ ok: true, message: "Demo data cleared" });
  });

}
