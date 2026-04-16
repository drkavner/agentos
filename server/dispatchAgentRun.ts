import { storage } from "./storage";
import { ensureAgentConfigurationTables, getAgentRuntimeSettings } from "./agentConfiguration";
import { cliRunOnce } from "./cliAdapter";
import { openclawRunOnce } from "./openclawAdapter";
import { hermesRunOnce } from "./hermesAdapter";

/**
 * Dispatch a single agent run to the correct adapter based on per-agent runtime settings.
 * Falls back to the tenant-level adapterType if the agent has no override.
 */
export async function dispatchAgentRun(
  tenantId: number,
  agentId: number,
  opts: { reason: string; bypassCooldown?: boolean },
): Promise<{ ok: boolean; adapter: string; [key: string]: any }> {
  ensureAgentConfigurationTables();
  const runtime = getAgentRuntimeSettings(agentId);
  const tenant = storage.getTenant(tenantId);
  const adapterType = runtime.adapterType ?? (tenant?.adapterType === "openclaw" ? "openclaw" : "hermes");

  if (adapterType === "cli") {
    const r = await cliRunOnce(tenantId, agentId, { reason: opts.reason, bypassCooldown: opts.bypassCooldown });
    return { ...r, adapter: "cli" };
  }
  if (adapterType === "openclaw") {
    const r = await openclawRunOnce(tenantId, agentId, { reason: opts.reason as any });
    return { ...r, adapter: "openclaw" };
  }
  const r = await hermesRunOnce(tenantId, agentId, { reason: opts.reason as any, bypassCooldown: opts.bypassCooldown });
  return { ...r, adapter: "hermes" };
}
