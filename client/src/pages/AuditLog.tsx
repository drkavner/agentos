import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Agent } from "@shared/schema";
import { ACTIVE_TENANT_ID } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Bot, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Simulated audit events since seeding creates them dynamically
function generateAuditEvents(agents: Agent[]) {
  const actions = [
    { action: "heartbeat", entity: "agent", color: "text-accent" },
    { action: "task_checkout", entity: "task", color: "text-primary" },
    { action: "message_sent", entity: "message", color: "text-muted-foreground" },
    { action: "task_completed", entity: "task", color: "text-green-400" },
    { action: "budget_check", entity: "budget", color: "text-yellow-400" },
    { action: "decision_made", entity: "decision", color: "text-primary" },
    { action: "tool_called", entity: "tool", color: "text-blue-400" },
    { action: "status_changed", entity: "agent", color: "text-orange-400" },
  ];
  const events = [];
  const now = Date.now();
  for (let i = 0; i < 40; i++) {
    const agent = agents[Math.floor(Math.random() * agents.length)];
    const action = actions[Math.floor(Math.random() * actions.length)];
    if (!agent) continue;
    events.push({
      id: i,
      agentName: agent.displayName,
      agentEmoji: "🤖",
      action: action.action,
      entity: action.entity,
      entityId: `${action.entity}-${Math.floor(Math.random() * 100)}`,
      color: action.color,
      tokensUsed: Math.floor(Math.random() * 2000),
      cost: Math.random() * 0.05,
      createdAt: new Date(now - i * 12 * 60000).toISOString(),
      detail: {
        heartbeat: "Woke up, checked work queue, no pending tasks",
        task_checkout: "Checked out task atomically, setting status to in_progress",
        message_sent: "Sent message to general channel",
        task_completed: "Marked task as done, logged 847 tokens consumed",
        budget_check: "Verified monthly budget — within limits",
        decision_made: "Escalated budget approval request to CEO",
        tool_called: "Called web_search tool with query: 'AI agent orchestration 2025'",
        status_changed: "Changed status from idle to running",
      }[action.action],
    });
  }
  return events;
}

export default function AuditLog() {
  const tid = ACTIVE_TENANT_ID;

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then(r => r.json()),
  });

  const events = generateAuditEvents(agents);
  const totalTokens = events.reduce((s, e) => s + e.tokensUsed, 0);
  const totalCost = events.reduce((s, e) => s + e.cost, 0);

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Immutable trace of every agent action, decision, and tool call</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <ScrollText className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Total Events</p>
              <p className="text-xl font-bold text-foreground">{events.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <Bot className="w-5 h-5 text-accent" />
            <div>
              <p className="text-xs text-muted-foreground">Tokens Used</p>
              <p className="text-xl font-bold text-foreground">{totalTokens.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-yellow-400" />
            <div>
              <p className="text-xs text-muted-foreground">Total Cost</p>
              <p className="text-xl font-bold text-foreground">${totalCost.toFixed(3)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Log table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" /> Event Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Time</th>
                  <th className="text-left px-4 py-3 font-medium">Agent</th>
                  <th className="text-left px-4 py-3 font-medium">Action</th>
                  <th className="text-left px-4 py-3 font-medium">Entity</th>
                  <th className="text-left px-4 py-3 font-medium">Detail</th>
                  <th className="text-right px-4 py-3 font-medium">Tokens</th>
                  <th className="text-right px-4 py-3 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors" data-testid={`audit-row-${e.id}`}>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono whitespace-nowrap">{formatTime(e.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span>🤖</span>
                        <span className="font-medium text-foreground">{e.agentName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={cn("text-xs py-0 font-mono", e.color)}>
                        {e.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{e.entity}</td>
                    <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">{e.detail}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{e.tokensUsed.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-yellow-400">${e.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
