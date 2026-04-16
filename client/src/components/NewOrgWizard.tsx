import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AdapterPickerCards } from "@/components/AdapterPickerCards";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { TenantAdapterType } from "@shared/schema";
import { OPENROUTER_MODELS } from "@/lib/openrouterModels";
import { useTenantContext } from "@/tenant/TenantContext";

type StepId = "company" | "agent" | "task" | "launch";

const STEPS: { id: StepId; label: string }[] = [
  { id: "company", label: "Organization" },
  { id: "agent", label: "Agent" },
  { id: "task", label: "Task" },
  { id: "launch", label: "Launch" },
];

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function defaultStarterTaskDescription(useCeo: boolean) {
  return (
    useCeo
      ? [
          "You are the CEO. You set the direction for the company.",
          "",
          "- hire a founding engineer",
          "- write a hiring plan",
          "- break the roadmap into concrete tasks and start delegating work",
        ]
      : [
          "- hire a founding engineer",
          "- write a hiring plan",
          "- break the roadmap into concrete tasks and start delegating work",
        ]
  ).join("\n");
}

export function NewOrgWizard(props: {
  open: boolean;
  onClose: () => void;
  onCreated?: (tenantId: number) => void;
  required?: boolean;
}) {
  const { open, onClose, onCreated, required } = props;
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { setActiveTenantId } = useTenantContext();

  const [name, setName] = useState("Acme Corp");
  const [mission, setMission] = useState("");
  const [plan, setPlan] = useState<"starter" | "pro" | "enterprise">("starter");
  const [monthlyBudget, setMonthlyBudget] = useState<number>(500);
  const [adapterType, setAdapterType] = useState<TenantAdapterType>("hermes");

  const [useCeoAgent, setUseCeoAgent] = useState(true);
  const [ceoLlmProvider, setCeoLlmProvider] = useState<"openrouter" | "ollama">("openrouter");
  const [ceoModel, setCeoModel] = useState("claude-3-5-sonnet");
  const openRouterModelIds = useMemo(() => new Set(OPENROUTER_MODELS.map((m) => m.id)), []);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://127.0.0.1:11434");
  const [ollamaDetected, setOllamaDetected] = useState<string[]>([]);
  const [ollamaDetecting, setOllamaDetecting] = useState(false);
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [ollamaApiKey, setOllamaApiKey] = useState("");
  const [ollamaDetectError, setOllamaDetectError] = useState<string | null>(null);

  const [taskTitle, setTaskTitle] = useState("Hire your first engineer and create a hiring plan");
  const [taskDescription, setTaskDescription] = useState(() => defaultStarterTaskDescription(true));
  const taskDescDirtyRef = useRef(false);

  const [stepIdx, setStepIdx] = useState(0);
  const steps = useMemo(() => {
    // If CEO is disabled, hide the Task step entirely.
    return useCeoAgent ? STEPS : STEPS.filter((s) => s.id !== "task");
  }, [useCeoAgent]);
  const step = steps[Math.min(stepIdx, steps.length - 1)]!.id;

  // Clamp step index when steps list changes (e.g. toggling CEO disables Task step).
  useEffect(() => {
    if (stepIdx > steps.length - 1) setStepIdx(steps.length - 1);
  }, [steps.length, stepIdx]);

  // Keep the default template in sync with CEO toggle, but don't overwrite user edits.
  useEffect(() => {
    if (taskDescDirtyRef.current) return;
    setTaskDescription(defaultStarterTaskDescription(useCeoAgent));
  }, [useCeoAgent]);

  const slug = useMemo(() => slugify(name || "org"), [name]);

  const create = useMutation({
    mutationFn: async () => {
      // Retry once with a uniquified slug if the default is taken.
      const makePayload = (nextSlug: string) => ({
        name,
        slug: nextSlug,
        plan,
        monthlyBudget,
        mission,
        adapterType,
        useCeoAgent,
        ollamaBaseUrl: useCeoAgent && ceoLlmProvider === "ollama" ? ollamaBaseUrl : undefined,
        ceoLlmProvider: useCeoAgent ? ceoLlmProvider : undefined,
        ceoModel: useCeoAgent ? ceoModel : undefined,
      });
      let tenantRes: Response;
      let tenant: any;
      try {
        tenantRes = await apiRequest("POST", "/api/tenants", makePayload(slug));
        tenant = await tenantRes.json();
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        const code = String(e?.code ?? "");
        if (code === "slug_taken" || msg.includes("slug_taken")) {
          const suffix = Math.random().toString(36).slice(2, 6);
          const nextSlug = `${slug}-${suffix}`.slice(0, 90);
          tenantRes = await apiRequest("POST", "/api/tenants", makePayload(nextSlug));
          tenant = await tenantRes.json();
        } else {
          throw e;
        }
      }
      if (!tenantRes.ok) throw tenant;

      const warnings: string[] = [];
      // Make toggle deterministic even if server is stale: enforce CEO enabled/disabled explicitly.
      if (!useCeoAgent) {
        try {
          await apiRequest("PUT", `/api/tenants/${tenant.id}/ceo/control`, { enabled: false, mode: "agent" });
          queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id, "ceo", "control"] });
          queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id, "agents"] });
        } catch {
          warnings.push("Could not disable CEO (server may need restart)");
        }
        // Verify and hard-clean any CEO row (older servers may ignore `enabled`).
        try {
          const control = await apiRequest("GET", `/api/tenants/${tenant.id}/ceo/control`).then((r) => r.json() as any);
          if (control && typeof control.enabled === "boolean" && control.enabled !== false) {
            warnings.push("CEO appears enabled after create (server may need restart)");
          }
          if (control && typeof control.enabled !== "boolean") {
            warnings.push("Server is missing CEO enable/disable support — restart the server");
          }
        } catch {
          warnings.push("Could not verify CEO state");
        }
        try {
          const agentsRes2 = await apiRequest("GET", `/api/tenants/${tenant.id}/agents`);
          const agents2 = await agentsRes2.json();
          const ceo2 = Array.isArray(agents2) ? agents2.find((a: any) => String(a?.role ?? "").toLowerCase() === "ceo") : null;
          if (ceo2?.id) {
            await apiRequest("DELETE", `/api/agents/${ceo2.id}`);
            queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id, "agents"] });
          }
        } catch {
          warnings.push("Could not remove CEO agent automatically — restart server and try again");
        }
      }
      // Save provider keys (optional) after tenant exists.
      if (useCeoAgent && openRouterApiKey.trim()) {
        try {
          const r = await apiRequest("PUT", `/api/tenants/${tenant.id}/openrouter/api-key`, { apiKey: openRouterApiKey.trim() });
          if (!r.ok) warnings.push("OpenRouter API key could not be saved");
        } catch {
          warnings.push("OpenRouter API key could not be saved");
        }
      }
      if (useCeoAgent && ollamaApiKey.trim()) {
        try {
          const r = await apiRequest("PUT", `/api/tenants/${tenant.id}/ollama/api-key`, { apiKey: ollamaApiKey.trim() });
          if (!r.ok) warnings.push("Ollama API key could not be saved");
        } catch {
          warnings.push("Ollama API key could not be saved");
        }
      }

      const agentsRes = await apiRequest("GET", `/api/tenants/${tenant.id}/agents`);
      const agents = await agentsRes.json();
      if (!agentsRes.ok) throw agents;
      const ceo = Array.isArray(agents) ? agents.find((a: any) => String(a?.role ?? "").toLowerCase() === "ceo") : null;
      if (useCeoAgent && !ceo?.id) warnings.push("CEO agent was not found after creation");

      let task: any = null;
      if (useCeoAgent) {
        const taskRes = await apiRequest("POST", `/api/tenants/${tenant.id}/tasks`, {
          title: taskTitle,
          description: taskDescription,
          status: "todo",
          priority: "medium",
          assignedAgentId: ceo?.id ?? null,
        });
        task = await taskRes.json();
        if (!taskRes.ok) throw task;
      }

      // Preflight: test the CEO environment once so we can surface LLM connectivity issues immediately.
      if (useCeoAgent && ceo?.id) {
        try {
          const testRes = await apiRequest("POST", `/api/tenants/${tenant.id}/agents/${ceo.id}/test-environment`);
          const test = await testRes.json().catch(() => ({}));
          if (!testRes.ok) {
            warnings.push("CEO environment test failed");
          } else if (test?.ok === false) {
            const reason = test?.hermes?.reason ? String(test.hermes.reason) : "unknown";
            warnings.push(`CEO LLM check failed (${reason})`);
          }
        } catch {
          warnings.push("CEO environment test failed");
        }
      }

      return { tenant, task, ceo, warnings };
    },
    onSuccess: ({ tenant, task, warnings }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id, "ceo", "control"] });
      toast({
        title: "Ready",
        description: warnings?.length
          ? `${useCeoAgent && task?.id ? `Created org + starter task (#${task.id}).` : "Created org."} Note: ${warnings.join("; ")}.`
          : `${useCeoAgent && task?.id ? `Created org + starter task (#${task.id}).` : "Created org."}`,
      });
      setActiveTenantId(tenant.id);
      onCreated?.(tenant.id);
      onClose();
      setLocation(useCeoAgent ? "/" : "/tasks");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to launch organization", variant: "destructive" });
    },
  });

  const canNext =
    step === "company"
      ? !!name.trim()
      : step === "agent"
        ? !useCeoAgent
          ? true
          : ceoLlmProvider === "ollama"
            ? !!ollamaBaseUrl.trim() && !!ceoModel.trim() && ollamaDetected.length > 0
            : !!ceoModel.trim()
        : step === "task"
          ? !!taskTitle.trim()
          : true;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !required) onClose();
      }}
    >
      <DialogContent
        className="w-screen h-screen max-w-none p-0 overflow-hidden rounded-none border-0"
        hideClose={!!required}
      >
        <div
          className={cn(
            "h-full grid grid-cols-1",
            step === "company" ? "lg:grid-cols-[1fr_420px]" : "lg:grid-cols-1",
          )}
        >
          <div className="min-w-0 flex flex-col">
            <div className="px-6 pt-5 pb-3 border-b border-border bg-card/20">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {steps.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStepIdx(i)}
                      className={cn(
                        "px-2 py-1 rounded-md transition-colors",
                        i === stepIdx ? "text-foreground bg-muted/50" : "hover:text-foreground hover:bg-muted/30",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 flex">
              {step === "company" && (
                <div className="flex-1 w-full flex items-center justify-center">
                  <div className="max-w-xl mx-auto w-full space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Name your organization</div>
                    <div className="text-xs text-muted-foreground mt-0.5">This is the organization your agents will work for.</div>
                  </div>
                  <div>
                    <Label className="text-xs">Organization name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Mission / goal (optional)</Label>
                    <Input value={mission} onChange={(e) => setMission(e.target.value)} className="mt-1" placeholder="What is this company trying to achieve?" />
                  </div>
                  </div>
                </div>
              )}

              {step === "agent" && (
                <div className="flex-1 w-full flex items-center justify-center">
                  <div className="max-w-2xl mx-auto w-full space-y-5">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Configure the CEO agent</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Optional. If disabled, you can still hire and run other agents normally.
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Agent adapter</Label>
                    <AdapterPickerCards
                      value={adapterType}
                      onChange={(v) => setAdapterType(v as TenantAdapterType)}
                      helperText="All library hires for this org run through the selected adapter."
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-card/20 p-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">Use CEO agent</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Enables the CEO dashboard and auto heartbeats. You can turn this off and use hired agents only.
                      </div>
                    </div>
                    <Switch
                      checked={useCeoAgent}
                      onCheckedChange={(v) => {
                        setUseCeoAgent(!!v);
                        if (!v) {
                          setOllamaDetectError(null);
                          setOllamaDetected([]);
                        }
                      }}
                    />
                  </div>

                  <div className={cn(!useCeoAgent && "opacity-50 pointer-events-none")}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">LLM provider</Label>
                      <Select
                        value={ceoLlmProvider}
                        onValueChange={(v) => {
                          const next = v as any;
                          setCeoLlmProvider(next);
                          if (next === "openrouter" && !openRouterModelIds.has(ceoModel)) {
                            setCeoModel("claude-3-5-sonnet");
                          }
                          if (next === "ollama") {
                            setOllamaDetected([]);
                            if (openRouterModelIds.has(ceoModel)) setCeoModel("");
                          }
                        }}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openrouter">OpenRouter</SelectItem>
                          <SelectItem value="ollama">Ollama</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Model</Label>
                      {ceoLlmProvider === "openrouter" ? (
                        <Select value={ceoModel} onValueChange={setCeoModel}>
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {OPENROUTER_MODELS.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Select value={ceoModel} onValueChange={setCeoModel} disabled={!ollamaDetected.length}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder={ollamaDetected.length ? "Select a model" : "Detect models first"} />
                          </SelectTrigger>
                          <SelectContent>
                            {ollamaDetected.map((id) => (
                              <SelectItem key={id} value={id}>
                                {id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {ceoLlmProvider === "openrouter"
                          ? "Select an OpenRouter model (curated list)."
                          : "Set a base URL, detect models, then pick one."}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className={cn(ceoLlmProvider !== "openrouter" && "opacity-50 pointer-events-none")}>
                      <Label className="text-xs">OpenRouter API key</Label>
                      <Input
                        type="password"
                        value={openRouterApiKey}
                        onChange={(e) => setOpenRouterApiKey(e.target.value)}
                        className="mt-1 font-mono"
                        placeholder="sk-or-…"
                      />
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Saved to this organization (server-side). Optional if already configured elsewhere.
                      </div>
                    </div>
                    <div className={cn(ceoLlmProvider !== "ollama" && "opacity-50 pointer-events-none")}>
                      <Label className="text-xs">Ollama API key</Label>
                      <Input
                        type="password"
                        value={ollamaApiKey}
                        onChange={(e) => setOllamaApiKey(e.target.value)}
                        className="mt-1 font-mono"
                        placeholder="ollama-…"
                      />
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Needed for Ollama cloud models (e.g. <span className="font-mono">:cloud</span>). Stored server-side.
                      </div>
                    </div>
                  </div>

                  {ceoLlmProvider === "ollama" && (
                    <div className="rounded-lg border border-border bg-card/20 p-4 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                        <div>
                          <Label className="text-xs">Ollama base URL</Label>
                          <Input
                            value={ollamaBaseUrl}
                            onChange={(e) => setOllamaBaseUrl(e.target.value)}
                            className="mt-1 font-mono"
                            placeholder="http://127.0.0.1:11434"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={ollamaDetecting || !ollamaBaseUrl.trim()}
                          onClick={async () => {
                            setOllamaDetecting(true);
                            setOllamaDetectError(null);
                            try {
                              const res = await apiRequest("GET", `/api/ollama/models?url=${encodeURIComponent(ollamaBaseUrl.trim())}`);
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) throw new Error(data?.message ?? "Failed to detect models");
                              const models = Array.isArray(data?.models) ? data.models.map(String) : [];
                              setOllamaDetected(models);
                              if (models.length && !models.includes(ceoModel)) setCeoModel(models[0]!);
                            } catch {
                              setOllamaDetected([]);
                              setCeoModel("");
                              setOllamaDetectError("Could not detect models. Check the base URL and ensure `ollama serve` is running.");
                            } finally {
                              setOllamaDetecting(false);
                            }
                          }}
                        >
                          {ollamaDetecting ? "Detecting..." : "Detect models"}
                        </Button>
                      </div>
                      {ollamaDetectError && (
                        <div className="text-xs text-destructive">
                          {ollamaDetectError}
                        </div>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        Example: <span className="font-mono">http://127.0.0.1:11434</span>. Make sure <span className="font-mono">ollama serve</span> is running.
                      </div>
                    </div>
                  )}
                  </div>
                  </div>
                </div>
              )}

              {step === "task" && useCeoAgent && (
                <div className="flex-1 w-full flex items-center justify-center">
                  <div className="max-w-2xl mx-auto w-full space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Give it something to do</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      This creates the first task{useCeoAgent ? " and assigns it to the CEO" : ""}.
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Task title</Label>
                    <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Description (optional)</Label>
                    <Textarea
                      value={taskDescription}
                      onChange={(e) => {
                        taskDescDirtyRef.current = true;
                        setTaskDescription(e.target.value);
                      }}
                      className="mt-1"
                      rows={7}
                    />
                  </div>
                  </div>
                </div>
              )}

              {step === "launch" && (
                <div className="flex-1 w-full flex items-center justify-center">
                  <div className="max-w-2xl mx-auto w-full space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Ready to launch</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Launching will create the organization{useCeoAgent ? ", boot the CEO, and create the starter task." : "."}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card/30 p-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Organization</span>
                      <span className="font-medium text-foreground">{name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Adapter</span>
                      <span className="font-medium text-foreground capitalize">{adapterType.replace("-", " ")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">CEO</span>
                      <span className="font-medium text-foreground">
                        {useCeoAgent ? (
                          <>
                            {ceoLlmProvider} · <span className="font-mono">{ceoModel}</span>
                          </>
                        ) : (
                          "Disabled"
                        )}
                      </span>
                    </div>
                    {useCeoAgent ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Task</span>
                        <span className="font-medium text-foreground truncate max-w-[60%]" title={taskTitle}>
                          {taskTitle}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border bg-card/20 flex items-center justify-end">
              {step !== "launch" ? (
                <Button
                  type="button"
                  onClick={() => canNext && setStepIdx((i) => Math.min(steps.length - 1, i + 1))}
                  disabled={!canNext || create.isPending}
                >
                  Next
                </Button>
              ) : (
                <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>
                  {create.isPending ? "Launching..." : useCeoAgent ? "Create & Open Task" : "Create Organization"}
                </Button>
              )}
            </div>
          </div>

          {/* Right panel (only on the first step) */}
          {step === "company" && (
            <div className="hidden lg:block border-l border-border bg-background/40 relative overflow-hidden">
              <div className="absolute inset-0">
                {/* soft mesh */}
                <div className="absolute inset-0 bg-[radial-gradient(1200px_800px_at_20%_20%,rgba(124,58,237,0.18),transparent_55%),radial-gradient(900px_700px_at_80%_60%,rgba(59,130,246,0.12),transparent_60%),radial-gradient(700px_600px_at_60%_90%,rgba(168,85,247,0.10),transparent_55%)]" />

                <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-primary/15 blur-3xl animate-pulse" />
                <div className="absolute top-1/3 -left-24 w-72 h-72 rounded-full bg-indigo-500/10 blur-3xl animate-pulse [animation-delay:600ms]" />
                <div className="absolute bottom-0 right-0 w-[520px] h-[520px] bg-gradient-to-tr from-primary/5 via-transparent to-primary/10" />

                {/* subtle animated "orbit" */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative w-[520px] h-[520px] opacity-[0.18]">
                    {/* conic glow ring */}
                    <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_90deg,rgba(124,58,237,0.0),rgba(124,58,237,0.55),rgba(59,130,246,0.0),rgba(124,58,237,0.0))] blur-md animate-spin [animation-duration:22s]" />
                    <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full animate-spin [animation-duration:28s]">
                      <defs>
                        <linearGradient id="wizOrbit" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="currentColor" stopOpacity="0.0" />
                          <stop offset="50%" stopColor="currentColor" stopOpacity="0.8" />
                          <stop offset="100%" stopColor="currentColor" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      <circle cx="100" cy="100" r="72" fill="none" stroke="url(#wizOrbit)" strokeWidth="2" />
                    </svg>
                    <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full animate-spin [animation-duration:46s] [animation-direction:reverse]">
                      <circle cx="100" cy="100" r="52" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="2 6" />
                    </svg>
                    <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full animate-spin [animation-duration:64s]">
                      <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="1 10" />
                    </svg>
                  </div>
                </div>

                {/* floating particles */}
                <div className="absolute inset-0">
                  <div className="absolute top-[14%] left-[18%] w-1.5 h-1.5 rounded-full bg-primary/60 animate-ping [animation-duration:3.2s]" />
                  <div className="absolute top-[28%] left-[62%] w-1 h-1 rounded-full bg-indigo-400/60 animate-ping [animation-duration:4.6s]" />
                  <div className="absolute top-[46%] left-[76%] w-1.5 h-1.5 rounded-full bg-primary/50 animate-ping [animation-duration:5.4s]" />
                  <div className="absolute top-[66%] left-[30%] w-1 h-1 rounded-full bg-indigo-400/50 animate-ping [animation-duration:4.0s]" />
                  <div className="absolute top-[78%] left-[70%] w-1.5 h-1.5 rounded-full bg-primary/40 animate-ping [animation-duration:6.0s]" />
                </div>

                {/* subtle scanlines */}
                <div className="absolute inset-0 opacity-[0.06] bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,0.6),rgba(255,255,255,0.6)_1px,transparent_1px,transparent_7px)]" />
              </div>
              {/* Accent-only (no text) */}
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 opacity-70">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:120ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:240ms]" />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

