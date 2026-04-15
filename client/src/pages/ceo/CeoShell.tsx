import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTenantContext } from "@/tenant/TenantContext";
import type { Agent, AuditLog } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Home, Plus, Play, Pause, XCircle, ChevronRight } from "lucide-react";

export function CeoShell({
  children,
  rightSlot,
  breadcrumb,
}: {
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const [location] = useLocation();

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const ceo = useMemo(() => agents.find((a) => String(a.role).toLowerCase() === "ceo") ?? null, [agents]);

  const { data: ceoControl } = useQuery<{ mode: "agent" | "me" }>({
    queryKey: ["/api/tenants", tid, "ceo", "control"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ceo/control`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const { data: audit = [] } = useQuery<AuditLog[]>({
    queryKey: ["/api/tenants", tid, "audit"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/audit`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const runEvents = useMemo(() => {
    if (!ceo) return [];
    return audit
      .filter((r) => r.agentId === ceo.id)
      .filter((r) => r.action === "hermes_run_once" || r.action === "heartbeat")
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [audit, ceo]);

  const latestRun = runEvents[0] ?? null;

  const heartbeat = useMutation({
    mutationFn: async () => {
      if (!ceo) throw new Error("No CEO");
      return apiRequest("POST", `/api/agents/${ceo.id}/heartbeat`, { detail: "CEO heartbeat (manual)" }).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "audit"] });
    },
  });

  const pause = useMutation({
    mutationFn: async () => {
      if (!ceo) throw new Error("No CEO");
      return apiRequest("PATCH", `/api/agents/${ceo.id}`, { status: "paused" }).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "audit"] });
    },
  });

  const tabs = [
    { href: "/ceo/dashboard", label: "Dashboard" },
    { href: "/ceo/instruction", label: "Instructions" },
    { href: "/ceo/skills", label: "Skills" },
    { href: "/ceo/configuration", label: "Configuration" },
    { href: "/ceo/runs", label: "Runs" },
    { href: "/ceo/budgets", label: "Budget" },
  ] as const;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {breadcrumb ? (
        <div className="text-xs text-muted-foreground/80">
          {breadcrumb}
        </div>
      ) : null}
      {/* Persistent header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/">
            <a className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent/10" aria-label="Home">
              <Home className="w-4 h-4" />
            </a>
          </Link>
          <div>
            <div className="text-lg font-semibold text-foreground">
              {ceoControl?.mode === "me" ? "You (CEO)" : (ceo?.displayName ?? "CEO")}
            </div>
            <div className="text-xs text-muted-foreground">
              {ceoControl?.mode === "me" ? "You" : (ceo?.role ?? "CEO")}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => (window.location.hash = "#/tasks")} className="gap-1.5">
            <Plus className="w-4 h-4" />
            Assign Task
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => heartbeat.mutate()}
            disabled={!ceo || heartbeat.isPending}
            className="gap-1.5"
          >
            <Play className="w-4 h-4" />
            Run Heartbeat
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => pause.mutate()}
            disabled={!ceo || pause.isPending}
            className="gap-1.5"
          >
            <Pause className="w-4 h-4" />
            Pause
          </Button>

          <Badge variant="outline" className="text-xs py-0 h-7">
            {latestRun ? "ok" : "error"}
          </Badge>

          {rightSlot}
        </div>
      </div>

      {/* Persistent tabs */}
      <div className="flex items-center gap-6 border-b border-border/40 pb-2">
        {tabs.map((t) => {
          const active = location === t.href;
          return (
            <Link key={t.href} href={t.href}>
              <a
                className={cn(
                  "text-sm transition-colors pb-2",
                  active ? "text-foreground border-b border-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </a>
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}

export function LatestRunSummary() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const ceo = useMemo(() => agents.find((a) => String(a.role).toLowerCase() === "ceo") ?? null, [agents]);

  const { data: audit = [] } = useQuery<AuditLog[]>({
    queryKey: ["/api/tenants", tid, "audit"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/audit`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const latest = useMemo(() => {
    if (!ceo) return null;
    return audit
      .filter((r) => r.agentId === ceo.id)
      .filter((r) => r.action === "hermes_run_once" || r.action === "heartbeat")
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
  }, [audit, ceo]);

  return (
    <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
      <XCircle className={cn("w-3.5 h-3.5", latest ? "text-muted-foreground" : "text-destructive")} />
      <span className="inline-flex items-center gap-1">
        <Badge
          variant="outline"
          className={cn("text-xs py-0", latest ? "" : "border-destructive/40 text-destructive")}
        >
          {latest ? "ok" : "failed"}
        </Badge>
      </span>
      <span className="font-mono">{latest?.id ?? "—"}</span>
      <Badge variant="outline" className="text-[10px] py-0">on-demand</Badge>
      <Link href="/ceo/runs">
        <a className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 ml-2">
          View details <ChevronRight className="w-3.5 h-3.5" />
        </a>
      </Link>
    </div>
  );
}

