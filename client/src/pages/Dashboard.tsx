import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Agent, Task, Goal, Tenant, Message } from "@shared/schema";
import { ACTIVE_TENANT_ID } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Bot, CheckSquare, DollarSign, TrendingUp, Clock, Zap, Target, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "../lib/utils";

function StatCard({ label, value, sub, icon: Icon, accent }: { label: string; value: string | number; sub?: string; icon: any; accent?: string }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
            <p className={cn("text-2xl font-bold mt-1", accent || "text-foreground")}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={cn("p-2.5 rounded-lg", accent ? "bg-primary/10" : "bg-muted")}>
            <Icon className={cn("w-5 h-5", accent || "text-muted-foreground")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-green-500 status-running",
    idle: "bg-yellow-500",
    paused: "bg-orange-500",
    terminated: "bg-red-500",
  };
  return <span className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", colors[status] ?? "bg-gray-500")} />;
}

export default function Dashboard() {
  const tid = ACTIVE_TENANT_ID;

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["/api/tenants", tid],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}`).then(r => r.json()),
  });

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then(r => r.json()),
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tenants", tid, "tasks"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/tasks`).then(r => r.json()),
  });

  const { data: goals = [] } = useQuery<Goal[]>({
    queryKey: ["/api/tenants", tid, "goals"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/goals`).then(r => r.json()),
  });

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["/api/tenants", tid, "messages", "general"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/messages?channelId=general`).then(r => r.json()),
  });

  const runningAgents = agents.filter(a => a.status === "running").length;
  const doneTasks = tasks.filter(t => t.status === "done").length;
  const inProgressTasks = tasks.filter(t => t.status === "in_progress").length;
  const blockedTasks = tasks.filter(t => t.status === "blocked").length;
  const totalSpent = agents.reduce((sum, a) => sum + a.spentThisMonth, 0);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{tenant?.name ?? "Loading..."}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{tenant?.mission ?? ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 status-running" />
          <span className="text-xs text-muted-foreground">{runningAgents} agents active</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Agents" value={runningAgents} sub={`of ${agents.length} total`} icon={Bot} accent="text-primary" />
        <StatCard label="Tasks Done" value={doneTasks} sub={`${inProgressTasks} in progress`} icon={CheckSquare} accent="text-green-400" />
        <StatCard label="Monthly Spend" value={`$${totalSpent.toFixed(2)}`} sub={`of $${tenant?.monthlyBudget ?? 0} budget`} icon={DollarSign} accent="text-yellow-400" />
        <StatCard label="Blocked Tasks" value={blockedTasks} sub="need attention" icon={AlertCircle} accent={blockedTasks > 0 ? "text-destructive" : "text-muted-foreground"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Goals */}
        <div className="lg:col-span-1">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" /> Company Goals
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {goals.map(g => (
                <div key={g.id} data-testid={`goal-${g.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-foreground font-medium truncate flex-1 mr-2">{g.title}</span>
                    <span className="text-xs text-muted-foreground font-mono">{g.progress}%</span>
                  </div>
                  <Progress value={g.progress} className="h-1.5" />
                  {g.description && <p className="text-xs text-muted-foreground mt-1">{g.description}</p>}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Budget card */}
          {tenant && (
            <Card className="bg-card border-border mt-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-yellow-400" /> Budget Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between mb-2">
                  <span className="text-2xl font-bold text-foreground">${tenant.spentThisMonth.toFixed(2)}</span>
                  <span className="text-sm text-muted-foreground">/ ${tenant.monthlyBudget}</span>
                </div>
                <Progress value={(tenant.spentThisMonth / tenant.monthlyBudget) * 100} className="h-2 mb-2" />
                <div className="space-y-2 mt-3">
                  {agents.slice(0, 5).map(a => (
                    <div key={a.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AgentStatusDot status={a.status} />
                        <span className="text-xs text-muted-foreground">{a.displayName}</span>
                      </div>
                      <span className="text-xs font-mono text-foreground">${a.spentThisMonth.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Agent roster */}
        <div className="lg:col-span-1">
          <Card className="bg-card border-border h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" /> Agent Roster
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 overflow-y-auto max-h-[500px]">
              {agents.map(a => (
                <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors" data-testid={`agent-card-${a.id}`}>
                  <AgentStatusDot status={a.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{a.displayName}</span>
                      <Badge variant="outline" className="text-xs py-0 shrink-0">{a.role.split(" ").slice(-1)[0]}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{a.role}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs font-mono text-foreground">${a.spentThisMonth.toFixed(0)}</div>
                    <div className="text-xs text-muted-foreground">{a.tasksCompleted} tasks</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Recent activity */}
        <div className="lg:col-span-1">
          <Card className="bg-card border-border h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-accent" /> General Channel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 overflow-y-auto max-h-[500px]">
              {messages.slice(-8).map(m => (
                <div key={m.id} className={cn(
                  "p-2.5 rounded-lg text-xs space-y-1",
                  m.messageType === "heartbeat" && "msg-heartbeat bg-accent/5",
                  m.messageType === "decision" && "msg-decision bg-primary/5",
                  m.messageType === "tool_call" && "msg-tool_call bg-green-500/5",
                  !["heartbeat","decision","tool_call"].includes(m.messageType) && "bg-muted/40",
                )} data-testid={`msg-${m.id}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-foreground">{m.senderEmoji} {m.senderName}</span>
                    {m.messageType !== "chat" && (
                      <Badge variant="outline" className="text-xs py-0 h-4">{m.messageType}</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{m.content}</p>
                </div>
              ))}
              {messages.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No messages yet</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent tasks */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-green-400" /> Recent Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {tasks.slice(0, 8).map(t => {
              const agent = agents.find(a => a.id === t.assignedAgentId);
              const statusColors: Record<string, string> = {
                done: "text-green-400 bg-green-400/10",
                in_progress: "text-primary bg-primary/10",
                todo: "text-muted-foreground bg-muted",
                review: "text-yellow-400 bg-yellow-400/10",
                blocked: "text-destructive bg-destructive/10",
              };
              const priorityColors: Record<string, string> = {
                urgent: "text-destructive",
                high: "text-orange-400",
                medium: "text-yellow-400",
                low: "text-muted-foreground",
              };
              return (
                <div key={t.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 transition-colors" data-testid={`task-row-${t.id}`}>
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0", statusColors[t.status])}>{t.status.replace("_", " ")}</span>
                  <span className="flex-1 text-sm text-foreground truncate">{t.title}</span>
                  {agent && <span className="text-xs text-muted-foreground flex-shrink-0">{agent.displayName}</span>}
                  <span className={cn("text-xs font-medium flex-shrink-0", priorityColors[t.priority])}>{t.priority}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
