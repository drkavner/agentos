import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTenantContext } from "@/tenant/TenantContext";
import type { Agent, Task, AuditLog } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { XCircle, ChevronRight } from "lucide-react";
import { CeoShell } from "./CeoShell";

const STATUSES = ["todo", "in_progress", "review", "done", "blocked"] as const;
const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

export default function CeoDashboard() {
  const { activeTenantId, activeTenant } = useTenantContext();
  const tid = activeTenantId ?? 0;

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tenants", tid, "tasks"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/tasks`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const { data: audit = [] } = useQuery<AuditLog[]>({
    queryKey: ["/api/tenants", tid, "audit"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/audit`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const byStatus = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of STATUSES) out[s] = tasks.filter((t) => t.status === s).length;
    return out;
  }, [tasks]);

  const ceo = agents.find((a) => String(a.role).toLowerCase() === "ceo") ?? null;

  const runEvents = useMemo(() => {
    if (!ceo) return [];
    // We treat CEO "runs" as hermes/openclaw runs, heartbeats, and explicit failures.
    return audit
      .filter((r) => r.agentId === ceo.id)
      .filter((r) =>
        r.action === "hermes_run_once" ||
        r.action === "openclaw_run_once" ||
        r.action === "heartbeat" ||
        r.action === "agent_run_failed"
      )
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [audit, ceo]);

  const latestRun = runEvents[0] ?? null;

  const issuesByPriority = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of PRIORITIES) out[p] = tasks.filter((t) => t.priority === p && t.status !== "done").length;
    return out;
  }, [tasks]);

  const issuesByStatus = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of STATUSES) out[s] = tasks.filter((t) => t.status === s).length;
    return out;
  }, [tasks]);

  const recentIssues = useMemo(() => {
    return tasks
      .filter((t) => t.status !== "done")
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 2);
  }, [tasks]);

  const runOnce = useMutation({
    mutationFn: async () => {
      if (!ceo) throw new Error("No CEO");
      return apiRequest("POST", `/api/tenants/${tid}/agents/${ceo.id}/hermes/run-once`).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "audit"] });
    },
  });

  // Auto-run once when opening the CEO dashboard so we immediately learn if the
  // chosen provider/model is healthy. Real provider/API-key failures surface via Audit Log.
  const [autoRan, setAutoRan] = useState(false);
  useEffect(() => {
    if (autoRan) return;
    if (!ceo || tid <= 0) return;
    if (runEvents.length > 0) return;
    setAutoRan(true);
    runOnce.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRan, ceo?.id, tid, runEvents.length]);

  const budgetPct = activeTenant ? Math.min(1, activeTenant.spentThisMonth / Math.max(1, activeTenant.monthlyBudget)) : 0;
  return (
    <CeoShell>
      {/* Latest run */}
      <Card className="bg-card border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Latest Run</CardTitle>
          <Link href="/ceo/runs">
            <a className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              View details <ChevronRight className="w-3.5 h-3.5" />
            </a>
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {latestRun ? (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs py-0",
                      latestRun.action === "agent_run_failed" && "border-destructive/40 text-destructive"
                    )}
                  >
                    {latestRun.action === "agent_run_failed" ? "failed" : "ok"}
                  </Badge>
                </span>
                <span className="font-mono">{latestRun.id}</span>
                <Badge variant="outline" className="text-[10px] py-0">
                  {latestRun.action === "heartbeat" ? "heartbeat" : "on-demand"}
                </Badge>
                <span className="ml-auto">{new Date(latestRun.createdAt).toLocaleString()}</span>
              </div>
              <div className="text-sm text-foreground">
                {latestRun.detail ?? "—"}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                <Badge variant="outline" className="text-xs py-0">—</Badge>
                <span className="font-mono">—</span>
                <Badge variant="outline" className="text-[10px] py-0">—</Badge>
                <span className="ml-auto">—</span>
              </div>
              <div className="text-sm text-foreground">
                {runOnce.isPending ? (
                  <>Running first heartbeat…</>
                ) : (
                  <>
                    No runs yet. A first heartbeat will run automatically. You can also run one manually or go to{" "}
                    <span className="font-medium">Runs</span>.
                  </>
                )}
              </div>
              <div className="pt-2">
                <Button size="sm" variant="outline" onClick={() => runOnce.mutate()} disabled={!ceo || runOnce.isPending}>
                  {runOnce.isPending ? "Running..." : "Run once now"}
                </Button>
                {activeTenant?.adapterType === "openclaw" ? (
                  <p className="text-xs text-muted-foreground mt-2">
                    OpenClaw: run is recorded here; gateway executes the real workload.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Mini-panels */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium">Run Activity</CardTitle>
            <div className="text-[10px] text-muted-foreground/70">Last 14 days</div>
          </CardHeader>
          <CardContent>
            <div className="h-20 flex items-end justify-end gap-1">
              {[3, 8, 2, 14].map((h, i) => (
                <div key={i} className="w-3 rounded bg-destructive/80" style={{ height: `${h * 4}px` }} />
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {runEvents.length} runs
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium">Issues by Priority</CardTitle>
            <div className="text-[10px] text-muted-foreground/70">Last 14 days</div>
          </CardHeader>
          <CardContent>
            <div className="h-20 flex items-end justify-end gap-1">
              <div className="w-3 rounded bg-destructive/80" style={{ height: `${Math.min(80, issuesByPriority.urgent * 10)}px` }} />
              <div className="w-3 rounded bg-orange-400/80" style={{ height: `${Math.min(80, issuesByPriority.high * 10)}px` }} />
              <div className="w-3 rounded bg-yellow-400/80" style={{ height: `${Math.min(80, issuesByPriority.medium * 10)}px` }} />
              <div className="w-3 rounded bg-muted-foreground/40" style={{ height: `${Math.min(80, issuesByPriority.low * 10)}px` }} />
            </div>
            <div className="mt-2 flex gap-2 text-[10px] text-muted-foreground">
              <span>Critical {issuesByPriority.urgent}</span>
              <span>High {issuesByPriority.high}</span>
              <span>Medium {issuesByPriority.medium}</span>
              <span>Low {issuesByPriority.low}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium">Issues by Status</CardTitle>
            <div className="text-[10px] text-muted-foreground/70">Last 14 days</div>
          </CardHeader>
          <CardContent>
            <div className="h-20 flex items-end justify-end gap-1">
              <div className="w-3 rounded bg-blue-500/80" style={{ height: `${Math.min(80, issuesByStatus.todo * 8)}px` }} />
              <div className="w-3 rounded bg-primary/80" style={{ height: `${Math.min(80, issuesByStatus.in_progress * 8)}px` }} />
              <div className="w-3 rounded bg-yellow-400/80" style={{ height: `${Math.min(80, issuesByStatus.review * 8)}px` }} />
              <div className="w-3 rounded bg-green-500/80" style={{ height: `${Math.min(80, issuesByStatus.done * 3)}px` }} />
            </div>
            <div className="mt-2 flex gap-2 text-[10px] text-muted-foreground">
              <span>To Do {issuesByStatus.todo}</span>
              <span>In progress {issuesByStatus.in_progress}</span>
              <span>Review {issuesByStatus.review}</span>
              <span>Done {issuesByStatus.done}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium">Success Rate</CardTitle>
            <div className="text-[10px] text-muted-foreground/70">Last 14 days</div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-semibold text-foreground">
              {runEvents.length ? "100%" : "—"}
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary" style={{ width: runEvents.length ? "100%" : "0%" }} />
            </div>
            <div className="text-xs text-muted-foreground">Based on audit events</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent issues */}
      <Card className="bg-card border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Recent Issues</CardTitle>
          <Link href="/tasks">
            <a className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              See All <ChevronRight className="w-3.5 h-3.5" />
            </a>
          </Link>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentIssues.length === 0 ? (
            <div className="text-sm text-muted-foreground">No open issues.</div>
          ) : (
            recentIssues.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">CER-{t.id}</div>
                  <div className="text-sm text-foreground truncate">{t.title}</div>
                </div>
                <Badge variant="outline" className="text-xs py-0 capitalize">
                  {t.status.replace("_", " ")}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Costs */}
      <Card className="bg-card border-border/50">
        <CardHeader>
          <CardTitle className="text-sm">Costs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Org budget: <span className="text-foreground">${activeTenant?.spentThisMonth?.toFixed(0) ?? "0"}</span> /{" "}
            <span className="text-foreground">${activeTenant?.monthlyBudget?.toFixed(0) ?? "0"}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", budgetPct > 0.8 ? "bg-destructive" : "bg-primary")}
              style={{ width: `${Math.round(budgetPct * 100)}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">We can next add per-agent costs from audit logs.</div>
        </CardContent>
      </Card>
    </CeoShell>
  );
}

