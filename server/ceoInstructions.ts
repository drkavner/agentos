import fs from "fs";
import path from "path";
import os from "os";
import { db } from "./db";
import { sql } from "drizzle-orm";

export type CeoInstructionsMode = "managed" | "external";

let ensured = false;

export function ensureCeoInstructionSettingsTable() {
  if (ensured) return;
  db.run(sql`
    CREATE TABLE IF NOT EXISTS ceo_instruction_settings (
      tenant_id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'managed',
      root_path TEXT NOT NULL,
      entry_file TEXT NOT NULL DEFAULT 'AGENTS.md',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS ceo_instruction_settings_tenant_idx
    ON ceo_instruction_settings (tenant_id);
  `);
  ensured = true;
}

export function ensurePaperclipIdentityTable() {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS paperclip_identity (
      tenant_id INTEGER PRIMARY KEY,
      company_id TEXT NOT NULL,
      ceo_agent_id INTEGER NOT NULL,
      ceo_paperclip_agent_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (ceo_agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS paperclip_identity_tenant_idx
    ON paperclip_identity (tenant_id);
  `);
}

export function managedRootPathForTenant(tenantId: number) {
  // Deprecated: keep signature for older calls, but we now use ~/.paperclip path with stable uuids.
  return path.join(os.homedir(), ".paperclip", "instances", "default", "companies", String(tenantId), "instructions");
}

export function managedRootPathForPaperclip(companyId: string, agentId: string) {
  return path.join(
    os.homedir(),
    ".cortex",
    "instances",
    "default",
    "companies",
    companyId,
    "agents",
    agentId,
    "instructions",
  );
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function safeJoin(rootPath: string, filename: string) {
  const root = path.resolve(rootPath);
  const full = path.resolve(rootPath, filename);
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw new Error("Path traversal blocked");
  }
  return full;
}

export function listMarkdownFiles(rootPath: string) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => n.toLowerCase().endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));
}

export function readFileUtf8(fullPath: string) {
  return fs.readFileSync(fullPath, "utf-8");
}

export function writeFileUtf8(fullPath: string, content: string) {
  fs.writeFileSync(fullPath, content, "utf-8");
}

export function deleteFileIfExists(fullPath: string) {
  try {
    fs.unlinkSync(fullPath);
  } catch {
    // ignore
  }
}

