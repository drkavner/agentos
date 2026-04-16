import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Tenant } from "@shared/schema";
import { TENANT_ADAPTER_LABELS, type TenantAdapterType } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Plus, Building2, Trash2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useTenantContext } from "@/tenant/TenantContext";
import { NewOrgWizard } from "@/components/NewOrgWizard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter as AlertFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  paused: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  suspended: "bg-red-500/10 text-red-400 border-red-500/20",
};

const PLAN_COLORS: Record<string, string> = {
  starter: "bg-muted text-muted-foreground",
  pro: "bg-primary/15 text-primary",
  enterprise: "bg-yellow-400/10 text-yellow-400",
};

function TenantCard({
  tenant,
  onDelete,
}: {
  tenant: Tenant;
  onDelete: () => void;
}) {
  const { data: ceoControl } = useQuery<{ enabled?: boolean }>({
    queryKey: ["/api/tenants", tenant.id, "ceo", "control"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tenant.id}/ceo/control`).then((r) => r.json()),
    enabled: tenant.id > 0,
  });
  const ceoEnabled = ceoControl?.enabled !== false;
  const budgetPct = (tenant.spentThisMonth / tenant.monthlyBudget) * 100;

  const ceoBadgeClass = useMemo(() => {
    return ceoEnabled
      ? "bg-primary/10 text-primary border-primary/20"
      : "bg-muted text-muted-foreground border-border/50";
  }, [ceoEnabled]);

  return (
    <Card key={tenant.id} className="bg-card border-border hover:border-primary/30 transition-all" data-testid={`tenant-card-${tenant.id}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-lg font-bold text-primary">
              {tenant.name[0]}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{tenant.name}</h3>
              <p className="text-xs text-muted-foreground font-mono">/{tenant.slug}</p>
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap justify-end">
            <Badge variant="outline" className={cn("text-xs py-0", STATUS_COLORS[tenant.status])}>
              {tenant.status}
            </Badge>
            <Badge variant="outline" className={cn("text-xs py-0 capitalize", PLAN_COLORS[tenant.plan])}>
              {tenant.plan}
            </Badge>
            <Badge variant="outline" className="text-xs py-0 text-muted-foreground">
              {(tenant.adapterType === "openclaw" ? TENANT_ADAPTER_LABELS.openclaw : TENANT_ADAPTER_LABELS.hermes)}
            </Badge>
            <Badge variant="outline" className={cn("text-xs py-0", ceoBadgeClass)}>
              {ceoEnabled ? "CEO enabled" : "No CEO"}
            </Badge>
          </div>
        </div>

        {tenant.mission && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{tenant.mission}</p>
        )}

        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>Monthly Budget</span>
            <span>${tenant.spentThisMonth.toFixed(2)} / ${tenant.monthlyBudget}</span>
          </div>
          <Progress value={Math.min(100, budgetPct)} className="h-1.5" />
        </div>

        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="flex-1 text-xs" data-testid={`open-tenant-${tenant.id}`}>
            <ExternalLink className="w-3 h-3 mr-1" /> Open
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:bg-destructive/10 border-destructive/30"
            onClick={onDelete}
            data-testid={`delete-tenant-${tenant.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Tenants() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { activeTenantId, setActiveTenantId } = useTenantContext();

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    queryFn: () => apiRequest("GET", "/api/tenants").then(r => r.json()),
  });

  // If there are no organizations, force onboarding wizard open.
  useEffect(() => {
    if (tenants.length === 0) setShowCreate(true);
  }, [tenants.length]);

  const deleteTenant = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tenants/${id}`),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", id, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", id, "teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", id, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", id, "goals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", id, "messages"] });
      toast({ title: "Organization deleted" });

      // If we deleted the active tenant, pick another (provider will also self-heal on next fetch).
      if (activeTenantId === id) {
        const remaining = tenants.filter((t) => t.id !== id);
        if (remaining.length > 0) {
          setActiveTenantId(remaining[0]!.id);
        } else {
          // No orgs left: immediately guide user to create one.
          setShowCreate(true);
        }
      }
    },
  });

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Organizations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{tenants.length} organization{tenants.length !== 1 ? "s" : ""} · multi-tenant deployment</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-org-btn">
          <Plus className="w-4 h-4 mr-1.5" /> New Organization
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Organizations", value: tenants.length },
          { label: "Active", value: tenants.filter(t => t.status === "active").length },
          { label: "Total Budget", value: `$${tenants.reduce((s, t) => s + t.monthlyBudget, 0).toLocaleString()}` },
        ].map(s => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tenant grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tenants.map((tenant) => (
          <TenantCard
            key={tenant.id}
            tenant={tenant}
            onDelete={() => setDeleteId(tenant.id)}
          />
        ))}
      </div>

      <NewOrgWizard
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => {
          setActiveTenantId(id);
        }}
        required={tenants.length === 0}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete organization?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the organization and all related agents, tasks, messages, goals, teams, and audit logs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertFooter>
            <AlertDialogCancel onClick={() => setDeleteId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId !== null) deleteTenant.mutate(deleteId);
                setDeleteId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
