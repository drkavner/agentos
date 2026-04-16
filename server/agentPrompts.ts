import { storage } from "./storage";
import { getEffectiveDefinitionSkills } from "./skillsRuntime";
import { getAgentDocs } from "./skillsRuntime";
import { ensureAgentConfigurationTables, getAgentRuntimeSettings } from "./agentConfiguration";

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
  const docs = await getAgentDocs(def.id);
  ensureAgentConfigurationTables();
  const runtime = getAgentRuntimeSettings(agentId);

  const sections: string[] = [];

  sections.push(`You are ${agent.displayName} (${agent.role}) inside org "${tenant.name}".

Mission: ${tenant.mission ?? "—"}
Goal: ${agent.goal ?? "—"}

Adapter: ${tenant.adapterType}
LLM routing: ${runtime.llmProvider === "ollama" ? "Ollama (local)" : "OpenRouter"}`);

  if (docs) {
    sections.push(docs.SOUL.markdown);
    sections.push(docs.AGENT.markdown);
    sections.push(docs.HEARTBEAT.markdown);
    sections.push(docs.TOOLS.markdown);
  }

  sections.push(`## Skills (source: ${skills.source}${skills.updatedAt ? `, updatedAt: ${skills.updatedAt}` : ""})
${skills.markdown}`);

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
