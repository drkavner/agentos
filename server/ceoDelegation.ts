import { storage } from "./storage";
import { auditAndInvalidate } from "./realtimeSideEffects";
import { dispatchAgentRun } from "./dispatchAgentRun";
import { db } from "./db";
import { messages } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
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

const STAGGER_MS = 2000;
const DISCUSSION_STAGGER_MS = 3000;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function runSingleWorker(tenantId: number, agentId: number, childTaskId: number): Promise<boolean> {
  const task = storage.getTask(childTaskId);
  if (!task) return false;

  try {
    await dispatchAgentRun(tenantId, agentId, { reason: "start", bypassCooldown: true });
  } catch (err) {
    console.error(`[ceoDelegation] dispatchAgentRun failed for agent ${agentId}, task ${childTaskId}:`, err);
  }

  const updated = storage.getTask(childTaskId);
  if (updated && updated.status !== "done" && updated.status !== "review") {
    storage.updateTask(childTaskId, { status: "review" } as any);
    const agent = storage.getAgent(agentId);
    auditAndInvalidate(tenantId, ["tasks", "goals"], {
      agentId,
      agentName: agent?.displayName,
      action: "task_status_changed",
      entity: "task",
      entityId: String(childTaskId),
      detail: `${task.title} → awaiting review`,
      tokensUsed: 0,
      cost: 0,
    });
  }
  return true;
}

function getRecentAgentMessages(tenantId: number, channelId: string, agentIds: number[], limit = 10): string {
  const recent = db
    .select()
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.channelId, channelId)))
    .orderBy(desc(messages.id))
    .limit(limit)
    .all()
    .reverse();

  const relevantMsgs = recent.filter((m) => m.senderAgentId && agentIds.includes(m.senderAgentId));
  if (relevantMsgs.length === 0) return "";

  return relevantMsgs
    .map((m) => `--- ${m.senderName} ---\n${String(m.content).slice(0, 1500)}`)
    .join("\n\n");
}

/**
 * Orchestrate the full delegation lifecycle:
 *   Phase 1: All workers produce their deliverables (staggered)
 *   Phase 2: Discussion round — each agent reads others' work and comments
 *   Phase 3: Auto-close parent CEO task
 */
async function orchestrateDelegation(
  tenantId: number,
  parentTaskId: number,
  childIds: { agentId: number; taskId: number }[],
) {
  // Phase 1: Run all workers
  for (let i = 0; i < childIds.length; i++) {
    if (i > 0) await sleep(STAGGER_MS);
    const c = childIds[i]!;
    await runSingleWorker(tenantId, c.agentId, c.taskId);
  }

  // Phase 2: Discussion round
  if (childIds.length >= 2) {
    const agentIds = childIds.map((c) => c.agentId);
    const teamChannel = findTeamChannelSimple(tenantId, agentIds);
    const discussionChannel = teamChannel ?? "general";

    const conversationSoFar = getRecentAgentMessages(tenantId, discussionChannel, agentIds, 15);
    if (!conversationSoFar) {
      const fallback = getRecentAgentMessages(tenantId, "general", agentIds, 15);
      if (fallback) {
        await runDiscussionRound(tenantId, parentTaskId, childIds, "general", fallback);
      }
    } else {
      await runDiscussionRound(tenantId, parentTaskId, childIds, discussionChannel, conversationSoFar);
    }
  }

  // Phase 3: Auto-close
  const freshChild = storage.getTask(childIds[0]!.taskId);
  if (freshChild) maybeAutoCloseParentCeoTask(freshChild);
}

function findTeamChannelSimple(tenantId: number, agentIds: number[]): string | null {
  const teams = storage.getTeams(tenantId);
  for (const team of teams) {
    const members = storage.getTeamMembers(team.id);
    if (members.some((m: any) => agentIds.includes(m.agentId))) {
      return `team-${team.id}`;
    }
  }
  return null;
}

async function runDiscussionRound(
  tenantId: number,
  parentTaskId: number,
  childIds: { agentId: number; taskId: number }[],
  channelId: string,
  conversationContext: string,
) {
  const parentTask = storage.getTask(parentTaskId);
  const channelType = channelId.startsWith("team-") ? "team" : "general";

  console.log(`[ceoDelegation] Starting discussion round for task #${parentTaskId} in ${channelId} (${childIds.length} agents)`);

  for (let i = 0; i < childIds.length; i++) {
    if (i > 0) await sleep(DISCUSSION_STAGGER_MS);
    const c = childIds[i]!;
    const agent = storage.getAgent(c.agentId);
    if (!agent) continue;

    // Refresh context — each agent sees previous discussion messages too
    const freshContext = getRecentAgentMessages(tenantId, channelId, childIds.map((x) => x.agentId), 20);
    const contextToUse = freshContext || conversationContext;

    try {
      await dispatchAgentRun(tenantId, c.agentId, {
        reason: "manual",
        forceChannelId: channelId,
        forceChannelType: channelType as any,
        bypassCooldown: true,
        discussionContext: contextToUse,
      });
    } catch (err) {
      console.error(`[ceoDelegation] Discussion run failed for agent ${c.agentId}:`, err);
    }
  }

  console.log(`[ceoDelegation] Discussion round complete for task #${parentTaskId}`);
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
  const allReviewOrDone = children.length > 0 && children.every((t) => t.status === "review" || t.status === "done");

  if (allDone) {
    storage.updateTask(parent.id, { status: "done" } as any);
    auditAndInvalidate(parent.tenantId, ["tasks", "goals"], {
      agentId: ceo.id,
      agentName: `${ceo.displayName} (CEO)`,
      action: "task_completed",
      entity: "task",
      entityId: String(parent.id),
      detail: `All ${children.length} delegated sub-tasks approved → CEO task done: ${parent.title}`,
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
        `All ${children.length} sub-tasks for "${parent.title}" have been approved and completed.`,
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
  } else if (allReviewOrDone && parent.status !== "review") {
    storage.updateTask(parent.id, { status: "review" } as any);
    auditAndInvalidate(parent.tenantId, ["tasks", "goals"], {
      agentId: ceo.id,
      agentName: `${ceo.displayName} (CEO)`,
      action: "task_status_changed",
      entity: "task",
      entityId: String(parent.id),
      detail: `All sub-tasks ready for review → "${parent.title}"`,
      tokensUsed: 0,
      cost: 0,
    });

    const agentNames = children
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
        `📋 All ${children.length} sub-tasks for "${parent.title}" are now ready for review.`,
        `Team: ${agentNames.join(", ")}.`,
        `Please review each sub-task and approve or request changes.`,
      ].join("\n"),
      messageType: "decision",
      metadata: JSON.stringify({ pendingReview: true, parentTaskId: parent.id }),
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

  // Fire off the full orchestration: work → discuss → close
  void orchestrateDelegation(task.tenantId, task.id, childIds);

  return true;
}
