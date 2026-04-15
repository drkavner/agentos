import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTenantContext } from "@/tenant/TenantContext";
import type { Agent } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CeoShell } from "./CeoShell";

type AgentRun = {
  id: number;
  status: "running" | "ok" | "failed";
  trigger: "timer" | "on_demand" | "assignment" | "heartbeat" | "test_environment";
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
};

type AgentRunEvent = {
  id: number;
  ts: string;
  kind: "system" | "stdout" | "stderr" | "event";
  message: string;
};

function triggerLabel(t: AgentRun["trigger"]) {
  switch (t) {
    case "timer": return "Timer";
    case "on_demand": return "On-demand";
    case "assignment": return "Assignment";
    case "heartbeat": return "Heartbeat";
    case "test_environment": return "Test";
    default: return t;
  }
}

function statusColor(s: AgentRun["status"]) {
  if (s === "ok") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  if (s === "failed") return "bg-red-500/10 text-red-300 border-red-500/30";
  return "bg-muted/40 text-muted-foreground border-border";
}

export default function CeoRuns() {
  const { activeTenantId, activeTenant } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const ceo = useMemo(() => agents.find((a) => String(a.role).toLowerCase() === "ceo") ?? null, [agents]);

  const { data: runs = [] } = useQuery<AgentRun[]>({
    queryKey: ["/api/tenants", tid, "agents", ceo?.id ?? 0, "runs"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents/${ceo!.id}/runs?limit=80`).then((r) => r.json()),
    enabled: tid > 0 && !!ceo?.id,
    refetchInterval: 4000,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(() => {
    const id = selectedId ?? runs[0]?.id ?? null;
    return id;
  }, [runs, selectedId]);

  const { data: detail } = useQuery<{ run: AgentRun; events: AgentRunEvent[] }>({
    queryKey: ["/api/tenants", tid, "agents", ceo?.id ?? 0, "runs", selected ?? 0],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents/${ceo!.id}/runs/${selected}`).then((r) => r.json()),
    enabled: tid > 0 && !!ceo?.id && !!selected,
  });

  const runOnce = useMutation({
    mutationFn: () => apiRequest("POST", `/api/tenants/${tid}/agents/${ceo!.id}/hermes/run-once`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "audit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents", ceo?.id ?? 0, "runs"] });
    },
  });

  return (
    <CeoShell rightSlot={ceo ? <Badge variant="outline" className="text-xs py-0 h-7">CEO agent #{ceo.id}</Badge> : null}>
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 max-w-[1200px]">
        {!ceo ? (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-sm">No CEO found</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              This organization doesn’t have a CEO agent yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">Runs</CardTitle>
                  <Button size="sm" onClick={() => runOnce.mutate()} disabled={runOnce.isPending}>
                    {runOnce.isPending ? "Running..." : "Run now"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[640px] overflow-auto divide-y divide-border">
                  {runs.map((r) => {
                    const active = r.id === selected;
                    return (
                      <button
                        key={r.id}
                        onClick={() => setSelectedId(r.id)}
                        className={cn(
                          "w-full text-left px-3 py-3 hover:bg-muted/20 transition-colors",
                          active ? "bg-muted/25" : "",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className={cn("text-xs rounded-md border px-2 py-0.5", statusColor(r.status))}>
                            {r.status}
                          </div>
                          <Badge variant="outline" className="text-[10px] py-0">
                            {triggerLabel(r.trigger)}
                          </Badge>
                          <div className="text-xs text-muted-foreground ml-auto">
                            {new Date(r.startedAt).toLocaleTimeString()}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {r.error ? `Error: ${r.error}` : (r.summary ?? "—")}
                        </div>
                      </button>
                    );
                  })}
                  {runs.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No runs yet.</div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-sm">
                      {detail?.run ? `Run #${detail.run.id}` : "Run"}
                    </CardTitle>
                    {detail?.run ? (
                      <div className="text-xs text-muted-foreground">
                        {detail.run.startedAt} → {detail.run.endedAt ?? "…"} · Duration:{" "}
                        {detail.run.durationMs != null ? `${Math.round(detail.run.durationMs / 1000)}s` : "—"}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">Select a run.</div>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runOnce.mutate()}
                    disabled={runOnce.isPending}
                  >
                    Retry
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!detail ? (
                  <div className="text-sm text-muted-foreground">Loading…</div>
                ) : (
                  <Tabs defaultValue="nice" className="w-full">
                    <div className="flex items-center justify-between">
                      <TabsList>
                        <TabsTrigger value="nice">Nice</TabsTrigger>
                        <TabsTrigger value="raw">Raw</TabsTrigger>
                      </TabsList>
                      {detail.run.status === "failed" ? (
                        <Badge variant="outline" className="text-xs border-red-500/30 text-red-300">
                          failed
                        </Badge>
                      ) : null}
                    </div>

                    <TabsContent value="nice" className="mt-3 space-y-3">
                      {detail.run.status === "failed" ? (
                        <div className="border border-red-500/25 rounded-md p-3 bg-red-500/5">
                          <div className="text-xs text-muted-foreground mb-1">Failure details</div>
                          <div className="text-sm">{detail.run.error ?? "Unknown error"}</div>
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Transcript</div>
                        <div className="border border-border rounded-md p-3 bg-muted/20 max-h-[420px] overflow-auto">
                          {detail.events.map((e) => (
                            <div key={e.id} className="text-xs font-mono whitespace-pre-wrap">
                              <span className="text-muted-foreground">[{e.kind}]</span>{" "}
                              <span>{e.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="raw" className="mt-3">
                      <pre className="text-xs whitespace-pre-wrap border border-border rounded-md p-3 bg-muted/20 max-h-[520px] overflow-auto">
{JSON.stringify(detail, null, 2)}
                      </pre>
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </CeoShell>
  );
}

