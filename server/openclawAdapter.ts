/**
 * OpenClaw orgs: execution is intended to happen in the external OpenClaw gateway.
 * Cortex records runs + collaboration signals here so the UI matches Hermes-style workflows.
 */

import { storage } from "./storage";
import { auditAndInvalidate } from "./realtimeSideEffects";
import { createAgentRun, addRunEvent, finishAgentRun } from "./agentRuns";
import { pickAgentPrimaryChannel } from "./hermesAdapter";

const collabThrottle = new Map<string, number>();
const COLLAB_COOLDOWN_MS = 12_000;

export type OpenclawRunOk = {
  ok: true;
  tokensUsed: number;
  costUsd: number;
  llmMode: "gateway";
  completedTaskId: null;
  skillsSource: "openclaw";
};

export async function openclawRunOnce(
  tenantId: number,
  agentId: number,
  _opts?: { reason?: "manual" | "scheduled" },
): Promise<OpenclawRunOk | { ok: false; error: string }> {
  const agent = storage.getAgent(agentId);
  if (!agent || agent.tenantId !== tenantId) return { ok: false, error: "agent_not_found" };
  const tenant = storage.getTenant(tenantId);
  if (!tenant) return { ok: false, error: "tenant_not_found" };
  if (tenant.adapterType !== "openclaw") return { ok: false, error: "not_openclaw" };

  const run = createAgentRun({ tenantId, agentId, trigger: "on_demand" });
  addRunEvent(run.id, {
    kind: "event",
    message:
      "OpenClaw: run registered in Cortex. Heavy execution is performed by your OpenClaw gateway; this app records runs and collaboration for visibility.",
  });

  const def = storage.getAgentDefinition(agent.definitionId);
  const primary = pickAgentPrimaryChannel(tenantId, agentId, null);
  const body = [
    `[OpenClaw] Manual run from Cortex — prompts/skills for this agent are loaded here.`,
    `Hook your OpenClaw gateway to automate real work; this message confirms the run signal was saved (run #${run.id}).`,
  ].join(" ");

  const posted = storage.createMessage({
    tenantId,
    channelId: primary.channelId,
    channelType: primary.channelType,
    senderAgentId: agentId,
    senderName: `${agent.displayName} (${agent.role})`,
    senderEmoji: def?.emoji ?? "🤖",
    content: body,
    messageType: "chat",
    metadata: { openclawRun: true, runId: run.id },
  } as any);

  addRunEvent(run.id, { kind: "stdout", message: `Posted collaboration message #${posted.id} → ${primary.channelId}` });

  auditAndInvalidate(tenantId, ["messages"], {
    agentId,
    agentName: `${agent.displayName} (${agent.role})`,
    action: "message_sent",
    entity: "message",
    entityId: String(posted.id),
    detail: body.slice(0, 200),
    tokensUsed: 0,
    cost: 0,
  });

  finishAgentRun(run.id, { status: "ok", summary: "OpenClaw run recorded in Cortex", error: null });

  storage.updateAgent(agentId, { lastHeartbeat: new Date().toISOString() });
  auditAndInvalidate(tenantId, ["agents"], {
    agentId,
    agentName: agent.displayName,
    action: "openclaw_run_once",
    entity: "agent",
    entityId: String(agentId),
    detail: `OpenClaw run #${run.id}`,
    tokensUsed: 0,
    cost: 0,
  });

  return {
    ok: true,
    tokensUsed: 0,
    costUsd: 0,
    llmMode: "gateway",
    completedTaskId: null,
    skillsSource: "openclaw",
  };
}

function channelKey(tenantId: number, channelId: string) {
  return `${tenantId}:${channelId}`;
}

/** After a user posts in Collaboration, add a visible reply (throttled). */
export async function collaborationAfterUserMessage(
  tenantId: number,
  channelId: string,
  senderName: string,
  messageType: string,
  content?: string,
): Promise<void> {
  if (messageType !== "chat") return;
  if (senderName.trim() !== "You") return;

  const tenant = storage.getTenant(tenantId);
  if (!tenant) return;

  const key = channelKey(tenantId, channelId);
  const now = Date.now();
  const last = collabThrottle.get(key) ?? 0;
  if (now - last < COLLAB_COOLDOWN_MS) return;
  collabThrottle.set(key, now);

  if (tenant.adapterType === "openclaw") {
    try {
      await openclawCollaborationAck(tenantId, channelId, content);
    } catch (err: any) {
      auditAndInvalidate(tenantId, ["audit"], {
        agentId: undefined,
        agentName: "system",
        action: "collaboration_auto_reply_failed",
        entity: "message",
        entityId: channelId,
        detail: `OpenClaw auto-reply failed: ${String(err?.message ?? err)}`,
        tokensUsed: 0,
        cost: 0,
      });
      throw err;
    }
    return;
  }

  if (tenant.adapterType === "hermes") {
    const agents = storage.getAgents(tenantId);
    const ceo = agents.find((a) => String(a.role).toLowerCase() === "ceo");
    const anyRunning = agents.find((a) => a.status === "running");
    const target = (ceo?.status === "running" ? ceo : null) ?? anyRunning ?? ceo;
    if (!target) return;
    const { hermesRunOnce } = await import("./hermesAdapter");
    await hermesRunOnce(tenantId, target.id, { reason: "manual" });
  }
}

async function openclawCollaborationAck(tenantId: number, channelId: string, userContent?: string) {
  const agents = storage.getAgents(tenantId);
  const ceo = agents.find((a) => String(a.role).toLowerCase() === "ceo");
  const dmMatch = /^dm-(\d+)$/.exec(channelId);
  const dmAgent = dmMatch ? agents.find((a) => a.id === Number(dmMatch[1])) : undefined;
  const agent = dmAgent ?? ceo ?? agents.find((a) => a.status === "running");
  if (!agent) return;

  const def = storage.getAgentDefinition(agent.definitionId);
  const channelType = channelId.startsWith("team-")
    ? "team"
    : channelId.startsWith("dm-")
      ? "dm"
      : "general";

  const snippet =
    userContent && userContent.trim()
      ? userContent.trim().length > 160
        ? `${userContent.trim().slice(0, 157)}…`
        : userContent.trim()
      : "";
  const content = [
    snippet ? `You said: “${snippet}”` : `Ping in #${channelId.replace(/^team-/, "team ").replace(/^dm-/, "DM ")}.`,
    `I’m ${agent.displayName} (${agent.role}) — this org uses OpenClaw; heavy work runs in your gateway, but Cortex keeps this channel two-way.`,
    `Use Run on an agent to log a run here, or connect your gateway for deeper automation.`,
  ].join(" ");

  const posted = storage.createMessage({
    tenantId,
    channelId,
    channelType,
    senderAgentId: agent.id,
    senderName: `${agent.displayName} (${agent.role})`,
    senderEmoji: def?.emoji ?? "🤖",
    content,
    messageType: "chat",
    metadata: { openclawCollaboration: true },
  } as any);

  auditAndInvalidate(tenantId, ["messages"], {
    agentId: agent.id,
    agentName: `${agent.displayName} (${agent.role})`,
    action: "message_sent",
    entity: "message",
    entityId: String(posted.id),
    detail: content.slice(0, 200),
    tokensUsed: 0,
    cost: 0,
  });
}
