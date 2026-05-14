/**
 * OpenClaw orgs: execution is intended to happen in the external OpenClaw gateway.
 * Cortex records runs + collaboration signals here so the UI matches Hermes-style workflows.
 */

import { storage } from "./storage";
import { auditAndInvalidate } from "./realtimeSideEffects";
import { createAgentRun, addRunEvent, finishAgentRun } from "./agentRuns";
import { pickAgentPrimaryChannel } from "./hermesAdapter";
import { getMergedAgentDocsForDeployed } from "./agentInstanceDocs";

const collabThrottle = new Map<string, number>();
const COLLAB_COOLDOWN_MS = 12_000;

const MAX_SKILLS_SNAPSHOT_CHARS = 12_000;

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
  _opts?: {
    reason?: "manual" | "scheduled" | string;
    bypassCooldown?: boolean;
    forceChannelId?: string;
    forceChannelType?: "general" | "team" | "dm";
    discussionContext?: string;
  },
): Promise<OpenclawRunOk | { ok: false; error: string }> {
  const agent = storage.getAgent(agentId);
  if (!agent || agent.tenantId !== tenantId) return { ok: false, error: "agent_not_found" };
  const tenant = storage.getTenant(tenantId);
  if (!tenant) return { ok: false, error: "tenant_not_found" };
  // Per-agent adapter override: allow openclaw runs regardless of tenant default

  // If discussion mode is requested, route through Hermes LLM since OpenClaw
  // gateway doesn't support interactive discussion natively.
  if (_opts?.discussionContext) {
    const { hermesRunOnce } = await import("./hermesAdapter");
    const r = await hermesRunOnce(tenantId, agentId, {
      reason: (_opts.reason ?? "manual") as any,
      bypassCooldown: _opts.bypassCooldown,
      forceChannelId: _opts.forceChannelId,
      forceChannelType: _opts.forceChannelType,
      discussionContext: _opts.discussionContext,
    });
    if (!r || (r as { ok?: boolean }).ok !== true) {
      const bad = r as { error?: string; reason?: string } | null | undefined;
      return {
        ok: false as const,
        error:
          typeof bad?.error === "string" && bad.error.trim()
            ? bad.error.trim()
            : String(bad?.reason ?? "hermes_run_failed"),
      };
    }
    return {
      ok: true as const,
      tokensUsed: (r as any).tokensUsed ?? 0,
      costUsd: (r as any).costUsd ?? 0,
      llmMode: "gateway" as const,
      completedTaskId: null,
      skillsSource: "openclaw" as const,
    };
  }

  const run = createAgentRun({ tenantId, agentId, trigger: "on_demand" });
  addRunEvent(run.id, {
    kind: "event",
    message:
      "OpenClaw adapter: this run is recorded in Cortex only (no in-app LLM). Use Hermes for a real model loop here, or have your gateway call GET …/agents/:id/runtime-context for merged prompts and SKILLS.",
  });

  const def = storage.getAgentDefinition(agent.definitionId);
  if (def) {
    try {
      const merged = await getMergedAgentDocsForDeployed(tenantId, agentId, def.id);
      const md = String(merged?.SKILLS?.markdown ?? "").trim();
      if (md.length > 0) {
        const snap = md.length > MAX_SKILLS_SNAPSHOT_CHARS ? `${md.slice(0, MAX_SKILLS_SNAPSHOT_CHARS)}\n\n… [truncated]` : md;
        addRunEvent(run.id, {
          kind: "stdout",
          message: `Merged SKILLS for this agent at run time (${md.length} chars):\n${snap}`,
        });
      } else {
        addRunEvent(run.id, { kind: "event", message: "Merged SKILLS markdown is empty for this agent." });
      }
    } catch (err) {
      addRunEvent(run.id, {
        kind: "stderr",
        message: `Could not load merged agent docs: ${String((err as Error)?.message ?? err)}`,
      });
    }
  }

  const channelId = _opts?.forceChannelId ?? pickAgentPrimaryChannel(tenantId, agentId, null).channelId;
  const channelType = _opts?.forceChannelType ?? (channelId.startsWith("team-") ? "team" : channelId.startsWith("dm-") ? "dm" : "general");
  const body = [
    `[OpenClaw] Manual run #${run.id} saved in Cortex.`,
    `No LLM or gateway call is made from this button. Open this agent’s Run tab → run #${run.id} for the merged SKILLS snapshot stored on the run.`,
  ].join("\n");

  const posted = storage.createMessage({
    tenantId,
    channelId,
    channelType,
    senderAgentId: agentId,
    senderName: `${agent.displayName} (${agent.role})`,
    senderEmoji: def?.emoji ?? "🤖",
    content: body,
    messageType: "chat",
    metadata: { openclawRun: true, runId: run.id },
  } as any);

  addRunEvent(run.id, { kind: "stdout", message: `Posted collaboration message #${posted.id} → ${channelId}` });

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

  finishAgentRun(run.id, {
    status: "ok",
    summary: `OpenClaw: run #${run.id} logged in Cortex (no in-app LLM; merged SKILLS attached to run events)`,
    error: null,
  });

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
    const dmMatch = /^dm-(\d+)$/.exec(channelId);
    const dmTarget = dmMatch ? agents.find((a) => a.id === Number(dmMatch[1])) : undefined;
    const running = agents.filter((a) => a.status === "running");
    const isDm = !!dmMatch;
    // In a DM channel, run a single target; in general/team, fan-out to multiple agents.
    const targets = isDm
      ? [
          (dmTarget?.status === "running" ? dmTarget : null) ??
            (ceo?.status === "running" ? ceo : null) ??
            running[0] ??
            dmTarget ??
            ceo,
        ].filter(Boolean)
      : [
          // CEO should lead the thread first, then other running agents chime in.
          ...(ceo?.status === "running" ? [ceo] : []),
          ...running.filter((a) => a.id !== ceo?.id),
        ].slice(0, 3); // cap to avoid spam
    if (targets.length === 0) return;
    const { hermesRunOnce } = await import("./hermesAdapter");
    const channelType = channelId.startsWith("team-") ? "team" : channelId.startsWith("dm-") ? "dm" : "general";
    for (const target of targets) {
      // eslint-disable-next-line no-await-in-loop
      const run = await hermesRunOnce(tenantId, (target as any).id, {
        reason: "manual",
        forceChannelId: channelId,
        forceChannelType: channelType as any,
        bypassCooldown: true,
      });
      if (!run.ok) {
        const def = storage.getAgentDefinition((target as any).definitionId);
        const posted = storage.createMessage({
          tenantId,
          channelId,
          channelType,
          senderAgentId: (target as any).id,
          senderName: `${(target as any).displayName} (${(target as any).role})`,
          senderEmoji: def?.emoji ?? "🤖",
          content:
            `⚠️ Agent run failed (${run.reason}). ` +
            `Check Audit Log for the full error. ` +
            `If this agent uses a cloud model (e.g. ":cloud"), verify the provider key/subscription or switch to a local model.`,
          messageType: "system",
          metadata: { hermesError: true, reason: run.reason, channelId },
        } as any);
        auditAndInvalidate(tenantId, ["messages"], {
          agentId: (target as any).id,
          agentName: `${(target as any).displayName} (${(target as any).role})`,
          action: "message_sent",
          entity: "message",
          entityId: String(posted.id),
          detail: posted.content.length > 200 ? `${posted.content.slice(0, 200)}…` : posted.content,
          tokensUsed: 0,
          cost: 0,
        });
      }
    }
  }
}

async function openclawCollaborationAck(tenantId: number, channelId: string, userContent?: string) {
  const agents = storage.getAgents(tenantId);
  const ceo = agents.find((a) => String(a.role).toLowerCase() === "ceo");
  const dmMatch = /^dm-(\d+)$/.exec(channelId);
  const dmAgent = dmMatch ? agents.find((a) => a.id === Number(dmMatch[1])) : undefined;
  const running = agents.filter((a) => a.status === "running");
  const isDm = !!dmMatch;
  const targets = isDm
    ? [dmAgent ?? ceo ?? running[0]].filter(Boolean)
    : (running.length ? running : [ceo].filter(Boolean)).slice(0, 3); // cap to avoid spam
  if (targets.length === 0) return;

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
  for (const agent of targets) {
    if (!agent) continue;
    const def = storage.getAgentDefinition(agent.definitionId);
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
}
