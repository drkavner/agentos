import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, readJsonOrApiHint } from "@/lib/queryClient";
import type { AgentDefinition, Team, Tenant } from "@shared/schema";
import { TENANT_ADAPTER_LABELS, type TenantAdapterType } from "@shared/schema";
import { useTenantContext } from "@/tenant/TenantContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Check, ChevronRight, Bot, Cpu, Target, Users, DollarSign, Globe, Terminal } from "lucide-react";
import { AdapterIcon } from "./AdapterIcons";
import { OPENROUTER_MODELS } from "@/lib/openrouterModels";
import { Switch } from "@/components/ui/switch";

const MODELS = OPENROUTER_MODELS;

// Radix Select does not support empty-string item values; using a sentinel avoids a runtime crash when the "Assign Team" step mounts.
const NO_MANAGER_VALUE = "__no_manager__";

const HEARTBEATS = [
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */4 * * *", label: "Every 4 hours" },
  { value: "0 9 * * 1-5", label: "Weekdays at 9am" },
  { value: "0 9 * * *", label: "Daily at 9am" },
];

const STEPS = [
  { id: "pick", label: "Choose Agent", icon: Bot },
  { id: "configure", label: "Configure", icon: Target },
  { id: "model", label: "Model & Budget", icon: Cpu },
  { id: "team", label: "Assign Team", icon: Users },
  { id: "review", label: "Review & Hire", icon: Check },
];

interface HireAgentWizardProps {
  open: boolean;
  onClose: () => void;
  preselectedDef?: AgentDefinition | null;
}

export function HireAgentWizard({ open, onClose, preselectedDef }: HireAgentWizardProps) {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const { toast } = useToast();

  const [step, setStep] = useState(preselectedDef ? 1 : 0);
  const [selectedDef, setSelectedDef] = useState<AgentDefinition | null>(preselectedDef ?? null);
  const [divisionFilter, setDivisionFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");

  // Form state
  const [displayName, setDisplayName] = useState(preselectedDef?.name ?? "");
  const [role, setRole] = useState("");
  const [goal, setGoal] = useState("");
  const [model, setModel] = useState("claude-3-5-sonnet");
  /** Where the model id is executed: OpenRouter (cloud) or local Ollama. */
  const [llmProvider, setLlmProvider] = useState<"openrouter" | "ollama">("openrouter");
  const [monthlyBudget, setMonthlyBudget] = useState(100);
  const [heartbeat, setHeartbeat] = useState("*/30 * * * *");
  const [teamId, setTeamId] = useState<string>("");
  const [managerId, setManagerId] = useState<string>(NO_MANAGER_VALUE);
  const [quantity, setQuantity] = useState(1);

  // Per-agent adapter override
  const [agentAdapter, setAgentAdapter] = useState<TenantAdapterType>("hermes");
  const [command, setCommand] = useState("");

  const ADAPTER_CMD_MAP: Record<string, { backend: string; cmd: string }> = {
    hermes: { backend: "hermes", cmd: "" },
    "claude-code": { backend: "cli", cmd: "claude" },
    codex: { backend: "cli", cmd: "codex" },
    "gemini-cli": { backend: "cli", cmd: "gemini" },
    opencode: { backend: "cli", cmd: "opencode" },
    cursor: { backend: "cli", cmd: "cursor" },
    openclaw: { backend: "openclaw", cmd: "" },
  };

  const { data: defs = [] } = useQuery<AgentDefinition[]>({
    queryKey: ["/api/agent-definitions"],
    queryFn: () => apiRequest("GET", "/api/agent-definitions").then(r => r.json()),
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/tenants", tid, "teams"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/teams`).then(r => r.json()),
    enabled: open,
  });

  const { data: agents = [] } = useQuery<any[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then(r => r.json()),
    enabled: open,
  });

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["/api/tenants", tid],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}`).then(r => r.json()),
    enabled: open,
  });

  const { data: ollamaModelsRes, isLoading: ollamaModelsLoading, isError: ollamaModelsError } = useQuery<{
    baseUsed: string;
    models: string[];
  }>({
    queryKey: ["/api/tenants", tid, "ollama", "models", tenant?.ollamaBaseUrl ?? ""],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ollama/models`).then((r) => readJsonOrApiHint(r)),
    enabled: open && tid > 0 && llmProvider === "ollama",
    retry: false,
  });

  // Sync adapter from tenant on load
  useEffect(() => {
    if (!tenant) return;
    const tAdapter = tenant.adapterType as TenantAdapterType;
    if (tAdapter && TENANT_ADAPTER_LABELS[tAdapter]) {
      setAgentAdapter(tAdapter);
      const mapped = ADAPTER_CMD_MAP[tAdapter];
      if (mapped) setCommand(mapped.cmd);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.adapterType]);

  // Auto-default manager to CEO so new hires appear in the org tree
  useEffect(() => {
    if (managerId !== NO_MANAGER_VALUE) return;
    const ceo = agents.find((a: any) => a.role === "CEO" || (!a.managerId && agents.length > 1));
    if (ceo) setManagerId(String(ceo.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  useEffect(() => {
    if (llmProvider !== "ollama") return;
    const list = ollamaModelsRes?.models;
    if (!list?.length) return;
    if (!list.includes(model)) setModel(list[0]!);
  }, [llmProvider, ollamaModelsRes?.models, model]);

  useEffect(() => {
    if (llmProvider !== "openrouter") return;
    if (!MODELS.some((m) => m.id === model)) setModel("claude-3-5-sonnet");
  }, [llmProvider, model]);

  const hire = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/tenants/${tid}/agents`, data);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw err;
      }
      return res.json();
    },
    onSuccess: async (newAgent) => {
      if (teamId) await apiRequest("POST", `/api/teams/${teamId}/members`, { agentId: newAgent.id });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "teams"] });
      toast({ title: `${displayName} hired!`, description: `${role} is ready to start working.` });
      onClose();
      resetForm();
    },
    onError: (err: any) => {
      if (err?.error === "agent_limit_reached") {
        toast({
          title: "Agent limit reached",
          description: `Your org is capped at ${err.limit} agents (${err.current} deployed). Raise the limit in Settings → Organization.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: "Failed to hire agent", variant: "destructive" });
      }
    },
  });

  function resetForm() {
    setStep(0); setSelectedDef(null); setDisplayName(""); setRole("");
    setGoal(""); setModel("claude-3-5-sonnet"); setLlmProvider("openrouter"); setMonthlyBudget(100);
    setHeartbeat("*/30 * * * *"); setTeamId(""); setManagerId(NO_MANAGER_VALUE); setSearchTerm("");
    setQuantity(1);
    const tAdapter = (tenant?.adapterType ?? "hermes") as TenantAdapterType;
    setAgentAdapter(tAdapter);
    setCommand(ADAPTER_CMD_MAP[tAdapter]?.cmd ?? "");
  }

  function selectDef(def: AgentDefinition) {
    setSelectedDef(def);
    setDisplayName(def.name);
    setStep(1);
  }

  const divisions = ["All", ...Array.from(new Set(defs.map(d => d.division))).sort()];

  const filteredDefs = defs.filter(d => {
    const matchDiv = divisionFilter === "All" || d.division === divisionFilter;
    const matchSearch = !searchTerm ||
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.specialty.toLowerCase().includes(searchTerm.toLowerCase());
    return matchDiv && matchSearch;
  });

  const modelReviewLabel =
    llmProvider === "openrouter" ? (MODELS.find((m) => m.id === model)?.label ?? model) : model;
  const modelReviewCost =
    llmProvider === "openrouter" ? (MODELS.find((m) => m.id === model)?.cost ?? "") : "Local · $0";

  async function handleHireMany() {
    const created: any[] = [];
    for (let i = 0; i < Math.max(1, Math.min(2, quantity)); i++) {
      const suffix = i === 0 ? "" : ` ${i + 1}`;
      const mapped = ADAPTER_CMD_MAP[agentAdapter] ?? { backend: "hermes", cmd: "" };
      const payload = {
        definitionId: selectedDef!.id,
        displayName: `${displayName}${suffix}`.trim(),
        role,
        goal,
        model,
        llmProvider,
        adapterType: mapped.backend,
        command: command || mapped.cmd,
        runtimeModel: model,
        monthlyBudget,
        heartbeatSchedule: heartbeat,
        managerId: managerId && managerId !== NO_MANAGER_VALUE ? Number(managerId) : null,
        status: "running",
      };
      // eslint-disable-next-line no-await-in-loop
      const a = await hire.mutateAsync(payload);
      created.push(a);
      if (teamId) {
        // eslint-disable-next-line no-await-in-loop
        await apiRequest("POST", `/api/teams/${teamId}/members`, { agentId: a.id });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "teams"] });
    toast({
      title: `Hired ${created.length} agent${created.length === 1 ? "" : "s"}`,
      description: "They are ready to start working.",
    });
    onClose();
    resetForm();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); resetForm(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            Hire an Agent
          </DialogTitle>
          {tenant && (
            <p className="text-xs text-muted-foreground pt-1">
              Execution adapter:{" "}
              <span className="text-foreground font-medium">
                {TENANT_ADAPTER_LABELS[agentAdapter] ?? agentAdapter}
              </span>
            </p>
          )}
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <div key={s.id} className="flex items-center gap-1 flex-1">
                <div className={cn(
                  "flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-all",
                  done ? "text-green-400" : active ? "text-primary bg-primary/10" : "text-muted-foreground"
                )}>
                  {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                  <span className="hidden sm:block">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* STEP 0: Pick agent from library */}
          {step === 0 && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Search agents..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="flex-1"
                  data-testid="wizard-search"
                />
                <Select value={divisionFilter} onValueChange={setDivisionFilter}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {divisions.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                {filteredDefs.map(def => (
                  <button
                    key={def.id}
                    onClick={() => selectDef(def)}
                    className={cn(
                      "flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all hover:border-primary/60 hover:bg-primary/5",
                      selectedDef?.id === def.id ? "border-primary bg-primary/10" : "border-border bg-card"
                    )}
                    data-testid={`wizard-pick-${def.id}`}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                      style={{ backgroundColor: `${def.color}20` }}>
                      {def.emoji}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{def.name}</p>
                      <p className="text-xs text-muted-foreground" style={{ color: def.color }}>{def.division}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-tight">{def.specialty}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 1: Configure */}
          {step === 1 && selectedDef && (
            <div className="space-y-4">
              {/* Selected agent preview */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-2xl"
                  style={{ backgroundColor: `${selectedDef.color}20` }}>
                  {selectedDef.emoji}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{selectedDef.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedDef.description}</p>
                </div>
                <button onClick={() => setStep(0)} className="ml-auto text-xs text-primary hover:underline">Change</button>
              </div>

              {/* Adapter picker */}
              <div className="space-y-2">
                <Label className="text-xs">Adapter</Label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {(Object.entries(TENANT_ADAPTER_LABELS) as [TenantAdapterType, string][]).map(([id, label]) => {
                    const active = agentAdapter === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setAgentAdapter(id);
                          const mapped = ADAPTER_CMD_MAP[id];
                          if (mapped) setCommand(mapped.cmd);
                        }}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2.5 rounded-lg border text-center transition-all text-xs",
                          active
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5",
                        )}
                      >
                        <AdapterIcon adapter={id} className="w-4 h-4" />
                        <span className="font-medium leading-tight">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Display Name <span className="text-muted-foreground">(what to call this agent)</span></Label>
                  <Input
                    className="mt-1"
                    placeholder={`e.g. ${selectedDef.name.split(" ")[0]}, Alex, Nova...`}
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    data-testid="wizard-name"
                  />
                </div>
                <div>
                  <Label className="text-xs">Job Title / Role</Label>
                  <Input
                    className="mt-1"
                    placeholder={`e.g. Head of Engineering, Senior ${selectedDef.name}...`}
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    data-testid="wizard-role"
                  />
                </div>
                <div>
                  <Label className="text-xs">Quantity</Label>
                  <Select value={String(quantity)} onValueChange={(v) => setQuantity(v === "2" ? 2 : 1)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2 (double)</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    If you pick 2, we’ll hire two copies (names get a “2” suffix).
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Goal <span className="text-muted-foreground">(what should this agent achieve?)</span></Label>
                  <Textarea
                    className="mt-1"
                    rows={3}
                    placeholder={`e.g. Build and ship the v2 product on time. Ship 20 content pieces per month. Close $100K in Q2 pipeline...`}
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    data-testid="wizard-goal"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Model & Budget */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs mb-2 block">LLM provider</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: "openrouter" as const, title: "OpenRouter", desc: "Cloud — one API key on the server" },
                      { id: "ollama" as const, title: "Ollama", desc: "Local — base URL in Settings → Organization" },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setLlmProvider(p.id)}
                      className={cn(
                        "flex flex-col items-start p-3 rounded-lg border text-left transition-all",
                        llmProvider === p.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
                      )}
                      data-testid={`wizard-llm-${p.id}`}
                    >
                      <p className="text-sm font-medium text-foreground">{p.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                      {llmProvider === p.id && <Check className="w-4 h-4 text-primary mt-2 self-end" />}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {llmProvider === "openrouter"
                    ? "Pick a model id OpenRouter accepts."
                    : "Models are loaded live from your Ollama instance (Settings → Organization)."}
                </p>
              </div>
              <div>
                <Label className="text-xs mb-2 block">LLM Model</Label>
                {llmProvider === "openrouter" ? (
                  <div className="grid grid-cols-1 gap-2">
                    {MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModel(m.id)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-lg border text-left transition-all",
                          model === m.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
                        )}
                        data-testid={`model-${m.id}`}
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">{m.label}</p>
                          <p className="text-xs text-muted-foreground">{m.desc}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">{m.cost}</span>
                          {model === m.id && <Check className="w-4 h-4 text-primary" />}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {ollamaModelsLoading ? (
                      <p className="text-xs text-muted-foreground py-4 text-center">Loading models from Ollama…</p>
                    ) : ollamaModelsError ? (
                      <p className="text-xs text-destructive py-2">
                        Could not list models. Save your Ollama URL in Settings, ensure <span className="font-mono">ollama serve</span> is running, then reopen this step.
                      </p>
                    ) : (ollamaModelsRes?.models?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        No models found at{" "}
                        <span className="font-mono text-foreground">{ollamaModelsRes?.baseUsed ?? "—"}</span>. Pull one with{" "}
                        <span className="font-mono">ollama pull llama3</span> (or open Settings → Detect models).
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 max-h-[min(50vh,320px)] overflow-y-auto pr-1">
                        {ollamaModelsRes!.models.map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setModel(id)}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-lg border text-left transition-all",
                              model === id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
                            )}
                            data-testid={`model-ollama-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground font-mono truncate" title={id}>
                                {id}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Ollama · {ollamaModelsRes?.baseUsed ?? ""}
                              </p>
                            </div>
                            {model === id && <Check className="w-4 h-4 text-primary shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Monthly Budget ($)</Label>
                  <Input
                    type="number"
                    className="mt-1"
                    min={1}
                    max={tenant?.monthlyBudget ?? 500}
                    value={monthlyBudget}
                    onChange={e => setMonthlyBudget(Number(e.target.value))}
                    data-testid="wizard-budget"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Org budget: ${tenant?.monthlyBudget ?? "—"}/mo
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Heartbeat Schedule</Label>
                  <Select value={heartbeat} onValueChange={setHeartbeat}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HEARTBEATS.map(h => (
                        <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">How often the agent wakes up</p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Team assignment */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs mb-2 block">Assign to Team <span className="text-muted-foreground">(optional)</span></Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setTeamId("")}
                    className={cn(
                      "p-3 rounded-lg border text-left text-sm transition-all",
                      !teamId ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    No team (independent)
                  </button>
                  {teams.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTeamId(String(t.id))}
                      className={cn(
                        "flex items-center gap-2 p-3 rounded-lg border text-left transition-all",
                        teamId === String(t.id) ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                      )}
                      data-testid={`wizard-team-${t.id}`}
                    >
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                      <div>
                        <p className="text-sm font-medium text-foreground">{t.name}</p>
                        {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                      </div>
                      {teamId === String(t.id) && <Check className="w-4 h-4 text-primary ml-auto" />}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs mb-2 block">Reports to <span className="text-muted-foreground">(optional manager)</span></Label>
                <Select value={managerId} onValueChange={setManagerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No manager (top-level)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_MANAGER_VALUE}>No manager (top-level)</SelectItem>
                    {agents.map((a: any) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.displayName} — {a.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* STEP 4: Review */}
          {step === 4 && selectedDef && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center gap-3 p-4 bg-primary/5 border-b border-border">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                    style={{ backgroundColor: `${selectedDef.color}20` }}>
                    {selectedDef.emoji}
                  </div>
                  <div>
                    <p className="text-base font-bold text-foreground">{displayName || selectedDef.name}</p>
                    <p className="text-sm text-muted-foreground">{role || selectedDef.division}</p>
                  </div>
                  <Badge variant="outline" className="ml-auto" style={{ color: selectedDef.color }}>
                    {selectedDef.division}
                  </Badge>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { icon: Terminal, label: "Adapter", value: TENANT_ADAPTER_LABELS[agentAdapter] ?? agentAdapter },
                    { icon: Target, label: "Goal", value: goal || "No goal set" },
                    {
                      icon: Globe,
                      label: "LLM provider",
                      value: llmProvider === "openrouter" ? "OpenRouter" : "Ollama",
                    },
                    {
                      icon: Cpu,
                      label: "Model",
                      value:
                        llmProvider === "ollama"
                          ? [model, ollamaModelsRes?.baseUsed ? `Base: ${ollamaModelsRes.baseUsed}` : null]
                              .filter(Boolean)
                              .join("\n")
                          : `${modelReviewLabel} · ${modelReviewCost}`,
                    },
                    { icon: DollarSign, label: "Budget", value: `$${monthlyBudget}/month` },
                    { icon: Bot, label: "Quantity", value: String(quantity) },
                    { icon: Bot, label: "Heartbeat", value: HEARTBEATS.find(h => h.value === heartbeat)?.label ?? heartbeat },
                    { icon: Users, label: "Team", value: teams.find(t => String(t.id) === teamId)?.name ?? "Independent" },
                    { icon: Users, label: "Reports to", value: agents.find((a: any) => String(a.id) === managerId)?.displayName ?? "Top-level" },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-3">
                      <item.icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="text-sm text-foreground whitespace-pre-line">{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
                <span>Agent slots used after hire</span>
                <span className={cn(
                  "font-semibold tabular-nums",
                  agents.length + quantity >= (tenant?.maxAgents ?? 25) ? "text-orange-400" : "text-foreground"
                )}>
                  {agents.length + quantity} / {tenant?.maxAgents ?? 25}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Hired agents start in <strong>running</strong> status so they can respond immediately.
              </p>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => step === 0 ? (onClose(), resetForm()) : setStep(s => s - 1)}
            data-testid="wizard-back"
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>

          {step < 4 ? (
            <Button
              size="sm"
              onClick={() => setStep(s => s + 1)}
              disabled={
                (step === 0 && !selectedDef) ||
                (step === 1 && (!displayName.trim() || !role.trim()))
              }
              data-testid="wizard-next"
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void handleHireMany()}
              disabled={hire.isPending}
              data-testid="wizard-hire"
            >
              {hire.isPending ? "Hiring..." : `Hire ${quantity} ${displayName || "Agent"}${quantity === 1 ? "" : "s"}`}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
