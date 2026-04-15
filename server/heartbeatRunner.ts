import { db } from "./db";
import { agents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "./storage";
import { auditAndInvalidate } from "./realtimeSideEffects";
import { hermesRunOnce } from "./hermesAdapter";
import { ensureAgentConfigurationTables, getAgentRuntimeSettings } from "./agentConfiguration";
import { pickAgentPrimaryChannel } from "./hermesAdapter";

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

    // Allow per-agent runtime settings to disable scheduled heartbeats.
    ensureAgentConfigurationTables();
    const runtime = getAgentRuntimeSettings(a.id);
    if (!runtime.heartbeatEnabled) continue;

    const last = a.lastHeartbeat ? new Date(a.lastHeartbeat) : null;
    const sched = parseSchedule(a.heartbeatSchedule);
    if (!dueNow(sched, now, last)) continue;

    if (tenant.adapterType === "hermes") {
      // Hermes: do real work loop (writes message/task/audit via existing plumbing)
      try {
        await hermesRunOnce(a.tenantId, a.id, { reason: "scheduled" });
        // hermesRunOnce already updates lastHeartbeat; we still record a heartbeat audit for clarity.
        auditAndInvalidate(a.tenantId, ["agents", "tasks", "messages", "goals"], {
          agentId: a.id,
          agentName: a.displayName,
          action: "heartbeat",
          entity: "agent",
          entityId: String(a.id),
          detail: `Scheduled heartbeat (${a.heartbeatSchedule})`,
          tokensUsed: 0,
          cost: 0,
        });
      } catch {
        // ignore to keep runner stable
      }
    } else {
      // OpenClaw: record the heartbeat tick (gateway would normally phone home)
      const iso = now.toISOString();
      storage.updateAgent(a.id, { lastHeartbeat: iso });
      // Also emit a lightweight collaboration update so the UI doesn't feel one-way.
      const def = storage.getAgentDefinition(a.definitionId);
      const primary = pickAgentPrimaryChannel(a.tenantId, a.id, null);
      const msg = storage.createMessage({
        tenantId: a.tenantId,
        channelId: primary.channelId,
        channelType: primary.channelType,
        senderAgentId: a.id,
        senderName: `${a.displayName} (${a.role})`,
        senderEmoji: def?.emoji ?? "🤖",
        content: `Heartbeat ping (${a.heartbeatSchedule}) — OpenClaw org: awaiting gateway execution. Set a task + use Run for a recorded signal.`,
        messageType: "heartbeat",
        metadata: { openclawHeartbeat: true },
      } as any);
      auditAndInvalidate(a.tenantId, ["messages"], {
        agentId: a.id,
        agentName: a.displayName,
        action: "message_sent",
        entity: "message",
        entityId: String(msg.id),
        detail: msg.content.slice(0, 200),
        tokensUsed: 0,
        cost: 0,
      });
      auditAndInvalidate(a.tenantId, ["agents"], {
        agentId: a.id,
        agentName: a.displayName,
        action: "heartbeat",
        entity: "agent",
        entityId: String(a.id),
        detail: `Scheduled heartbeat (${a.heartbeatSchedule}) — awaiting OpenClaw gateway`,
        tokensUsed: 0,
        cost: 0,
      });
    }
  }
}

export function startHeartbeatRunner() {
  // tick every second so minute-bound schedules are accurate
  const intervalMs = 1000;
  setInterval(() => {
    void heartbeatTick();
  }, intervalMs);
}

