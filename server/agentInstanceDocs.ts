import fs from "fs";
import path from "path";
import { AGENT_DOC_TYPES, type AgentDocType } from "./agentDocTemplates";
import type { AgentDocs } from "./skillsRuntime";
import { getAgentDocs, getEffectiveDefinitionSkills } from "./skillsRuntime";

/** On-disk instructions for a deployed agent (per tenant + agent id). */
export function agentInstanceInstructionsDir(tenantId: number, agentId: number) {
  return path.join(process.cwd(), "agent-instructions", `tenant-${tenantId}`, `agent-${agentId}`);
}

const ALLOWED_INSTANCE_FILENAMES = new Set(AGENT_DOC_TYPES.map((t) => `${t}.md`));

export function parseAgentDocFilesFromBody(body: Record<string, unknown>): { filename: string; markdown: string }[] {
  const raw = body.files;
  if (!Array.isArray(raw)) return [];
  const out: { filename: string; markdown: string }[] = [];
  for (const entry of raw) {
    if (entry == null || typeof entry !== "object") continue;
    const fn = String((entry as { filename?: unknown }).filename ?? "").trim();
    const md = String((entry as { markdown?: unknown }).markdown ?? "");
    if (!fn || !ALLOWED_INSTANCE_FILENAMES.has(fn)) continue;
    out.push({ filename: fn, markdown: md });
  }
  return out;
}

export function stripAgentDocFilesFromBody(body: Record<string, unknown>) {
  delete body.files;
}

function instanceDocPath(tenantId: number, agentId: number, docType: AgentDocType) {
  return path.join(agentInstanceInstructionsDir(tenantId, agentId), `${docType}.md`);
}

/** Writes default SOUL–SKILLS from the definition catalog + effective skills when files are missing. */
export async function materializeDefaultAgentInstanceDocs(tenantId: number, agentId: number, definitionId: number) {
  const dir = agentInstanceInstructionsDir(tenantId, agentId);
  await fs.promises.mkdir(dir, { recursive: true });
  const base = await getAgentDocs(definitionId);
  if (!base) return;
  const skillsEff = await getEffectiveDefinitionSkills(tenantId, definitionId);
  for (const docType of AGENT_DOC_TYPES) {
    const p = instanceDocPath(tenantId, agentId, docType);
    try {
      await fs.promises.access(p);
    } catch {
      const content = docType === "SKILLS" ? skillsEff.markdown : base[docType].markdown;
      await fs.promises.writeFile(p, content, "utf-8");
    }
  }
}

export async function writeAgentInstanceDocOverlays(
  tenantId: number,
  agentId: number,
  files: { filename: string; markdown: string }[],
) {
  const dir = agentInstanceInstructionsDir(tenantId, agentId);
  await fs.promises.mkdir(dir, { recursive: true });
  for (const f of files) {
    if (!ALLOWED_INSTANCE_FILENAMES.has(f.filename)) continue;
    await fs.promises.writeFile(path.join(dir, f.filename), f.markdown, "utf-8");
  }
}

export function agentInstanceHasSkillsFile(tenantId: number, agentId: number): boolean {
  try {
    return fs.existsSync(instanceDocPath(tenantId, agentId, "SKILLS"));
  } catch {
    return false;
  }
}

/**
 * Definition docs + org-effective SKILLS, overridden by per-agent files under `agent-instructions/…`.
 * If the instance folder has no SOUL.md yet, defaults are materialized once (legacy agents + race safety).
 */
export async function getMergedAgentDocsForDeployed(
  tenantId: number,
  agentId: number,
  definitionId: number,
): Promise<AgentDocs | null> {
  const soulPath = instanceDocPath(tenantId, agentId, "SOUL");
  try {
    await fs.promises.access(soulPath);
  } catch {
    await materializeDefaultAgentInstanceDocs(tenantId, agentId, definitionId);
  }

  const base = await getAgentDocs(definitionId);
  if (!base) return null;
  const skillsEff = await getEffectiveDefinitionSkills(tenantId, definitionId);
  const merged = { ...base } as AgentDocs;

  for (const docType of AGENT_DOC_TYPES) {
    const p = instanceDocPath(tenantId, agentId, docType);
    try {
      const md = await fs.promises.readFile(p, "utf-8");
      merged[docType] = { markdown: md, source: "file" };
    } catch {
      if (docType === "SKILLS") {
        merged.SKILLS = {
          markdown: skillsEff.markdown,
          source: skillsEff.source === "generated" ? "generated" : "file",
        };
      }
    }
  }
  return merged;
}
