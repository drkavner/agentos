import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Activity, Bell, Bot, CheckSquare } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatDistanceToNow, agentCardStatus } from "@/lib/utils";
import type { Agent, AuditLog, Task } from "@shared/schema";

type AgentRow = Agent & {
  displayStatus?: string;
  latestFinishedRun?: { status: string; summary?: string | null; error?: string | null };
};

function taskSortKey(t: Task) {
  const statusOrder: Record<string, number> = { review: 0, blocked: 1, in_progress: 2, todo: 3 };
  const pr: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return (statusOrder[t.status] ?? 9) * 10 + (pr[t.priority] ?? 2);
}

function statusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s === "error" || s === "blocked") return "border-destructive/40 text-destructive bg-destructive/10";
  if (s === "review") return "border-yellow-500/35 text-yellow-200 bg-yellow-500/10";
  if (s === "running" || s === "in_progress") return "border-emerald-500/35 text-emerald-200 bg-emerald-500/10";
  if (s === "done") return "border-border text-muted-foreground";
  return "border-border text-muted-foreground";
}

function formatAuditAction(action: string) {
  return action.replace(/_/g, " ");
}

const ACTIVITY_ACK_KEY = "cortex-activity-ack-v1";

/** Stable signature of “needs attention” items so the bell clears after you open the panel until something changes. */
function attentionFingerprint(tasks: Task[], agents: AgentRow[]): string {
  const taskPart = tasks
    .filter((t) => t.status === "review" || t.status === "blocked")
    .map((t) => `${t.id}:${t.status}`)
    .sort()
    .join(",");
  const agentPart = agents
    .filter((a) => String(agentCardStatus(a)).toLowerCase() === "error")
    .map((a) => String(a.id))
    .sort()
    .join(",");
  return `${taskPart}||${agentPart}`;
}

export function HeaderActivityMenu({ tenantId }: { tenantId: number }) {
  const [open, setOpen] = useState(false);
  /** Last acknowledged attention fingerprint (localStorage per tenant). */
  const [ackedFp, setAckedFp] = useState("");
  const enabled = tenantId > 0;
  const ackStorageKey = `${ACTIVITY_ACK_KEY}:${tenantId}`;

  useEffect(() => {
    if (tenantId <= 0) {
      setAckedFp("");
      return;
    }
    try {
      setAckedFp(localStorage.getItem(ackStorageKey) ?? "");
    } catch {
      setAckedFp("");
    }
  }, [tenantId, ackStorageKey]);

  const { data: agents = [] } = useQuery<AgentRow[]>({
    queryKey: ["/api/tenants", tenantId, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tenantId}/agents`).then((r) => r.json()),
    enabled,
    staleTime: 4000,
    refetchInterval: open ? 7000 : 25000,
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tenants", tenantId, "tasks"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tenantId}/tasks`).then((r) => r.json()),
    enabled,
    staleTime: 4000,
    refetchInterval: open ? 7000 : 25000,
  });

  const { data: audit = [] } = useQuery<AuditLog[]>({
    queryKey: ["/api/tenants", tenantId, "audit"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tenantId}/audit`).then((r) => r.json()),
    enabled,
    staleTime: 4000,
    refetchInterval: open ? 7000 : 35000,
  });

  const activeTasks = useMemo(() => {
    return [...tasks].filter((t) => t.status !== "done").sort((a, b) => taskSortKey(a) - taskSortKey(b)).slice(0, 14);
  }, [tasks]);

  const recentAudit = useMemo(() => audit.slice(0, 18), [audit]);

  const { attentionCount, livePulse, attentionFp } = useMemo(() => {
    let attention = 0;
    for (const t of tasks) {
      if (t.status === "review" || t.status === "blocked") attention++;
    }
    for (const a of agents) {
      if (String(agentCardStatus(a)).toLowerCase() === "error") attention++;
    }
    const runningAgents = agents.filter((a) => String(agentCardStatus(a)).toLowerCase() === "running").length;
    const activeWork = tasks.filter((t) => t.status === "in_progress").length;
    const livePulse = runningAgents > 0 || activeWork > 0;
    return { attentionCount: attention, livePulse, attentionFp: attentionFingerprint(tasks, agents) };
  }, [tasks, agents]);

  /** Opening the menu = “saw” current alerts; badge hides until the set of blocking issues changes. */
  useEffect(() => {
    if (!open || tenantId <= 0) return;
    try {
      localStorage.setItem(ackStorageKey, attentionFp);
      setAckedFp(attentionFp);
    } catch {
      /* ignore quota / private mode */
    }
  }, [open, attentionFp, ackStorageKey, tenantId]);

  const unackedAttention = attentionCount > 0 && attentionFp !== ackedFp;

  if (!enabled) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative text-muted-foreground hover:text-foreground"
        disabled
        aria-label="Notifications"
        data-testid="notifications"
      >
        <Bell className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Activity and notifications"
          data-testid="notifications"
        >
          <Bell className="h-4 w-4" />
          {unackedAttention ? (
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-[18px] text-center",
                "bg-destructive text-destructive-foreground shadow-sm",
              )}
            >
              {attentionCount > 99 ? "99+" : attentionCount}
            </span>
          ) : livePulse ? (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(100vw-1.5rem,400px)] p-0" collisionPadding={12}>
        <div className="px-3 py-2.5 border-b border-border">
          <div className="text-sm font-semibold text-foreground">Activity</div>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
            Live agent status, open tasks, and what just happened in this org.
          </p>
        </div>

        <ScrollArea className="h-[min(60vh,420px)]">
          <div className="px-2 py-2 space-y-3">
            <section>
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-foreground">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                Agents ({agents.length})
              </div>
              <div className="space-y-1">
                {agents.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground px-2 py-1">No agents yet.</p>
                ) : (
                  agents.map((a) => {
                    const st = String(agentCardStatus(a));
                    const last = a.latestFinishedRun;
                    const sub =
                      last?.status === "failed" && last.error
                        ? last.error
                        : last?.summary
                          ? String(last.summary).slice(0, 120) + (String(last.summary).length > 120 ? "…" : "")
                          : a.lastHeartbeat
                            ? `Heartbeat ${formatDistanceToNow(a.lastHeartbeat)}`
                            : "No run yet";
                    return (
                      <Link
                        key={a.id}
                        href="/agents/my-agents"
                        onClick={() => setOpen(false)}
                        className="flex gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/40 transition-colors"
                      >
                        <span className="text-base shrink-0 leading-none pt-0.5" aria-hidden>
                          {a.emoji?.trim() || "🤖"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-foreground truncate">{a.displayName}</span>
                            <Badge variant="outline" className={cn("text-[10px] py-0 h-5 font-normal", statusBadgeClass(st))}>
                              {st}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">{a.role}</div>
                          <div className="text-[10px] text-muted-foreground/90 line-clamp-2 mt-0.5">{sub}</div>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </section>

            <DropdownMenuSeparator className="my-0" />

            <section>
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-foreground">
                <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                Tasks ({activeTasks.length} open)
              </div>
              <div className="space-y-1">
                {activeTasks.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground px-2 py-1">No open tasks.</p>
                ) : (
                  activeTasks.map((t) => (
                    <Link
                      key={t.id}
                      href="/tasks"
                      onClick={() => setOpen(false)}
                      className="block rounded-md px-2 py-1.5 hover:bg-accent/40 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <Badge variant="outline" className={cn("text-[10px] py-0 h-5 shrink-0 font-normal", statusBadgeClass(t.status))}>
                          {String(t.status).replace(/_/g, " ")}
                        </Badge>
                        <span className="text-xs text-foreground leading-snug line-clamp-2">{t.title}</span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </section>

            <DropdownMenuSeparator className="my-0" />

            <section>
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-foreground">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                Recent events
              </div>
              <div className="space-y-1.5">
                {recentAudit.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground px-2 py-1">No audit entries yet.</p>
                ) : (
                  recentAudit.map((row) => (
                    <Link
                      key={row.id}
                      href="/audit"
                      onClick={() => setOpen(false)}
                      className="block rounded-md px-2 py-1 hover:bg-accent/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-foreground capitalize truncate">
                          {formatAuditAction(row.action)}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {row.createdAt ? formatDistanceToNow(row.createdAt) : "—"}
                        </span>
                      </div>
                      {row.agentName ? (
                        <div className="text-[10px] text-muted-foreground truncate">{row.agentName}</div>
                      ) : null}
                      {row.detail ? (
                        <div className="text-[10px] text-muted-foreground/90 line-clamp-2 mt-0.5">{row.detail}</div>
                      ) : null}
                    </Link>
                  ))
                )}
              </div>
            </section>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-end gap-1 border-t border-border px-2 py-1.5">
          <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
            <Link href="/agents/my-agents" onClick={() => setOpen(false)}>
              My Agents
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
            <Link href="/tasks" onClick={() => setOpen(false)}>
              Tasks
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
            <Link href="/audit" onClick={() => setOpen(false)}>
              Audit
            </Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
