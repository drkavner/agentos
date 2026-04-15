import Database from "better-sqlite3";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../shared/schema";
import { resolveSqliteDbPath } from "../server/dbPath";

const dbPath = resolveSqliteDbPath();
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

const db = drizzle(sqlite, { schema });

const migrationsFolder = path.join(process.cwd(), "migrations");

function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function baselineExistingDatabase() {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journalRaw = readFileSync(journalPath, "utf-8");
  const journal = JSON.parse(journalRaw) as {
    entries: Array<{ tag: string; when: number }>;
  };

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `);

  const existing = sqlite
    .prepare(`SELECT COUNT(1) as c FROM "__drizzle_migrations"`)
    .get() as { c: number };
  if (existing.c > 0) {
    throw new Error(
      `Refusing to baseline: "__drizzle_migrations" already has entries`,
    );
  }

  const insert = sqlite.prepare(
    `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`,
  );

  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, "utf-8");
    insert.run(sha256Hex(sql), entry.when);
  }
}

try {
  migrate(db, { migrationsFolder });
  console.log(`Migrations applied to ${dbPath}`);
} catch (err: any) {
  const message = String(err?.cause?.message || err?.message || err);
  const code = err?.cause?.code || err?.code;

  const cleanupLegacyFks = () => {
    // Best-effort cleanup for legacy data before adding FK constraints.
    // Safe because these relationships are nullable/optional in the app.
    sqlite.exec(`
      -- Remove orphan rows from prior non-cascading deletes
      DELETE FROM messages WHERE tenant_id NOT IN (SELECT id FROM tenants);
      DELETE FROM tasks WHERE tenant_id NOT IN (SELECT id FROM tenants);
      DELETE FROM goals WHERE tenant_id NOT IN (SELECT id FROM tenants);
      DELETE FROM audit_log WHERE tenant_id NOT IN (SELECT id FROM tenants);
      DELETE FROM teams WHERE tenant_id NOT IN (SELECT id FROM tenants);
      DELETE FROM agents WHERE tenant_id NOT IN (SELECT id FROM tenants);

      UPDATE messages
      SET sender_agent_id = NULL
      WHERE sender_agent_id IS NOT NULL
        AND sender_agent_id NOT IN (SELECT id FROM agents);

      UPDATE tasks
      SET assigned_agent_id = NULL
      WHERE assigned_agent_id IS NOT NULL
        AND assigned_agent_id NOT IN (SELECT id FROM agents);

      UPDATE tasks
      SET created_by_id = NULL
      WHERE created_by_id IS NOT NULL
        AND created_by_id NOT IN (SELECT id FROM agents);

      UPDATE tasks
      SET team_id = NULL
      WHERE team_id IS NOT NULL
        AND team_id NOT IN (SELECT id FROM teams);

      UPDATE audit_log
      SET agent_id = NULL
      WHERE agent_id IS NOT NULL
        AND agent_id NOT IN (SELECT id FROM agents);

      DELETE FROM team_members
      WHERE team_id NOT IN (SELECT id FROM teams)
         OR agent_id NOT IN (SELECT id FROM agents);
    `);
  };

  // If the DB was previously created via `drizzle-kit push`, tables may already exist
  // but there is no migration history. Baseline it so future migrations can apply.
  if (
    message.includes("already exists") &&
    (process.env.NODE_ENV !== "production" || process.env.ALLOW_BASELINE === "true")
  ) {
    baselineExistingDatabase();
    console.log(`Baselined existing DB for migrations: ${dbPath}`);
  } else if (
    code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
    message.includes("FOREIGN KEY constraint failed")
  ) {
    cleanupLegacyFks();
    migrate(db, { migrationsFolder });
    console.log(`Migrations applied to ${dbPath}`);
  } else {
    throw err;
  }
}

