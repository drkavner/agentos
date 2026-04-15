import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, AgentDefinition, Tenant } from "@shared/schema";
import { useTenantContext } from "@/tenant/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Bot, Play, Pause, Trash2, Plus, Clock, CheckCircle, DollarSign, Cpu, Lock } from "lucide-react";
import { cn, formatDistanceToNow } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { HireAgentWizard } from "@/components/HireAgentWizard";

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  running: { label: "Running", dot: "bg-green-500 status-running", badge: "bg-green-500/10 text-green-400 border-green-500/20" },
  idle: { label: "Idle", dot: "bg-yellow-500", badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  paused: { label: "Paused", dot: "bg-orange-500", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  terminated: { label: "Terminated", dot: "bg-red-500", badge: "bg-red-500/10 text-red-400 border-red-500/20" },
};

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4": "Claude Opus 4",
  "claude-3-5-sonnet": "Claude 3.5 Sonnet",
  "gpt-4o": "GPT-4o",
};

export default function MyAgents() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailsAgentId, setDetailsAgentId] = useState<number | null>(null);

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then(r => r.json()),
  });

  const { data: defs = [] } = useQuery<AgentDefinition[]>({
    queryKey: ["/api/agent-definitions"],
    queryFn: () => apiRequest("GET", "/api/agent-definitions").then(r => r.json()),
  });

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["/api/tenants", tid],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}`).then(r => r.json()),
  });

  const selectedAgent = useMemo(
    () => (detailsAgentId ? agents.find((a) => a.id === detailsAgentId) ?? null : null),
    [agents, detailsAgentId],
  );
  const selectedDef = useMemo(
    () => (selectedAgent ? defs.find((d) => d.id === selectedAgent.definitionId) ?? null : null),
    [defs, selectedAgent],
  );

  const { data: runtimeCtx } = useQuery<any>({
    queryKey: ["/api/tenants", tid, "agents", selectedAgent?.id ?? 0, "runtime-context"],
    queryFn: () =>
      apiRequest("GET", `/api/tenants/${tid}/agents/${selectedAgent!.id}/runtime-context`).then((r) => r.json()),
    enabled: tid > 0 && !!selectedAgent?.id,
  });

  const { data: skills } = useQuery<{ markdown: string; source: string; updatedAt?: string }>({
    queryKey: ["/api/agent-definitions", selectedDef?.id ?? 0, "skills", tid],
    queryFn: () =>
      apiRequest("GET", `/api/agent-definitions/${selectedDef!.id}/skills?tenantId=${tid}`).then((r) => r.json()),
    enabled: tid > 0 && !!selectedDef?.id,
  });

  const { data: runs = [] } = useQuery<any[]>({
    queryKey: ["/api/tenants", tid, "agents", selectedAgent?.id ?? 0, "runs"],
    queryFn: () =>
      apiRequest("GET", `/api/tenants/${tid}/agents/${selectedAgent!.id}/runs?limit=30`).then((r) => r.json()),
    enabled: tid > 0 && !!selectedAgent?.id,
    refetchInterval: detailsAgentId ? 4000 : false,
  });

  const runOnce = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) throw new Error("No agent");
      return apiRequest("POST", `/api/tenants/${tid}/agents/${selectedAgent.id}/hermes/run-once`).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents", selectedAgent?.id ?? 0, "runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "audit"] });
    },
    onError: (e: any) => {
      toast({ title: "Run failed", description: String(e?.message ?? "Unable to run"), variant: "destructive" });
    },
  });

  const maxAgents = tenant?.maxAgents ?? 25;
  const atLimit = agents.length >= maxAgents;
  const limitPct = Math.min(100, (agents.length / maxAgents) * 100);

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/agents/${id}`, { status }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] }),
    onError: () => toast({ title: "Error", description: "Failed to update agent", variant: "destructive" }),
  });

  const deleteAgent = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/agents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      toast({ title: "Agent terminated" });
      setDeleteId(null);
    },
  });

  const totalSpent = agents.reduce((s, a) => s + a.spentThisMonth, 0);
  const totalCompleted = agents.reduce((s, a) => s + a.tasksCompleted, 0);

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground">My Agents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{agents.length} agents deployed · {agents.filter(a => a.status === "running").length} running</p>
          {/* Agent usage bar */}
          <div className="mt-2 flex items-center gap-3 max-w-xs">
            <Progress
              value={limitPct}
              className={cn("h-1.5 flex-1", atLimit ? "[&>div]:bg-destructive" : limitPct > 80 ? "[&>div]:bg-orange-400" : "")}
            />
            <span className={cn("text-xs font-medium tabular-nums shrink-0", atLimit ? "text-destructive" : "text-muted-foreground")}>
              {agents.length} / {maxAgents}
            </span>
          </div>
          {atLimit && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <Lock className="w-3 h-3" /> Agent limit reached — raise it in Settings to hire more
            </p>
          )}
        </div>
        <Button
          data-testid="hire-agent-btn"
          onClick={() => setWizardOpen(true)}
          disabled={atLimit}
          title={atLimit ? `Limit of ${maxAgents} agents reached` : undefined}
        >
          <Plus className="w-4 h-4 mr-1.5" /> Hire Agent
        </Button>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: Bot, label: "Total Agents", value: agents.length, sub: `${agents.filter(a => a.status === "running").length} running` },
          { icon: CheckCircle, label: "Tasks Completed", value: totalCompleted, sub: "all time" },
          { icon: DollarSign, label: "Total Spent", value: `$${totalSpent.toFixed(2)}`, sub: "this month" },
        ].map(s => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <s.icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Agent cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="bg-card border-border animate-pulse">
              <CardContent className="p-5 h-48" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map(agent => {
            const def = defs.find(d => d.id === agent.definitionId);
            const s = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
            const budgetPct = (agent.spentThisMonth / agent.monthlyBudget) * 100;
            const isCeo = String(agent.role).toLowerCase() === "ceo";
            return (
              <Card
                key={agent.id}
                className="bg-card border-border hover:border-primary/30 transition-all cursor-pointer"
                data-testid={`agent-card-${agent.id}`}
                onClick={() => {
                  if (isCeo) return; // CEO has its own dedicated section
                  setDetailsAgentId(agent.id);
                }}
              >
                <CardContent className="p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-xl flex-shrink-0">
                          {def?.emoji ?? "🤖"}
                        </div>
                        <span className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card", s.dot)} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{agent.displayName}</h3>
                        <p className="text-xs text-muted-foreground">{agent.role}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("text-xs py-0 shrink-0", s.badge)}>{s.label}</Badge>
                  </div>
                  {isCeo ? (
                    <div className="text-[11px] text-muted-foreground">
                      Manage details in the CEO section.
                    </div>
                  ) : null}

                  {/* Goal */}
                  {agent.goal && (
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 bg-muted/40 rounded-md px-2.5 py-1.5">
                      {agent.goal}
                    </p>
                  )}

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs font-semibold text-foreground">{agent.tasksCompleted}</p>
                      <p className="text-xs text-muted-foreground">done</p>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs font-semibold text-foreground">${agent.spentThisMonth.toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground">spent</p>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs font-semibold text-foreground truncate" title={MODEL_LABELS[agent.model] ?? agent.model}>
                        {agent.model.split("-").pop()}
                      </p>
                      <p className="text-xs text-muted-foreground">model</p>
                    </div>
                  </div>

                  {/* Budget bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Budget</span>
                      <span>${agent.spentThisMonth.toFixed(2)} / ${agent.monthlyBudget}</span>
                    </div>
                    <Progress value={Math.min(100, budgetPct)} className="h-1" />
                  </div>

                  {/* Last heartbeat */}
                  {agent.lastHeartbeat && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>Last heartbeat {formatDistanceToNow(agent.lastHeartbeat)}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    {agent.status === "running" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs"
                        onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: agent.id, status: "paused" }); }}
                        data-testid={`pause-${agent.id}`}
                      >
                        <Pause className="w-3 h-3 mr-1" /> Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: agent.id, status: "running" }); }}
                        data-testid={`start-${agent.id}`}
                      >
                        <Play className="w-3 h-3 mr-1" /> Start
                      </Button>
                    )}
                    {!isCeo ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10 border-destructive/30"
                        onClick={(e) => { e.stopPropagation(); setDeleteId(agent.id); }}
                        data-testid={`delete-${agent.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <HireAgentWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      <Dialog open={detailsAgentId != null} onOpenChange={(o) => setDetailsAgentId(o ? detailsAgentId : null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {selectedDef?.emoji ?? "🤖"} {selectedAgent?.displayName ?? "Agent"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedAgent?.role ?? "—"}{selectedAgent ? ` · #${selectedAgent.id}` : ""}
            </DialogDescription>
          </DialogHeader>

          {!selectedAgent ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <Tabs defaultValue="dashboard" className="w-full">
              <TabsList>
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="instructions">Instructions</TabsTrigger>
                <TabsTrigger value="skills">Skills</TabsTrigger>
                <TabsTrigger value="run">Run</TabsTrigger>
              </TabsList>

              <TabsContent value="dashboard" className="mt-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Card className="bg-card border-border">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <CheckCircle className="w-3.5 h-3.5" /> Tasks completed
                      </div>
                      <div className="text-xl font-semibold">{selectedAgent.tasksCompleted}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border-border">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <DollarSign className="w-3.5 h-3.5" /> Spent this month
                      </div>
                      <div className="text-xl font-semibold">${selectedAgent.spentThisMonth.toFixed(2)}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border-border">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <Cpu className="w-3.5 h-3.5" /> Model
                      </div>
                      <div className="text-sm font-semibold truncate">
                        {MODEL_LABELS[selectedAgent.model] ?? selectedAgent.model}
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    Last heartbeat {selectedAgent.lastHeartbeat ? formatDistanceToNow(selectedAgent.lastHeartbeat) : "—"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Status: <span className="text-foreground">{selectedAgent.status}</span> · Budget:{" "}
                  <span className="text-foreground">${selectedAgent.spentThisMonth.toFixed(2)} / ${selectedAgent.monthlyBudget}</span>
                </div>
              </TabsContent>

              <TabsContent value="instructions" className="mt-4 space-y-3">
                <Card className="bg-card border-border">
                  <CardContent className="p-4 space-y-2">
                    <div className="text-xs text-muted-foreground">Goal</div>
                    <div className="text-sm">{selectedAgent.goal ?? "—"}</div>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="p-4 space-y-2">
                    <div className="text-xs text-muted-foreground">System prompt (preview)</div>
                    <pre className="text-xs whitespace-pre-wrap bg-muted/30 border border-border rounded-md p-3 max-h-[320px] overflow-auto">
{runtimeCtx?.systemPrompt ?? "—"}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="skills" className="mt-4 space-y-3">
                <Card className="bg-card border-border">
                  <CardContent className="p-4 space-y-2">
                    <div className="text-xs text-muted-foreground">
                      skills.md (source: {skills?.source ?? "—"})
                    </div>
                    <pre className="text-xs whitespace-pre-wrap bg-muted/30 border border-border rounded-md p-3 max-h-[420px] overflow-auto">
{skills?.markdown ?? "—"}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="run" className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm text-muted-foreground">Run logs</div>
                  <Button size="sm" onClick={() => runOnce.mutate()} disabled={runOnce.isPending}>
                    {runOnce.isPending ? "Running…" : "Run now"}
                  </Button>
                </div>
                {tenant?.adapterType === "openclaw" ? (
                  <p className="text-xs text-muted-foreground border border-border rounded-md p-3 bg-muted/20">
                    OpenClaw: Cortex records the run and posts a channel update. Heavy execution still happens in your OpenClaw gateway.
                  </p>
                ) : null}
                <div className="border border-border rounded-md divide-y divide-border max-h-[420px] overflow-auto">
                  {runs.map((r) => (
                    <div key={r.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-mono">#{r.id}</div>
                        <Badge variant="outline" className="text-[10px] py-0">{r.trigger}</Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] py-0",
                            r.status === "failed" ? "border-red-500/30 text-red-300" : "",
                          )}
                        >
                          {r.status}
                        </Badge>
                        <div className="text-xs text-muted-foreground ml-auto">{new Date(r.startedAt).toLocaleTimeString()}</div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {r.error ? `Error: ${r.error}` : (r.summary ?? "—")}
                      </div>
                    </div>
                  ))}
                  {runs.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No runs yet.</div>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminate Agent?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the agent and all their task history. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteId && deleteAgent.mutate(deleteId)}>
              Terminate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
