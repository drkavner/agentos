import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { AGENT_DOC_TYPES, renderAgentDoc, type AgentDefInput, type AgentDocType } from "./agentDocTemplates";

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function renderDefinitionSkillsMd(def: {
  id: number;
  name: string;
  division: string;
  specialty: string;
  description: string;
  whenToUse: string;
  source: string;
}) {
  const skills = def.specialty
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bullets = skills.length ? skills : [def.specialty];
  return `# ${def.name} — Skills

## Summary
${def.description}

## Division
${def.division}

## Skills
${bullets.map((b) => `- ${b}`).join("\n")}

## When to use
${def.whenToUse}

## Source
${def.source}
`;
}

export type EffectiveSkills = { markdown: string; source: "override" | "file" | "generated"; updatedAt?: string };

export async function getEffectiveDefinitionSkills(
  tenantId: number,
  definitionId: number,
): Promise<EffectiveSkills> {
  const def = storage.getAgentDefinition(definitionId);
  if (!def) return { markdown: "Agent definition not found.", source: "generated" };

  // 1) Org override
  const override = storage.getAgentDefinitionSkills(tenantId, definitionId);
  if (override) return { markdown: override.markdown, source: "override", updatedAt: override.updatedAt };

  // 2) Repo generated file
  const outRoot = path.join(process.cwd(), "agent-library", "agent-definitions");
  const folder = `${slugify(def.name)}__${def.id}`;
  const skillsPath = path.join(outRoot, folder, "skills.md");
  try {
    const md = await fs.promises.readFile(skillsPath, "utf-8");
    return { markdown: md, source: "file" };
  } catch {
    // 3) Deterministic fallback
    return {
      markdown: renderDefinitionSkillsMd({
        id: def.id,
        name: def.name,
        division: def.division,
        specialty: def.specialty,
        description: def.description,
        whenToUse: def.whenToUse,
        source: def.source,
      }),
      source: "generated",
    };
  }
}

// ─── Full agent docs (SOUL, AGENT, HEARTBEAT, TOOLS, SKILLS) ───────────────

export type AgentDocs = Record<AgentDocType, { markdown: string; source: "file" | "generated" }>;

function defToInput(def: { id: number; name: string; emoji: string; division: string; specialty: string; description: string; whenToUse: string; source: string }): AgentDefInput {
  return { id: def.id, name: def.name, emoji: def.emoji, division: def.division, specialty: def.specialty, description: def.description, whenToUse: def.whenToUse, source: def.source };
}

export async function getAgentDocs(definitionId: number): Promise<AgentDocs | null> {
  const def = storage.getAgentDefinition(definitionId);
  if (!def) return null;

  const outRoot = path.join(process.cwd(), "agent-library", "agent-definitions");
  const folder = `${slugify(def.name)}__${def.id}`;
  const input = defToInput(def);
  const result = {} as AgentDocs;

  for (const docType of AGENT_DOC_TYPES) {
    const filePath = path.join(outRoot, folder, `${docType}.md`);
    try {
      const md = await fs.promises.readFile(filePath, "utf-8");
      result[docType] = { markdown: md, source: "file" };
    } catch {
      result[docType] = { markdown: renderAgentDoc(docType, input), source: "generated" };
    }
  }

  return result;
}

export function getAgentDocsSync(definitionId: number): AgentDocs | null {
  const def = storage.getAgentDefinition(definitionId);
  if (!def) return null;

  const outRoot = path.join(process.cwd(), "agent-library", "agent-definitions");
  const folder = `${slugify(def.name)}__${def.id}`;
  const input = defToInput(def);
  const result = {} as AgentDocs;

  for (const docType of AGENT_DOC_TYPES) {
    const filePath = path.join(outRoot, folder, `${docType}.md`);
    try {
      const md = fs.readFileSync(filePath, "utf-8");
      result[docType] = { markdown: md, source: "file" };
    } catch {
      result[docType] = { markdown: renderAgentDoc(docType, input), source: "generated" };
    }
  }

  return result;
}
