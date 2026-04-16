import { db } from "./db";
import { sql } from "drizzle-orm";

let ensured = false;

export function ensureTenantSecretsTable() {
  if (ensured) return;
  db.run(sql`
    CREATE TABLE IF NOT EXISTS tenant_secrets (
      tenant_id INTEGER PRIMARY KEY,
      ollama_api_key TEXT,
      openrouter_api_key TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);
  // If table existed before columns were added, backfill via ALTER TABLE.
  try {
    const cols = db.all(sql`PRAGMA table_info(tenant_secrets);`) as any[];
    const names = new Set(cols.map((c) => String(c?.name ?? "")));
    if (!names.has("ollama_api_key")) {
      db.run(sql`ALTER TABLE tenant_secrets ADD COLUMN ollama_api_key TEXT;`);
    }
    if (!names.has("openrouter_api_key")) {
      db.run(sql`ALTER TABLE tenant_secrets ADD COLUMN openrouter_api_key TEXT;`);
    }
    if (!names.has("updated_at")) {
      db.run(sql`ALTER TABLE tenant_secrets ADD COLUMN updated_at TEXT;`);
      // Best-effort: initialize updated_at so reads work.
      db.run(sql`UPDATE tenant_secrets SET updated_at = ${new Date().toISOString()} WHERE updated_at IS NULL;`);
    }
  } catch {
    // ignore: best-effort migrations
  }
  ensured = true;
}

export function getTenantOllamaApiKey(tenantId: number): { apiKey: string | null; updatedAt: string | null } {
  ensureTenantSecretsTable();
  const row = db.get(sql`
    SELECT ollama_api_key as apiKey, updated_at as updatedAt
    FROM tenant_secrets
    WHERE tenant_id = ${tenantId}
  `) as any | undefined;
  return {
    apiKey: row?.apiKey ? String(row.apiKey) : null,
    updatedAt: row?.updatedAt ? String(row.updatedAt) : null,
  };
}

export function upsertTenantOllamaApiKey(tenantId: number, apiKey: string | null) {
  ensureTenantSecretsTable();
  const updatedAt = new Date().toISOString();
  db.run(sql`
    INSERT INTO tenant_secrets (tenant_id, ollama_api_key, updated_at)
    VALUES (${tenantId}, ${apiKey}, ${updatedAt})
    ON CONFLICT(tenant_id) DO UPDATE SET
      ollama_api_key = excluded.ollama_api_key,
      updated_at = excluded.updated_at
  `);
  return { tenantId, configured: !!(apiKey && apiKey.trim()), updatedAt };
}

export function getTenantOpenRouterApiKey(tenantId: number): { apiKey: string | null; updatedAt: string | null } {
  ensureTenantSecretsTable();
  const row = db.get(sql`
    SELECT openrouter_api_key as apiKey, updated_at as updatedAt
    FROM tenant_secrets
    WHERE tenant_id = ${tenantId}
  `) as any | undefined;
  return {
    apiKey: row?.apiKey ? String(row.apiKey) : null,
    updatedAt: row?.updatedAt ? String(row.updatedAt) : null,
  };
}

export function upsertTenantOpenRouterApiKey(tenantId: number, apiKey: string | null) {
  ensureTenantSecretsTable();
  const updatedAt = new Date().toISOString();
  db.run(sql`
    INSERT INTO tenant_secrets (tenant_id, openrouter_api_key, updated_at)
    VALUES (${tenantId}, ${apiKey}, ${updatedAt})
    ON CONFLICT(tenant_id) DO UPDATE SET
      openrouter_api_key = excluded.openrouter_api_key,
      updated_at = excluded.updated_at
  `);
  return { tenantId, configured: !!(apiKey && apiKey.trim()), updatedAt };
}

