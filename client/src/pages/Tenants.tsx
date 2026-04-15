import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Tenant } from "@shared/schema";
import { TENANT_ADAPTER_LABELS, type TenantAdapterType } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdapterPickerCards } from "@/components/AdapterPickerCards";
import { Progress } from "@/components/ui/progress";
import { Plus, Building2, Trash2, ExternalLink } from "lucide-react";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useTenantContext } from "@/tenant/TenantContext";
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

export default function Tenants() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { activeTenantId, setActiveTenantId } = useTenantContext();
  const form = useForm({
    defaultValues: {
      name: "",
      slug: "",
      plan: "starter",
      monthlyBudget: 500,
      mission: "",
      adapterType: "hermes" as TenantAdapterType,
    },
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    queryFn: () => apiRequest("GET", "/api/tenants").then(r => r.json()),
  });

  const createTenant = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/tenants", data).then((r) => r.json() as Promise<Tenant>),
    onSuccess: (t) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      if (t?.id != null) {
        queryClient.invalidateQueries({ queryKey: ["/api/tenants", t.id, "agents"] });
        queryClient.invalidateQueries({ queryKey: ["/api/tenants", t.id, "ceo", "control"] });
        setActiveTenantId(t.id);
      }
      toast({ title: "Organization created", description: "A CEO agent was added automatically." });
      setShowCreate(false);
      form.reset();
    },
  });

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
        if (remaining.length > 0) setActiveTenantId(remaining[0]!.id);
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
        {tenants.map(tenant => {
          const budgetPct = (tenant.spentThisMonth / tenant.monthlyBudget) * 100;
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
                  <div className="flex gap-1.5">
                    <Badge variant="outline" className={cn("text-xs py-0", STATUS_COLORS[tenant.status])}>
                      {tenant.status}
                    </Badge>
                    <Badge variant="outline" className={cn("text-xs py-0 capitalize", PLAN_COLORS[tenant.plan])}>
                      {tenant.plan}
                    </Badge>
                    <Badge variant="outline" className="text-xs py-0 text-muted-foreground">
                      {(tenant.adapterType === "openclaw" ? TENANT_ADAPTER_LABELS.openclaw : TENANT_ADAPTER_LABELS.hermes)}
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
                    onClick={() => setDeleteId(tenant.id)}
                    disabled={tenants.length <= 1}
                    data-testid={`delete-tenant-${tenant.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => createTenant.mutate(d))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input placeholder="Acme Corp" {...field} data-testid="org-name-create" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="slug" render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl><Input placeholder="acme-corp" {...field} data-testid="org-slug-create" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="plan" render={({ field }) => (
                <FormItem>
                  <FormLabel>Plan</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="adapterType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent adapter</FormLabel>
                  <FormControl>
                    <div className="w-full pt-0.5">
                      <AdapterPickerCards
                        value={field.value}
                        onChange={field.onChange}
                        data-testid="org-adapter-create"
                        helperText="All agents hired from the Agent Library for this organization run through the selected adapter."
                      />
                    </div>
                  </FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="monthlyBudget" render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly Budget ($)</FormLabel>
                  <FormControl><Input type="number" {...field} onChange={e => field.onChange(Number(e.target.value))} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="mission" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mission (optional)</FormLabel>
                  <FormControl><Input placeholder="Company mission statement" {...field} /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" disabled={createTenant.isPending}>
                  {createTenant.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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
