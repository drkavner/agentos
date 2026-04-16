import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTenantContext } from "@/tenant/TenantContext";
import type { Agent, Tenant, TenantAdapterType } from "@shared/schema";
import { TENANT_ADAPTER_LABELS } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { CeoShell } from "./CeoShell";
import { ChevronDown } from "lucide-react";

type AgentConfiguration = {
  profile: { title: string; capabilities: string };
  runtime: {
    llmProvider: "openrouter" | "ollama";
    adapterType: "hermes" | "openclaw" | "cli";
    bypassSandbox: boolean;
    enableSearch: boolean;
    command: string;
    model: string;
    thinkingEffort: "auto" | "low" | "medium" | "high";
    extraArgs: string;
    timeoutSec: number;
    interruptGraceSec: number;
    heartbeatEnabled: boolean;
    heartbeatEverySec: number;
    wakeOnDemand: boolean;
    cooldownSec: number;
    maxConcurrentRuns: number;
    canCreateAgents: boolean;
    canAssignTasks: boolean;
  };
  apiKeys: { id: number; name: string; last4: string; createdAt: string }[];
};

export default function CeoConfiguration() {
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

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["/api/tenants", tid],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const { data: cfg, isLoading } = useQuery<AgentConfiguration>({
    queryKey: ["/api/tenants", tid, "agents", ceo?.id ?? 0, "configuration"],
    queryFn: () =>
      apiRequest("GET", `/api/tenants/${tid}/agents/${ceo!.id}/configuration`).then((r) => r.json()),
    enabled: tid > 0 && !!ceo?.id,
  });

  const { data: ceoControl } = useQuery<{ mode: "agent" | "me" }>({
    queryKey: ["/api/tenants", tid, "ceo", "control"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ceo/control`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const updateCeoControl = useMutation({
    mutationFn: async (mode: "agent" | "me") => {
      const r = await apiRequest("PUT", `/api/tenants/${tid}/ceo/control`, { mode });
      return r.json();
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/tenants", tid, "ceo", "control"] });
      await qc.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      toast({ title: "Saved", description: "CEO control updated." });
    },
  });

  const [form, setForm] = useState<AgentConfiguration | null>(null);

  // Initialize/refresh local form when cfg loads
  useEffect(() => {
    if (cfg) setForm(cfg);
  }, [cfg]);

  const updateConfigMutation = useMutation({
    mutationFn: async (patch: Partial<Pick<AgentConfiguration, "profile" | "runtime">>) => {
      const r = await apiRequest("PUT", `/api/tenants/${tid}/agents/${ceo!.id}/configuration`, patch);
      return r.json() as Promise<AgentConfiguration>;
    },
    onSuccess: async (next) => {
      qc.setQueryData([`/api/tenants`, tid, "agents", ceo?.id ?? 0, "configuration"], next);
      await qc.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      toast({ title: "Saved", description: "Configuration updated." });
    },
  });

  const patchTenantMutation = useMutation({
    mutationFn: async (patch: Partial<Tenant>) => {
      const r = await apiRequest("PATCH", `/api/tenants/${tid}`, patch);
      return r.json();
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/tenants", tid] });
      toast({ title: "Saved", description: "Organization adapter updated." });
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await apiRequest("POST", `/api/tenants/${tid}/agents/${ceo!.id}/api-keys`, { name });
      return r.json() as Promise<{ token: string }>;
    },
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents", ceo?.id ?? 0, "configuration"] });
      toast({
        title: "API key created",
        description: `Token (copy now): ${data.token}`,
      });
    },
  });

  const [newKeyName, setNewKeyName] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(true);

  const testEnvMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/tenants/${tid}/agents/${ceo!.id}/test-environment`, {});
      return r.json() as Promise<any>;
    },
    onSuccess: (data) => {
      if (data?.hermes?.ok === false) {
        toast({ title: "Test failed", description: `Hermes run failed: ${data.hermes.reason ?? "unknown"}` });
        return;
      }
      toast({ title: "Environment OK", description: data?.note ?? "Configuration looks good." });
      qc.invalidateQueries({ queryKey: ["/api/tenants", tid, "audit"] });
    },
  });

  const adapterValue = (tenant?.adapterType === "openclaw" ? "openclaw" : "hermes") as TenantAdapterType;

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
        ) : isLoading || !form ? (
          <div className="text-sm text-muted-foreground">Loading configuration…</div>
        ) : (
          <>
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm">Identity</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">CEO is me</div>
                    <div className="text-xs text-muted-foreground">
                      When enabled, “Assign to me” means you. When disabled, the CEO behaves as an autonomous agent.
                    </div>
                  </div>
                  <Switch
                    checked={ceoControl?.mode === "me"}
                    onCheckedChange={(checked) => updateCeoControl.mutate(checked ? "me" : "agent")}
                    disabled={!ceoControl || updateCeoControl.isPending}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Name</div>
                    <Input
                      value={ceo.displayName}
                      onChange={(e) => {
                        const v = e.target.value;
                        // Optimistic UI for header
                        qc.setQueryData<Agent[]>(["/api/tenants", tid, "agents"], (prev) => {
                          if (!prev) return prev as any;
                          return prev.map((a) => (a.id === ceo.id ? { ...a, displayName: v } : a));
                        });
                        apiRequest("PATCH", `/api/agents/${ceo.id}`, { displayName: v })
                          .then(() => qc.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] }))
                          .catch(() => {});
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Title</div>
                    <Input
                      placeholder="e.g. VP of Engineering"
                      value={form.profile.title}
                      onChange={(e) => setForm((f) => (f ? { ...f, profile: { ...f.profile, title: e.target.value } } : f))}
                      onBlur={() => updateConfigMutation.mutate({ profile: form.profile })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Reports to</div>
                  <Select
                    value={ceo.managerId ? String(ceo.managerId) : "none"}
                    onValueChange={(v) => {
                      const managerId = v === "none" ? null : Number(v);
                      apiRequest("PATCH", `/api/agents/${ceo.id}`, { managerId }).then(() => {
                        qc.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
                      }).catch(() => {});
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose manager…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No manager</SelectItem>
                      {agents
                        .filter((a) => a.id !== ceo.id)
                        .map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.displayName} ({a.role})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Capabilities</div>
                  <Textarea
                    placeholder="Describe what this agent can do…"
                    value={form.profile.capabilities}
                    onChange={(e) => setForm((f) => (f ? { ...f, profile: { ...f.profile, capabilities: e.target.value } } : f))}
                    onBlur={() => updateConfigMutation.mutate({ profile: form.profile })}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Adapter</CardTitle>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => testEnvMutation.mutate()}
                  disabled={!ceo || testEnvMutation.isPending}
                >
                  Test environment
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Adapter type</div>
                  <Select
                    value={adapterValue}
                    onValueChange={(v) => patchTenantMutation.mutate({ adapterType: v as TenantAdapterType } as any)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hermes">{TENANT_ADAPTER_LABELS.hermes}</SelectItem>
                      <SelectItem value="openclaw">{TENANT_ADAPTER_LABELS.openclaw}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Bypass sandbox</div>
                  </div>
                  <Switch
                    checked={form.runtime.bypassSandbox}
                    onCheckedChange={(checked) =>
                      setForm((f) => {
                        if (!f) return f;
                        const next = { ...f, runtime: { ...f.runtime, bypassSandbox: checked } };
                        updateConfigMutation.mutate({ runtime: { bypassSandbox: checked } as any });
                        return next;
                      })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Enable search</div>
                  </div>
                  <Switch
                    checked={form.runtime.enableSearch}
                    onCheckedChange={(checked) =>
                      setForm((f) => {
                        if (!f) return f;
                        const next = { ...f, runtime: { ...f.runtime, enableSearch: checked } };
                        updateConfigMutation.mutate({ runtime: { enableSearch: checked } as any });
                        return next;
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm">Permissions &amp; Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 max-w-md">
                  <div className="text-xs text-muted-foreground">Adapter type</div>
                  <Select
                    value={form.runtime.adapterType ?? "hermes"}
                    onValueChange={(v) =>
                      setForm((f) => {
                        if (!f) return f;
                        const next = { ...f, runtime: { ...f.runtime, adapterType: v as any } };
                        updateConfigMutation.mutate({ runtime: { adapterType: v } as any });
                        return next;
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hermes">Hermes (internal sim/LLM)</SelectItem>
                      <SelectItem value="cli">CLI (claude, codex, gemini, etc.)</SelectItem>
                      <SelectItem value="openclaw">OpenClaw Gateway</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.runtime.adapterType === "cli" && (
                    <p className="text-[11px] text-amber-500">
                      CLI adapter spawns the configured Command below. Make sure the CLI tool is installed and in PATH.
                    </p>
                  )}
                </div>

                <div className="space-y-2 max-w-md">
                  <div className="text-xs text-muted-foreground">LLM provider</div>
                  <Select
                    value={form.runtime.llmProvider}
                    onValueChange={(v) =>
                      setForm((f) => {
                        if (!f) return f;
                        const next = { ...f, runtime: { ...f.runtime, llmProvider: v as "openrouter" | "ollama" } };
                        updateConfigMutation.mutate({ runtime: { llmProvider: v } as any });
                        return next;
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openrouter">OpenRouter (cloud)</SelectItem>
                      <SelectItem value="ollama">Ollama (local)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Command</div>
                    <Input
                      placeholder="e.g. codex"
                      value={form.runtime.command}
                      onChange={(e) => setForm((f) => (f ? { ...f, runtime: { ...f.runtime, command: e.target.value } } : f))}
                      onBlur={() => updateConfigMutation.mutate({ runtime: { command: form.runtime.command } as any })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Model</div>
                    <Input
                      placeholder="Model name"
                      value={form.runtime.model}
                      onChange={(e) => setForm((f) => (f ? { ...f, runtime: { ...f.runtime, model: e.target.value } } : f))}
                      onBlur={() => updateConfigMutation.mutate({ runtime: { model: form.runtime.model } as any })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Thinking effort</div>
                    <Select
                      value={form.runtime.thinkingEffort}
                      onValueChange={(v) =>
                        setForm((f) => {
                          if (!f) return f;
                          const next = { ...f, runtime: { ...f.runtime, thinkingEffort: v as any } };
                          updateConfigMutation.mutate({ runtime: { thinkingEffort: v as any } as any });
                          return next;
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Extra args (comma-separated)</div>
                    <Input
                      placeholder="e.g. --verbose, --foo=bar"
                      value={form.runtime.extraArgs}
                      onChange={(e) => setForm((f) => (f ? { ...f, runtime: { ...f.runtime, extraArgs: e.target.value } } : f))}
                      onBlur={() => updateConfigMutation.mutate({ runtime: { extraArgs: form.runtime.extraArgs } as any })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Timeout (sec)</div>
                    <Input
                      type="number"
                      value={form.runtime.timeoutSec}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, runtime: { ...f.runtime, timeoutSec: Number(e.target.value || 0) } } : f))
                      }
                      onBlur={() => updateConfigMutation.mutate({ runtime: { timeoutSec: form.runtime.timeoutSec } as any })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Interrupt grace period (sec)</div>
                    <Input
                      type="number"
                      value={form.runtime.interruptGraceSec}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, runtime: { ...f.runtime, interruptGraceSec: Number(e.target.value || 0) } } : f))
                      }
                      onBlur={() => updateConfigMutation.mutate({ runtime: { interruptGraceSec: form.runtime.interruptGraceSec } as any })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm">Run Policy</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Heartbeat on interval</div>
                  </div>
                  <Switch
                    checked={form.runtime.heartbeatEnabled}
                    onCheckedChange={(checked) =>
                      setForm((f) => {
                        if (!f) return f;
                        const next = { ...f, runtime: { ...f.runtime, heartbeatEnabled: checked } };
                        updateConfigMutation.mutate({ runtime: { heartbeatEnabled: checked } as any });
                        return next;
                      })
                    }
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div className="col-span-2 space-y-2">
                    <div className="text-xs text-muted-foreground">Run heartbeat every</div>
                    <Input
                      type="number"
                      value={form.runtime.heartbeatEverySec}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, runtime: { ...f.runtime, heartbeatEverySec: Number(e.target.value || 60) } } : f))
                      }
                      onBlur={() => updateConfigMutation.mutate({ runtime: { heartbeatEverySec: form.runtime.heartbeatEverySec } as any })}
                    />
                  </div>
                  <div className="text-sm text-muted-foreground pb-2">sec</div>
                </div>

                <div className="pt-2">
                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between py-1">
                        <div className="text-sm font-medium">Advanced Run Policy</div>
                        <ChevronDown className={advancedOpen ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"} />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">Wake on demand</div>
                        </div>
                        <Switch
                          checked={form.runtime.wakeOnDemand}
                          onCheckedChange={(checked) =>
                            setForm((f) => {
                              if (!f) return f;
                              const next = { ...f, runtime: { ...f.runtime, wakeOnDemand: checked } };
                              updateConfigMutation.mutate({ runtime: { wakeOnDemand: checked } as any });
                              return next;
                            })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Cooldown (sec)</div>
                        <Input
                          type="number"
                          value={form.runtime.cooldownSec}
                          onChange={(e) =>
                            setForm((f) => (f ? { ...f, runtime: { ...f.runtime, cooldownSec: Number(e.target.value || 0) } } : f))
                          }
                          onBlur={() => updateConfigMutation.mutate({ runtime: { cooldownSec: form.runtime.cooldownSec } as any })}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Max concurrent runs</div>
                        <Input
                          type="number"
                          value={form.runtime.maxConcurrentRuns}
                          onChange={(e) =>
                            setForm((f) => (f ? { ...f, runtime: { ...f.runtime, maxConcurrentRuns: Number(e.target.value || 1) } } : f))
                          }
                          onBlur={() => updateConfigMutation.mutate({ runtime: { maxConcurrentRuns: form.runtime.maxConcurrentRuns } as any })}
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm">Permissions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Can create new agents</div>
                    <div className="text-xs text-muted-foreground">
                      Lets this agent create or hire agents and implicitly assign tasks.
                    </div>
                  </div>
                  <Switch
                    checked={form.runtime.canCreateAgents}
                    onCheckedChange={(checked) =>
                      setForm((f) => {
                        if (!f) return f;
                        const next = { ...f, runtime: { ...f.runtime, canCreateAgents: checked } };
                        updateConfigMutation.mutate({ runtime: { canCreateAgents: checked } as any });
                        return next;
                      })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Can assign tasks</div>
                    <div className="text-xs text-muted-foreground">Enabled automatically for CEO agents.</div>
                  </div>
                  <Switch
                    checked={form.runtime.canAssignTasks}
                    onCheckedChange={(checked) =>
                      setForm((f) => {
                        if (!f) return f;
                        const next = { ...f, runtime: { ...f.runtime, canAssignTasks: checked } };
                        updateConfigMutation.mutate({ runtime: { canAssignTasks: checked } as any });
                        return next;
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-sm">API Keys</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                  <Input
                    placeholder="Key name (e.g. production)"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                  <Button
                    onClick={() => {
                      if (!newKeyName.trim()) {
                        toast({ title: "Missing name", description: "Enter a key name first." });
                        return;
                      }
                      createKeyMutation.mutate(newKeyName.trim());
                      setNewKeyName("");
                    }}
                  >
                    Create
                  </Button>
                </div>

                {form.apiKeys.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No active API keys.</div>
                ) : (
                  <div className="divide-y divide-border rounded-md border border-border">
                    {form.apiKeys.map((k) => (
                      <div key={k.id} className="flex items-center justify-between px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{k.name}</div>
                          <div className="text-xs text-muted-foreground">••••{k.last4} · {k.createdAt}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </CeoShell>
  );
}

