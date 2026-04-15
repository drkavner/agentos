import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { resolveSqliteDbPath } from "../server/dbPath";

type AgentDefinitionRow = {
  id: number;
  name: string;
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

function mdEscape(s: string) {
  return String(s ?? "").replace(/\r\n/g, "\n").trim();
}

function guessSkillBullets(def: AgentDefinitionRow) {
  // Keep it deterministic; "specialty" is already curated seed text.
  const raw = def.specialty
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq: string[] = [];
  for (const r of raw) {
    const key = r.toLowerCase();
    if (!uniq.some((u) => u.toLowerCase() === key)) uniq.push(r);
  }
  return uniq.length > 0 ? uniq : [def.specialty];
}

function renderSkillsMd(def: AgentDefinitionRow) {
  const bullets = guessSkillBullets(def);
  return `# ${mdEscape(def.name)} — Skills

## Summary
${mdEscape(def.description)}

## Division
${mdEscape(def.division)}

## Skills
${bullets.map((b) => `- ${mdEscape(b)}`).join("\n")}

## When to use
${mdEscape(def.when_to_use)}

## Source
${mdEscape(def.source)}
`;
}

function main() {
  const dbPath = resolveSqliteDbPath();
  const outRoot = path.join(process.cwd(), "agent-library");
  const outDefs = path.join(outRoot, "agent-definitions");

  ensureDir(outDefs);

  const db = new Database(dbPath);
  const rows = db
    .prepare(
      `select id, name, division, specialty, description, when_to_use, source
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

- Per Agent Library template, we generate a \`skills.md\`.
- Run: \`npm run skills:generate\`

Output path: \`agent-library/agent-definitions/<slug>__<id>/skills.md\`
`;
  fs.writeFileSync(path.join(outRoot, "README.md"), readme);

  let count = 0;
  for (const def of rows) {
    const slug = slugify(def.name);
    const folder = path.join(outDefs, `${slug}__${def.id}`);
    ensureDir(folder);
    fs.writeFileSync(path.join(folder, "skills.md"), renderSkillsMd(def));
    count++;
  }

  console.log(`Generated ${count} skills.md files in ${outDefs}`);
}

main();

