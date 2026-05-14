import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, AgentDefinition, Team, TeamMember } from "@shared/schema";
import { useTenantContext } from "@/tenant/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Network, Users, Plus, ZoomIn, ZoomOut, RotateCcw, LayoutGrid, GitBranch } from "lucide-react";
import { cn, deployedAgentEmoji, agentCardStatus } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  running: "border-green-500/60 bg-green-500/5",
  idle: "border-yellow-500/40 bg-yellow-500/5",
  paused: "border-orange-500/40 bg-orange-500/5",
  error: "border-destructive/50 bg-destructive/5",
  terminated: "border-red-500/40 bg-red-500/5",
};

const STATUS_DOT: Record<string, string> = {
  running: "bg-green-500 status-running",
  idle: "bg-yellow-500",
  paused: "bg-orange-500",
  error: "bg-destructive",
  terminated: "bg-red-500",
};

const ORG_CHART_ZOOM_MIN = 0.35;
const ORG_CHART_ZOOM_MAX = 2.25;
const ORG_CHART_ZOOM_STEP = 0.1;

function clampOrgChartZoom(z: number) {
  return Math.min(ORG_CHART_ZOOM_MAX, Math.max(ORG_CHART_ZOOM_MIN, Math.round(z * 100) / 100));
}

function orgChartStorageKey(tenantId: number) {
  return `cortex-orgchart-positions-v1-${tenantId}`;
}

function defaultCanvasPositions(agents: Agent[], ceo: Agent | undefined): Record<number, { x: number; y: number }> {
  const pos: Record<number, { x: number; y: number }> = {};
  if (!ceo) {
    agents.forEach((a, i) => {
      pos[a.id] = { x: 80 + (i % 5) * 200, y: 80 + Math.floor(i / 5) * 150 };
    });
    return pos;
  }
  pos[ceo.id] = { x: 480, y: 56 };
  const rest = agents.filter((a) => a.id !== ceo.id);
  rest.forEach((a, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    pos[a.id] = { x: 100 + col * 240, y: 280 + row * 168 };
  });
  return pos;
}

function mergeCanvasPositions(
  agents: Agent[],
  ceo: Agent | undefined,
  saved: Record<number, { x: number; y: number }>,
): Record<number, { x: number; y: number }> {
  const defaults = defaultCanvasPositions(agents, ceo);
  const out: Record<number, { x: number; y: number }> = { ...defaults };
  for (const a of agents) {
    const p = saved[a.id];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[a.id] = p;
  }
  return out;
}

interface AgentNodeProps {
  agent: Agent;
  allAgents: Agent[];
  defs: AgentDefinition[];
  level: number;
}

const LEVEL_SIZES = [
  { card: "w-52", avatar: "w-14 h-14 rounded-xl", avatarText: "text-3xl", dot: "w-4 h-4", nameText: "text-sm font-bold", pad: "p-4", gap: "gap-8", nodeW: 220 },
  { card: "w-44", avatar: "w-11 h-11 rounded-xl", avatarText: "text-2xl", dot: "w-3 h-3", nameText: "text-xs font-semibold", pad: "p-3", gap: "gap-6", nodeW: 196 },
  { card: "w-40", avatar: "w-9 h-9 rounded-lg", avatarText: "text-xl", dot: "w-2.5 h-2.5", nameText: "text-xs font-medium", pad: "p-2.5", gap: "gap-5", nodeW: 176 },
  { card: "w-36", avatar: "w-8 h-8 rounded-lg", avatarText: "text-lg", dot: "w-2 h-2", nameText: "text-[11px] font-medium", pad: "p-2", gap: "gap-4", nodeW: 160 },
];

const LINE = "bg-muted-foreground/50";

function AgentNode({ agent, allAgents, defs, level }: AgentNodeProps) {
  const def = defs.find((d) => d.id === agent.definitionId);
  const children = allAgents.filter((a) => a.managerId === agent.id);
  const s = LEVEL_SIZES[Math.min(level, LEVEL_SIZES.length - 1)]!;

  return (
    <div className="flex flex-col items-center">
      {/* Vertical line: horizontal bar → this node */}
      {level > 0 && <div className={cn("w-0.5 h-8", LINE)} />}

      {/* Card */}
      <div
        className={cn(
          "relative border rounded-xl text-center cursor-pointer hover:border-primary/60 transition-all",
          s.card, s.pad,
          STATUS_COLORS[agentCardStatus(agent)] ?? "border-border bg-card",
        )}
        data-testid={`org-node-${agent.id}`}
      >
        <div className="relative inline-block mb-1.5">
          <div className={cn("bg-primary/10 flex items-center justify-center mx-auto", s.avatar, s.avatarText)}>
            {deployedAgentEmoji(agent, def)}
          </div>
          <span className={cn("absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-card", s.dot, STATUS_DOT[agentCardStatus(agent)] ?? "bg-muted")} />
        </div>
        <p className={cn("text-foreground truncate", s.nameText)}>{agent.displayName}</p>
        <p className="text-xs text-muted-foreground truncate">{agent.role}</p>
        {level < 2 && (
          <>
            {agent.goal && <p className="text-xs text-muted-foreground mt-0.5 truncate">{agent.goal}</p>}
            <div className="mt-1.5 flex justify-center gap-3 text-xs text-muted-foreground">
              <span>✓ {agent.tasksCompleted}</span>
              <span>$ {agent.spentThisMonth.toFixed(0)}</span>
            </div>
          </>
        )}
      </div>

      {/* Children tree */}
      {children.length > 0 && (
        <ChildrenConnector line={LINE} gap={s.gap} count={children.length}>
          {children.map((child) => (
            <AgentNode key={child.id} agent={child} allAgents={allAgents} defs={defs} level={level + 1} />
          ))}
        </ChildrenConnector>
      )}
    </div>
  );
}

function ChildrenConnector({ children, line, gap, count }: { children: React.ReactNode; line: string; gap: string; count: number }) {
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const cols = Array.from(el.children).filter(
      (c) => c instanceof HTMLElement && c.getAttribute("data-child-col") !== null,
    ) as HTMLElement[];
    if (cols.length < 2) return;
    const first = cols[0]!;
    const last = cols[cols.length - 1]!;
    const bar = el.querySelector<HTMLElement>("[data-h-bar]");
    if (!bar) return;
    const parentRect = el.getBoundingClientRect();
    const l = first.getBoundingClientRect().left + first.getBoundingClientRect().width / 2 - parentRect.left;
    const r = last.getBoundingClientRect().left + last.getBoundingClientRect().width / 2 - parentRect.left;
    bar.style.left = `${l}px`;
    bar.style.width = `${r - l}px`;
    bar.style.display = "block";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (
    <>
      {/* Vertical stem: parent card → horizontal bar */}
      <div className={cn("w-0.5 h-8", line)} />

      <div ref={containerRef} className={cn("relative flex items-start", gap)}>
        {/* Horizontal bar spanning first-child-center to last-child-center */}
        {count > 1 && (
          <div data-h-bar="" className={cn("absolute top-0 h-0.5", line)} style={{ display: "none" }} />
        )}
        {React.Children.map(children, (child, i) => (
          <div key={i} data-child-col="" className="flex flex-col items-center">
            {child}
          </div>
        ))}
      </div>
    </>
  );
}

export default function OrgChart() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const { toast } = useToast();
  const [orgChartZoom, setOrgChartZoom] = useState(1);
  const [orgChartView, setOrgChartView] = useState<"tree" | "canvas">("tree");
  const [canvasPositions, setCanvasPositions] = useState<Record<number, { x: number; y: number }>>({});
  const [canvasPositionsReady, setCanvasPositionsReady] = useState(false);
  const [draggingCanvasId, setDraggingCanvasId] = useState<number | null>(null);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDescription, setNewTeamDescription] = useState("");
  const [newTeamColor, setNewTeamColor] = useState("#4f98a3");

  const { data: agents = [] } = useQuery<(Agent & { displayStatus?: string })[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then(r => r.json()),
  });

  const { data: defs = [] } = useQuery<AgentDefinition[]>({
    queryKey: ["/api/agent-definitions"],
    queryFn: () => apiRequest("GET", "/api/agent-definitions").then(r => r.json()),
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/tenants", tid, "teams"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/teams`).then(r => r.json()),
    enabled: tid > 0,
  });

  const createTeam = useMutation({
    mutationFn: (body: { name: string; description?: string; color: string }) =>
      apiRequest("POST", `/api/tenants/${tid}/teams`, body).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "teams"] });
      toast({ title: "Team created", description: `${newTeamName.trim()} was added.` });
      setAddTeamOpen(false);
      setNewTeamName("");
      setNewTeamDescription("");
      setNewTeamColor("#4f98a3");
    },
    onError: (err: Error & { message?: string }) => {
      toast({ title: "Could not create team", description: err.message || "Try again.", variant: "destructive" });
    },
  });

  function submitNewTeam() {
    const name = newTeamName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Give the team a name.", variant: "destructive" });
      return;
    }
    createTeam.mutate({
      name,
      description: newTeamDescription.trim() || undefined,
      color: newTeamColor,
    });
  }

  // Build hierarchy
  const ceo = agents.find(a => !a.managerId);
  useEffect(() => {
    if (tid <= 0) return;
    try {
      const raw = localStorage.getItem(orgChartStorageKey(tid));
      if (raw) setCanvasPositions(JSON.parse(raw) as Record<number, { x: number; y: number }>);
    } catch {
      /* ignore */
    }
    setCanvasPositionsReady(true);
  }, [tid]);

  const mergedCanvasPositions = useMemo(() => {
    if (!canvasPositionsReady) return defaultCanvasPositions(agents, ceo);
    return mergeCanvasPositions(agents, ceo, canvasPositions);
  }, [agents, ceo, canvasPositions, canvasPositionsReady]);

  const persistCanvasPositions = useCallback(
    (prev: Record<number, { x: number; y: number }>) => {
      if (tid <= 0) return;
      const merged = mergeCanvasPositions(agents, ceo, prev);
      try {
        localStorage.setItem(orgChartStorageKey(tid), JSON.stringify(merged));
      } catch {
        /* ignore */
      }
    },
    [tid, agents, ceo],
  );

  const resetCanvasLayout = useCallback(() => {
    if (tid <= 0) return;
    const fresh = defaultCanvasPositions(agents, ceo);
    setCanvasPositions(fresh);
    try {
      localStorage.setItem(orgChartStorageKey(tid), JSON.stringify(fresh));
    } catch {
      /* ignore */
    }
    toast({ title: "Layout reset", description: "Arrange view restored to default positions." });
  }, [tid, agents, ceo, toast]);

  const canvasBounds = useMemo(() => {
    let w = 1280;
    let h = 820;
    for (const a of agents) {
      const p = mergedCanvasPositions[a.id];
      if (!p) continue;
      w = Math.max(w, p.x + 220);
      h = Math.max(h, p.y + 200);
    }
    return { width: w, height: h };
  }, [agents, mergedCanvasPositions]);

  useEffect(() => {
    if (draggingCanvasId === null) return;
    const id = draggingCanvasId;
    const scale = orgChartZoom;
    const move = (e: PointerEvent) => {
      setCanvasPositions((prev) => {
        const merged = mergeCanvasPositions(agents, ceo, prev);
        const cur = merged[id];
        if (!cur) return prev;
        const nx = Math.max(0, cur.x + e.movementX / scale);
        const ny = Math.max(0, cur.y + e.movementY / scale);
        return { ...prev, [id]: { x: nx, y: ny } };
      });
    };
    const up = () => {
      setDraggingCanvasId(null);
      setCanvasPositions((prev) => {
        persistCanvasPositions(prev);
        return prev;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [draggingCanvasId, orgChartZoom, agents, ceo, persistCanvasPositions]);

  const startCanvasDrag = useCallback((agentId: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDraggingCanvasId(agentId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const [manageTeamId, setManageTeamId] = useState<number | null>(null);
  const manageTeam = useMemo(() => teams.find((t) => t.id === manageTeamId) ?? null, [teams, manageTeamId]);

  const { data: members = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/teams", manageTeamId, "members"],
    queryFn: () => apiRequest("GET", `/api/teams/${manageTeamId}/members`).then((r) => r.json()),
    enabled: !!manageTeamId,
  });

  const memberAgentIds = useMemo(() => new Set(members.map((m) => m.agentId)), [members]);
  const availableAgents = useMemo(() => agents.filter((a) => !memberAgentIds.has(a.id)), [agents, memberAgentIds]);

  const [addMemberAgentId, setAddMemberAgentId] = useState<string>("");
  const addMember = useMutation({
    mutationFn: ({ teamId, agentId }: { teamId: number; agentId: number }) =>
      apiRequest("POST", `/api/teams/${teamId}/members`, { agentId }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams", manageTeamId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "teams"] });
      toast({ title: "Member added" });
      setAddMemberAgentId("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to add member", variant: "destructive" }),
  });

  const removeMember = useMutation({
    mutationFn: ({ teamId, agentId }: { teamId: number; agentId: number }) =>
      apiRequest("DELETE", `/api/teams/${teamId}/members/${agentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams", manageTeamId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "teams"] });
      toast({ title: "Member removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to remove member", variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto w-full min-w-0 overflow-x-hidden">
      <div>
        <h1 className="text-xl font-bold text-foreground">Org Chart</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Hierarchical view of your agent organization</p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {Object.entries({ running: "Running", idle: "Idle", paused: "Paused", error: "Error", terminated: "Terminated" }).map(([s, label]) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={cn("w-2.5 h-2.5 rounded-full", STATUS_DOT[s])} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Hierarchy */}
      <Card className="bg-card border-border overflow-hidden max-w-full min-w-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
          <div className="flex flex-col gap-2 min-w-0">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Network className="w-4 h-4 text-primary shrink-0" /> Reporting Structure
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Chart view">
              <Button
                type="button"
                size="sm"
                variant={orgChartView === "tree" ? "default" : "outline"}
                className="h-8"
                onClick={() => setOrgChartView("tree")}
              >
                <GitBranch className="w-3.5 h-3.5 mr-1.5" />
                Tree
              </Button>
              <Button
                type="button"
                size="sm"
                variant={orgChartView === "canvas" ? "default" : "outline"}
                className="h-8"
                onClick={() => setOrgChartView("canvas")}
              >
                <LayoutGrid className="w-3.5 h-3.5 mr-1.5" />
                Arrange
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            <div className="flex items-center gap-1.5" role="group" aria-label="Chart zoom">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setOrgChartZoom((z) => clampOrgChartZoom(z - ORG_CHART_ZOOM_STEP))}
                disabled={orgChartZoom <= ORG_CHART_ZOOM_MIN}
                title="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums min-w-[2.75rem] text-center">
                {Math.round(orgChartZoom * 100)}%
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setOrgChartZoom((z) => clampOrgChartZoom(z + ORG_CHART_ZOOM_STEP))}
                disabled={orgChartZoom >= ORG_CHART_ZOOM_MAX}
                title="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={() => setOrgChartZoom(1)}
                title="Reset zoom to 100%"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
            {orgChartView === "canvas" ? (
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={resetCanvasLayout}>
                Reset layout
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0 min-w-0 max-w-full">
          <>
          {orgChartView === "tree" ? (
          <div
            className="relative isolate h-[min(78vh,880px)] w-full min-w-0 max-w-full overflow-auto overscroll-contain rounded-b-lg border-t border-border bg-muted/10 [contain:layout]"
          >
            {agents.length > 0 ? (
              <div className="flex w-full min-w-0 justify-center p-6 pb-10 box-border">
                <div
                  className="inline-block origin-top will-change-transform"
                  style={{ transform: `scale(${orgChartZoom})`, transformOrigin: "top center" }}
                >
                  <div className="py-4 flex gap-8 items-start" style={{ minWidth: "max-content" }}>
                    {(() => {
                      const roots = agents.filter((a) => !a.managerId);
                      if (roots.length === 0) {
                        return agents.map((a) => (
                          <AgentNode key={a.id} agent={a} allAgents={agents} defs={defs} level={0} />
                        ));
                      }
                      return roots.map((root) => (
                        <AgentNode key={root.id} agent={root} allAgents={agents} defs={defs} level={0} />
                      ));
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 px-4 text-muted-foreground">
                <Network className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No agents deployed yet</p>
              </div>
            )}
          </div>
          ) : (
          <div
            className="relative isolate h-[min(78vh,880px)] w-full min-w-0 max-w-full overflow-auto overscroll-contain rounded-b-lg border-t border-border bg-muted/10 [contain:layout]"
          >
            {agents.length === 0 ? (
              <div className="text-center py-12 px-4 text-muted-foreground">
                <Network className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No agents deployed yet</p>
              </div>
            ) : (
              <div className="relative min-w-0 w-full p-4 box-border">
                <p className="text-[11px] text-muted-foreground mb-3 px-1">
                  Drag cards to place them. Positions are saved in this browser for this organization.
                </p>
                <div className="flex w-full min-w-0 justify-center">
                  <div
                    className="inline-block origin-top will-change-transform"
                    style={{ transform: `scale(${orgChartZoom})`, transformOrigin: "top center" }}
                  >
                  <div
                    className="relative rounded-lg border border-dashed border-border/60 bg-background/40 min-w-[1280px]"
                    style={{ width: canvasBounds.width, height: canvasBounds.height }}
                  >
                    {agents.map((agent) => {
                      const def = defs.find((d) => d.id === agent.definitionId);
                      const pos = mergedCanvasPositions[agent.id] ?? { x: 40, y: 40 };
                      const z = draggingCanvasId === agent.id ? 30 : 1;
                      return (
                        <div
                          key={agent.id}
                          className={cn(
                            "absolute w-44 rounded-xl border p-3 text-center shadow-sm cursor-grab active:cursor-grabbing touch-none select-none",
                            STATUS_COLORS[agentCardStatus(agent)] ?? "border-border bg-card",
                          )}
                          style={{ left: pos.x, top: pos.y, zIndex: z }}
                          data-testid={`org-canvas-node-${agent.id}`}
                          onPointerDown={(e) => startCanvasDrag(agent.id, e)}
                        >
                          <div className="relative inline-block mb-1.5 pointer-events-none">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-xl mx-auto">
                              {deployedAgentEmoji(agent, def)}
                            </div>
                            <span
                              className={cn(
                                "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card",
                                STATUS_DOT[agentCardStatus(agent)] ?? "bg-muted",
                              )}
                            />
                          </div>
                          <p className="text-xs font-semibold text-foreground pointer-events-none">{agent.displayName}</p>
                          <p className="text-[10px] text-muted-foreground truncate pointer-events-none">{agent.role}</p>
                          <Badge variant="outline" className="mt-1 text-[10px] py-0 pointer-events-none">
                            {agent.model.split("-").pop()}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}
          </>
        </CardContent>
      </Card>

      {/* Teams */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Teams
          </h2>
          <Button
            size="sm"
            onClick={() => setAddTeamOpen(true)}
            disabled={tid <= 0}
            data-testid="org-add-team"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add team
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {teams.map(team => {
            return (
              <Card key={team.id} className="bg-card border-border" data-testid={`team-card-${team.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                    <h3 className="text-sm font-semibold text-foreground">{team.name}</h3>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-7 px-2 text-xs"
                      onClick={() => setManageTeamId(team.id)}
                      data-testid={`team-manage-${team.id}`}
                    >
                      Manage
                    </Button>
                  </div>
                  {team.description && <p className="text-xs text-muted-foreground mb-3">{team.description}</p>}
                  <div className="flex -space-x-2">
                    {agents.slice(0, 5).map(a => (
                      <div key={a.id} className="w-7 h-7 rounded-full bg-primary/10 border-2 border-card flex items-center justify-center text-sm" title={a.displayName}>
                        {deployedAgentEmoji(a, defs.find(d => d.id === a.definitionId))}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {teams.length === 0 && tid > 0 && (
          <p className="text-sm text-muted-foreground mt-3">No teams yet. Click <strong>Add team</strong> to create one, then assign agents when hiring.</p>
        )}
      </div>

      <Dialog open={addTeamOpen} onOpenChange={setAddTeamOpen}>
        <DialogContent className="sm:max-w-md" data-testid="add-team-dialog">
          <DialogHeader>
            <DialogTitle>Add team</DialogTitle>
            <DialogDescription>
              Groups appear on the org chart and can be selected when hiring agents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label htmlFor="team-name" className="text-xs">Name</Label>
              <Input
                id="team-name"
                className="mt-1"
                placeholder="e.g. Engineering"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                data-testid="add-team-name"
              />
            </div>
            <div>
              <Label htmlFor="team-desc" className="text-xs">Description <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea
                id="team-desc"
                className="mt-1 min-h-[72px]"
                placeholder="What this team owns…"
                value={newTeamDescription}
                onChange={(e) => setNewTeamDescription(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="team-color" className="text-xs">Color</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  id="team-color"
                  type="color"
                  className="h-9 w-14 cursor-pointer p-1"
                  value={newTeamColor}
                  onChange={(e) => setNewTeamColor(e.target.value)}
                />
                <Input
                  className="font-mono text-xs flex-1"
                  value={newTeamColor}
                  onChange={(e) => setNewTeamColor(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTeamOpen(false)}>Cancel</Button>
            <Button onClick={submitNewTeam} disabled={createTeam.isPending} data-testid="add-team-submit">
              {createTeam.isPending ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manageTeamId !== null} onOpenChange={(v) => { if (!v) setManageTeamId(null); }}>
        <DialogContent className="sm:max-w-lg" data-testid="manage-team-dialog">
          <DialogHeader>
            <DialogTitle>Manage team</DialogTitle>
            <DialogDescription>
              Add members so agents post updates in this team channel (Collaboration → team-{manageTeamId}).
            </DialogDescription>
          </DialogHeader>

          {manageTeam && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: manageTeam.color }} />
                <div className="text-sm font-semibold text-foreground">{manageTeam.name}</div>
                <div className="ml-auto text-xs text-muted-foreground">{members.length} member{members.length !== 1 ? "s" : ""}</div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Add member</Label>
                <div className="flex gap-2">
                  <Select value={addMemberAgentId} onValueChange={setAddMemberAgentId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAgents.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.displayName} — {a.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => {
                      if (!manageTeamId || !addMemberAgentId) return;
                      addMember.mutate({ teamId: manageTeamId, agentId: Number(addMemberAgentId) });
                    }}
                    disabled={!addMemberAgentId || addMember.isPending}
                  >
                    Add
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Members</Label>
                {members.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No members yet.</div>
                ) : (
                  <div className="space-y-1">
                    {members.map((m) => {
                      const a = agents.find((x) => x.id === m.agentId);
                      return (
                        <div key={m.id} className="flex items-center gap-2 border border-border rounded-md px-3 py-2">
                          <div className="text-sm text-foreground">{a?.displayName ?? `Agent ${m.agentId}`}</div>
                          <div className="ml-auto flex items-center gap-2">
                            <div className="text-xs text-muted-foreground">{a?.role ?? ""}</div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                              onClick={() => manageTeamId && removeMember.mutate({ teamId: manageTeamId, agentId: m.agentId })}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setManageTeamId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
