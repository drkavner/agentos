import { storage } from "./storage";
import { ensureAgentConfigurationTables, getAgentRuntimeSettings } from "./agentConfiguration";
import { cliRunOnce } from "./cliAdapter";
import { openclawRunOnce } from "./openclawAdapter";
import { hermesRunOnce } from "./hermesAdapter";

export interface DispatchOpts {
  reason: string;
  bypassCooldown?: boolean;
  forceChannelId?: string;
  forceChannelType?: "general" | "team" | "dm";
  discussionContext?: string;
}

/**
 * Dispatch a single agent run to the correct adapter based on per-agent runtime settings.
 * Falls back to the tenant-level adapterType if the agent has no override.
 *
 * All adapters receive the same opts shape — discussion context, forced channel, etc.
 * CLI-based adapters (claude-code, codex, gemini-cli, opencode, cursor) route through
 * cliRunOnce which already has LLM fallback; discussion mode overrides the prompt.
 */
export async function dispatchAgentRun(
  tenantId: number,
  agentId: number,
  opts: DispatchOpts,
): Promise<{ ok: boolean; adapter: string; [key: string]: any }> {
  ensureAgentConfigurationTables();
  const runtime = getAgentRuntimeSettings(agentId);
  const tenant = storage.getTenant(tenantId);
  const adapterType = runtime.adapterType ?? (tenant?.adapterType === "openclaw" ? "openclaw" : "hermes");

  const commonOpts = {
    reason: opts.reason,
    bypassCooldown: opts.bypassCooldown,
    forceChannelId: opts.forceChannelId,
    forceChannelType: opts.forceChannelType,
    discussionContext: opts.discussionContext,
  };

  if (adapterType === "cli" || ["claude-code", "codex", "gemini-cli", "opencode", "cursor"].includes(adapterType)) {
    const r = await cliRunOnce(tenantId, agentId, commonOpts);
    return { ...r, adapter: "cli" };
  }
  if (adapterType === "openclaw") {
    const r = await openclawRunOnce(tenantId, agentId, commonOpts);
    return { ...r, adapter: "openclaw" };
  }
  // hermes and any unknown adapter type
  const r = await hermesRunOnce(tenantId, agentId, {
    reason: opts.reason as any,
    bypassCooldown: opts.bypassCooldown,
    forceChannelId: opts.forceChannelId,
    forceChannelType: opts.forceChannelType,
    discussionContext: opts.discussionContext,
  });
  return { ...r, adapter: "hermes" };
}
