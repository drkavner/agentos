import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTenantContext } from "@/tenant/TenantContext";
import type { Agent } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { CeoShell } from "./CeoShell";

type AgentBudgetResponse = {
  settings: { enabled: boolean; capUsd: number | null; softAlertPct: number; updatedAt: string };
  observed: { spentUsd: number; capUsd: number | null; remainingUsd: number | null };
  health: "healthy" | "warning";
};

export default function CeoBudgets() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const ceo = useMemo(() => agents.find((a) => String(a.role).toLowerCase() === "ceo") ?? null, [agents]);

  const { data: budget } = useQuery<AgentBudgetResponse>({
    queryKey: ["/api/tenants", tid, "agents", ceo?.id ?? 0, "budget"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents/${ceo!.id}/budget`).then((r) => r.json()),
    enabled: tid > 0 && !!ceo?.id,
    refetchInterval: 8000,
  });

  const [capInput, setCapInput] = useState<string>("");

  const updateBudget = useMutation({
    mutationFn: async (patch: Partial<{ enabled: boolean; capUsd: number | null; softAlertPct: number }>) => {
      const r = await apiRequest("PUT", `/api/tenants/${tid}/agents/${ceo!.id}/budget`, patch);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents", ceo?.id ?? 0, "budget"] });
      qc.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      toast({ title: "Saved", description: "Budget updated." });
    },
  });

  return (
    <CeoShell>
      <div className="space-y-4 max-w-[980px]">
        {!ceo ? (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-sm">No CEO found</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              This organization doesn’t have a CEO agent yet.
            </CardContent>
          </Card>
        ) : !budget ? (
          <div className="text-sm text-muted-foreground">Loading budget…</div>
        ) : (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Budget</CardTitle>
                <Badge
                  variant="outline"
                  className={budget.health === "warning" ? "text-xs py-0 h-7 border-yellow-500/30 text-yellow-300" : "text-xs py-0 h-7"}
                >
                  {budget.health === "warning" ? "warning" : "healthy"}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="space-y-2">
                  <div className="text-[10px] tracking-widest text-muted-foreground uppercase">Agent</div>
                  <div className="text-lg font-semibold">{ceo.displayName}</div>
                  <div className="text-xs text-muted-foreground">Monthly UTC budget</div>
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] tracking-widest text-muted-foreground uppercase">Observed</div>
                  <div className="text-2xl font-semibold">${budget.observed.spentUsd.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">
                    {budget.observed.capUsd == null ? "No cap configured" : `of $${budget.observed.capUsd.toFixed(2)}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Remaining{" "}
                    <span className="text-foreground">
                      {budget.observed.remainingUsd == null ? "Unlimited" : `$${budget.observed.remainingUsd.toFixed(2)}`}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] tracking-widest text-muted-foreground uppercase">Budget</div>
                  <div className="text-lg font-semibold">{budget.settings.enabled ? "Enabled" : "Disabled"}</div>
                  <div className="text-xs text-muted-foreground">Soft alert at {Math.round(budget.settings.softAlertPct * 100)}%</div>
                  <div className="pt-2 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">Enforce cap</div>
                    <Switch
                      checked={budget.settings.enabled}
                      onCheckedChange={(checked) => updateBudget.mutate({ enabled: checked })}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                <div className="space-y-2">
                  <div className="text-[10px] tracking-widest text-muted-foreground uppercase">Budget (USD)</div>
                  <Input
                    type="number"
                    placeholder={budget.settings.capUsd == null ? "0.00" : String(budget.settings.capUsd)}
                    value={capInput}
                    onChange={(e) => setCapInput(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => {
                    const n = Number(capInput);
                    if (!Number.isFinite(n) || n <= 0) {
                      toast({ title: "Invalid amount", description: "Enter a budget cap > 0." });
                      return;
                    }
                    updateBudget.mutate({ enabled: true, capUsd: n });
                    setCapInput("");
                  }}
                >
                  Set budget
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </CeoShell>
  );
}

