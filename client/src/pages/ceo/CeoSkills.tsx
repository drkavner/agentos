import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTenantContext } from "@/tenant/TenantContext";
import { TENANT_ADAPTER_LABELS, type Tenant, type TenantAdapterType } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CeoShell } from "./CeoShell";

type CortexSkillSummary = {
  slug: string;
  name: string;
  required: boolean;
  selected: boolean;
  updatedAt?: string | null;
};

type CortexSkillDetail = {
  slug: string;
  name: string;
  markdown: string;
  updatedAt?: string | null;
};

export default function CeoSkills() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;

  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["/api/tenants", tid],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const { data: skills = [], isLoading } = useQuery<CortexSkillSummary[]>({
    queryKey: ["/api/tenants", tid, "ceo", "skills"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ceo/skills`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const selectedCount = useMemo(() => skills.filter((s) => s.selected).length, [skills]);
  const adapterLabel = useMemo(() => {
    const raw = (tenant?.adapterType === "openclaw" ? "openclaw" : "hermes") as TenantAdapterType;
    return TENANT_ADAPTER_LABELS[raw];
  }, [tenant?.adapterType]);

  const { data: skillDetail, isLoading: detailLoading } = useQuery<CortexSkillDetail>({
    queryKey: ["/api/tenants", tid, "ceo", "skills", openSlug ?? ""],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ceo/skills/${openSlug}`).then((r) => r.json()),
    enabled: tid > 0 && !!openSlug,
  });

  return (
    <CeoShell>
      <div className="space-y-4 max-w-[1100px]">
        <div className="text-sm text-muted-foreground">View company skills library</div>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Required by Cortex</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading skills…</div>
            ) : (
              <div className="divide-y divide-border rounded-md border border-border">
                {skills.map((s) => (
                  <div key={s.slug} className="flex items-center justify-between gap-3 px-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Checkbox checked={s.selected} disabled />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Will be linked into the effective CODEX_HOME/skills/ directory on the next run.
                        </div>
                      </div>
                      {s.required ? (
                        <Badge variant="secondary" className="text-[10px] h-5">
                          required
                        </Badge>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      className="text-xs"
                      onClick={() => setOpenSlug(s.slug)}
                    >
                      View
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="py-4">
            <div className="grid grid-cols-3 gap-8">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Adapter</div>
                <div className="text-sm font-medium">{adapterLabel}</div>
                <div className="text-xs text-muted-foreground">Skills applied</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Selected skills</div>
                <div className="text-sm font-medium">{selectedCount}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Applied when the agent runs</div>
                <div className="text-sm font-medium">Skills applied</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!openSlug} onOpenChange={(o) => (o ? null : setOpenSlug(null))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{skillDetail?.name ?? openSlug ?? "Skill"}</DialogTitle>
            <DialogDescription className="text-xs">
              {skillDetail?.updatedAt ? `Updated ${skillDetail.updatedAt}` : "Skill details"}
            </DialogDescription>
          </DialogHeader>
          <div className="border border-border rounded-md bg-muted/30 p-4 max-h-[60vh] overflow-auto">
            <pre className="text-xs whitespace-pre-wrap">
              {detailLoading ? "Loading…" : skillDetail?.markdown ?? "—"}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </CeoShell>
  );
}

