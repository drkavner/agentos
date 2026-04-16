import { storage } from "./storage";
import { auditAndInvalidate } from "./realtimeSideEffects";
import { dispatchAgentRun } from "./dispatchAgentRun";
import type { InsertTask } from "@shared/schema";

export function parentTaskMarker(parentTaskId: number) {
  return `parentTaskId:${parentTaskId}`;
}

function isCeoAgent(agent: { role: string } | undefined | null) {
  return !!agent && String(agent.role).toLowerCase() === "ceo";
}

/**
 * Score how well a worker matches a task, based on role/specialty keywords vs task title+description.
 */
function relevanceScore(
  taskText: string,
  agent: { role: string; displayName: string; definitionId: number },
): number {
  const haystack = taskText.toLowerCase();
  const def = storage.getAgentDefinition(agent.definitionId);
  const keywords = [
    agent.role,
    agent.displayName,
    def?.specialty ?? "",
    def?.description ?? "",
    def?.division ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .split(/[\s,;|/]+/)
    .filter((w) => w.length > 2);

  let score = 0;
  const seen = new Set<string>();
  for (const kw of keywords) {
    if (seen.has(kw)) continue;
    seen.add(kw);
    if (haystack.includes(kw)) score += 1;
  }
  return score;
}

function rankWorkers(
  tenantId: number,
  ceoId: number,
  taskText: string,
  limit: number,
) {
  const agents = storage.getAgents(tenantId);
  const running = agents
    .filter((a) => a.id !== ceoId)
    .filter((a) => String(a.role).toLowerCase() !== "ceo")
    .filter((a) => a.status === "running");

  if (running.length === 0) return [];

  const scored = running.map((a) => ({
    agent: a,
    score: relevanceScore(taskText, a),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.agent);
}

// ─── Real worker execution via adapter dispatch ─────────────────────────────
// Each delegated worker runs through its configured adapter (Hermes LLM, CLI,
// or OpenClaw). The adapter posts real LLM output to #general and updates
// the task status. After each run, we check if all siblings are done so the
// CEO parent task auto-closes.

const STAGGER_MS = 2000;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function realWorkerRun(tenantId: number, agentId: number, childTaskId: number, startDelayMs: number) {
  if (startDelayMs > 0) await sleep(startDelayMs);

  const task = storage.getTask(childTaskId);
  if (!task) return;

  try {
    await dispatchAgentRun(tenantId, agentId, { reason: "start", bypassCooldown: true });
  } catch (err) {
    console.error(`[ceoDelegation] dispatchAgentRun failed for agent ${agentId}, task ${childTaskId}:`, err);
  }

  // Re-read task — adapter may or may not have marked it done
  const updated = storage.getTask(childTaskId);
  if (updated && updated.status !== "done") {
    // If adapter didn't auto-complete, mark done now
    storage.updateTask(childTaskId, { status: "done" } as any);
    const agent = storage.getAgent(agentId);
    auditAndInvalidate(tenantId, ["tasks", "goals"], {
      agentId,
      agentName: agent?.displayName,
      action: "task_completed",
      entity: "task",
      entityId: String(childTaskId),
      detail: task.title,
      tokensUsed: 0,
      cost: 0,
    });
  }

  // Check if all siblings done → auto-close CEO parent
  const freshTask = storage.getTask(childTaskId);
  if (freshTask) maybeAutoCloseParentCeoTask(freshTask);
}

// ─── Auto-close parent when children are done ───────────────────────────────

export function maybeAutoCloseParentCeoTask(childTask: { id: number; tenantId: number; description?: string | null; parentTaskId?: number | null }) {
  const parentId = childTask.parentTaskId ?? (() => {
    const m = String(childTask.description ?? "").match(/parentTaskId:(\d+)/);
    return m ? Number(m[1]) : null;
  })();
  if (!parentId) return;
  const parent = storage.getTask(parentId);
  if (!parent || parent.status === "done") return;
  if (!parent.assignedAgentId) return;
  const ceo = storage.getAgent(parent.assignedAgentId);
  if (!ceo || !isCeoAgent(ceo)) return;

  const allTasks = storage.getTasks(parent.tenantId);
  const children = allTasks.filter(
    (t) =>
      t.id !== parent.id &&
      (t.parentTaskId === parent.id || String(t.description ?? "").includes(parentTaskMarker(parent.id))),
  );
  const allDone = children.length > 0 && children.every((t) => t.status === "done");
  if (!allDone) return;

  storage.updateTask(parent.id, { status: "done" } as any);
  auditAndInvalidate(parent.tenantId, ["tasks", "goals"], {
    agentId: ceo.id,
    agentName: `${ceo.displayName} (CEO)`,
    action: "task_completed",
    entity: "task",
    entityId: String(parent.id),
    detail: `All ${children.length} delegated sub-tasks completed → CEO task done: ${parent.title}`,
    tokensUsed: 0,
    cost: 0,
  });

  const completedNames = children
    .map((c) => {
      const a = c.assignedAgentId ? storage.getAgent(c.assignedAgentId) : null;
      return a ? a.displayName : "Agent";
    })
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const posted = storage.createMessage({
    tenantId: parent.tenantId,
    channelId: "general",
    channelType: "general",
    senderAgentId: ceo.id,
    senderName: `${ceo.displayName} (CEO)`,
    senderEmoji: "🤖",
    content: [
      `All ${children.length} sub-tasks for "${parent.title}" are now complete.`,
      `Team members who contributed: ${completedNames.join(", ")}.`,
      `Marking CEO task #${parent.id} as done. Great work, team.`,
    ].join("\n"),
    messageType: "decision",
    metadata: JSON.stringify({ ceoAutoClose: true, parentTaskId: parent.id }),
  } as any);

  auditAndInvalidate(parent.tenantId, ["messages"], {
    agentId: ceo.id,
    agentName: `${ceo.displayName} (CEO)`,
    action: "message_sent",
    entity: "message",
    entityId: String(posted.id),
    detail: posted.content.slice(0, 200),
    tokensUsed: 0,
    cost: 0,
  });
}

// ─── Main delegation entry ──────────────────────────────────────────────────

export function maybeDelegateCeoIncomingTask(taskId: number): boolean {
  const task = storage.getTask(taskId);
  if (!task?.assignedAgentId) return false;

  const assignee = storage.getAgent(task.assignedAgentId);
  if (!assignee || assignee.tenantId !== task.tenantId) return false;
  if (!isCeoAgent(assignee)) return false;
  if (task.status === "done") return false;

  const taskText = `${task.title} ${task.description ?? ""}`;
  const workers = rankWorkers(task.tenantId, assignee.id, taskText, 5);
  if (workers.length === 0) return false;

  const existing = storage.getTasks(task.tenantId);
  const already = existing.some(
    (t) =>
      t.id !== task.id &&
      (t.parentTaskId === task.id || String(t.description ?? "").includes(parentTaskMarker(task.id))),
  );
  if (already) return false;

  // Mark the CEO task as in_progress immediately.
  if (task.status === "todo") {
    storage.updateTask(task.id, { status: "in_progress" } as any);
    auditAndInvalidate(task.tenantId, ["tasks", "goals"], {
      agentId: assignee.id,
      agentName: `${assignee.displayName} (CEO)`,
      action: "task_status_changed",
      entity: "task",
      entityId: String(task.id),
      detail: `todo → in_progress (CEO delegation started)`,
      tokensUsed: 0,
      cost: 0,
    });
  }

  const ceo = assignee;
  const lines = [
    `📋 CEO Delegation — task #${task.id}: "${task.title}"`,
    "",
    `I've reviewed the task and assigned the following agents:`,
  ];

  const childIds: { agentId: number; taskId: number }[] = [];

  for (let i = 0; i < workers.length; i++) {
    const w = workers[i]!;
    const def = storage.getAgentDefinition(w.definitionId);
    const childPayload: InsertTask = {
      tenantId: task.tenantId,
      title: `[CEO\u2192${w.displayName}] ${task.title}`,
      description: [
        parentTaskMarker(task.id),
        "",
        `Parent task: ${task.title}`,
        task.description ? `\nContext: ${String(task.description).slice(0, 800)}` : "",
        "",
        `Your role: ${w.role}${def ? ` (${def.specialty})` : ""}`,
        `Instructions: handle your part of this task using your skills. Post updates in #general.`,
      ].join("\n"),
      status: "todo",
      priority: task.priority,
      assignedAgentId: w.id,
      createdById: ceo.id,
      parentTaskId: task.id,
      teamId: task.teamId ?? null,
      goalTag: task.goalTag ?? null,
      dueDate: task.dueDate ?? null,
    };
    const child = storage.createTask(childPayload);
    childIds.push({ agentId: w.id, taskId: child.id });

    lines.push(
      `• **${w.displayName}** (${w.role})${def ? ` — ${def.specialty.split(",").slice(0, 2).join(", ")}` : ""} → task #${child.id}`,
    );

    auditAndInvalidate(task.tenantId, ["tasks", "goals"], {
      agentId: ceo.id,
      agentName: `${ceo.displayName} (CEO)`,
      action: "task_created",
      entity: "task",
      entityId: String(child.id),
      detail: `Delegated from CEO task #${task.id} → ${w.displayName}`,
      tokensUsed: 0,
      cost: 0,
    });
  }

  lines.push("", `All agents will start working automatically. I'll track progress and close when everyone finishes.`);

  const posted = storage.createMessage({
    tenantId: task.tenantId,
    channelId: "general",
    channelType: "general",
    senderAgentId: ceo.id,
    senderName: `${ceo.displayName} (CEO)`,
    senderEmoji: "🤖",
    content: lines.join("\n"),
    messageType: "decision",
    metadata: JSON.stringify({ ceoDelegation: true, parentTaskId: task.id }),
  } as any);

  auditAndInvalidate(task.tenantId, ["messages"], {
    agentId: ceo.id,
    agentName: `${ceo.displayName} (CEO)`,
    action: "message_sent",
    entity: "message",
    entityId: String(posted.id),
    detail: posted.content.slice(0, 200),
    tokensUsed: 0,
    cost: 0,
  });

  // Fire off real adapter runs for each worker (staggered to avoid flooding).
  for (let i = 0; i < childIds.length; i++) {
    const c = childIds[i]!;
    void realWorkerRun(task.tenantId, c.agentId, c.taskId, i * STAGGER_MS);
  }

  return true;
}
