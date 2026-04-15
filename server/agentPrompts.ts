import { storage } from "./storage";
import { getEffectiveDefinitionSkills } from "./skillsRuntime";
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
  ensureAgentConfigurationTables();
  const runtime = getAgentRuntimeSettings(agentId);

  return `You are ${agent.displayName} (${agent.role}) inside org ${tenant.name}.

Mission: ${tenant.mission ?? "—"}
Goal: ${agent.goal ?? "—"}

Adapter: ${tenant.adapterType}
LLM routing: ${runtime.llmProvider === "ollama" ? "Ollama (local)" : "OpenRouter"}

## Runtime settings
- bypassSandbox: ${runtime.bypassSandbox}
- enableSearch: ${runtime.enableSearch}
- command: ${runtime.command || "—"}
- model: ${runtime.model || agent.model}
- thinkingEffort: ${runtime.thinkingEffort}
- timeoutSec: ${runtime.timeoutSec}
- interruptGraceSec: ${runtime.interruptGraceSec}
- heartbeatEnabled: ${runtime.heartbeatEnabled}
- heartbeatEverySec: ${runtime.heartbeatEverySec}

## Advanced run policy
- wakeOnDemand: ${runtime.wakeOnDemand}
- cooldownSec: ${runtime.cooldownSec}
- maxConcurrentRuns: ${runtime.maxConcurrentRuns}

## Skills (source: ${skills.source}${skills.updatedAt ? `, updatedAt: ${skills.updatedAt}` : ""})
${skills.markdown}
`;
}
