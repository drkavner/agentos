import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, readJsonOrApiHint } from "@/lib/queryClient";
import { useTenantContext } from "@/tenant/TenantContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Bot, ChevronRight, Sparkles,
} from "lucide-react";
import { AdapterIcon } from "./AdapterIcons";
import { EmojiPicker } from "./EmojiPicker";
import { OPENROUTER_MODELS } from "@/lib/openrouterModels";
import type { Tenant } from "@shared/schema";

// ─── Adapter types matching Paperclip's picker ────────────────────────────────
const ADAPTER_TYPES = [
  { id: "hermes", label: "Hermes Agent", desc: "Local multi-provider agent", recommended: false },
  { id: "claude-code", label: "Claude Code", desc: "Local Claude agent", recommended: false },
  { id: "codex", label: "Codex", desc: "Local Codex agent", recommended: false },
  { id: "gemini-cli", label: "Gemini CLI", desc: "Local Gemini agent", recommended: false },
  { id: "opencode", label: "OpenCode", desc: "Local multi-provider agent", recommended: false },
  { id: "cursor", label: "Cursor", desc: "Local Cursor agent", recommended: false },
  { id: "openclaw", label: "OpenClaw Gateway", desc: "Invoke OpenClaw via gateway protocol", recommended: false },
] as const;

type AdapterId = (typeof ADAPTER_TYPES)[number]["id"];

const HEARTBEATS = [
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */4 * * *", label: "Every 4 hours" },
];

const THINKING_EFFORT = ["auto", "low", "medium", "high"] as const;

type Step = "choose" | "ceo-task" | "adapter" | "config" | "review";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AddAgentDialog({ open, onClose }: Props) {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("choose");

  // CEO task path
  const [ceoDescription, setCeoDescription] = useState("");

  // Advanced config path
  const [adapterType, setAdapterType] = useState<AdapterId>("hermes");
  const [agentName, setAgentName] = useState("");
  const [agentTitle, setAgentTitle] = useState("");
  const [promptTemplate, setPromptTemplate] = useState(
    "You are agent {{ agent.name }}. Your role is {{ agent.role }}...",
  );
  const [instructionsFile, setInstructionsFile] = useState("");
  const [command, setCommand] = useState("hermes");
  const [model, setModel] = useState("");
  const [llmProvider, setLlmProvider] = useState<"openrouter" | "ollama">("openrouter");
  const [thinkingEffort, setThinkingEffort] = useState("auto");
  const [extraArgs, setExtraArgs] = useState("");
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [heartbeatSchedule, setHeartbeatSchedule] = useState("*/30 * * * *");
  const [monthlyBudget, setMonthlyBudget] = useState(100);
  const [reportsTo, setReportsTo] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [division, setDivision] = useState("Custom");
  const [emoji, setEmoji] = useState("🤖");

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["/api/tenants", tid],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}`).then((r) => r.json()),
    enabled: tid > 0 && open,
  });

  const { data: agents = [] } = useQuery<any[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then((r) => r.json()),
    enabled: tid > 0 && open,
  });

  const ceoAgent = useMemo(
    () => agents.find((a) => String(a.role).toLowerCase() === "ceo"),
    [agents],
  );

  const { data: ollamaModelsRes } = useQuery<{ models: string[] }>({
    queryKey: ["/api/tenants", tid, "ollama", "models"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ollama/models`).then((r) => readJsonOrApiHint(r)),
    enabled: open && tid > 0 && llmProvider === "ollama",
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setCeoDescription("");
    setAgentName("");
    setAgentTitle("");
    setModel("");
    setAdapterType("hermes");
  }, [open]);

  // Update command when adapter changes
  useEffect(() => {
    const cmds: Record<string, string> = {
      hermes: "hermes",
      "claude-code": "claude",
      codex: "codex",
      "gemini-cli": "gemini",
      opencode: "opencode",
      cursor: "cursor",
      openclaw: "openclaw",
    };
    setCommand(cmds[adapterType] ?? "hermes");
  }, [adapterType]);

  // ─── CEO task mutation ────────────────────────────────────────────────
  const createCeoTask = useMutation({
    mutationFn: async () => {
      if (!ceoAgent) throw new Error("No CEO agent");
      const res = await apiRequest("POST", `/api/tenants/${tid}/tasks`, {
        title: "Create a new agent",
        description: ceoDescription,
        status: "todo",
        priority: "medium",
        assignedAgentId: ceoAgent.id,
      });
      if (!res.ok) throw await res.json();
      return res.json();
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] });
      toast({ title: "Task created", description: `CEO will handle agent creation (task #${task.id}).` });
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create task", variant: "destructive" });
    },
  });

  // ─── Advanced create mutation ─────────────────────────────────────────
  const createAgent = useMutation({
    mutationFn: async () => {
      // 1. Create agent definition in library
      const defRes = await apiRequest("POST", "/api/agent-definitions", {
        name: agentName,
        emoji,
        division,
        specialty,
        description: agentTitle,
        whenToUse: specialty,
        source: "custom",
        color: "#6366f1",
      });
      if (!defRes.ok) throw await defRes.json();
      const def = await defRes.json();

      // Map UI adapter IDs to backend adapter types
      const adapterMap: Record<string, string> = {
        hermes: "hermes",
        "claude-code": "cli",
        codex: "cli",
        "gemini-cli": "cli",
        opencode: "cli",
        cursor: "cli",
        openclaw: "openclaw",
      };

      // 2. Create the agent instance with adapter settings
      const agentRes = await apiRequest("POST", `/api/tenants/${tid}/agents`, {
        definitionId: def.id,
        displayName: agentName,
        role: agentTitle || agentName,
        model: model || "claude-3-5-sonnet",
        llmProvider,
        adapterType: adapterMap[adapterType] ?? "hermes",
        command,
        runtimeModel: model,
        thinkingEffort,
        extraArgs,
        heartbeatEnabled,
        monthlyBudget,
        status: "running",
        heartbeatSchedule: heartbeatEnabled ? heartbeatSchedule : "0 9 * * *",
        managerId: reportsTo ? Number(reportsTo) : null,
        goal: promptTemplate,
      });
      if (!agentRes.ok) throw await agentRes.json();
      return agentRes.json();
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-definitions"] });
      toast({ title: `${agentName} created!`, description: `Agent is ready and saved to the library.` });
      onClose();
    },
    onError: (err: any) => {
      if (err?.error === "agent_limit_reached") {
        toast({
          title: "Agent limit reached",
          description: `Your org is capped at ${err.limit} agents.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: "Failed to create agent", variant: "destructive" });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            Add a new agent
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* ─── Step: Choose path ─── */}
          {step === "choose" && (
            <div className="flex flex-col items-center gap-6 py-8 px-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
                We recommend letting your CEO handle agent setup — they know the org structure and can configure
                reporting, permissions, and adapters.
              </p>

              <Button
                variant="outline"
                className="w-full max-w-sm h-auto py-3 justify-start gap-3"
                disabled={!ceoAgent}
                onClick={() => setStep("ceo-task")}
              >
                <Bot className="w-5 h-5 text-muted-foreground shrink-0" />
                <span>Ask the CEO to create a new agent</span>
              </Button>

              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
                onClick={() => setStep("adapter")}
              >
                I want advanced configuration myself
              </button>
            </div>
          )}

          {/* ─── Step: CEO task ─── */}
          {step === "ceo-task" && (
            <div className="space-y-4 py-4">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setStep("choose")}
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              <div>
                <h3 className="text-sm font-semibold">Create a new agent</h3>
                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <span>For</span>
                  <Badge variant="outline" className="gap-1">
                    <Bot className="w-3 h-3" /> CEO
                  </Badge>
                  <span>in</span>
                  <Badge variant="outline">{tenant?.name ?? "Project"}</Badge>
                </div>
              </div>

              <div>
                <Textarea
                  placeholder="(type in what kind of agent you want here)"
                  value={ceoDescription}
                  onChange={(e) => setCeoDescription(e.target.value)}
                  rows={5}
                  className="resize-none"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-xs gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" /> Todo
                  </Badge>
                  <span className="text-muted-foreground/50">—</span>
                  <span>Priority</span>
                </div>
                <Button
                  onClick={() => createCeoTask.mutate()}
                  disabled={!ceoDescription.trim() || createCeoTask.isPending}
                >
                  {createCeoTask.isPending ? "Creating..." : "Create Issue"}
                </Button>
              </div>
            </div>
          )}

          {/* ─── Step: Adapter picker ─── */}
          {step === "adapter" && (
            <div className="space-y-4 py-4">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setStep("choose")}
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              <p className="text-sm text-muted-foreground">Choose your adapter type for advanced setup.</p>

              <div className="grid grid-cols-2 gap-3">
                {ADAPTER_TYPES.map((a) => {
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setAdapterType(a.id);
                        setStep("config");
                      }}
                      className={cn(
                        "relative flex flex-col items-center gap-2 p-4 rounded-lg border text-center transition-all",
                        "hover:border-primary/60 hover:bg-primary/5",
                        "border-border bg-card",
                      )}
                    >
                      {a.recommended && (
                        <Badge className="absolute -top-2 right-2 bg-green-500 text-white text-[10px] px-1.5 py-0">
                          Recommended
                        </Badge>
                      )}
                      <AdapterIcon adapter={a.id} className="w-6 h-6 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{a.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── Step: Advanced config ─── */}
          {step === "config" && (
            <div className="space-y-5 py-4">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setStep("adapter")}
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold">New Agent</h3>
                  <p className="text-xs text-muted-foreground">Advanced agent configuration</p>
                </div>
                <Badge variant="outline">
                  {ADAPTER_TYPES.find((a) => a.id === adapterType)?.label ?? adapterType}
                </Badge>
              </div>

              {/* Agent identity */}
              <div className="space-y-3">
                <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
                  <div>
                    <Label className="text-xs">Emoji</Label>
                    <div className="mt-1">
                      <EmojiPicker value={emoji} onChange={setEmoji} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Agent name</Label>
                    <Input
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      className="mt-1"
                      placeholder="e.g. VP of Engineering"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Title / Role</Label>
                  <Input
                    value={agentTitle}
                    onChange={(e) => setAgentTitle(e.target.value)}
                    className="mt-1"
                    placeholder="e.g. VP of Engineering"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Division</Label>
                    <Select value={division} onValueChange={setDivision}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Custom", "Engineering", "Design", "Marketing", "Sales", "Product", "Finance", "Support", "Specialized"].map((d) => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Specialty</Label>
                    <Input
                      value={specialty}
                      onChange={(e) => setSpecialty(e.target.value)}
                      className="mt-1"
                      placeholder="e.g. React, Node.js, APIs"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Reports to</Label>
                  <Select value={reportsTo} onValueChange={setReportsTo}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="No manager (top-level)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No manager (top-level)</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.displayName} — {a.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Adapter section */}
              <div className="space-y-3 border-t border-border pt-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Adapter</h4>

                <div>
                  <Label className="text-xs">Adapter type</Label>
                  <Select value={adapterType} onValueChange={(v) => setAdapterType(v as AdapterId)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ADAPTER_TYPES.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Prompt Template</Label>
                  <Textarea
                    value={promptTemplate}
                    onChange={(e) => setPromptTemplate(e.target.value)}
                    className="mt-1 font-mono text-xs"
                    rows={3}
                  />
                  <div className="mt-1.5 text-[11px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                    Prompt template is replayed on every heartbeat. Prefer small task framing and variables like{" "}
                    <code className="font-mono">{"{{ context.* }}"}</code> or <code className="font-mono">{"{{ run.* }}"}</code>;
                    avoid repeating stable instructions here.
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Agent instructions file</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      value={instructionsFile}
                      onChange={(e) => setInstructionsFile(e.target.value)}
                      placeholder="/absolute/path/to/AGENTS.md"
                      className="font-mono text-xs flex-1"
                    />
                    <Button variant="outline" size="sm" type="button">Choose</Button>
                  </div>
                </div>
              </div>

              {/* Permissions & Configuration */}
              <div className="space-y-3 border-t border-border pt-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Permissions & Configuration</h4>

                <div>
                  <Label className="text-xs">Command</Label>
                  <Input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    className="mt-1 font-mono text-xs"
                    placeholder="hermes"
                  />
                </div>

                <div>
                  <Label className="text-xs">Model</Label>
                  {llmProvider === "openrouter" ? (
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select model (required)" /></SelectTrigger>
                      <SelectContent>
                        {OPENROUTER_MODELS.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.label} — {m.cost}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select model" /></SelectTrigger>
                      <SelectContent>
                        {(ollamaModelsRes?.models ?? []).map((id) => (
                          <SelectItem key={id} value={id}>{id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div>
                  <Label className="text-xs">Thinking effort</Label>
                  <Select value={thinkingEffort} onValueChange={setThinkingEffort}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {THINKING_EFFORT.map((t) => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Extra args (comma-separated)</Label>
                  <Input
                    value={extraArgs}
                    onChange={(e) => setExtraArgs(e.target.value)}
                    className="mt-1 font-mono text-xs"
                    placeholder="e.g. --verbose, --foo=bar"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Environment variables</Label>
                  {envVars.map((ev, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                      <Input
                        value={ev.key}
                        onChange={(e) => {
                          const next = [...envVars];
                          next[i] = { ...ev, key: e.target.value };
                          setEnvVars(next);
                        }}
                        className="font-mono text-xs"
                        placeholder="KEY"
                      />
                      <Badge variant="outline" className="text-[10px]">Plain</Badge>
                      <Input
                        value={ev.value}
                        onChange={(e) => {
                          const next = [...envVars];
                          next[i] = { ...ev, value: e.target.value };
                          setEnvVars(next);
                        }}
                        className="font-mono text-xs"
                        placeholder="value"
                      />
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground">
                    PAPERCLIP.* variables are injected automatically at runtime.
                  </p>
                </div>

                <div>
                  <Label className="text-xs">Monthly Budget ($)</Label>
                  <Input
                    type="number"
                    value={monthlyBudget}
                    onChange={(e) => setMonthlyBudget(Number(e.target.value))}
                    className="mt-1"
                    min={1}
                  />
                </div>
              </div>

              {/* Run Policy */}
              <div className="space-y-3 border-t border-border pt-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Run Policy</h4>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Heartbeat on interval</p>
                  </div>
                  <Switch checked={heartbeatEnabled} onCheckedChange={setHeartbeatEnabled} />
                </div>
                {heartbeatEnabled && (
                  <Select value={heartbeatSchedule} onValueChange={setHeartbeatSchedule}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HEARTBEATS.map((h) => (
                        <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === "config" && (
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => createAgent.mutate()}
              disabled={!agentName.trim() || createAgent.isPending}
            >
              {createAgent.isPending ? "Creating..." : "Create agent"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
