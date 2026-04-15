import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CeoShell } from "./CeoShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTenantContext } from "@/tenant/TenantContext";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy } from "lucide-react";

export default function CeoInstruction() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;

  type CeoFileRow = { id: number; tenantId: number; filename: string; markdown: string; updatedAt: string };
  type CeoInstructionSettings = {
    tenantId: number;
    mode: "managed" | "external";
    rootPath: string;
    entryFile: string;
    updatedAt: string;
  };

  const { data: settings } = useQuery<CeoInstructionSettings>({
    queryKey: ["/api/tenants", tid, "ceo-instructions", "settings"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ceo/instructions/settings`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const saveSettings = useMutation({
    mutationFn: (data: { mode: "managed" | "external"; rootPath: string; entryFile: string }) =>
      apiRequest("PUT", `/api/tenants/${tid}/ceo/instructions/settings`, data).then((r) => r.json()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "ceo-instructions", "settings"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "ceo-files"] });
    },
  });

  const { data: rows = [] } = useQuery<CeoFileRow[]>({
    queryKey: ["/api/tenants", tid, "ceo-files"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ceo/files`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const fileEntries = useMemo(() => {
    return rows
      .slice()
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .map((r) => {
      const bytes = new TextEncoder().encode(r.markdown ?? "").length;
      const size = bytes >= 1024 ? `${Math.round(bytes / 1024)}KB` : `${bytes}B`;
      return { name: r.filename, size, content: r.markdown ?? "", updatedAt: r.updatedAt };
    });
  }, [rows]);

  const [activeName, setActiveName] = useState<string>("AGENTS.md");
  const active = fileEntries.find((f) => f.name === activeName) ?? fileEntries[0] ?? null;

  useEffect(() => {
    if (!activeName && fileEntries.length > 0) setActiveName(fileEntries[0]!.name);
    if (activeName && fileEntries.length > 0 && !fileEntries.some((f) => f.name === activeName)) {
      setActiveName(fileEntries[0]!.name);
    }
  }, [fileEntries, activeName]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setEditing(false);
    setDraft(active?.content ?? "");
  }, [active?.name]);

  const saveFile = useMutation({
    mutationFn: ({ filename, markdown }: { filename: string; markdown: string }) =>
      apiRequest("PUT", `/api/tenants/${tid}/ceo/files/${encodeURIComponent(filename)}`, { markdown }).then((r) => r.json()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "ceo-files"] });
      setEditing(false);
    },
  });

  const deleteFile = useMutation({
    mutationFn: (filename: string) =>
      apiRequest("DELETE", `/api/tenants/${tid}/ceo/files/${encodeURIComponent(filename)}`).then((r) => r.json()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "ceo-files"] });
    },
  });

  const onDelete = (name: string) => {
    deleteFile.mutate(name);
    if (activeName === name) {
      const remaining = fileEntries.filter((f) => f.name !== name);
      setActiveName(remaining[0]?.name ?? "");
    }
  };

  const onAdd = () => {
    const name = window.prompt("File name (e.g. NOTES.md)");
    if (!name) return;
    const clean = name.trim();
    if (!clean) return;
    saveFile.mutate({ filename: clean, markdown: `# ${clean}\n\n` });
    setActiveName(clean);
  };

  const [draftMode, setDraftMode] = useState<"managed" | "external">("managed");
  const [draftRootPath, setDraftRootPath] = useState("");
  const [draftEntryFile, setDraftEntryFile] = useState("AGENTS.md");

  useEffect(() => {
    if (!settings) return;
    setDraftMode(settings.mode);
    setDraftRootPath(settings.rootPath);
    setDraftEntryFile(settings.entryFile || "AGENTS.md");
  }, [settings?.updatedAt]);

  const isDirty =
    !!settings &&
    (draftMode !== settings.mode ||
      draftRootPath !== settings.rootPath ||
      draftEntryFile !== (settings.entryFile || "AGENTS.md"));

  const onCancelSettings = () => {
    if (!settings) return;
    setDraftMode(settings.mode);
    setDraftRootPath(settings.rootPath);
    setDraftEntryFile(settings.entryFile || "AGENTS.md");
  };

  const copyRootPath = async () => {
    try {
      await navigator.clipboard.writeText(draftRootPath);
    } catch {
      // ignore
    }
  };

  return (
    <CeoShell
      breadcrumb={
        <span className="inline-flex items-center gap-2">
          <span>Agents</span>
          <ChevronRight className="w-3.5 h-3.5 opacity-60" />
          <span>CEO</span>
          <ChevronRight className="w-3.5 h-3.5 opacity-60" />
          <span className="text-foreground/90">Instructions</span>
        </span>
      }
    >
      <button
        onClick={() => setAdvancedOpen((v) => !v)}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-2"
      >
        <ChevronRight className={cn("w-4 h-4 transition-transform", advancedOpen && "rotate-90")} />
        Advanced
      </button>

      {advancedOpen ? (
        <TooltipProvider>
          <div className="rounded-lg border border-border/40 bg-card/30 p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="text-xs text-muted-foreground">
                {settings?.mode ? `Current: ${settings.mode}` : "Current: —"}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCancelSettings}
                  disabled={!isDirty || saveSettings.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveSettings.mutate({ mode: draftMode, rootPath: draftRootPath, entryFile: draftEntryFile })}
                  disabled={saveSettings.isPending || !isDirty || !draftRootPath.trim() || !draftEntryFile.trim()}
                >
                  {saveSettings.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_260px] gap-4 items-end">
              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  Mode
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="text-muted-foreground/70 hover:text-foreground">?</button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Managed: Cortex stores + mirrors the instructions bundle to disk. External: you provide a folder path on disk.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="inline-flex rounded-md border border-border/50 overflow-hidden">
                  <button
                    className={cn("px-3 py-2 text-xs", draftMode === "managed" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/20")}
                    onClick={() => setDraftMode("managed")}
                  >
                    Managed
                  </button>
                  <button
                    className={cn("px-3 py-2 text-xs", draftMode === "external" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/20")}
                    onClick={() => setDraftMode("external")}
                  >
                    External
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  Root path
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="text-muted-foreground/70 hover:text-foreground">?</button>
                    </TooltipTrigger>
                    <TooltipContent>
                      The absolute directory on disk where the instructions bundle lives. In managed mode this is set automatically by Cortex.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={draftRootPath}
                    onChange={(e) => setDraftRootPath(e.target.value)}
                    disabled={draftMode === "managed"}
                    className="font-mono text-xs"
                  />
                  <Button size="icon" variant="outline" onClick={copyRootPath} className="h-9 w-9" title="Copy">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  Entry file
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="text-muted-foreground/70 hover:text-foreground">?</button>
                    </TooltipTrigger>
                    <TooltipContent>
                      The file that acts as the entry point for the instruction bundle (usually AGENTS.md).
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={draftEntryFile}
                    onChange={(e) => setDraftEntryFile(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </TooltipProvider>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Files panel */}
        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Files</CardTitle>
            <Button size="icon" variant="ghost" onClick={onAdd} className="h-8 w-8">
              <Plus className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/40">
              {fileEntries.map((f) => {
                const isActive = f.name === activeName;
                return (
                  <button
                    key={f.name}
                    onClick={() => setActiveName(f.name)}
                    className={cn(
                      "w-full px-4 py-3 flex items-center gap-3 text-left transition-colors",
                      isActive ? "bg-muted/30" : "hover:bg-muted/20",
                    )}
                  >
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground truncate">{f.name}</div>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {f.name === "AGENTS.md" ? <span className="uppercase tracking-wider opacity-70">ENTRY</span> : null}
                      <span className="font-mono opacity-70">{f.size}</span>
                    </div>
                  </button>
                );
              })}
              {fileEntries.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No files.</div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Viewer panel */}
        <Card className="bg-card border-border/50 min-h-[520px]">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm">{active?.name ?? "—"}</CardTitle>
              <div className="text-xs text-muted-foreground mt-0.5">markdown file</div>
            </div>
            {active ? (
              <div className="flex items-center gap-2">
                {!editing ? (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setEditing(false); setDraft(active.content); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => saveFile.mutate({ filename: active.name, markdown: draft })}
                      disabled={saveFile.isPending || !draft.trim()}
                    >
                      {saveFile.isPending ? "Saving..." : "Save"}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDelete(active.name)}
                  disabled={deleteFile.isPending}
                >
                  Delete
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {active ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] py-0 h-5">CEO</Badge>
                  <Badge variant="outline" className="text-[10px] py-0 h-5">{active.size}</Badge>
                  {active.updatedAt ? (
                    <Badge variant="outline" className="text-[10px] py-0 h-5">
                      {new Date(active.updatedAt).toLocaleString()}
                    </Badge>
                  ) : null}
                </div>
                {!editing ? (
                  <pre className="text-sm whitespace-pre-wrap leading-relaxed bg-transparent border-0 p-0 max-h-[560px] overflow-auto">
{active.content}
                  </pre>
                ) : (
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="min-h-[560px] font-mono text-xs"
                  />
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Select a file.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </CeoShell>
  );
}

