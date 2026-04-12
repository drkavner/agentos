import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AgentDefinition, Team, Tenant } from "@shared/schema";
import { ACTIVE_TENANT_ID } from "./AppShell";
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
import { Check, ChevronRight, Bot, Cpu, Target, Users, DollarSign } from "lucide-react";

const MODELS = [
  { id: "claude-opus-4", label: "Claude Opus 4", desc: "Most capable, best reasoning", cost: "~$0.015/1k tokens" },
  { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", desc: "Fast, smart, balanced", cost: "~$0.003/1k tokens" },
  { id: "gpt-4o", label: "GPT-4o", desc: "OpenAI flagship", cost: "~$0.005/1k tokens" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", desc: "Fast, cheap", cost: "~$0.00015/1k tokens" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", desc: "Google, very fast", cost: "~$0.0001/1k tokens" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Google's best", cost: "~$0.007/1k tokens" },
];

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
  const tid = ACTIVE_TENANT_ID;
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
  const [monthlyBudget, setMonthlyBudget] = useState(100);
  const [heartbeat, setHeartbeat] = useState("*/30 * * * *");
  const [teamId, setTeamId] = useState<string>("");
  const [managerId, setManagerId] = useState<string>("");

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
      if (teamId) {
        await apiRequest("POST", `/api/teams/${teamId}/members`, { agentId: newAgent.id });
      }
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
    setGoal(""); setModel("claude-3-5-sonnet"); setMonthlyBudget(100);
    setHeartbeat("*/30 * * * *"); setTeamId(""); setManagerId(""); setSearchTerm("");
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

  const selectedModel = MODELS.find(m => m.id === model);

  function handleHire() {
    hire.mutate({
      definitionId: selectedDef!.id,
      displayName,
      role,
      goal,
      model,
      monthlyBudget,
      heartbeatSchedule: heartbeat,
      managerId: managerId ? Number(managerId) : null,
      status: "idle",
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); resetForm(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            Hire an Agent
          </DialogTitle>
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
                <Label className="text-xs mb-2 block">LLM Model</Label>
                <div className="grid grid-cols-1 gap-2">
                  {MODELS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border text-left transition-all",
                        model === m.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
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
                    <SelectItem value="">No manager (top-level)</SelectItem>
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
                    { icon: Target, label: "Goal", value: goal || "No goal set" },
                    { icon: Cpu, label: "Model", value: selectedModel?.label ?? model },
                    { icon: DollarSign, label: "Budget", value: `$${monthlyBudget}/month` },
                    { icon: Bot, label: "Heartbeat", value: HEARTBEATS.find(h => h.value === heartbeat)?.label ?? heartbeat },
                    { icon: Users, label: "Team", value: teams.find(t => String(t.id) === teamId)?.name ?? "Independent" },
                    { icon: Users, label: "Reports to", value: agents.find((a: any) => String(a.id) === managerId)?.displayName ?? "Top-level" },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-3">
                      <item.icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="text-sm text-foreground">{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
                <span>Agent slots used after hire</span>
                <span className={cn(
                  "font-semibold tabular-nums",
                  agents.length + 1 >= (tenant?.maxAgents ?? 25) ? "text-orange-400" : "text-foreground"
                )}>
                  {agents.length + 1} / {tenant?.maxAgents ?? 25}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                The agent will start in <strong>idle</strong> status. Hit "Start" on the My Agents page to activate it.
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
              onClick={handleHire}
              disabled={hire.isPending}
              data-testid="wizard-hire"
            >
              {hire.isPending ? "Hiring..." : `Hire ${displayName || "Agent"}`}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
