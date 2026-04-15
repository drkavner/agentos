import { db } from "./db";
import { sql } from "drizzle-orm";

let ensured = false;

export type AgentBudgetSettings = {
  enabled: boolean;
  capUsd: number | null;
  softAlertPct: number; // 0..1
  updatedAt: string;
};

export function ensureAgentBudgetTables() {
  if (ensured) return;
  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_budget_settings (
      agent_id INTEGER PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      cap_usd REAL,
      soft_alert_pct REAL NOT NULL DEFAULT 0.8,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `);
  ensured = true;
}

export function getAgentBudgetSettings(agentId: number): AgentBudgetSettings {
  ensureAgentBudgetTables();
  const row = db.get(sql`
    SELECT
      enabled as enabled,
      cap_usd as capUsd,
      soft_alert_pct as softAlertPct,
      updated_at as updatedAt
    FROM agent_budget_settings
    WHERE agent_id = ${agentId}
  `) as any | undefined;

  if (!row) {
    const now = new Date().toISOString();
    db.run(sql`
      INSERT INTO agent_budget_settings (agent_id, enabled, cap_usd, soft_alert_pct, updated_at)
      VALUES (${agentId}, 0, NULL, 0.8, ${now});
    `);
    return { enabled: false, capUsd: null, softAlertPct: 0.8, updatedAt: now };
  }

  return {
    enabled: !!row.enabled,
    capUsd: row.capUsd == null ? null : Number(row.capUsd),
    softAlertPct: Math.max(0.1, Math.min(0.99, Number(row.softAlertPct ?? 0.8))),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
  };
}

export function updateAgentBudgetSettings(
  agentId: number,
  patch: Partial<Pick<AgentBudgetSettings, "enabled" | "capUsd" | "softAlertPct">>,
) {
  const existing = getAgentBudgetSettings(agentId);
  const now = new Date().toISOString();
  const next: AgentBudgetSettings = {
    enabled: patch.enabled ?? existing.enabled,
    capUsd: patch.capUsd === undefined ? existing.capUsd : (patch.capUsd == null ? null : Number(patch.capUsd)),
    softAlertPct: patch.softAlertPct === undefined ? existing.softAlertPct : Math.max(0.1, Math.min(0.99, Number(patch.softAlertPct))),
    updatedAt: now,
  };

  db.run(sql`
    UPDATE agent_budget_settings
    SET enabled = ${next.enabled ? 1 : 0},
        cap_usd = ${next.capUsd ?? null},
        soft_alert_pct = ${next.softAlertPct},
        updated_at = ${now}
    WHERE agent_id = ${agentId};
  `);

  return next;
}

