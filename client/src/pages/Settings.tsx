import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Tenant } from "@shared/schema";
import { ACTIVE_TENANT_ID } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Building2, DollarSign, Key, Shield, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Settings() {
  const tid = ACTIVE_TENANT_ID;
  const { toast } = useToast();
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const clearDemoData = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/tenants/${tid}/demo-data`),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Demo data cleared", description: "All demo agents, tasks, teams, and messages have been removed. Start fresh!" });
    },
    onError: () => toast({ title: "Error", description: "Failed to clear demo data", variant: "destructive" }),
  });

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["/api/tenants", tid],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}`).then(r => r.json()),
  });

  const form = useForm({
    values: {
      name: tenant?.name ?? "",
      mission: tenant?.mission ?? "",
      monthlyBudget: tenant?.monthlyBudget ?? 500,
      maxAgents: tenant?.maxAgents ?? 25,
    },
  });

  const updateTenant = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/tenants/${tid}`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid] });
      toast({ title: "Settings saved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to save settings", variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your organization configuration</p>
      </div>

      {/* Organization */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" /> Organization
          </CardTitle>
          <CardDescription className="text-xs">Basic settings for your organization</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => updateTenant.mutate(d))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization Name</FormLabel>
                  <FormControl><Input {...field} data-testid="org-name-input" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="mission" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mission Statement</FormLabel>
                  <FormControl><Textarea rows={3} placeholder="What is your company's mission?" {...field} data-testid="mission-input" /></FormControl>
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="monthlyBudget" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Budget ($)</FormLabel>
                    <FormControl><Input type="number" min={1} {...field} onChange={e => field.onChange(Number(e.target.value))} data-testid="budget-input" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="maxAgents" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      Agent Limit
                      <span className="text-xs font-normal text-muted-foreground">(max deployable)</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        {...field}
                        onChange={e => field.onChange(Number(e.target.value))}
                        data-testid="max-agents-input"
                      />
                    </FormControl>
                  </FormItem>
                )} />
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                Currently <strong>{tenant?.maxAgents ?? 25}</strong> agents allowed. The system will block new hires once this cap is reached.
              </p>
              <Button type="submit" disabled={updateTenant.isPending} data-testid="save-settings-btn">
                {updateTenant.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Plan */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-yellow-400" /> Plan & Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Current Plan</p>
              <p className="text-xs text-muted-foreground">You are on the {tenant?.plan} plan</p>
            </div>
            <Badge className="capitalize text-sm">{tenant?.plan}</Badge>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { name: "Starter", price: "$49/mo", agents: "5 agents", budget: "$200 budget" },
              { name: "Pro", price: "$149/mo", agents: "25 agents", budget: "$2,000 budget" },
              { name: "Enterprise", price: "Custom", agents: "Unlimited agents", budget: "Custom budget" },
            ].map(plan => (
              <div key={plan.name} className={cn("border rounded-lg p-3 cursor-pointer hover:border-primary/40 transition-all", tenant?.plan?.toLowerCase() === plan.name.toLowerCase() ? "border-primary bg-primary/5" : "border-border")} data-testid={`plan-${plan.name}`}>
                <p className="text-xs font-bold text-foreground">{plan.name}</p>
                <p className="text-lg font-bold text-primary mt-1">{plan.price}</p>
                <p className="text-xs text-muted-foreground">{plan.agents}</p>
                <p className="text-xs text-muted-foreground">{plan.budget}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-accent" /> API Keys
          </CardTitle>
          <CardDescription className="text-xs">Configure LLM provider API keys for your agents</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: "Anthropic API Key", placeholder: "sk-ant-..." },
            { label: "OpenAI API Key", placeholder: "sk-..." },
            { label: "Google AI API Key", placeholder: "AIza..." },
            { label: "OpenRouter API Key", placeholder: "sk-or-..." },
          ].map(k => (
            <div key={k.label}>
              <Label className="text-xs">{k.label}</Label>
              <Input type="password" placeholder={k.placeholder} className="mt-1 font-mono text-xs" data-testid={`api-key-${k.label.split(" ")[0].toLowerCase()}`} />
            </div>
          ))}
          <Button variant="outline" size="sm" className="mt-2">Save API Keys</Button>
        </CardContent>
      </Card>

      {/* Security */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Shield className="w-4 h-4 text-green-400" /> Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: "Require approval for agent hires", desc: "You must approve every new agent before it can run" },
            { label: "Require approval for budget increases", desc: "Monthly budget changes need your sign-off" },
            { label: "Immutable audit log", desc: "All agent actions are logged and cannot be deleted" },
            { label: "Agent communication encryption", desc: "All inter-agent messages are encrypted at rest" },
          ].map(s => (
            <div key={s.label} className="flex items-start justify-between gap-4 p-3 rounded-lg bg-muted/30">
              <div>
                <p className="text-sm font-medium text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
              <div className="flex-shrink-0 w-9 h-5 bg-primary rounded-full flex items-center justify-end px-0.5 cursor-pointer">
                <div className="w-4 h-4 rounded-full bg-white" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="bg-card border-destructive/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" /> Danger Zone
          </CardTitle>
          <CardDescription className="text-xs">Irreversible actions — proceed with caution</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
            <div>
              <p className="text-sm font-semibold text-foreground">Clear Demo Data</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Removes all seeded demo agents, tasks, teams, and messages so you can start with a clean slate and build your own real team.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={() => setClearConfirmOpen(true)}
              data-testid="clear-demo-btn"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Clear Demo Data
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all demo agents, teams, tasks, and messages for <strong>{tenant?.name}</strong>. Your organization settings will be preserved. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => clearDemoData.mutate()}
              data-testid="confirm-clear-btn"
            >
              Yes, clear everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
