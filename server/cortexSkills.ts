import { db } from "./db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

let ensured = false;

export function ensureCortexSkillsTables() {
  if (ensured) return;

  db.run(sql`
    CREATE TABLE IF NOT EXISTS cortex_skills_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      markdown TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tenant_cortex_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS tenant_cortex_skills_tenant_idx
    ON tenant_cortex_skills (tenant_id);
  `);
  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS tenant_cortex_skills_tenant_slug_uniq
    ON tenant_cortex_skills (tenant_id, slug);
  `);

  // Sync required skills from repo markdown (real source of truth)
  const now = new Date().toISOString();
  const required = [
    {
      slug: "cortex",
      name: "cortex",
      file: "cortex.md",
    },
    {
      slug: "cortex-create-agent",
      name: "cortex-create-agent",
      file: "cortex-create-agent.md",
    },
    {
      slug: "cortex-create-plugin",
      name: "cortex-create-plugin",
      file: "cortex-create-plugin.md",
    },
    {
      slug: "para-memory-files",
      name: "para-memory-files",
      file: "para-memory-files.md",
    },
  ];

  const libRoot = path.join(process.cwd(), "cortex-skills", "library");
  for (const s of required) {
    let md = "";
    try {
      md = fs.readFileSync(path.join(libRoot, s.file), "utf-8");
    } catch {
      md = `# ${s.name}\n\n(Missing source file: ${s.file})\n`;
    }

    // Upsert (so editing markdown files updates what the UI shows)
    db.run(sql`
      INSERT INTO cortex_skills_library (slug, name, markdown, updated_at)
      VALUES (${s.slug}, ${s.name}, ${md}, ${now})
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        markdown = excluded.markdown,
        updated_at = excluded.updated_at;
    `);
  }

  ensured = true;
}

