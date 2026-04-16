import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, readJsonOrApiHint } from "@/lib/queryClient";
import type { Tenant } from "@shared/schema";
import type { TenantAdapterType } from "@shared/schema";
import { useTenantContext } from "@/tenant/TenantContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { AdapterPickerCards } from "@/components/AdapterPickerCards";
import { useToast } from "@/hooks/use-toast";
import { Building2, DollarSign, Key, Shield, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Settings() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const { toast } = useToast();
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [ollamaApiKey, setOllamaApiKey] = useState("");
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");

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

  const { data: ollamaKeyStatus } = useQuery<{ configured: boolean; updatedAt: string | null }>({
    queryKey: ["/api/tenants", tid, "ollama", "api-key"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ollama/api-key`).then(r => r.json()),
    enabled: tid > 0,
  });

  const { data: openRouterKeyStatus } = useQuery<{ configured: boolean; updatedAt: string | null }>({
    queryKey: ["/api/tenants", tid, "openrouter", "api-key"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/openrouter/api-key`).then(r => r.json()),
    enabled: tid > 0,
  });

  const form = useForm({
    values: {
      name: tenant?.name ?? "",
      mission: tenant?.mission ?? "",
      monthlyBudget: tenant?.monthlyBudget ?? 500,
      maxAgents: tenant?.maxAgents ?? 25,
      adapterType: (tenant?.adapterType === "openclaw" ? "openclaw" : "hermes") as TenantAdapterType,
      ollamaBaseUrl: tenant?.ollamaBaseUrl ?? "",
    },
  });

  const listOllamaModels = useMutation({
    mutationFn: async () => {
      const url = String(form.getValues("ollamaBaseUrl") ?? "").trim();
      const q = url ? `?${new URLSearchParams({ url }).toString()}` : "";
      const r = await apiRequest("GET", `/api/tenants/${tid}/ollama/models${q}`);
      return readJsonOrApiHint<{ baseUsed: string; models: string[] }>(r);
    },
    onSuccess: () => {
      toast({ title: "Ollama", description: "Model list updated." });
    },
    onError: (e: any) => {
      toast({
        title: "Could not reach Ollama",
        description: String(e?.message ?? "Check the base URL and that Ollama is running."),
        variant: "destructive",
      });
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

  const saveOllamaApiKey = useMutation({
    mutationFn: async () => {
      const apiKey = String(ollamaApiKey || "").trim();
      const r = await apiRequest("PUT", `/api/tenants/${tid}/ollama/api-key`, { apiKey });
      return readJsonOrApiHint<{ ok: boolean; configured: boolean }>(r);
    },
    onSuccess: () => {
      setOllamaApiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "ollama", "api-key"] });
      toast({ title: "Ollama API key saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: String(e?.message ?? "Failed to save API key"), variant: "destructive" }),
  });

  const clearOllamaApiKey = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("DELETE", `/api/tenants/${tid}/ollama/api-key`);
      return readJsonOrApiHint<{ ok: boolean; configured: boolean }>(r);
    },
    onSuccess: () => {
      setOllamaApiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "ollama", "api-key"] });
      toast({ title: "Ollama API key cleared" });
    },
    onError: (e: any) => toast({ title: "Error", description: String(e?.message ?? "Failed to clear API key"), variant: "destructive" }),
  });

  const saveOpenRouterApiKey = useMutation({
    mutationFn: async () => {
      const apiKey = String(openRouterApiKey || "").trim();
      const r = await apiRequest("PUT", `/api/tenants/${tid}/openrouter/api-key`, { apiKey });
      return readJsonOrApiHint<{ ok: boolean; configured: boolean }>(r);
    },
    onSuccess: () => {
      setOpenRouterApiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "openrouter", "api-key"] });
      toast({ title: "OpenRouter API key saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: String(e?.message ?? "Failed to save API key"), variant: "destructive" }),
  });

  const clearOpenRouterApiKey = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("DELETE", `/api/tenants/${tid}/openrouter/api-key`);
      return readJsonOrApiHint<{ ok: boolean; configured: boolean }>(r);
    },
    onSuccess: () => {
      setOpenRouterApiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "openrouter", "api-key"] });
      toast({ title: "OpenRouter API key cleared" });
    },
    onError: (e: any) => toast({ title: "Error", description: String(e?.message ?? "Failed to clear API key"), variant: "destructive" }),
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
              <FormField control={form.control} name="adapterType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent adapter</FormLabel>
                  <FormControl>
                    <div className="w-full pt-0.5">
                      <AdapterPickerCards
                        value={field.value}
                        onChange={field.onChange}
                        data-testid="settings-adapter"
                        helperText="All Agent Library hires for this organization use this execution plane."
                      />
                    </div>
                  </FormControl>
                </FormItem>
              )} />
              <FormField
                control={form.control}
                name="ollamaBaseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ollama base URL</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="http://127.0.0.1:11434"
                        className="font-mono text-xs"
                        data-testid="ollama-base-url-input"
                      />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">
                      Host only (per{" "}
                      <a className="underline hover:text-foreground" href="https://docs.ollama.com/api/introduction" target="_blank" rel="noreferrer">
                        Ollama API docs
                      </a>
                      ), e.g. <span className="font-mono">http://127.0.0.1:11434</span> — not the full <span className="font-mono">…/api</span> path. Leave empty to use{" "}
                      <span className="font-mono">OLLAMA_BASE_URL</span>.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={listOllamaModels.isPending || tid <= 0}
                        onClick={() => listOllamaModels.mutate()}
                        data-testid="ollama-detect-models"
                      >
                        {listOllamaModels.isPending ? "Checking…" : "Detect models"}
                      </Button>
                      {listOllamaModels.isSuccess && listOllamaModels.data ? (
                        <span className="text-xs text-muted-foreground">
                          <span className="font-mono text-foreground">{listOllamaModels.data.baseUsed}</span>
                          {" · "}
                          {listOllamaModels.data.models.length} model(s)
                        </span>
                      ) : null}
                    </div>
                    {listOllamaModels.isSuccess && listOllamaModels.data?.models?.length ? (
                      <ul className="mt-2 max-h-36 overflow-y-auto rounded-md border border-border bg-muted/20 p-2 text-[11px] font-mono space-y-0.5">
                        {listOllamaModels.data.models.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    ) : listOllamaModels.isSuccess && !listOllamaModels.data?.models?.length ? (
                      <p className="text-xs text-amber-600/90 mt-2">No models reported — run: ollama pull &lt;model&gt;</p>
                    ) : null}
                  </FormItem>
                )}
              />
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
          <CardDescription className="text-xs">
            API keys are stored server-side for this organization. Keys are not shown again after saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">OpenRouter API Key</Label>
              {openRouterKeyStatus ? (
                <Badge variant="outline" className="text-[10px] py-0 h-5">
                  {openRouterKeyStatus.configured ? "configured" : "not set"}
                </Badge>
              ) : null}
            </div>
            <Input
              type="password"
              placeholder="sk-or-..."
              className="mt-1 font-mono text-xs"
              value={openRouterApiKey}
              onChange={(e) => setOpenRouterApiKey(e.target.value)}
              data-testid="api-key-openrouter"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Used when an agent is routed to <span className="font-mono">openrouter</span>.
            </p>
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saveOpenRouterApiKey.isPending || tid <= 0 || !openRouterApiKey.trim()}
                onClick={() => saveOpenRouterApiKey.mutate()}
                data-testid="save-openrouter-api-key"
              >
                {saveOpenRouterApiKey.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={clearOpenRouterApiKey.isPending || tid <= 0 || !(openRouterKeyStatus?.configured)}
                onClick={() => clearOpenRouterApiKey.mutate()}
                data-testid="clear-openrouter-api-key"
              >
                {clearOpenRouterApiKey.isPending ? "Clearing…" : "Clear"}
              </Button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Ollama Cloud API Key</Label>
              {ollamaKeyStatus ? (
                <Badge variant="outline" className="text-[10px] py-0 h-5">
                  {ollamaKeyStatus.configured ? "configured" : "not set"}
                </Badge>
              ) : null}
            </div>
            <Input
              type="password"
              placeholder="ollama_api_key..."
              className="mt-1 font-mono text-xs"
              value={ollamaApiKey}
              onChange={(e) => setOllamaApiKey(e.target.value)}
              data-testid="api-key-ollama"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Used only for cloud-backed models (e.g. <span className="font-mono">*:cloud</span>). Stored in the server DB for this org.
            </p>
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saveOllamaApiKey.isPending || tid <= 0 || !ollamaApiKey.trim()}
                onClick={() => saveOllamaApiKey.mutate()}
                data-testid="save-ollama-api-key"
              >
                {saveOllamaApiKey.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={clearOllamaApiKey.isPending || tid <= 0 || !(ollamaKeyStatus?.configured)}
                onClick={() => clearOllamaApiKey.mutate()}
                data-testid="clear-ollama-api-key"
              >
                {clearOllamaApiKey.isPending ? "Clearing…" : "Clear"}
              </Button>
            </div>
          </div>
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
