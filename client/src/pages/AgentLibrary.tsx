import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, AgentDefinition } from "@shared/schema";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Filter, Rocket } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { HireAgentWizard } from "@/components/HireAgentWizard";
import { useTenantContext } from "@/tenant/TenantContext";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const DIVISIONS = ["All", "Engineering", "Design", "Marketing", "Marketing Ops", "Sales", "Product", "Finance", "Support", "Specialized"];
const VIEW_MODES = ["Library", "Deployed"] as const;

export default function AgentLibrary() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("All");
  const [viewMode, setViewMode] = useState<(typeof VIEW_MODES)[number]>("Library");

  const [selected, setSelected] = useState<AgentDefinition | null>(null);
  // Wizard state: null = closed, { def: null } = open without preselection, { def } = open with preselection
  const [wizard, setWizard] = useState<{ open: boolean; def: AgentDefinition | null }>({ open: false, def: null });
  const openWizard = (def: AgentDefinition | null = null) => setWizard({ open: true, def });
  const closeWizard = () => setWizard({ open: false, def: null });

  const { data: defs = [] } = useQuery<AgentDefinition[]>({
    queryKey: ["/api/agent-definitions"],
    queryFn: () => apiRequest("GET", "/api/agent-definitions").then(r => r.json()),
  });

  const { data: deployedAgents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then(r => r.json()),
    enabled: tid > 0,
  });

  const { data: skillsMd, isLoading: isLoadingSkills } = useQuery<{ markdown: string; source?: string; updatedAt?: string }>({
    queryKey: ["/api/agent-definitions", selected?.id, "skills", tid],
    queryFn: () => apiRequest("GET", `/api/agent-definitions/${selected!.id}/skills?tenantId=${tid}`).then(r => r.json()),
    enabled: !!selected?.id && tid > 0,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!selected) return;
    setEditing(false);
    setDraft(skillsMd?.markdown ?? "");
  }, [selected?.id, skillsMd?.markdown]);

  const saveSkills = useMutation({
    mutationFn: (markdown: string) =>
      apiRequest("PUT", `/api/tenants/${tid}/agent-definitions/${selected!.id}/skills`, { markdown }).then(r => r.json()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/agent-definitions", selected?.id, "skills", tid] });
      toast({ title: "Saved", description: "skills.md updated for this organization." });
      setEditing(false);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message || "Try again.", variant: "destructive" });
    },
  });

  const filtered = defs.filter(d => {
    const matchDivision = division === "All" || d.division === division;
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.specialty.toLowerCase().includes(search.toLowerCase()) || d.description.toLowerCase().includes(search.toLowerCase());
    return matchDivision && matchSearch;
  });

  const defById = useMemo(() => {
    const m = new Map<number, AgentDefinition>();
    for (const d of defs) m.set(d.id, d);
    return m;
  }, [defs]);

  const filteredDeployed = useMemo(() => {
    const q = search.trim().toLowerCase();
    const div = division;
    return deployedAgents.filter((a) => {
      const def = defById.get(a.definitionId);
      const matchDivision = div === "All" || (def?.division ?? "") === div;
      if (!q) return matchDivision;
      const hay = `${a.displayName} ${a.role} ${def?.name ?? ""} ${def?.specialty ?? ""} ${def?.description ?? ""}`.toLowerCase();
      return matchDivision && hay.includes(q);
    });
  }, [deployedAgents, defById, search, division]);

  const divisionCounts = DIVISIONS.reduce((acc, div) => {
    acc[div] = div === "All" ? defs.length : defs.filter(d => d.division === div).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Agent Library</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{defs.length} specialized agents across {DIVISIONS.length - 1} divisions</p>
        </div>
        <Button onClick={() => openWizard()} data-testid="hire-from-library-btn">
          <Plus className="w-4 h-4 mr-1.5" /> Hire Agent
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name or specialty..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="library-search"
          />
        </div>

      </div>

      {/* View mode */}
      <div className="flex gap-2 flex-wrap">
        {VIEW_MODES.map((m) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
              viewMode === m
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
            data-testid={`library-view-${m}`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Division tabs */}
      <div className="flex gap-2 flex-wrap">
        {DIVISIONS.filter(d => divisionCounts[d] > 0).map(div => (
          <button
            key={div}
            onClick={() => setDivision(div)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
              division === div
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
            data-testid={`division-${div}`}
          >
            {div} <span className="ml-1 opacity-60">{divisionCounts[div]}</span>
          </button>
        ))}
      </div>

      {viewMode === "Library" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(def => (
            <Card
              key={def.id}
              className="bg-card border-border hover:border-primary/40 transition-all cursor-pointer group"
              onClick={() => setSelected(def)}
              data-testid={`agent-def-${def.id}`}
            >
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ backgroundColor: `${def.color}20` }}>
                      {def.emoji}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground leading-tight group-hover:text-primary transition-colors">{def.name}</h3>
                      <Badge variant="outline" className="text-xs mt-0.5 py-0" style={{ color: def.color, borderColor: `${def.color}40` }}>
                        {def.division}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{def.description}</p>
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground/70 italic line-clamp-1 flex-1">{def.specialty}</p>
                  <button
                    onClick={e => { e.stopPropagation(); openWizard(def); }}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all"
                    data-testid={`quick-hire-${def.id}`}
                  >
                    <Rocket className="w-3 h-3" /> Hire
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredDeployed.map((a) => {
            const def = defById.get(a.definitionId);
            const emoji = def?.emoji ?? "🤖";
            const color = def?.color ?? "#64748b";
            const divisionLabel = def?.division ?? "Deployed";
            return (
              <Card key={a.id} className="bg-card border-border hover:border-primary/40 transition-all" data-testid={`deployed-agent-${a.id}`}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                        style={{ backgroundColor: `${color}20` }}>
                        {emoji}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-foreground leading-tight truncate">{a.displayName}</h3>
                        <p className="text-xs text-muted-foreground truncate">{a.role}</p>
                        <Badge variant="outline" className="text-xs mt-1 py-0" style={{ color, borderColor: `${color}40` }}>
                          {divisionLabel}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {def?.description ?? "Deployed agent in this organization."}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {viewMode === "Library" && filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Filter className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>No agents match your filters</p>
        </div>
      )}

      {viewMode === "Deployed" && filteredDeployed.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Filter className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>No deployed agents match your filters</p>
        </div>
      )}

      {/* Detail dialog */}
      {selected && (
        <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-lg" data-testid="agent-detail-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <span className="text-2xl">{selected.emoji}</span>
                <div>
                  <div>{selected.name}</div>
                  <Badge variant="outline" className="text-xs mt-0.5" style={{ color: selected.color }}>
                    {selected.division}
                  </Badge>
                </div>
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-2 leading-relaxed">
                {selected.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Specialty</h4>
                <p className="text-sm text-foreground">{selected.specialty}</p>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">When to Use</h4>
                <p className="text-sm text-foreground">{selected.whenToUse}</p>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Skills</h4>
                {isLoadingSkills ? (
                  <p className="text-sm text-muted-foreground">Loading skills…</p>
                ) : (
                  <div className="space-y-2">
                    {!editing ? (
                      <pre className="text-xs text-foreground whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 max-h-64 overflow-auto">
                        {skillsMd?.markdown ?? "No skills.md available yet."}
                      </pre>
                    ) : (
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="min-h-[220px] font-mono text-xs"
                        data-testid="skills-editor"
                      />
                    )}

                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        {skillsMd?.source === "override" ? "Org override" : skillsMd?.source === "file" ? "Default file" : "Generated"}
                        {skillsMd?.updatedAt ? ` · updated ${new Date(skillsMd.updatedAt).toLocaleString()}` : ""}
                      </div>
                      <div className="flex gap-2">
                        {!editing ? (
                          <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="skills-edit">
                            Edit
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft(skillsMd?.markdown ?? ""); }}>
                              Cancel
                            </Button>
                            <Button size="sm" onClick={() => saveSkills.mutate(draft)} disabled={saveSkills.isPending || !draft.trim()} data-testid="skills-save">
                              {saveSkills.isPending ? "Saving…" : "Save"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
              <Button
                onClick={() => { setSelected(null); openWizard(selected); }}
                data-testid="deploy-agent-btn"
              >
                <Rocket className="w-4 h-4 mr-1" /> Hire This Agent
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Hire wizard */}
      <HireAgentWizard
        open={wizard.open}
        onClose={closeWizard}
        preselectedDef={wizard.def ?? undefined}
      />
    </div>
  );
}
