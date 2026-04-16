import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { resolveSqliteDbPath } from "../server/dbPath";
import { AGENT_DOC_TYPES, renderAgentDoc, type AgentDefInput } from "../server/agentDocTemplates";

type AgentDefinitionRow = {
  id: number;
  name: string;
  emoji: string;
  division: string;
  specialty: string;
  description: string;
  when_to_use: string;
  source: string;
};

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const dbPath = resolveSqliteDbPath();
  const outRoot = path.join(process.cwd(), "agent-library");
  const outDefs = path.join(outRoot, "agent-definitions");

  ensureDir(outDefs);

  const db = new Database(dbPath);
  const rows = db
    .prepare(
      `select id, name, emoji, division, specialty, description, when_to_use, source
       from agent_definitions
       order by division asc, name asc`,
    )
    .all() as AgentDefinitionRow[];

  if (rows.length === 0) {
    console.log(
      `No agent_definitions found in ${dbPath}. Seed the DB (SEED=true) then rerun.`,
    );
    process.exitCode = 1;
    return;
  }

  const readme = `# Agent Library

This folder is generated from the SQLite database.

Each agent definition gets a folder with 5 canonical docs:
- **SOUL.md** — Identity, personality, values
- **AGENT.md** — Role, mission, operational rules
- **HEARTBEAT.md** — Scheduled heartbeat behavior
- **TOOLS.md** — Available tools and integrations
- **SKILLS.md** — Core skills and when to use

Run: \`npm run skills:generate\`

Output path: \`agent-library/agent-definitions/<slug>__<id>/\`
`;
  fs.writeFileSync(path.join(outRoot, "README.md"), readme);

  let fileCount = 0;
  for (const row of rows) {
    const slug = slugify(row.name);
    const folder = path.join(outDefs, `${slug}__${row.id}`);
    ensureDir(folder);

    const def: AgentDefInput = {
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      division: row.division,
      specialty: row.specialty,
      description: row.description,
      whenToUse: row.when_to_use,
      source: row.source,
    };

    for (const docType of AGENT_DOC_TYPES) {
      const filename = `${docType}.md`;
      const content = renderAgentDoc(docType, def);
      fs.writeFileSync(path.join(folder, filename), content);
      fileCount++;
    }

    // Keep backward-compatible skills.md (lowercase alias)
    const skillsContent = renderAgentDoc("SKILLS", def);
    fs.writeFileSync(path.join(folder, "skills.md"), skillsContent);
  }

  console.log(`Generated ${fileCount} doc files across ${rows.length} agent definitions in ${outDefs}`);
}

main();
