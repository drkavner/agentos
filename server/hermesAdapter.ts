import { storage } from "./storage";
import { db } from "./db";
import { and, eq, isNull, ne, desc, like } from "drizzle-orm";
import { messages, tasks, teamMembers } from "@shared/schema";
import { parentTaskMarker, maybeAutoCloseParentCeoTask } from "./ceoDelegation";
import { getEffectiveDefinitionSkills } from "./skillsRuntime";
import { buildAgentSystemPrompt } from "./agentPrompts";
import { completeLlmChat, getOpenRouterApiKey, resolveOllamaBaseUrl } from "./llmClient";
import { auditAndInvalidate, invalidateTenant } from "./realtimeSideEffects";
import { getTenantOllamaApiKey, getTenantOpenRouterApiKey } from "./tenantSecrets";
import { processAgentDeliverable } from "./deliverables";
import { spawn } from "child_process";
import {
  ensureAgentConfigurationTables,
  getAgentRuntimeSettings,
  releaseAgentRunLock,
  tryAcquireAgentRunLock,
  upsertAgentRuntimeSettings,
} from "./agentConfiguration";
import { addRunEvent, createAgentRun, finishAgentRun, type RunTrigger } from "./agentRuns";
import { getAgentDocsSync } from "./skillsRuntime";

async function completeViaHermesAgentCli(opts: {
  provider: "openrouter" | "ollama";
  model: string;
  prompt: string;
  timeoutMs: number;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const args = ["chat", "--quiet", "--provider", opts.provider, "--model", opts.model, "--query", opts.prompt];
  return await new Promise((resolve) => {
    const child = spawn("hermes", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const to = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({ ok: false, error: `timeout after ${opts.timeoutMs}ms` });
    }, Math.max(1000, opts.timeoutMs));

    child.stdout.on("data", (b) => (out += String(b)));
    child.stderr.on("data", (b) => (err += String(b)));
    child.on("error", (e) => {
      clearTimeout(to);
      resolve({ ok: false, error: String((e as any)?.message ?? e) });
    });
    child.on("close", (code) => {
      clearTimeout(to);
      const text = out.trim();
      if (code === 0 && text) return resolve({ ok: true, text });
      resolve({ ok: false, error: (err || text || `exit ${code ?? "?"}`).trim().slice(0, 2000) });
    });
  });
}

function pickWorkTask(tenantId: number, agentId: number) {
  const assigned = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.assignedAgentId, agentId), ne(tasks.status, "done"), ne(tasks.status, "review")))
    .orderBy(tasks.id)
    .get();
  if (assigned) return assigned;

  const unassigned = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), isNull(tasks.assignedAgentId), ne(tasks.status, "done"), ne(tasks.status, "review")))
    .orderBy(tasks.id)
    .get();
  return unassigned;
}

function hasOpenCeoDelegatedChildren(tenantId: number, parentTaskId: number) {
  const byField = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        eq(tasks.parentTaskId, parentTaskId),
        ne(tasks.status, "done"),
      ),
    )
    .get();
  if (byField) return true;
  const marker = `%${parentTaskMarker(parentTaskId)}%`;
  return !!db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        like(tasks.description, marker),
        ne(tasks.status, "done"),
      ),
    )
    .get();
}

function estimateTokensFromSkills(md: string) {
  const len = md.trim().length;
  return Math.max(120, Math.min(2400, Math.round(len / 6)));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function generateAutonomousSimMessage(
  agent: { id: number; displayName: string; role: string; goal?: string | null; definitionId: number },
  def: { name: string; specialty: string; description: string; division: string },
  task: { id: number; title: string; description?: string | null } | undefined | null,
  lastMsg: { senderName: string; senderAgentId: number | null; content: string } | undefined | null,
  reason: string,
  skillBullets: string[],
): string {
  const role = agent.role;
  const specialty = def.specialty.split(",").map((s) => s.trim()).filter(Boolean);
  const topSkill = specialty[0] ?? role;
  const docs = getAgentDocsSync(agent.definitionId);
  const soulIdentity = docs?.SOUL?.markdown?.match(/## Identity\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim() ?? "";
  const soulPurpose = docs?.SOUL?.markdown?.match(/## Core Purpose\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim() ?? def.description;

  const replyTo =
    lastMsg && lastMsg.senderAgentId !== agent.id && lastMsg.senderAgentId != null
      ? lastMsg
      : null;

  const parts: string[] = [];

  if (replyTo) {
    const replySnippet = String(replyTo.content).slice(0, 100);
    parts.push(pick([
      `@${replyTo.senderName} Got it, I'll incorporate that into my work.`,
      `@${replyTo.senderName} Thanks for the update. Aligning my approach with yours.`,
      `@${replyTo.senderName} Noted — "${replySnippet}${replyTo.content.length > 100 ? "..." : ""}". I'll factor this in.`,
      `@${replyTo.senderName} Acknowledged. Coordinating on this.`,
    ]));
  }

  if (task) {
    const desc = String(task.description ?? "").slice(0, 200);
    const purposeLine = soulPurpose || def.description;
    const taskTemplates = [
      [
        `Working on "${task.title}" now.`,
        soulIdentity ? `${soulIdentity.split(".")[0]}.` : null,
        `I've analyzed the requirements and I'm breaking this into actionable steps.`,
        `Current approach: leveraging my ${topSkill} capabilities to ${pick(["draft a plan", "build the first iteration", "run an analysis", "set up the framework", "research best practices"])}.`,
        desc ? `Key context from the brief: "${desc.slice(0, 120)}..."` : null,
        `I'll post deliverables once the first pass is ready.`,
      ],
      [
        `Starting task #${task.id}: "${task.title}".`,
        `As someone who ${purposeLine.toLowerCase()}, this is right in my wheelhouse.`,
        `Phase 1: ${pick(["Research & discovery", "Requirements analysis", "Initial setup", "Competitive analysis", "Architecture design"])} — estimated ${pick(["15 min", "20 min", "30 min"])}.`,
        `Phase 2: ${pick(["Execution & implementation", "Content creation", "Testing & validation", "Drafting deliverables"])}.`,
        skillBullets.length > 0
          ? `Applying: ${skillBullets.slice(0, 2).join(", ")}.`
          : `My ${topSkill} expertise is directly relevant here.`,
        `Will share progress updates as I hit milestones.`,
      ],
      [
        `On it. "${task.title}" is my focus right now.`,
        `I've reviewed the task details and ${pick(["identified 3 key areas to address", "mapped out the approach", "scoped the deliverables", "prioritized the critical path"])}.`,
        desc ? `The brief mentions: "${desc.slice(0, 80)}..." — I'm using this as my north star.` : null,
        `${pick(["Drafting", "Building", "Analyzing", "Researching", "Designing"])} the first deliverable now. ETA: ${pick(["~15 minutes", "~20 minutes", "shortly"])}.`,
        `My core mission: ${purposeLine}. This task aligns perfectly.`,
      ],
      [
        `Taking ownership of "${task.title}".`,
        `As the ${role}, my approach: ${pick([
          `run a thorough analysis and present findings`,
          `create a structured plan with clear milestones`,
          `build a working prototype and iterate`,
          `synthesize the requirements into an actionable brief`,
          `apply ${topSkill} best practices to deliver quality output`,
        ])}.`,
        `${pick(["Currently", "Right now I'm", "First step:"])} ${pick([
          "gathering relevant data and reviewing existing materials",
          "sketching the solution architecture",
          "outlining the key deliverables and milestones",
          "setting up the workspace and pulling dependencies",
          "running a quick competitive scan for reference",
        ])}.`,
        `I'll coordinate with the team if I need input on any dependencies.`,
      ],
      [
        `Picked up "${task.title}" — let's get this done.`,
        desc ? `Context: "${desc.slice(0, 150)}..."` : null,
        `Here's my execution plan:`,
        `1. ${pick(["Audit current state", "Gather requirements", "Review prior work", "Map dependencies"])}`,
        `2. ${pick(["Build first draft", "Create the framework", "Run initial analysis", "Prototype the solution"])}`,
        `3. ${pick(["Test and validate", "Get peer feedback", "Iterate on v1", "Polish deliverables"])}`,
        `Targeting completion within this work cycle. ${skillBullets.length > 0 ? `Key skills I'm applying: ${skillBullets.slice(0, 3).join(", ")}.` : ""}`,
      ],
    ];
    const chosen = pick(taskTemplates);
    parts.push(...chosen.filter(Boolean) as string[]);
  } else {
    const idleLine = soulPurpose
      ? `While I wait, I'm reviewing opportunities related to: ${soulPurpose.slice(0, 100)}.`
      : `Keeping an eye on the team's progress in case anyone needs ${topSkill} support.`;
    parts.push(pick([
      `Standing by — no tasks in my queue. ${idleLine}`,
      `All caught up on tasks. Ready to take on new work whenever it comes in. ${idleLine}`,
      `Queue is clear. I'm reviewing past outputs and looking for optimization opportunities.`,
      `No pending tasks. ${idleLine}`,
    ]));
  }

  return parts.join("\n\n");
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
  opts?: {
    reason?: "start" | "scheduled" | "manual";
    forceChannelId?: string;
    forceChannelType?: "general" | "team" | "dm";
    bypassCooldown?: boolean;
    /** If set, agent enters "discussion" mode — reacts to teammates' work instead of producing a deliverable. */
    discussionContext?: string;
  },
) {
  const agent = storage.getAgent(agentId);
  if (!agent || agent.tenantId !== tenantId) return { ok: false as const, reason: "agent_not_found" as const };

  const tenant = storage.getTenant(tenantId);
  if (!tenant) return { ok: false as const, reason: "tenant_not_found" as const };

  // Per-agent adapter override: if the agent is configured as hermes, run it
  // regardless of the tenant's default adapter type.
  ensureAgentConfigurationTables();
  const runtime = getAgentRuntimeSettings(agentId);
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();
  const reason = opts?.reason ?? "scheduled";
  const trigger: RunTrigger =
    reason === "scheduled" ? "timer" : reason === "start" ? "assignment" : "on_demand";
  const run = createAgentRun({ tenantId, agentId, trigger, startedAt: nowIso });

  if (!opts?.bypassCooldown && runtime.cooldownSec > 0 && runtime.lastRunAt) {
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

    const primary =
      opts?.forceChannelId
        ? {
            channelId: opts.forceChannelId,
            channelType: (opts.forceChannelType ??
              (opts.forceChannelId.startsWith("team-") ? "team" : opts.forceChannelId.startsWith("dm-") ? "dm" : "general")) as
              | "general"
              | "team"
              | "dm",
          }
        : pickAgentPrimaryChannel(tenantId, agentId, task?.teamId ?? null);
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
    const openRouterKey = routing === "openrouter" ? getTenantOpenRouterApiKey(tenantId).apiKey : null;
    const canCallLlm =
      routing === "ollama" || (routing === "openrouter" && (!!openRouterKey || !!getOpenRouterApiKey()));

    let systemPrompt: string;
    try {
      systemPrompt = await buildAgentSystemPrompt(tenantId, agentId);
    } catch (e: any) {
      addRunEvent(run.id, { kind: "stderr", message: `system prompt failed: ${String(e?.message ?? e)}` });
      auditAndInvalidate(tenantId, ["agents"], {
        agentId,
        agentName: `${agent.displayName} (${agent.role})`,
        action: "agent_run_failed",
        entity: "agent_run",
        entityId: String(run.id),
        detail: `prompt_error: ${String(e?.message ?? e).slice(0, 800)}`,
        tokensUsed: 0,
        cost: 0,
      });
      finishAgentRun(run.id, { status: "failed", error: "prompt", summary: "Failed to build system prompt" });
      return { ok: false as const, reason: "prompt_error" as const };
    }

    let assistantBody: string;
    if (canCallLlm) {
      let userPrompt: string;
      if (opts?.discussionContext) {
        userPrompt = [
          `You are in a TEAM DISCUSSION about a shared task. Your teammates have posted their work below.`,
          `Your role: ${agent.role} (${agent.displayName})`,
          task ? `Task: "${task.title}"` : null,
          ``,
          `=== TEAMMATES' WORK ===`,
          opts.discussionContext,
          `=== END TEAMMATES' WORK ===`,
          ``,
          `INSTRUCTIONS:`,
          `- Read your teammates' deliverables above carefully.`,
          `- Respond with specific, constructive feedback from YOUR expertise (${agent.role}).`,
          `- Point out what's good, suggest improvements, flag risks or gaps you see.`,
          `- If their work connects to yours, explain how and suggest integration points.`,
          `- Reference specific parts of their work (quote or mention section names).`,
          `- Keep it professional and collaborative. 3-6 sentences.`,
          `- DO NOT repeat their work. DO NOT produce a new deliverable. Just discuss.`,
        ].filter(Boolean).join("\n");
      } else if (task) {
        const descText = String(task.description ?? "");
        const feedbackMatch = descText.match(/--- Reviewer Feedback ---\n([\s\S]+)$/);
        const reviewerFeedback = feedbackMatch ? feedbackMatch[1]!.trim() : null;
        const isRevision = !!reviewerFeedback;

        userPrompt = [
          isRevision
            ? `Your previous work on this task was reviewed and CHANGES WERE REQUESTED. Address the feedback below and produce an improved deliverable.`
            : `You have been assigned a task. PRODUCE THE ACTUAL DELIVERABLE — not a status update.`,
          `Task: "${task.title}"`,
          task.description ? `Description: ${descText.slice(0, 2000)}` : null,
          isRevision ? `\n⚠️ REVIEWER FEEDBACK (address this):\n${reviewerFeedback}` : null,
          ``,
          `INSTRUCTIONS:`,
          `- If the task asks for code, WRITE THE COMPLETE WORKING CODE with file names.`,
          `- If the task asks for a document, WRITE THE FULL DOCUMENT.`,
          `- If the task asks for a plan, WRITE A DETAILED PLAN with concrete steps.`,
          `- Use markdown formatting. Use code blocks with language tags for code.`,
          `- DO NOT just say "I will do X" or "I'm starting work on X". Actually DO the work and show the output.`,
          `- Be thorough and produce production-quality output.`,
          isRevision
            ? `- Pay special attention to the reviewer feedback above. Show what you changed.`
            : null,
          lastMsg
            ? `\nContext — latest channel message from ${lastMsg.senderName}: ${String(lastMsg.content).slice(0, 600)}`
            : null,
        ].filter(Boolean).join("\n");
      } else {
        userPrompt = [
          `Post a status update to channel "${primary.channelId}".`,
          lastMsg
            ? `The latest message in the channel is from ${lastMsg.senderName}: "${String(lastMsg.content).slice(0, 600)}"`
            : null,
          ``,
          `INSTRUCTIONS:`,
          `- Write as ${agent.displayName} speaking naturally to the team.`,
          `- Lead with CONCRETE UPDATES: metrics, progress, blockers, or results.`,
          `- If someone addressed you or your area, respond to them directly using @Name.`,
          `- If you're a leader, give direction to your reports or ask for updates.`,
          `- If you're an IC, report on your current work or flag issues to your manager.`,
          `- DO NOT start with "Status Update:" or "Checking in:" — just speak naturally.`,
          `- 1-3 sentences. Be direct. No fluff.`,
        ].filter(Boolean).join("\n");
      }

      const defaultTimeout = task ? 300_000 : 120_000;
      const timeoutMs = runtime.timeoutSec > 0 ? Math.min(600_000, runtime.timeoutSec * 1000) : defaultTimeout;
      addRunEvent(run.id, { kind: "event", message: `llm: routing=${routing} model=${modelId}` });
      const useRealHermes = String(process.env.USE_REAL_HERMES_AGENT ?? "").toLowerCase() === "true";
      if (useRealHermes) {
        const prompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
        const hermes = await completeViaHermesAgentCli({
          provider: routing,
          model: modelId,
          prompt,
          timeoutMs,
        });
        if (!hermes.ok) {
          addRunEvent(run.id, { kind: "stderr", message: `hermes-agent cli error: ${hermes.error}` });
          auditAndInvalidate(tenantId, ["agents"], {
            agentId,
            agentName: `${agent.displayName} (${agent.role})`,
            action: "agent_run_failed",
            entity: "agent_run",
            entityId: String(run.id),
            detail: `hermes_agent_error provider=${routing} model=${modelId}. Fix: install Hermes Agent and ensure \`hermes\` is on PATH. Error: ${hermes.error}`,
            tokensUsed: 0,
            cost: 0,
          });
          finishAgentRun(run.id, { status: "failed", error: "llm", summary: "Hermes Agent CLI failed" });
          return { ok: false as const, reason: "llm_error" as const };
        }
        assistantBody = hermes.text;
        llmMode = "live";
        addRunEvent(run.id, { kind: "stdout", message: "hermes-agent: ok (cli)" });
      } else {
        const llm = await completeLlmChat({
          routing,
          model: modelId,
          system: systemPrompt,
          user: userPrompt,
          timeoutMs,
          ollamaBaseUrl: routing === "ollama" ? resolveOllamaBaseUrl(tenant.ollamaBaseUrl) : undefined,
          ollamaApiKey: routing === "ollama" ? getTenantOllamaApiKey(tenantId).apiKey : null,
          openRouterApiKey: openRouterKey,
        });
        if (!llm.ok) {
          addRunEvent(run.id, { kind: "stderr", message: `llm error: ${llm.error}` });
          const hint =
            routing === "ollama"
              ? "Fix: ensure the model exists in Ollama (run `ollama pull <model>`), and that the Ollama base URL is reachable from the server."
              : "Fix: set OPENROUTER_API_KEY on the server, or switch this agent to Ollama routing.";
          auditAndInvalidate(tenantId, ["agents"], {
            agentId,
            agentName: `${agent.displayName} (${agent.role})`,
            action: "agent_run_failed",
            entity: "agent_run",
            entityId: String(run.id),
            detail: `llm_error routing=${routing} model=${modelId}. ${hint} Error: ${String(llm.error).slice(0, 1200)}`,
            tokensUsed: 0,
            cost: 0,
          });
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
      }
    } else {
      if (routing === "openrouter" && !getOpenRouterApiKey()) {
        addRunEvent(run.id, {
          kind: "event",
          message: "llm: skipped (set OPENROUTER_API_KEY on the server for OpenRouter routing)",
        });
      }
      assistantBody = generateAutonomousSimMessage(agent, def, task, lastMsg, reason, bullets);
    }

    let deliverableFiles: string[] = [];
    if (task && llmMode === "live") {
      try {
        deliverableFiles = processAgentDeliverable(tenantId, task.id, agent.displayName, assistantBody);
        if (deliverableFiles.length > 0) {
          addRunEvent(run.id, { kind: "stdout", message: `extracted ${deliverableFiles.length} deliverable file(s) for task #${task.id}` });
        }
      } catch (e: any) {
        addRunEvent(run.id, { kind: "stderr", message: `deliverable extraction error: ${String(e?.message ?? e)}` });
      }
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
      metadata: llmMode === "live"
        ? { llm: true, model: modelId, ...(deliverableFiles.length > 0 ? { deliverableFiles, taskId: task?.id } : {}) }
        : null,
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

    let waitingOnCeoDelegation = false;
    const isDelegatedChild = !!task?.description && /parentTaskId:\d+/.test(String(task.description));
    if (task && !isDelegatedChild) {
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
      } else if (task.status !== "in_progress") {
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

      const isCeo = String(agent.role).toLowerCase() === "ceo";
      const waitingOnDelegation = isCeo && hasOpenCeoDelegatedChildren(tenantId, task.id);
      waitingOnCeoDelegation = waitingOnDelegation;

      if (waitingOnDelegation) {
        addRunEvent(run.id, {
          kind: "event",
          message: `CEO task #${task.id} kept open while delegated child tasks are still incomplete`,
        });
      } else {
        storage.updateTask(task.id, { status: "review", actualTokens: tokensUsed } as any);
        addRunEvent(run.id, { kind: "event", message: `task #${task.id} ready for review` });
        auditAndInvalidate(tenantId, ["tasks", "goals"], {
          agentId,
          agentName: agent.displayName,
          action: "task_status_changed",
          entity: "task",
          entityId: String(task.id),
          detail: `${task.title} → awaiting review`,
          tokensUsed,
          cost: costUsd,
        });

        // Report upward to the assigned agent's head/manager so they can approve or request changes.
        if (agent.managerId) {
          const head = storage.getAgent(agent.managerId);
          if (head && head.tenantId === tenantId) {
            const note = `@${head.displayName} — Task #${task.id} is ready for review: "${task.title}". Approve or Request Changes in Tasks.`;
            try {
              const headMsg = storage.createMessage({
                tenantId,
                channelId: `dm-${head.id}`,
                channelType: "dm",
                senderAgentId: agentId,
                senderName: `${agent.displayName} (${agent.role})`,
                senderEmoji: def.emoji ?? "🤖",
                content: note,
                messageType: "chat",
                metadata: { taskId: task.id, review: true },
              } as any);
              addRunEvent(run.id, { kind: "stdout", message: `notified head via dm-${head.id} (#${headMsg.id})` });
            } catch {
              // best-effort
            }
          }
        }

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

        maybeAutoCloseParentCeoTask(task);
      }
    } else if (task && isDelegatedChild) {
      addRunEvent(run.id, {
        kind: "event",
        message: `task #${task.id} is CEO-delegated — lifecycle managed by delegation runner`,
      });
    }

    const spent = (agent.spentThisMonth ?? 0) + costUsd;
    const completedThisRun = !!task && !isDelegatedChild && !waitingOnCeoDelegation;
    storage.updateAgent(agentId, {
      lastHeartbeat: nowIso,
      tasksCompleted: agent.tasksCompleted + (completedThisRun ? 1 : 0),
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
