import { db } from "./db";
import { agents, tasks } from "@shared/schema";
import { eq, and, isNull, ne } from "drizzle-orm";
import { storage } from "./storage";
import { auditAndInvalidate } from "./realtimeSideEffects";
import { pickAgentPrimaryChannel } from "./hermesAdapter";
import { ensureAgentConfigurationTables, getAgentRuntimeSettings } from "./agentConfiguration";
import { dispatchAgentRun } from "./dispatchAgentRun";
import { getCeoControlSettings } from "./ceoControl";
import { maybeDelegateCeoIncomingTask } from "./ceoDelegation";

type ParsedSchedule =
  | { kind: "everyNMinutes"; n: number }
  | { kind: "hourly" } // 0 * * * *
  | { kind: "everyNHours"; n: number } // 0 */n * * *
  | { kind: "dailyAt"; hour: number; minute: number; weekdaysOnly: boolean };

function parseSchedule(expr: string): ParsedSchedule {
  const s = (expr || "").trim();
  const everyN = s.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (everyN) return { kind: "everyNMinutes", n: Math.max(1, Number(everyN[1])) };

  if (s === "0 * * * *") return { kind: "hourly" };
  const everyNh = s.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (everyNh) return { kind: "everyNHours", n: Math.max(1, Number(everyNh[1])) };

  // 0 9 * * 1-5
  const daily = s.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+(\*|1-5)$/);
  if (daily) {
    const minute = Math.min(59, Math.max(0, Number(daily[1])));
    const hour = Math.min(23, Math.max(0, Number(daily[2])));
    const weekdaysOnly = daily[3] === "1-5";
    return { kind: "dailyAt", hour, minute, weekdaysOnly };
  }

  // default to */30
  return { kind: "everyNMinutes", n: 30 };
}

function sameMinute(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

function sameHour(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours()
  );
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isWeekday(d: Date) {
  const day = d.getDay(); // 0=Sun
  return day >= 1 && day <= 5;
}

function dueNow(schedule: ParsedSchedule, now: Date, last: Date | null) {
  // avoid multiple heartbeats per interval window
  if (last && sameMinute(now, last)) return false;

  switch (schedule.kind) {
    case "everyNMinutes": {
      if (now.getSeconds() > 5) return false; // fire near top of minute
      if (now.getMinutes() % schedule.n !== 0) return false;
      return true;
    }
    case "hourly": {
      if (now.getSeconds() > 5) return false;
      if (now.getMinutes() !== 0) return false;
      if (last && sameHour(now, last)) return false;
      return true;
    }
    case "everyNHours": {
      if (now.getSeconds() > 5) return false;
      if (now.getMinutes() !== 0) return false;
      if (now.getHours() % schedule.n !== 0) return false;
      if (last && sameHour(now, last)) return false;
      return true;
    }
    case "dailyAt": {
      if (now.getSeconds() > 5) return false;
      if (schedule.weekdaysOnly && !isWeekday(now)) return false;
      if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) return false;
      if (last && sameDay(now, last)) return false;
      return true;
    }
    default:
      return false;
  }
}

async function heartbeatTick() {
  const now = new Date();
  const running = db
    .select()
    .from(agents)
    .where(eq(agents.status, "running"))
    .all();

  for (const a of running) {
    const tenant = storage.getTenant(a.tenantId);
    if (!tenant) continue;

    // If CEO is disabled for this org, do not run its scheduled heartbeats even if the agent row exists.
    if (String(a.role).toLowerCase() === "ceo") {
      const s = getCeoControlSettings(a.tenantId);
      if (s.enabled === false) continue;
    }

    // Allow per-agent runtime settings to disable scheduled heartbeats.
    ensureAgentConfigurationTables();
    const runtime = getAgentRuntimeSettings(a.id);
    if (!runtime.heartbeatEnabled) continue;

    const last = a.lastHeartbeat ? new Date(a.lastHeartbeat) : null;
    const sched = parseSchedule(a.heartbeatSchedule);
    if (!dueNow(sched, now, last)) continue;

    // Mark the tick immediately so we don't re-fire multiple times within the same
    // minute window when a run fails before it can update lastHeartbeat.
    const iso = now.toISOString();
    storage.updateAgent(a.id, { lastHeartbeat: iso });

    const adapterType = runtime.adapterType ?? (tenant.adapterType === "openclaw" ? "openclaw" : "hermes");

    try {
      await dispatchAgentRun(a.tenantId, a.id, { reason: "scheduled" });
      auditAndInvalidate(a.tenantId, ["agents", "tasks", "messages", "goals"], {
        agentId: a.id,
        agentName: a.displayName,
        action: "heartbeat",
        entity: "agent",
        entityId: String(a.id),
        detail: `Scheduled heartbeat (${a.heartbeatSchedule}) — adapter: ${adapterType}`,
        tokensUsed: 0,
        cost: 0,
      });
    } catch {
      // ignore to keep runner stable
    }
  }
}

async function workScanTick() {
  const tenants = storage.getTenants();
  for (const tenant of tenants) {
    const unassigned = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenant.id), isNull(tasks.assignedAgentId), ne(tasks.status, "done")))
      .all();
    if (unassigned.length === 0) continue;

    const runningAgents = db
      .select()
      .from(agents)
      .where(and(eq(agents.tenantId, tenant.id), eq(agents.status, "running")))
      .all()
      .filter((a) => String(a.role).toLowerCase() !== "ceo");
    if (runningAgents.length === 0) continue;

    for (const task of unassigned) {
      const busyCounts = new Map<number, number>();
      const allTasks = storage.getTasks(tenant.id);
      for (const t of allTasks) {
        if (t.status !== "done" && t.assignedAgentId) {
          busyCounts.set(t.assignedAgentId, (busyCounts.get(t.assignedAgentId) ?? 0) + 1);
        }
      }
      const leastBusy = runningAgents.sort(
        (a, b) => (busyCounts.get(a.id) ?? 0) - (busyCounts.get(b.id) ?? 0),
      )[0];
      if (!leastBusy) continue;

      storage.updateTask(task.id, { assignedAgentId: leastBusy.id } as any);
      auditAndInvalidate(tenant.id, ["tasks"], {
        agentId: leastBusy.id,
        agentName: leastBusy.displayName,
        action: "task_checkout",
        entity: "task",
        entityId: String(task.id),
        detail: `Auto-assigned unassigned task: ${task.title}`,
        tokensUsed: 0,
        cost: 0,
      });
      break;
    }
  }
}

export function startHeartbeatRunner() {
  const intervalMs = 1000;
  setInterval(() => {
    void heartbeatTick();
  }, intervalMs);

  // Work scan: every 10s, auto-assign orphaned tasks to idle agents.
  setInterval(() => {
    void workScanTick();
  }, 10_000);
}

