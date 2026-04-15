import { storage } from "./storage";
import { db } from "./db";
import { and, eq, isNull, ne, desc } from "drizzle-orm";
import { messages, tasks, teamMembers } from "@shared/schema";
import { getEffectiveDefinitionSkills } from "./skillsRuntime";
import { buildAgentSystemPrompt } from "./agentPrompts";
import { completeLlmChat, getOpenRouterApiKey, resolveOllamaBaseUrl } from "./llmClient";
import { auditAndInvalidate, invalidateTenant } from "./realtimeSideEffects";
import {
  ensureAgentConfigurationTables,
  getAgentRuntimeSettings,
  releaseAgentRunLock,
  tryAcquireAgentRunLock,
  upsertAgentRuntimeSettings,
} from "./agentConfiguration";
import { addRunEvent, createAgentRun, finishAgentRun, type RunTrigger } from "./agentRuns";

function pickWorkTask(tenantId: number, agentId: number) {
  const assigned = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.assignedAgentId, agentId), ne(tasks.status, "done")))
    .orderBy(tasks.id)
    .get();
  if (assigned) return assigned;

  const unassigned = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), isNull(tasks.assignedAgentId), ne(tasks.status, "done")))
    .orderBy(tasks.id)
    .get();
  return unassigned;
}

function estimateTokensFromSkills(md: string) {
  const len = md.trim().length;
  return Math.max(120, Math.min(2400, Math.round(len / 6)));
}

export function pickAgentPrimaryChannel(
  tenantId: number,
  agentId: number,
  taskTeamId?: number | null,
): { channelId: string; channelType: "general" | "team" | "dm" } {
  if (taskTeamId) return { channelId: `team-${taskTeamId}`, channelType: "team" };
  const membership = db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.agentId, agentId))
    .get();
  if (membership?.teamId) return { channelId: `team-${membership.teamId}`, channelType: "team" };
  return { channelId: "general", channelType: "general" };
}

export async function hermesRunOnce(
  tenantId: number,
  agentId: number,
  opts?: { reason?: "start" | "scheduled" | "manual" },
) {
  const agent = storage.getAgent(agentId);
  if (!agent || agent.tenantId !== tenantId) return { ok: false as const, reason: "agent_not_found" as const };

  const tenant = storage.getTenant(tenantId);
  if (!tenant) return { ok: false as const, reason: "tenant_not_found" as const };

  if (tenant.adapterType !== "hermes") {
    return { ok: false as const, reason: "not_hermes" as const };
  }

  ensureAgentConfigurationTables();
  const runtime = getAgentRuntimeSettings(agentId);
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();
  const reason = opts?.reason ?? "scheduled";
  const trigger: RunTrigger =
    reason === "scheduled" ? "timer" : reason === "start" ? "assignment" : "on_demand";
  const run = createAgentRun({ tenantId, agentId, trigger, startedAt: nowIso });

  if (runtime.cooldownSec > 0 && runtime.lastRunAt) {
    const last = new Date(runtime.lastRunAt);
    if (Number.isFinite(last.getTime())) {
      const since = (nowDate.getTime() - last.getTime()) / 1000;
      if (since < runtime.cooldownSec) {
        addRunEvent(run.id, { kind: "stderr", message: `cooldown: wait ${(runtime.cooldownSec - since).toFixed(1)}s` });
        finishAgentRun(run.id, { status: "failed", error: "cooldown", summary: "Blocked by cooldown" });
        return { ok: false as const, reason: "cooldown" as const };
      }
    }
  }
  if (runtime.maxConcurrentRuns <= 1) {
    const ok = tryAcquireAgentRunLock(agentId);
    if (!ok) {
      addRunEvent(run.id, { kind: "stderr", message: "busy: another run is in progress" });
      finishAgentRun(run.id, { status: "failed", error: "busy", summary: "Blocked by concurrency" });
      return { ok: false as const, reason: "busy" as const };
    }
  }

  const def = storage.getAgentDefinition(agent.definitionId);
  if (!def) {
    if (runtime.maxConcurrentRuns <= 1) releaseAgentRunLock(agentId);
    return { ok: false as const, reason: "definition_not_found" as const };
  }

  try {
    const skills = await getEffectiveDefinitionSkills(tenantId, def.id);
    const task = pickWorkTask(tenantId, agentId);

    let tokensUsed = estimateTokensFromSkills(skills.markdown);
    let costUsd = 0;
    let llmMode: "live" | "sim" = "sim";

    addRunEvent(run.id, { kind: "event", message: `reason=${reason}; skillsSource=${skills.source}` });

    const primary = pickAgentPrimaryChannel(tenantId, agentId, task?.teamId ?? null);
    const dmTargetId = agent.managerId ?? null;

    const lastMsg = db
      .select()
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.channelId, primary.channelId)))
      .orderBy(desc(messages.id))
      .get();

    const bullets = skills.markdown
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .slice(0, 3)
      .map((l) => l.replace(/^- /, ""));
    const skillLine = bullets.length ? `Key skills: ${bullets.join(", ")}.` : "";

    const modelId = (runtime.model || "").trim() || agent.model;
    const routing = runtime.llmProvider;
    const canCallLlm =
      routing === "ollama" || (routing === "openrouter" && !!getOpenRouterApiKey());

    let systemPrompt: string;
    try {
      systemPrompt = await buildAgentSystemPrompt(tenantId, agentId);
    } catch (e: any) {
      addRunEvent(run.id, { kind: "stderr", message: `system prompt failed: ${String(e?.message ?? e)}` });
      finishAgentRun(run.id, { status: "failed", error: "prompt", summary: "Failed to build system prompt" });
      return { ok: false as const, reason: "prompt_error" as const };
    }

    let assistantBody: string;
    if (canCallLlm) {
      const userPrompt = [
        `Post an update to collaboration channel "${primary.channelId}" (${primary.channelType}).`,
        `Run trigger: ${reason}.`,
        task
          ? `Active task: "${task.title}"\n${task.description ? `Description: ${String(task.description).slice(0, 1200)}` : ""}`
          : "No queued task — explain what you're monitoring and what you'd pick up next.",
        lastMsg
          ? `Latest channel message from ${lastMsg.senderName}: ${String(lastMsg.content).slice(0, 600)}`
          : "No prior messages in this channel.",
        `Write the message body only: 2–8 sentences, plain text, specific to your role and skills.`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const timeoutMs = runtime.timeoutSec > 0 ? Math.min(600_000, runtime.timeoutSec * 1000) : 120_000;
      addRunEvent(run.id, { kind: "event", message: `llm: routing=${routing} model=${modelId}` });
      const llm = await completeLlmChat({
        routing,
        model: modelId,
        system: systemPrompt,
        user: userPrompt,
        timeoutMs,
        ollamaBaseUrl: routing === "ollama" ? resolveOllamaBaseUrl(tenant.ollamaBaseUrl) : undefined,
      });
      if (!llm.ok) {
        addRunEvent(run.id, { kind: "stderr", message: `llm error: ${llm.error}` });
        finishAgentRun(run.id, { status: "failed", error: "llm", summary: "LLM request failed" });
        return { ok: false as const, reason: "llm_error" as const };
      }
      assistantBody = llm.text;
      tokensUsed = Math.max(1, llm.promptTokens + llm.completionTokens);
      costUsd = llm.estimatedCostUsd;
      llmMode = "live";
      addRunEvent(run.id, {
        kind: "stdout",
        message: `llm: ok tokens in=${llm.promptTokens} out=${llm.completionTokens} ~$${costUsd.toFixed(4)}`,
      });
    } else {
      if (routing === "openrouter" && !getOpenRouterApiKey()) {
        addRunEvent(run.id, {
          kind: "event",
          message: "llm: skipped (set OPENROUTER_API_KEY on the server for OpenRouter routing)",
        });
      }
      const replyTo =
        lastMsg && lastMsg.senderAgentId !== agentId
          ? `Replying to ${lastMsg.senderName}: “${String(lastMsg.content).slice(0, 120)}${String(lastMsg.content).length > 120 ? "…" : ""}”\n\n`
          : "";
      const workSummary = task
        ? `Update (${reason}): I will handle “${task.title}”.`
        : `Update (${reason}): No pending tasks found — monitoring for new work.`;
      assistantBody = `${replyTo}${workSummary}\n${skillLine}\n\nSkills context source: ${skills.source}${skills.updatedAt ? ` (${skills.updatedAt})` : ""}`;
    }

    const posted = storage.createMessage({
      tenantId,
      channelId: primary.channelId,
      channelType: primary.channelType,
      senderAgentId: agentId,
      senderName: `${agent.displayName} (${agent.role})`,
      senderEmoji: def.emoji ?? "🤖",
      content: assistantBody,
      messageType: reason === "scheduled" ? "heartbeat" : "chat",
      metadata: llmMode === "live" ? { llm: true, model: modelId } : null,
    } as any);
    addRunEvent(run.id, { kind: "stdout", message: `posted message #${posted.id} to ${primary.channelId}` });

    auditAndInvalidate(tenantId, ["messages"], {
      agentId,
      agentName: `${agent.displayName} (${agent.role})`,
      action: "message_sent",
      entity: "message",
      entityId: String(posted.id),
      detail: posted.content.length > 200 ? `${posted.content.slice(0, 200)}…` : posted.content,
      tokensUsed,
      cost: costUsd,
    });

    if (dmTargetId && reason !== "scheduled") {
      const mgr = storage.getAgent(dmTargetId);
      if (mgr && mgr.tenantId === tenantId) {
        const dmText =
          llmMode === "live"
            ? `@${mgr.displayName} — ${assistantBody.slice(0, 500)}${assistantBody.length > 500 ? "…" : ""}`
            : `@${mgr.displayName} quick update: ${task ? `working on “${task.title}”.` : "standing by for new tasks."} ${skillLine}`.trim();
        const dmMsg = storage.createMessage({
          tenantId,
          channelId: `dm-${dmTargetId}`,
          channelType: "dm",
          senderAgentId: agentId,
          senderName: `${agent.displayName} (${agent.role})`,
          senderEmoji: def.emoji ?? "🤖",
          content: dmText,
          messageType: "chat",
          metadata: null,
        } as any);
        auditAndInvalidate(tenantId, ["messages"], {
          agentId,
          agentName: `${agent.displayName} (${agent.role})`,
          action: "message_sent",
          entity: "message",
          entityId: String(dmMsg.id),
          detail: dmMsg.content.length > 200 ? `${dmMsg.content.slice(0, 200)}…` : dmMsg.content,
          tokensUsed: llmMode === "live" ? 0 : 0,
          cost: 0,
        });
      }
    }

    if (task) {
      if (!task.assignedAgentId) {
        storage.updateTask(task.id, { assignedAgentId: agentId, status: "in_progress" } as any);
        auditAndInvalidate(tenantId, ["tasks", "goals"], {
          agentId,
          agentName: agent.displayName,
          action: "task_checkout",
          entity: "task",
          entityId: String(task.id),
          detail: `Started: ${task.title}`,
          tokensUsed: 0,
          cost: 0,
        });
      } else {
        storage.updateTask(task.id, { status: "in_progress" } as any);
        auditAndInvalidate(tenantId, ["tasks", "goals"], {
          agentId,
          agentName: agent.displayName,
          action: "task_status_changed",
          entity: "task",
          entityId: String(task.id),
          detail: `${task.status} → in_progress: ${task.title}`,
          tokensUsed: 0,
          cost: 0,
        });
      }
      storage.updateTask(task.id, { status: "done", actualTokens: tokensUsed } as any);
      addRunEvent(run.id, { kind: "event", message: `completed task #${task.id}` });
      auditAndInvalidate(tenantId, ["tasks", "goals"], {
        agentId,
        agentName: agent.displayName,
        action: "task_completed",
        entity: "task",
        entityId: String(task.id),
        detail: task.title,
        tokensUsed,
        cost: costUsd,
      });

      if (task.teamId) {
        const teamMsg = storage.createMessage({
          tenantId,
          channelId: `team-${task.teamId}`,
          channelType: "team",
          senderAgentId: agentId,
          senderName: `${agent.displayName} (${agent.role})`,
          senderEmoji: def.emoji ?? "🤖",
          content: `Completed “${task.title}”. ${skillLine}`.trim(),
          messageType: "chat",
          metadata: null,
        } as any);
        addRunEvent(run.id, { kind: "stdout", message: `posted team message to team-${task.teamId}` });
        auditAndInvalidate(tenantId, ["messages"], {
          agentId,
          agentName: `${agent.displayName} (${agent.role})`,
          action: "message_sent",
          entity: "message",
          entityId: String(teamMsg.id),
          detail: teamMsg.content.length > 200 ? `${teamMsg.content.slice(0, 200)}…` : teamMsg.content,
          tokensUsed: 0,
          cost: 0,
        });
      }
    }

    const spent = (agent.spentThisMonth ?? 0) + costUsd;
    storage.updateAgent(agentId, {
      lastHeartbeat: nowIso,
      tasksCompleted: agent.tasksCompleted + (task ? 1 : 0),
      spentThisMonth: spent,
    });
    upsertAgentRuntimeSettings(agentId, { lastRunAt: nowIso });
    invalidateTenant(tenantId, ["agents"]);

    finishAgentRun(run.id, {
      status: "ok",
      summary: task ? `Completed: ${task.title}` : "No pending tasks",
      error: null,
    });
    return {
      ok: true as const,
      tokensUsed,
      costUsd,
      llmMode,
      completedTaskId: task?.id ?? null,
      skillsSource: skills.source,
    };
  } finally {
    if (runtime.maxConcurrentRuns <= 1) releaseAgentRunLock(agentId);
  }
}
