import { db } from "./db";
import { sql } from "drizzle-orm";

let ensured = false;

export type CeoControlMode = "agent" | "me";

export function ensureCeoControlTable() {
  if (ensured) return;
  db.run(sql`
    CREATE TABLE IF NOT EXISTS ceo_control_settings (
      tenant_id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'agent',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);
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
    INSERT INTO ceo_control_settings (tenant_id, mode, updated_at)
    VALUES (${tenantId}, ${mode}, ${now})
    ON CONFLICT(tenant_id) DO UPDATE SET
      mode = excluded.mode,
      updated_at = excluded.updated_at;
  `);
  return { tenantId, mode, updatedAt: now };
}

