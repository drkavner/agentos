import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { AuditLog as AuditLogRow } from "@shared/schema";
import { useTenantContext } from "@/tenant/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Bot, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ACTION_COLORS: Record<string, string> = {
  heartbeat: "text-accent",
  task_checkout: "text-primary",
  message_sent: "text-muted-foreground",
  task_completed: "text-green-400",
  task_created: "text-primary",
  task_deleted: "text-orange-400",
  budget_check: "text-yellow-400",
  decision_made: "text-primary",
  tool_called: "text-blue-400",
  status_changed: "text-orange-400",
  agent_hired: "text-green-400",
  agent_updated: "text-orange-400",
  agent_deleted: "text-destructive",
  team_created: "text-primary",
  team_updated: "text-muted-foreground",
  team_deleted: "text-destructive",
  team_member_added: "text-primary",
  team_member_removed: "text-muted-foreground",
  goal_created: "text-primary",
  goal_updated: "text-muted-foreground",
};

function actionColor(action: string) {
  return ACTION_COLORS[action] ?? "text-muted-foreground";
}

export default function AuditLog() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;

  const { data: events = [], isLoading } = useQuery<AuditLogRow[]>({
    queryKey: ["/api/tenants", tid, "audit"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/audit`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const totalTokens = events.reduce((s, e) => s + (e.tokensUsed ?? 0), 0);
  const totalCost = events.reduce((s, e) => s + (e.cost ?? 0), 0);

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Immutable trace of actions recorded by the control plane (from the database)</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <ScrollText className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Total Events</p>
              <p className="text-xl font-bold text-foreground">{isLoading ? "…" : events.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <Bot className="w-5 h-5 text-accent" />
            <div>
              <p className="text-xs text-muted-foreground">Tokens Used</p>
              <p className="text-xl font-bold text-foreground">{isLoading ? "…" : totalTokens.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-yellow-400" />
            <div>
              <p className="text-xs text-muted-foreground">Total Cost</p>
              <p className="text-xl font-bold text-foreground">{isLoading ? "…" : `$${totalCost.toFixed(3)}`}</p>
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
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Loading audit log…
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No audit events yet. Actions you take in the app (tasks, agents, messages, etc.) are logged here.
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                      data-testid={`audit-row-${e.id}`}
                    >
                      <td className="px-4 py-2.5 text-muted-foreground font-mono whitespace-nowrap">{formatTime(e.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span>🤖</span>
                          <span className="font-medium text-foreground">{e.agentName ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className={cn("text-xs py-0 font-mono", actionColor(e.action))}>
                          {e.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{e.entity}</td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate" title={e.detail ?? ""}>
                        {e.detail ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{(e.tokensUsed ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-yellow-400">${(e.cost ?? 0).toFixed(4)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
