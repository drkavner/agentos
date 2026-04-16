/**
 * CLI Adapter — runs agent work via external CLI tools OR falls back to our
 * OpenRouter / Ollama LLM providers when the CLI is not installed.
 *
 * Execution order:
 *  1. Try to spawn the configured CLI (claude, codex, gemini, etc.)
 *  2. If CLI not found (exit 127) → fall back to completeLlmChat via OpenRouter/Ollama
 *  3. Post the output as a channel message and update task status
 *
 * This ensures every adapter type works out of the box with just an OpenRouter
 * or Ollama API key — no external CLI installation required.
 */

import { spawn } from "child_process";
import { storage } from "./storage";
import { auditAndInvalidate } from "./realtimeSideEffects";
import { getAgentRuntimeSettings, ensureAgentConfigurationTables } from "./agentConfiguration";
import { createAgentRun, addRunEvent, finishAgentRun } from "./agentRuns";
import { buildAgentSystemPrompt } from "./agentPrompts";
import { completeLlmChat, resolveOllamaBaseUrl } from "./llmClient";
import { getTenantOllamaApiKey, getTenantOpenRouterApiKey } from "./tenantSecrets";
import { processAgentDeliverable } from "./deliverables";

const CLI_COMMANDS: Record<string, { bin: string; buildArgs: (opts: CliRunOpts) => string[] }> = {
  claude: {
    bin: "claude",
    buildArgs: (opts) => [
      "--print",
      "--model", opts.model || "claude-sonnet-4-20250514",
      ...(opts.systemPrompt ? ["--system-prompt", opts.systemPrompt] : []),
      opts.prompt,
    ],
  },
  codex: {
    bin: "codex",
    buildArgs: (opts) => [
      "--quiet",
      ...(opts.model ? ["--model", opts.model] : []),
      opts.prompt,
    ],
  },
  gemini: {
    bin: "gemini",
    buildArgs: (opts) => [
      ...(opts.model ? ["--model", opts.model] : []),
      "-p", opts.prompt,
    ],
  },
  opencode: {
    bin: "opencode",
    buildArgs: (opts) => ["run", opts.prompt],
  },
  cursor: {
    bin: "cursor",
    buildArgs: (opts) => ["--message", opts.prompt],
  },
};

/** Human-readable labels for each CLI adapter used in fallback messages. */
const CLI_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  cursor: "Cursor",
};

type CliRunOpts = {
  prompt: string;
  model: string;
  systemPrompt?: string;
  extraArgs?: string;
  timeoutSec?: number;
  env?: Record<string, string>;
};

function buildPrompt(
  agent: { displayName: string; role: string; goal?: string | null },
  task: { id: number; title: string; description?: string | null } | null,
  discussionContext?: string,
): string {
  if (discussionContext) {
    return [
      `You are ${agent.displayName} (${agent.role}).`,
      `You are in a TEAM DISCUSSION. Your teammates have posted their work below.`,
      task ? `Task: "${task.title}"` : "",
      "",
      `=== TEAMMATES' WORK ===`,
      discussionContext,
      `=== END TEAMMATES' WORK ===`,
      "",
      `Respond with specific feedback from YOUR expertise (${agent.role}).`,
      `Point out what's good, suggest improvements, flag risks or gaps.`,
      `Reference specific parts of their work. 3-6 sentences. Be collaborative.`,
      `DO NOT repeat their work or produce a new deliverable.`,
    ].filter(Boolean).join("\n");
  }

  const parts: string[] = [];
  parts.push(`You are ${agent.displayName} (${agent.role}).`);
  if (agent.goal) parts.push(`Goal: ${agent.goal}`);
  if (task) {
    const descText = String(task.description ?? "");
    const feedbackMatch = descText.match(/--- Reviewer Feedback ---\n([\s\S]+)$/);
    const reviewerFeedback = feedbackMatch ? feedbackMatch[1]!.trim() : null;

    parts.push(`\nTask #${task.id}: ${task.title}`);
    if (task.description) parts.push(`Description: ${descText.slice(0, 1000)}`);
    if (reviewerFeedback) {
      parts.push(`\n⚠️ REVIEWER FEEDBACK (address this):\n${reviewerFeedback}`);
      parts.push(`\nYour previous work was reviewed and changes were requested. Improve your output based on the feedback above.`);
    } else {
      parts.push(`\nComplete this task and provide a detailed response with your work output.`);
    }
  } else {
    parts.push(`\nNo pending tasks. Report your current status, any observations, and what you plan to work on next.`);
  }
  return parts.join("\n");
}

function spawnCli(
  command: string,
  args: string[],
  opts: { timeoutMs: number; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(opts.env ?? {}) };
    const child = spawn(command, args, {
      env,
      timeout: opts.timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000);
    }, opts.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 10_000),
        exitCode: code ?? 1,
        timedOut,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: `spawn error: ${err.message}`,
        exitCode: 127,
        timedOut: false,
      });
    });
  });
}

/**
 * Fallback: when the CLI tool isn't installed, call our LLM provider directly.
 * This is the key integration — every adapter is wired to OpenRouter / Ollama.
 */
async function llmFallback(
  tenantId: number,
  agentId: number,
  opts: {
    systemPrompt: string;
    userPrompt: string;
    routing: "openrouter" | "ollama";
    model: string;
    timeoutMs: number;
  },
) {
  const tenant = storage.getTenant(tenantId);
  const ollamaBaseUrl = opts.routing === "ollama" ? resolveOllamaBaseUrl(tenant?.ollamaBaseUrl) : undefined;
  const ollamaApiKey = opts.routing === "ollama" ? getTenantOllamaApiKey(tenantId).apiKey : null;
  const openRouterApiKey = opts.routing === "openrouter" ? (getTenantOpenRouterApiKey(tenantId).apiKey ?? undefined) : undefined;

  return completeLlmChat({
    routing: opts.routing,
    model: opts.model,
    system: opts.systemPrompt,
    user: opts.userPrompt,
    timeoutMs: opts.timeoutMs,
    ollamaBaseUrl,
    ollamaApiKey,
    openRouterApiKey,
  });
}

export async function cliRunOnce(
  tenantId: number,
  agentId: number,
  opts?: {
    reason?: string;
    bypassCooldown?: boolean;
    forceChannelId?: string;
    forceChannelType?: "general" | "team" | "dm";
    discussionContext?: string;
  },
) {
  const reason = opts?.reason ?? "manual";
  const agent = storage.getAgent(agentId);
  if (!agent || agent.tenantId !== tenantId) {
    return { ok: false as const, reason: "agent_not_found" as const };
  }

  const def = storage.getAgentDefinition(agent.definitionId);
  if (!def) return { ok: false as const, reason: "no_definition" as const };

  ensureAgentConfigurationTables();
  const runtime = getAgentRuntimeSettings(agentId);

  const cmdKey = (runtime.command || "claude").toLowerCase().trim();
  const cliDef = CLI_COMMANDS[cmdKey];

  const allTasks = storage.getTasks(tenantId);
  const task = allTasks.find(
    (t) => t.assignedAgentId === agentId && t.status !== "done" && t.status !== "review",
  ) ?? null;

  const userPrompt = buildPrompt(agent, task, opts?.discussionContext);
  const modelId = runtime.model || agent.model || "";
  const timeoutSec = runtime.timeoutSec > 0 ? runtime.timeoutSec : 120;
  const routing = runtime.llmProvider;

  let systemPrompt = "";
  try {
    systemPrompt = await buildAgentSystemPrompt(tenantId, agentId);
  } catch {
    systemPrompt = `You are ${agent.displayName}, a ${agent.role}. ${def.description ?? ""}`;
  }

  const triggerMap: Record<string, string> = {
    manual: "on_demand",
    start: "on_demand",
    scheduled: "heartbeat",
  };
  const run = createAgentRun({
    tenantId,
    agentId,
    trigger: (triggerMap[reason] ?? "on_demand") as any,
  });

  let output = "";
  let exitCode = 0;
  let timedOut = false;
  let usedLlmFallback = false;
  let tokensUsed = 0;
  let costUsd = 0;

  // ── Step 1: Try spawning the external CLI ──────────────────────────────
  if (cliDef) {
    const cliArgs = cliDef.buildArgs({
      prompt: userPrompt,
      model: modelId,
      systemPrompt,
      extraArgs: runtime.extraArgs,
    });

    if (runtime.extraArgs) {
      const extra = runtime.extraArgs.split(",").map((s) => s.trim()).filter(Boolean);
      cliArgs.push(...extra);
    }

    addRunEvent(run.id, {
      kind: "event",
      message: `CLI adapter: trying \`${cliDef.bin}\` → fallback to ${routing} LLM if not found`,
    });

    const envVars: Record<string, string> = {
      AGENT_NAME: agent.displayName,
      AGENT_ROLE: agent.role,
      AGENT_ID: String(agentId),
      TENANT_ID: String(tenantId),
    };
    if (task) {
      envVars.TASK_ID = String(task.id);
      envVars.TASK_TITLE = task.title;
    }

    const result = await spawnCli(cliDef.bin, cliArgs, {
      timeoutMs: timeoutSec * 1000,
      env: envVars,
    });

    if (result.exitCode === 127) {
      // CLI not found — fall through to LLM fallback
      addRunEvent(run.id, {
        kind: "event",
        message: `\`${cliDef.bin}\` not found in PATH — falling back to ${routing} LLM (model: ${modelId})`,
      });
    } else {
      // CLI ran (success or error) — use its output
      output = (result.stdout || result.stderr || "(no output)").trim();
      exitCode = result.exitCode;
      timedOut = result.timedOut;

      addRunEvent(run.id, {
        kind: "stdout",
        message: `CLI exit=${result.exitCode} timedOut=${result.timedOut}\n${output.slice(0, 2000)}`,
      });
    }

    // Only fall back to LLM if CLI was not found
    if (result.exitCode === 127) {
      usedLlmFallback = true;
    }
  } else {
    // No CLI definition at all — go straight to LLM
    usedLlmFallback = true;
    addRunEvent(run.id, {
      kind: "event",
      message: `No CLI definition for "${cmdKey}" — using ${routing} LLM directly (model: ${modelId})`,
    });
  }

  // ── Step 2: LLM fallback via OpenRouter / Ollama ──────────────────────
  if (usedLlmFallback) {
    const adapterLabel = CLI_LABELS[cmdKey] ?? cmdKey;

    const llmResult = await llmFallback(tenantId, agentId, {
      systemPrompt: systemPrompt + `\n\nYou are operating as a "${adapterLabel}" adapter agent. Respond thoroughly and professionally.`,
      userPrompt,
      routing,
      model: modelId,
      timeoutMs: timeoutSec * 1000,
    });

    if (llmResult.ok) {
      output = llmResult.text;
      exitCode = 0;
      tokensUsed = llmResult.promptTokens + llmResult.completionTokens;
      costUsd = llmResult.estimatedCostUsd;

      addRunEvent(run.id, {
        kind: "stdout",
        message: `LLM fallback (${routing}/${llmResult.modelUsed}): ${tokensUsed} tokens, $${costUsd.toFixed(4)}\n${output.slice(0, 2000)}`,
      });
    } else {
      output = `LLM call failed (${routing}, model: ${modelId}): ${llmResult.error}\n\nTo fix: configure your ${routing === "openrouter" ? "OpenRouter" : "Ollama"} API key in Settings, or install the \`${cmdKey}\` CLI tool.`;
      exitCode = 1;

      addRunEvent(run.id, {
        kind: "stderr",
        message: `LLM fallback failed: ${llmResult.error}`,
      });
    }
  }

  // ── Step 3: Extract deliverables + post message + update task ───────────
  let deliverableFiles: string[] = [];
  if (task && exitCode === 0 && !timedOut) {
    try {
      deliverableFiles = processAgentDeliverable(tenantId, task.id, agent.displayName, output);
      if (deliverableFiles.length > 0) {
        addRunEvent(run.id, { kind: "stdout", message: `extracted ${deliverableFiles.length} deliverable file(s) for task #${task.id}` });
      }
    } catch { /* best-effort */ }
  }

  const postChannelId = opts?.forceChannelId ?? "general";
  const postChannelType = opts?.forceChannelType ?? "general";

  const posted = storage.createMessage({
    tenantId,
    channelId: postChannelId,
    channelType: postChannelType,
    senderAgentId: agentId,
    senderName: `${agent.displayName} (${agent.role})`,
    senderEmoji: def.emoji ?? "🤖",
    content: timedOut
      ? `[Timed out after ${timeoutSec}s]\n\n${output.slice(0, 3000)}`
      : output.slice(0, 5000),
    messageType: "chat",
    metadata: JSON.stringify({
      adapter: "cli",
      command: cmdKey,
      exitCode,
      llmFallback: usedLlmFallback,
      routing: usedLlmFallback ? routing : undefined,
      tokensUsed: tokensUsed || undefined,
      costUsd: costUsd || undefined,
      ...(deliverableFiles.length > 0 ? { deliverableFiles, taskId: task?.id } : {}),
    }),
  } as any);

  auditAndInvalidate(tenantId, ["messages"], {
    agentId,
    agentName: `${agent.displayName} (${agent.role})`,
    action: "message_sent",
    entity: "message",
    entityId: String(posted.id),
    detail: posted.content.slice(0, 200),
    tokensUsed,
    cost: costUsd,
  });

  if (task && exitCode === 0 && !timedOut) {
    storage.updateTask(task.id, { status: "review" } as any);
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
  } else if (task && task.status === "todo") {
    storage.updateTask(task.id, { status: "in_progress" } as any);
    auditAndInvalidate(tenantId, ["tasks"], {
      agentId,
      action: "task_status_changed",
      entity: "task",
      entityId: String(task.id),
      detail: `todo → in_progress`,
      tokensUsed: 0,
      cost: 0,
    });
  }

  storage.updateAgent(agentId, {
    lastHeartbeat: new Date().toISOString(),
    tasksCompleted: agent.tasksCompleted + (exitCode === 0 && task ? 1 : 0),
  });

  finishAgentRun(run.id, {
    status: exitCode === 0 ? "ok" : "failed",
    error: exitCode !== 0 ? (usedLlmFallback ? "llm_error" : `exit_code_${exitCode}`) : null,
    summary: [
      task ? `Task: ${task.title}` : "No pending tasks",
      usedLlmFallback ? `(LLM fallback: ${routing})` : `(CLI: ${cmdKey})`,
    ].join(" "),
  });

  return {
    ok: true as const,
    exitCode,
    outputLength: output.length,
    timedOut,
    llmFallback: usedLlmFallback,
    tokensUsed,
    costUsd,
  };
}
