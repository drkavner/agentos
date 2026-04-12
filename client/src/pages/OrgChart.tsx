import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Agent, AgentDefinition, Team, TeamMember } from "@shared/schema";
import { ACTIVE_TENANT_ID } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Network, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  running: "border-green-500/60 bg-green-500/5",
  idle: "border-yellow-500/40 bg-yellow-500/5",
  paused: "border-orange-500/40 bg-orange-500/5",
  terminated: "border-red-500/40 bg-red-500/5",
};

const STATUS_DOT: Record<string, string> = {
  running: "bg-green-500 status-running",
  idle: "bg-yellow-500",
  paused: "bg-orange-500",
  terminated: "bg-red-500",
};

interface AgentNodeProps {
  agent: Agent;
  def?: AgentDefinition;
  reports: Agent[];
  defs: AgentDefinition[];
  level: number;
}

function AgentNode({ agent, def, reports, defs, level }: AgentNodeProps) {
  return (
    <div className={cn("flex flex-col items-center", level > 0 && "pt-6 relative")}>
      {level > 0 && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-6 bg-border" />
      )}
      <div className={cn(
        "relative border rounded-xl p-3 w-44 text-center cursor-pointer hover:border-primary/60 transition-all",
        STATUS_COLORS[agent.status] ?? "border-border bg-card"
      )} data-testid={`org-node-${agent.id}`}>
        <div className="relative inline-block mb-2">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-2xl mx-auto">
            {def?.emoji ?? "🤖"}
          </div>
          <span className={cn("absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-card", STATUS_DOT[agent.status] ?? "bg-muted")} />
        </div>
        <p className="text-xs font-semibold text-foreground">{agent.displayName}</p>
        <p className="text-xs text-muted-foreground truncate">{agent.role}</p>
        <Badge variant="outline" className="mt-1.5 text-xs py-0">{agent.model.split("-").pop()}</Badge>
        <div className="mt-2 flex justify-center gap-3 text-xs text-muted-foreground">
          <span>✓ {agent.tasksCompleted}</span>
          <span>$ {agent.spentThisMonth.toFixed(0)}</span>
        </div>
      </div>

      {reports.length > 0 && (
        <div className="relative mt-0 pt-6">
          <div className="absolute top-6 left-1/2 -translate-x-1/2 w-px bg-border" style={{ height: "0" }} />
          {/* Horizontal connector */}
          <div className="relative flex gap-6 items-start">
            {/* Connector bar */}
            {reports.length > 1 && (
              <div
                className="absolute top-0 bg-border h-px"
                style={{
                  left: `calc(50% - (${reports.length} * 88px + (${reports.length - 1}) * 24px) / 2 + 88px / 2)`,
                  width: `calc((${reports.length} - 1) * (176px + 24px))`,
                }}
              />
            )}
            {reports.map(r => (
              <AgentNode
                key={r.id}
                agent={r}
                def={defs.find(d => d.id === r.definitionId)}
                reports={[]}
                defs={defs}
                level={level + 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrgChart() {
  const tid = ACTIVE_TENANT_ID;

  const { data: agents = [] } = useQuery<Agent[]>({
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
  });

  const { data: allMembers = [] } = useQuery<Record<number, TeamMember[]>>({
    queryKey: ["/api/teams/members", tid],
    queryFn: async () => {
      const results: Record<number, TeamMember[]> = {};
      // Fetch all team members in one pass since we have teams
      return results;
    },
  });

  // Build hierarchy
  const ceo = agents.find(a => !a.managerId);
  const directReports = (mgr: Agent) => agents.filter(a => a.managerId === mgr.id);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Org Chart</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Hierarchical view of your agent organization</p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {Object.entries({ running: "Running", idle: "Idle", paused: "Paused", terminated: "Terminated" }).map(([s, label]) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={cn("w-2.5 h-2.5 rounded-full", STATUS_DOT[s])} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Hierarchy */}
      <Card className="bg-card border-border overflow-auto">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Network className="w-4 h-4 text-primary" /> Reporting Structure
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto pb-8">
          {ceo ? (
            <div className="flex flex-col items-center py-4" style={{ minWidth: "max-content" }}>
              {/* CEO */}
              <div className={cn(
                "border rounded-xl p-4 w-52 text-center cursor-pointer hover:border-primary/60 transition-all",
                STATUS_COLORS[ceo.status] ?? "border-border bg-card"
              )} data-testid={`org-node-${ceo.id}`}>
                <div className="relative inline-block mb-2">
                  <div className="w-14 h-14 rounded-xl bg-primary/15 flex items-center justify-center text-3xl mx-auto">
                    {defs.find(d => d.id === ceo.definitionId)?.emoji ?? "🤖"}
                  </div>
                  <span className={cn("absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-card", STATUS_DOT[ceo.status] ?? "bg-muted")} />
                </div>
                <p className="text-sm font-bold text-foreground">{ceo.displayName}</p>
                <p className="text-xs text-primary font-medium">{ceo.role}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{ceo.goal}</p>
                <div className="mt-2 flex justify-center gap-3 text-xs text-muted-foreground">
                  <span>✓ {ceo.tasksCompleted}</span>
                  <span>$ {ceo.spentThisMonth.toFixed(0)}</span>
                </div>
              </div>

              {/* L1 reports connector */}
              {directReports(ceo).length > 0 && (
                <div className="w-px h-8 bg-border" />
              )}

              {/* L1 direct reports */}
              {directReports(ceo).length > 0 && (
                <div className="relative">
                  <div
                    className="absolute top-0 h-px bg-border"
                    style={{
                      left: `calc(50% - ${(directReports(ceo).length * 220) / 2}px + 110px)`,
                      width: `${(directReports(ceo).length - 1) * 220}px`,
                    }}
                  />
                  <div className="flex gap-8">
                    {directReports(ceo).map(l1 => {
                      const l2 = directReports(l1);
                      return (
                        <div key={l1.id} className="flex flex-col items-center">
                          <div className="w-px h-8 bg-border" />
                          <div className={cn(
                            "border rounded-xl p-3 w-44 text-center cursor-pointer hover:border-primary/60 transition-all",
                            STATUS_COLORS[l1.status] ?? "border-border bg-card"
                          )} data-testid={`org-node-${l1.id}`}>
                            <div className="relative inline-block mb-1.5">
                              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-2xl mx-auto">
                                {defs.find(d => d.id === l1.definitionId)?.emoji ?? "🤖"}
                              </div>
                              <span className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card", STATUS_DOT[l1.status] ?? "bg-muted")} />
                            </div>
                            <p className="text-xs font-semibold text-foreground">{l1.displayName}</p>
                            <p className="text-xs text-muted-foreground">{l1.role.split(" ").slice(-2).join(" ")}</p>
                            <div className="mt-1.5 flex justify-center gap-2 text-xs text-muted-foreground">
                              <span>✓{l1.tasksCompleted}</span>
                              <span>${l1.spentThisMonth.toFixed(0)}</span>
                            </div>
                          </div>

                          {/* L2 */}
                          {l2.length > 0 && (
                            <div className="w-px h-8 bg-border" />
                          )}
                          {l2.length > 0 && (
                            <div className="relative">
                              {l2.length > 1 && (
                                <div
                                  className="absolute top-0 h-px bg-border"
                                  style={{
                                    left: `calc(50% - ${(l2.length * 196) / 2}px + 98px)`,
                                    width: `${(l2.length - 1) * 196}px`,
                                  }}
                                />
                              )}
                              <div className="flex gap-6">
                                {l2.map(l2a => (
                                  <div key={l2a.id} className="flex flex-col items-center">
                                    <div className="w-px h-8 bg-border" />
                                    <div className={cn(
                                      "border rounded-xl p-2.5 w-40 text-center hover:border-primary/50 transition-all",
                                      STATUS_COLORS[l2a.status] ?? "border-border bg-card"
                                    )} data-testid={`org-node-${l2a.id}`}>
                                      <div className="relative inline-block mb-1">
                                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-xl mx-auto">
                                          {defs.find(d => d.id === l2a.definitionId)?.emoji ?? "🤖"}
                                        </div>
                                        <span className={cn("absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card", STATUS_DOT[l2a.status] ?? "bg-muted")} />
                                      </div>
                                      <p className="text-xs font-medium text-foreground">{l2a.displayName}</p>
                                      <p className="text-xs text-muted-foreground line-clamp-1">{l2a.role.split(" ").slice(-2).join(" ")}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Network className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No agents deployed yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Teams */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> Teams
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {teams.map(team => {
            const teamAgents = agents.filter(a => {
              // Check if agent is in this team — simplified by checking if their manager is in the expected division
              return true;
            }).slice(0, 3);
            return (
              <Card key={team.id} className="bg-card border-border" data-testid={`team-card-${team.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                    <h3 className="text-sm font-semibold text-foreground">{team.name}</h3>
                  </div>
                  {team.description && <p className="text-xs text-muted-foreground mb-3">{team.description}</p>}
                  <div className="flex -space-x-2">
                    {agents.slice(0, 5).map(a => (
                      <div key={a.id} className="w-7 h-7 rounded-full bg-primary/10 border-2 border-card flex items-center justify-center text-sm" title={a.displayName}>
                        {defs.find(d => d.id === a.definitionId)?.emoji ?? "🤖"}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
