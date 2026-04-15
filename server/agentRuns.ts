import { db } from "./db";
import { sql } from "drizzle-orm";

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
  const run = db.get(sql`SELECT started_at as startedAt FROM agent_runs WHERE id = ${runId}`) as any | undefined;
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

