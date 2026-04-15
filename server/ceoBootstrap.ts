import { insertAgentSchema } from "@shared/schema";
import { storage } from "./storage";
import { ensureAgentDefinitionsCatalog } from "./agentDefinitionsCatalog";
import { upsertAgentRuntimeSettings } from "./agentConfiguration";
import { auditAndInvalidate } from "./realtimeSideEffects";

const DEFAULT_CEO_FILES: Record<string, string> = {
  "AGENTS.md": `You are the CEO. Your job is to lead the company, not to do individual contributor work.\nYou own strategy, prioritization, and cross-functional coordination.\n\n## Delegation (critical)\nYou MUST delegate work rather than doing it yourself.\n\nRouting rules:\n- Code, bugs, features, infra, devtools → CTO\n- Marketing, content, social media, growth, devrel → CMO\n- UX, design, user research, design-system → UXDesigner\n`,
  "HEARTBEAT.md": `# HEARTBEAT.md — CEO Heartbeat Checklist\n\nRun this checklist on every heartbeat.\n\n1. Identity and Context\n2. Local Planning Check\n3. Approval Follow-Up\n4. Get Assignments\n5. Delegation\n6. Exit\n`,
  "SOUL.md": `# SOUL.md — CEO Persona\n\n- Default to action\n- Delegate execution\n- Stay close to the customer\n`,
  "TOOLS.md": `# Tools\n\n(Your tools will go here. Add notes about them as you acquire and use them.)\n`,
};

/**
 * Creates the default CEO agent + instruction files for a tenant.
 * Caller must ensure the tenant row already exists.
 */
export function createDefaultCeoForTenant(
  tenantId: number,
  tenantName: string,
  opts?: { agentHiredDetail?: string; filesDetail?: string },
) {
  ensureAgentDefinitionsCatalog();
  const defs = storage.getAgentDefinitions();
  if (defs.length === 0) {
    throw new Error("Agent definition catalog is still empty after ensureAgentDefinitionsCatalog()");
  }
  const orchestrator = defs.find((d) => d.name === "Agents Orchestrator") ?? defs[0]!;
  const ceoParsed = insertAgentSchema.safeParse({
    tenantId,
    definitionId: orchestrator.id,
    displayName: "CEO",
    role: "CEO",
    model: "claude-3-5-sonnet",
    monthlyBudget: 200,
    status: "running",
    goal: `Lead ${tenantName} and orchestrate all teams toward the mission.`,
    heartbeatSchedule: "*/30 * * * *",
  });
  if (!ceoParsed.success) {
    throw new Error(`CEO validation failed: ${JSON.stringify(ceoParsed.error?.issues ?? ceoParsed.error)}`);
  }
  const ceo = storage.createAgent(ceoParsed.data);
  upsertAgentRuntimeSettings(ceo.id, {
    llmProvider: "openrouter",
    bypassSandbox: true,
    heartbeatEnabled: true,
    wakeOnDemand: true,
    cooldownSec: 10,
    maxConcurrentRuns: 1,
    canCreateAgents: true,
    canAssignTasks: true,
  });

  auditAndInvalidate(tenantId, ["agents"], {
    agentId: ceo.id,
    agentName: `${ceo.displayName} (${ceo.role})`,
    action: "agent_hired",
    entity: "agent",
    entityId: String(ceo.id),
    detail: opts?.agentHiredDetail ?? "Auto-created CEO on org setup",
    tokensUsed: 0,
    cost: 0,
  });

  for (const [filename, markdown] of Object.entries(DEFAULT_CEO_FILES)) {
    storage.upsertCeoFile(tenantId, filename, { filename, markdown });
  }
  auditAndInvalidate(tenantId, ["ceo_files"], {
    action: "ceo_files_created",
    entity: "ceo_files",
    entityId: String(tenantId),
    detail: opts?.filesDetail ?? "Created default CEO instruction files",
    tokensUsed: 0,
    cost: 0,
  });

  return ceo;
}

/** Backfills CEO for any tenant that is missing one (fixes partial failures + old DBs). */
export function repairAllTenantsMissingCeo() {
  try {
    ensureAgentDefinitionsCatalog();
  } catch (e) {
    console.error("[ceo-bootstrap] ensureAgentDefinitionsCatalog failed:", e);
    return;
  }
  for (const t of storage.getTenants()) {
    const agents = storage.getAgents(t.id);
    const hasCeo = agents.some((a) => String(a.role).toLowerCase() === "ceo");
    if (hasCeo) continue;
    try {
      createDefaultCeoForTenant(t.id, t.name, {
        agentHiredDetail: `Backfilled missing CEO for organization "${t.name}"`,
        filesDetail: "Backfilled default CEO instruction files",
      });
      console.log(`[ceo-bootstrap] Created CEO for tenant ${t.id} (${t.name})`);
    } catch (e) {
      console.error(`[ceo-bootstrap] Failed to create CEO for tenant ${t.id}:`, e);
    }
  }
}
