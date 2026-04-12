import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { AgentDefinition } from "@shared/schema";
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

const DIVISIONS = ["All", "Engineering", "Design", "Marketing", "Marketing Ops", "Sales", "Product", "Finance", "Support", "Specialized"];

export default function AgentLibrary() {
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("All");

  const [selected, setSelected] = useState<AgentDefinition | null>(null);
  // Wizard state: null = closed, { def: null } = open without preselection, { def } = open with preselection
  const [wizard, setWizard] = useState<{ open: boolean; def: AgentDefinition | null }>({ open: false, def: null });
  const openWizard = (def: AgentDefinition | null = null) => setWizard({ open: true, def });
  const closeWizard = () => setWizard({ open: false, def: null });

  const { data: defs = [] } = useQuery<AgentDefinition[]>({
    queryKey: ["/api/agent-definitions"],
    queryFn: () => apiRequest("GET", "/api/agent-definitions").then(r => r.json()),
  });

  const filtered = defs.filter(d => {
    const matchDivision = division === "All" || d.division === division;
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.specialty.toLowerCase().includes(search.toLowerCase()) || d.description.toLowerCase().includes(search.toLowerCase());
    return matchDivision && matchSearch;
  });

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

      {/* Grid */}
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

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Filter className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>No agents match your filters</p>
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
