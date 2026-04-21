import { storage } from "./storage";
import { getEffectiveDefinitionSkills } from "./skillsRuntime";
import { ensureAgentConfigurationTables, getAgentRuntimeSettings } from "./agentConfiguration";
import { agentInstanceHasSkillsFile, getMergedAgentDocsForDeployed } from "./agentInstanceDocs";

/** Shared system prompt for Hermes runs and `runtime-context` API. */
export async function buildAgentSystemPrompt(tenantId: number, agentId: number): Promise<string> {
  const tenant = storage.getTenant(tenantId);
  const agent = storage.getAgent(agentId);
  if (!tenant || !agent || agent.tenantId !== tenantId) {
    throw new Error("buildAgentSystemPrompt: tenant or agent not found");
  }
  const def = storage.getAgentDefinition(agent.definitionId);
  if (!def) throw new Error("buildAgentSystemPrompt: agent definition not found");

  const skills = await getEffectiveDefinitionSkills(tenantId, def.id);
  const docs = await getMergedAgentDocsForDeployed(tenantId, agentId, def.id);
  const useInstanceSkillsFile = agentInstanceHasSkillsFile(tenantId, agentId);
  ensureAgentConfigurationTables();
  const runtime = getAgentRuntimeSettings(agentId);

  // Build org hierarchy context
  const allAgents = storage.getAgents(tenantId);
  const manager = agent.managerId ? allAgents.find(a => a.id === agent.managerId) : null;
  const directReports = allAgents.filter(a => a.managerId === agent.id);
  const isLeader = directReports.length > 0;
  const isCeo = !agent.managerId && String(agent.role).toLowerCase().includes("ceo");

  const sections: string[] = [];

  const hierarchyLines: string[] = [];
  if (isCeo) {
    hierarchyLines.push(`You are the CEO. You lead this entire organization.`);
    hierarchyLines.push(`Your direct reports: ${directReports.map(r => `${r.displayName} (${r.role})`).join(", ")}.`);
    hierarchyLines.push(`You set direction, make decisions, delegate tasks, and hold your team accountable.`);
  } else if (isLeader) {
    hierarchyLines.push(`You report to: ${manager ? `${manager.displayName} (${manager.role})` : "—"}.`);
    hierarchyLines.push(`Your direct reports: ${directReports.map(r => `${r.displayName} (${r.role})`).join(", ")}.`);
    hierarchyLines.push(`You lead your team, delegate work to your reports, and report progress upward.`);
  } else {
    hierarchyLines.push(`You report to: ${manager ? `${manager.displayName} (${manager.role})` : "—"}.`);
    hierarchyLines.push(`You are an individual contributor. Execute tasks assigned to you and report back.`);
  }

  const peers = manager ? allAgents.filter(a => a.managerId === agent.managerId && a.id !== agent.id) : [];

  sections.push(`You are ${agent.displayName} (${agent.role}) inside org "${tenant.name}".

Mission: ${tenant.mission ?? "—"}
Goal: ${agent.goal ?? "—"}

${hierarchyLines.join("\n")}
${peers.length > 0 ? `Peers: ${peers.map(p => `${p.displayName} (${p.role})`).join(", ")}.` : ""}

COMMUNICATION STYLE:
- Be direct and professional. Use your name and role naturally.
- Reference teammates by name when coordinating.
- When giving orders (if you're a leader), be clear and specific.
- When reporting status, lead with concrete metrics or blockers.
- Keep messages concise: 1-3 sentences for updates, more for deliverables.
- Use @Name to address someone directly.`);

  if (docs) {
    sections.push(docs.SOUL.markdown);
    sections.push(docs.AGENT.markdown);
    sections.push(docs.HEARTBEAT.markdown);
    sections.push(docs.TOOLS.markdown);
  }

  const skillsHeaderSource = useInstanceSkillsFile ? "instance SKILLS.md" : skills.source;
  const skillsHeaderMeta = !useInstanceSkillsFile && skills.updatedAt ? `, updatedAt: ${skills.updatedAt}` : "";
  sections.push(`## Skills (source: ${skillsHeaderSource}${skillsHeaderMeta})
${docs ? docs.SKILLS.markdown : skills.markdown}`);

  sections.push(`## Runtime Settings
- model: ${runtime.model || agent.model}
- bypassSandbox: ${runtime.bypassSandbox}
- enableSearch: ${runtime.enableSearch}
- command: ${runtime.command || "—"}
- thinkingEffort: ${runtime.thinkingEffort}
- timeoutSec: ${runtime.timeoutSec}
- heartbeatEnabled: ${runtime.heartbeatEnabled}
- heartbeatEverySec: ${runtime.heartbeatEverySec}
- cooldownSec: ${runtime.cooldownSec}
- maxConcurrentRuns: ${runtime.maxConcurrentRuns}`);

  return sections.join("\n\n---\n\n");
}
