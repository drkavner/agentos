import { db } from "./db";
import { sql } from "drizzle-orm";

let ensured = false;

export function ensureCeoFilesTable() {
  if (ensured) return;
  // Create table/index at runtime so existing DBs work without migration ceremony.
  db.run(sql`
    CREATE TABLE IF NOT EXISTS ceo_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      markdown TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS ceo_files_tenant_filename_idx
    ON ceo_files (tenant_id, filename);
  `);
  ensured = true;
}

