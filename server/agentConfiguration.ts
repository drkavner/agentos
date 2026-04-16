import { db } from "./db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

let ensured = false;

export type LlmProviderRouting = "openrouter" | "ollama";

export type AgentAdapterType = "hermes" | "openclaw" | "cli";

export type AgentRuntimeSettings = {
  /** Where model id is resolved: OpenRouter cloud or local Ollama. */
  llmProvider: LlmProviderRouting;
  /** Execution adapter: hermes (internal sim/LLM), openclaw (gateway), cli (external CLI like claude/codex/gemini). */
  adapterType: AgentAdapterType;
  bypassSandbox: boolean;
  enableSearch: boolean;
  command: string;
  model: string;
  thinkingEffort: "auto" | "low" | "medium" | "high";
  extraArgs: string;
  timeoutSec: number;
  interruptGraceSec: number;
  heartbeatEnabled: boolean;
  heartbeatEverySec: number;
  wakeOnDemand: boolean;
  cooldownSec: number;
  maxConcurrentRuns: number;
  lastRunAt?: string | null;
  canCreateAgents: boolean;
  canAssignTasks: boolean;
};

export type AgentProfile = {
  title: string;
  capabilities: string;
};

export type AgentApiKeyRow = {
  id: number;
  name: string;
  last4: string;
  createdAt: string;
};

export function ensureAgentConfigurationTables() {
  if (ensured) return;

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      agent_id INTEGER PRIMARY KEY,
      title TEXT,
      capabilities TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_runtime_settings (
      agent_id INTEGER PRIMARY KEY,
      bypass_sandbox INTEGER NOT NULL DEFAULT 0,
      enable_search INTEGER NOT NULL DEFAULT 0,
      command TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      thinking_effort TEXT NOT NULL DEFAULT 'auto',
      extra_args TEXT NOT NULL DEFAULT '',
      timeout_sec INTEGER NOT NULL DEFAULT 0,
      interrupt_grace_sec INTEGER NOT NULL DEFAULT 15,
      heartbeat_enabled INTEGER NOT NULL DEFAULT 1,
      heartbeat_every_sec INTEGER NOT NULL DEFAULT 1800,
      wake_on_demand INTEGER NOT NULL DEFAULT 1,
      cooldown_sec INTEGER NOT NULL DEFAULT 10,
      max_concurrent_runs INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      can_create_agents INTEGER NOT NULL DEFAULT 0,
      can_assign_tasks INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `);

  // Backfill columns for existing DBs (SQLite has no IF NOT EXISTS for ADD COLUMN).
  const cols = db.all(sql`PRAGMA table_info(agent_runtime_settings);`) as any[];
  const names = new Set(cols.map((c) => String(c.name)));
  const add = (name: string, ddl: string) => {
    if (names.has(name)) return;
    db.run(sql.raw(ddl));
  };
  add("wake_on_demand", "ALTER TABLE agent_runtime_settings ADD COLUMN wake_on_demand INTEGER NOT NULL DEFAULT 1");
  add("cooldown_sec", "ALTER TABLE agent_runtime_settings ADD COLUMN cooldown_sec INTEGER NOT NULL DEFAULT 10");
  add("max_concurrent_runs", "ALTER TABLE agent_runtime_settings ADD COLUMN max_concurrent_runs INTEGER NOT NULL DEFAULT 1");
  add("last_run_at", "ALTER TABLE agent_runtime_settings ADD COLUMN last_run_at TEXT");
  add("llm_provider", "ALTER TABLE agent_runtime_settings ADD COLUMN llm_provider TEXT NOT NULL DEFAULT 'openrouter'");
  add("adapter_type", "ALTER TABLE agent_runtime_settings ADD COLUMN adapter_type TEXT NOT NULL DEFAULT 'hermes'");

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_run_locks (
      agent_id INTEGER PRIMARY KEY,
      started_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      last4 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS agent_api_keys_agent_idx
    ON agent_api_keys (agent_id);
  `);

  ensured = true;
}

export function getAgentProfile(agentId: number): AgentProfile {
  ensureAgentConfigurationTables();
  const row = db.get(sql`
    SELECT title, capabilities
    FROM agent_profiles
    WHERE agent_id = ${agentId}
  `) as any | undefined;
  return {
    title: String(row?.title ?? ""),
    capabilities: String(row?.capabilities ?? ""),
  };
}

export function upsertAgentProfile(agentId: number, profile: Partial<AgentProfile>) {
  ensureAgentConfigurationTables();
  const now = new Date().toISOString();
  const existing = getAgentProfile(agentId);
  const title = profile.title ?? existing.title;
  const capabilities = profile.capabilities ?? existing.capabilities;
  db.run(sql`
    INSERT INTO agent_profiles (agent_id, title, capabilities, updated_at)
    VALUES (${agentId}, ${title}, ${capabilities}, ${now})
    ON CONFLICT(agent_id) DO UPDATE SET
      title = excluded.title,
      capabilities = excluded.capabilities,
      updated_at = excluded.updated_at;
  `);
}

export function getAgentRuntimeSettings(agentId: number): AgentRuntimeSettings {
  ensureAgentConfigurationTables();
  const row = db.get(sql`
    SELECT
      llm_provider as llmProvider,
      adapter_type as adapterType,
      bypass_sandbox as bypassSandbox,
      enable_search as enableSearch,
      command as command,
      model as model,
      thinking_effort as thinkingEffort,
      extra_args as extraArgs,
      timeout_sec as timeoutSec,
      interrupt_grace_sec as interruptGraceSec,
      heartbeat_enabled as heartbeatEnabled,
      heartbeat_every_sec as heartbeatEverySec,
      wake_on_demand as wakeOnDemand,
      cooldown_sec as cooldownSec,
      max_concurrent_runs as maxConcurrentRuns,
      last_run_at as lastRunAt,
      can_create_agents as canCreateAgents,
      can_assign_tasks as canAssignTasks
    FROM agent_runtime_settings
    WHERE agent_id = ${agentId}
  `) as any | undefined;

  // Defaults: ON for key CEO controls (requested)
  const defaultBypassSandbox = true;
  const defaultCanCreateAgents = true;
  const defaultCanAssignTasks = true;

  const llmRaw = String(row?.llmProvider ?? "openrouter").toLowerCase();
  const llmProvider: LlmProviderRouting = llmRaw === "ollama" ? "ollama" : "openrouter";

  const adapterRaw = String(row?.adapterType ?? "hermes").toLowerCase();
  const adapterType: AgentAdapterType = (["hermes", "openclaw", "cli"].includes(adapterRaw) ? adapterRaw : "hermes") as AgentAdapterType;

  return {
    llmProvider,
    adapterType,
    bypassSandbox: row?.bypassSandbox === undefined ? defaultBypassSandbox : !!row?.bypassSandbox,
    enableSearch: !!row?.enableSearch,
    command: String(row?.command ?? ""),
    model: String(row?.model ?? ""),
    thinkingEffort: (["auto", "low", "medium", "high"].includes(String(row?.thinkingEffort))
      ? String(row?.thinkingEffort)
      : "auto") as AgentRuntimeSettings["thinkingEffort"],
    extraArgs: String(row?.extraArgs ?? ""),
    timeoutSec: Number(row?.timeoutSec ?? 0),
    interruptGraceSec: Number(row?.interruptGraceSec ?? 15),
    heartbeatEnabled: row?.heartbeatEnabled === undefined ? true : !!row?.heartbeatEnabled,
    heartbeatEverySec: Math.max(60, Number(row?.heartbeatEverySec ?? 1800)),
    wakeOnDemand: row?.wakeOnDemand === undefined ? true : !!row?.wakeOnDemand,
    cooldownSec: Math.max(0, Number(row?.cooldownSec ?? 10)),
    maxConcurrentRuns: Math.max(1, Number(row?.maxConcurrentRuns ?? 1)),
    lastRunAt: row?.lastRunAt ?? null,
    canCreateAgents: row?.canCreateAgents === undefined ? defaultCanCreateAgents : !!row?.canCreateAgents,
    canAssignTasks: row?.canAssignTasks === undefined ? defaultCanAssignTasks : !!row?.canAssignTasks,
  };
}

export function upsertAgentRuntimeSettings(agentId: number, patch: Partial<AgentRuntimeSettings>) {
  ensureAgentConfigurationTables();
  const now = new Date().toISOString();
  const existing = getAgentRuntimeSettings(agentId);
  const next: AgentRuntimeSettings = {
    ...existing,
    ...patch,
    llmProvider: patch.llmProvider != null ? (patch.llmProvider === "ollama" ? "ollama" : "openrouter") : existing.llmProvider,
    adapterType: patch.adapterType != null ? patch.adapterType : existing.adapterType,
    heartbeatEverySec: patch.heartbeatEverySec ? Math.max(60, patch.heartbeatEverySec) : existing.heartbeatEverySec,
    cooldownSec: patch.cooldownSec != null ? Math.max(0, Math.floor(patch.cooldownSec)) : existing.cooldownSec,
    maxConcurrentRuns: patch.maxConcurrentRuns != null ? Math.max(1, Math.floor(patch.maxConcurrentRuns)) : existing.maxConcurrentRuns,
  };

  db.run(sql`
    INSERT INTO agent_runtime_settings (
      agent_id,
      llm_provider,
      adapter_type,
      bypass_sandbox,
      enable_search,
      command,
      model,
      thinking_effort,
      extra_args,
      timeout_sec,
      interrupt_grace_sec,
      heartbeat_enabled,
      heartbeat_every_sec,
      wake_on_demand,
      cooldown_sec,
      max_concurrent_runs,
      last_run_at,
      can_create_agents,
      can_assign_tasks,
      updated_at
    ) VALUES (
      ${agentId},
      ${next.llmProvider},
      ${next.adapterType},
      ${next.bypassSandbox ? 1 : 0},
      ${next.enableSearch ? 1 : 0},
      ${next.command},
      ${next.model},
      ${next.thinkingEffort},
      ${next.extraArgs},
      ${Math.max(0, Math.floor(next.timeoutSec))},
      ${Math.max(0, Math.floor(next.interruptGraceSec))},
      ${next.heartbeatEnabled ? 1 : 0},
      ${Math.max(60, Math.floor(next.heartbeatEverySec))},
      ${next.wakeOnDemand ? 1 : 0},
      ${Math.max(0, Math.floor(next.cooldownSec))},
      ${Math.max(1, Math.floor(next.maxConcurrentRuns))},
      ${next.lastRunAt ?? null},
      ${next.canCreateAgents ? 1 : 0},
      ${next.canAssignTasks ? 1 : 0},
      ${now}
    )
    ON CONFLICT(agent_id) DO UPDATE SET
      llm_provider = excluded.llm_provider,
      adapter_type = excluded.adapter_type,
      bypass_sandbox = excluded.bypass_sandbox,
      enable_search = excluded.enable_search,
      command = excluded.command,
      model = excluded.model,
      thinking_effort = excluded.thinking_effort,
      extra_args = excluded.extra_args,
      timeout_sec = excluded.timeout_sec,
      interrupt_grace_sec = excluded.interrupt_grace_sec,
      heartbeat_enabled = excluded.heartbeat_enabled,
      heartbeat_every_sec = excluded.heartbeat_every_sec,
      wake_on_demand = excluded.wake_on_demand,
      cooldown_sec = excluded.cooldown_sec,
      max_concurrent_runs = excluded.max_concurrent_runs,
      last_run_at = excluded.last_run_at,
      can_create_agents = excluded.can_create_agents,
      can_assign_tasks = excluded.can_assign_tasks,
      updated_at = excluded.updated_at;
  `);
}

export function tryAcquireAgentRunLock(agentId: number) {
  ensureAgentConfigurationTables();
  const existing = db.get(
    sql`SELECT agent_id, started_at as startedAt FROM agent_run_locks WHERE agent_id = ${agentId}`,
  ) as any | undefined;
  if (existing) {
    const startedAtRaw = String(existing.startedAt ?? "");
    const startedAtMs = Date.parse(startedAtRaw);
    const ageMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : Infinity;
    // If the server crashed mid-run, the lock can be left behind forever.
    // Treat old locks as stale and reclaim them.
    const STALE_LOCK_MS = 10 * 60 * 1000;
    if (ageMs <= STALE_LOCK_MS) return false;
    db.run(sql`DELETE FROM agent_run_locks WHERE agent_id = ${agentId}`);
  }
  const nowIso = new Date().toISOString();
  db.run(sql`INSERT INTO agent_run_locks (agent_id, started_at) VALUES (${agentId}, ${nowIso})`);
  return true;
}

export function releaseAgentRunLock(agentId: number) {
  ensureAgentConfigurationTables();
  db.run(sql`DELETE FROM agent_run_locks WHERE agent_id = ${agentId}`);
}

export function listAgentApiKeys(agentId: number): AgentApiKeyRow[] {
  ensureAgentConfigurationTables();
  const rows = db.all(sql`
    SELECT id, name, last4, created_at as createdAt
    FROM agent_api_keys
    WHERE agent_id = ${agentId} AND revoked_at IS NULL
    ORDER BY id DESC
  `) as any[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    last4: String(r.last4),
    createdAt: String(r.createdAt),
  }));
}

export function createAgentApiKey(agentId: number, name: string) {
  ensureAgentConfigurationTables();
  const token = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const last4 = token.slice(-4);
  const now = new Date().toISOString();
  db.run(sql`
    INSERT INTO agent_api_keys (agent_id, name, token_hash, last4, created_at)
    VALUES (${agentId}, ${name}, ${tokenHash}, ${last4}, ${now});
  `);
  return { token, last4, createdAt: now };
}

export function secondsToCron(seconds: number) {
  const s = Math.max(60, Math.floor(seconds));
  if (s % 3600 === 0) {
    const h = Math.max(1, Math.floor(s / 3600));
    return h === 1 ? "0 * * * *" : `0 */${h} * * *`;
  }
  if (s % 60 === 0) {
    const m = Math.max(1, Math.floor(s / 60));
    return `*/${m} * * * *`;
  }
  // fallback
  return "*/30 * * * *";
}

