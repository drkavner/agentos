import { db } from "./db";
import { sql } from "drizzle-orm";

let ensured = false;

export type CeoControlMode = "agent" | "me";

export function ensureCeoControlTable() {
  if (ensured) return;
  db.run(sql`
    CREATE TABLE IF NOT EXISTS ceo_control_settings (
      tenant_id INTEGER PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL DEFAULT 'agent',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);

  // Backfill column for older installs (SQLite supports ADD COLUMN).
  try {
    const cols = (db.all(sql`PRAGMA table_info(ceo_control_settings);`) as any[]) ?? [];
    const hasEnabled = cols.some((c) => String(c?.name) === "enabled");
    if (!hasEnabled) {
      db.run(sql`ALTER TABLE ceo_control_settings ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`);
    }
  } catch {
    // ignore
  }

  ensured = true;
}

export function getCeoControlMode(tenantId: number): CeoControlMode {
  ensureCeoControlTable();
  const row = db.get(sql`
    SELECT mode
    FROM ceo_control_settings
    WHERE tenant_id = ${tenantId}
  `) as any | undefined;
  const mode = String(row?.mode ?? "agent");
  return mode === "me" ? "me" : "agent";
}

export function setCeoControlMode(tenantId: number, mode: CeoControlMode) {
  ensureCeoControlTable();
  const now = new Date().toISOString();
  db.run(sql`
    INSERT INTO ceo_control_settings (tenant_id, enabled, mode, updated_at)
    VALUES (${tenantId}, 1, ${mode}, ${now})
    ON CONFLICT(tenant_id) DO UPDATE SET
      mode = excluded.mode,
      updated_at = excluded.updated_at;
  `);
  return { tenantId, mode, updatedAt: now };
}

export function getCeoControlSettings(tenantId: number): { tenantId: number; enabled: boolean; mode: CeoControlMode; updatedAt?: string } {
  ensureCeoControlTable();
  const row = db.get(sql`
    SELECT enabled, mode, updated_at
    FROM ceo_control_settings
    WHERE tenant_id = ${tenantId}
  `) as any | undefined;
  const mode = String(row?.mode ?? "agent");
  const enabled = Number(row?.enabled ?? 1) !== 0;
  return { tenantId, enabled, mode: mode === "me" ? "me" : "agent", updatedAt: row?.updated_at ? String(row.updated_at) : undefined };
}

export function setCeoEnabled(tenantId: number, enabled: boolean) {
  ensureCeoControlTable();
  const now = new Date().toISOString();
  const mode: CeoControlMode = getCeoControlMode(tenantId);
  db.run(sql`
    INSERT INTO ceo_control_settings (tenant_id, enabled, mode, updated_at)
    VALUES (${tenantId}, ${enabled ? 1 : 0}, ${mode}, ${now})
    ON CONFLICT(tenant_id) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at;
  `);
  return { tenantId, enabled, mode, updatedAt: now };
}

