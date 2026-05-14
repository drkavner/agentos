import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { invalidateTenant } from "./realtimeSideEffects";

let ensured = false;

export type RunTrigger = "timer" | "on_demand" | "assignment" | "heartbeat" | "test_environment";
export type RunStatus = "running" | "ok" | "failed";

export type AgentRunRow = {
  id: number;
  tenantId: number;
  agentId: number;
  status: RunStatus;
  trigger: RunTrigger;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
};

export type AgentRunEventRow = {
  id: number;
  runId: number;
  ts: string;
  kind: "system" | "stdout" | "stderr" | "event";
  message: string;
};

export function ensureAgentRunsTables() {
  if (ensured) return;
  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      agent_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms INTEGER,
      summary TEXT,
      error TEXT,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS agent_runs_tenant_agent_idx ON agent_runs (tenant_id, agent_id, id DESC);`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS agent_run_events_run_idx ON agent_run_events (run_id, id ASC);`);

  ensured = true;
}

export function createAgentRun(input: {
  tenantId: number;
  agentId: number;
  trigger: RunTrigger;
  startedAt?: string;
}) {
  ensureAgentRunsTables();
  const startedAt = input.startedAt ?? new Date().toISOString();
  const row = db.get(sql`
    INSERT INTO agent_runs (tenant_id, agent_id, status, trigger, started_at)
    VALUES (${input.tenantId}, ${input.agentId}, ${"running"}, ${input.trigger}, ${startedAt})
    RETURNING id, tenant_id as tenantId, agent_id as agentId, status, trigger, started_at as startedAt, ended_at as endedAt, duration_ms as durationMs, summary, error;
  `) as any;
  addRunEvent(row.id, { kind: "system", message: "run_started", ts: startedAt });
  return row as AgentRunRow;
}

export function addRunEvent(
  runId: number,
  evt: { kind: AgentRunEventRow["kind"]; message: string; ts?: string },
) {
  ensureAgentRunsTables();
  const ts = evt.ts ?? new Date().toISOString();
  db.run(sql`
    INSERT INTO agent_run_events (run_id, ts, kind, message)
    VALUES (${runId}, ${ts}, ${evt.kind}, ${evt.message});
  `);
}

export function finishAgentRun(runId: number, input: { status: RunStatus; summary?: string | null; error?: string | null }) {
  ensureAgentRunsTables();
  const endedAt = new Date().toISOString();
  const run = db.get(sql`
    SELECT
      started_at as startedAt,
      agent_id as agentId,
      tenant_id as tenantId
    FROM agent_runs
    WHERE id = ${runId}
  `) as { startedAt?: string; agentId?: number; tenantId?: number } | undefined;
  const startedAt = run?.startedAt ? new Date(String(run.startedAt)) : null;
  const durationMs = startedAt && Number.isFinite(startedAt.getTime()) ? Date.now() - startedAt.getTime() : null;
  db.run(sql`
    UPDATE agent_runs
    SET status = ${input.status},
        ended_at = ${endedAt},
        duration_ms = ${durationMs},
        summary = ${input.summary ?? null},
        error = ${input.error ?? null}
    WHERE id = ${runId};
  `);
  addRunEvent(runId, { kind: "system", message: "run_finished", ts: endedAt });

  const agentId = run?.agentId != null ? Number(run.agentId) : null;
  const tenantId = run?.tenantId != null ? Number(run.tenantId) : null;
  if (agentId != null && tenantId != null) {
    const agent = storage.getAgent(agentId);
    if (agent && agent.tenantId === tenantId) {
      if (input.status === "failed" && agent.status !== "terminated") {
        storage.updateAgent(agentId, { status: "error" });
        invalidateTenant(tenantId, ["agents"]);
      } else if (input.status === "ok" && agent.status === "error") {
        storage.updateAgent(agentId, { status: "running" });
        invalidateTenant(tenantId, ["agents"]);
      }
    }
  }
}

/** Latest finished run per agent (max `agent_runs.id` with `ended_at` set). */
export function latestFinishedRunStatusByAgent(tenantId: number): Map<number, RunStatus> {
  ensureAgentRunsTables();
  const rows = db.all(sql`
    SELECT ar.agent_id as agentId, ar.status as status
    FROM agent_runs ar
    JOIN (
      SELECT agent_id, MAX(id) as max_id
      FROM agent_runs
      WHERE tenant_id = ${tenantId} AND ended_at IS NOT NULL
      GROUP BY agent_id
    ) latest ON latest.agent_id = ar.agent_id AND ar.id = latest.max_id
    WHERE ar.tenant_id = ${tenantId}
  `) as { agentId: number; status: RunStatus }[];

  const m = new Map<number, RunStatus>();
  for (const r of rows) {
    const id = Number(r.agentId);
    if (Number.isFinite(id)) m.set(id, r.status);
  }
  return m;
}

/** Latest finished run per agent (same row as status map) — for UI error detail. */
export type LatestFinishedRunInfo = {
  runId: number;
  status: RunStatus;
  trigger: RunTrigger;
  error: string | null;
  summary: string | null;
};

export function latestFinishedRunByAgent(tenantId: number): Map<number, LatestFinishedRunInfo> {
  ensureAgentRunsTables();
  const rows = db.all(sql`
    SELECT
      ar.agent_id as agentId,
      ar.id as runId,
      ar.status as status,
      ar.trigger as trigger,
      ar.error as error,
      ar.summary as summary
    FROM agent_runs ar
    JOIN (
      SELECT agent_id, MAX(id) as max_id
      FROM agent_runs
      WHERE tenant_id = ${tenantId} AND ended_at IS NOT NULL
      GROUP BY agent_id
    ) latest ON latest.agent_id = ar.agent_id AND ar.id = latest.max_id
    WHERE ar.tenant_id = ${tenantId}
  `) as {
    agentId: number;
    runId: number;
    status: RunStatus;
    trigger: RunTrigger;
    error: string | null;
    summary: string | null;
  }[];

  const m = new Map<number, LatestFinishedRunInfo>();
  for (const r of rows as any[]) {
    const id = Number(r.agentId ?? r.agent_id);
    if (!Number.isFinite(id)) continue;
    m.set(id, {
      runId: Number(r.runId ?? r.run_id),
      status: r.status,
      trigger: r.trigger,
      error: r.error ?? null,
      summary: r.summary ?? null,
    });
  }
  return m;
}

/**
 * If an agent is still marked `running` but their latest *finished* run failed (e.g. LLM error),
 * align the row to `error` so My Agents matches Run logs. Covers historical rows from before
 * `finishAgentRun` synced status, and any missed edge cases.
 */
export function reconcileAgentStatusWithLatestFinishedRun(tenantId: number) {
  ensureAgentRunsTables();
  const rows = db.all(sql`
    SELECT a.id as agentId
    FROM agents a
    JOIN (
      SELECT agent_id, MAX(id) as max_id
      FROM agent_runs
      WHERE tenant_id = ${tenantId} AND ended_at IS NOT NULL
      GROUP BY agent_id
    ) latest ON latest.agent_id = a.id
    JOIN agent_runs last_run ON last_run.id = latest.max_id
    WHERE a.tenant_id = ${tenantId}
      AND a.status = 'running'
      AND last_run.status = 'failed'
  `) as { agentId: number }[];

  if (rows.length === 0) return;
  for (const r of rows) {
    const id = Number(r.agentId);
    if (Number.isFinite(id)) storage.updateAgent(id, { status: "error" });
  }
  invalidateTenant(tenantId, ["agents"]);
}

export function listAgentRuns(tenantId: number, agentId: number, limit = 50): AgentRunRow[] {
  ensureAgentRunsTables();
  const rows = db.all(sql`
    SELECT
      id,
      tenant_id as tenantId,
      agent_id as agentId,
      status,
      trigger,
      started_at as startedAt,
      ended_at as endedAt,
      duration_ms as durationMs,
      summary,
      error
    FROM agent_runs
    WHERE tenant_id = ${tenantId} AND agent_id = ${agentId}
    ORDER BY id DESC
    LIMIT ${Math.max(1, Math.min(200, limit))}
  `) as any[];
  return rows as AgentRunRow[];
}

export function getAgentRun(runId: number): AgentRunRow | null {
  ensureAgentRunsTables();
  const row = db.get(sql`
    SELECT
      id,
      tenant_id as tenantId,
      agent_id as agentId,
      status,
      trigger,
      started_at as startedAt,
      ended_at as endedAt,
      duration_ms as durationMs,
      summary,
      error
    FROM agent_runs
    WHERE id = ${runId}
  `) as any | undefined;
  return row ? (row as AgentRunRow) : null;
}

export function getRunEvents(runId: number): AgentRunEventRow[] {
  ensureAgentRunsTables();
  const rows = db.all(sql`
    SELECT id, run_id as runId, ts, kind, message
    FROM agent_run_events
    WHERE run_id = ${runId}
    ORDER BY id ASC
  `) as any[];
  return rows as AgentRunEventRow[];
}

