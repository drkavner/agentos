import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, Team } from "@shared/schema";
import { useTenantContext } from "@/tenant/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChevronRight, Download, FileText, Lock, Plus, Trash2, Unlock, Users } from "lucide-react";

type TeamFileRow = {
  id: number;
  tenantId: number;
  teamId: number;
  filename: string;
  markdown: string;
  updatedAt: string;
};

type TeamMemberRow = { id: number; teamId: number; agentId: number };

type AgentDocsResponse = {
  tenant: { id: number; name: string };
  agent: { id: number; displayName: string; role: string; definitionId: number };
  definition: { id: number; name: string; division: string };
  files: { filename: string; markdown: string }[];
};

export default function TeamsPage() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;

  const ownerId = useMemo(() => {
    if (typeof window === "undefined") return "unknown";
    const key = "cortex_team_lock_owner";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = `user-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
    window.localStorage.setItem(key, next);
    return next;
  }, []);

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/tenants", tid, "teams"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/teams`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);

  useEffect(() => {
    if (teams.length === 0) {
      setActiveTeamId(null);
      return;
    }
    if (activeTeamId && teams.some((t) => t.id === activeTeamId)) return;
    setActiveTeamId(teams[0]!.id);
  }, [teams, activeTeamId]);

  const { data: files = [] } = useQuery<TeamFileRow[]>({
    queryKey: ["/api/tenants", tid, "teams", activeTeamId, "files"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/teams/${activeTeamId}/files`).then((r) => r.json()),
    enabled: tid > 0 && !!activeTeamId,
  });

  const { data: lock } = useQuery<{ locked: boolean; owner?: string; lockedAt?: string }>({
    queryKey: ["/api/tenants", tid, "teams", activeTeamId, "lock"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/teams/${activeTeamId}/lock`).then((r) => r.json()),
    enabled: tid > 0 && !!activeTeamId,
    refetchInterval: 5000,
  });
  const lockedByOther = !!lock?.locked && !!lock?.owner && lock.owner !== ownerId;

  const fileEntries = useMemo(() => {
    return files
      .slice()
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .map((r) => {
        const bytes = new TextEncoder().encode(r.markdown ?? "").length;
        const size = bytes >= 1024 ? `${Math.round(bytes / 1024)}KB` : `${bytes}B`;
        return { name: r.filename, size, content: r.markdown ?? "", updatedAt: r.updatedAt };
      });
  }, [files]);

  const [activeName, setActiveName] = useState<string>("TEAM.md");
  const activeFile = fileEntries.find((f) => f.name === activeName) ?? fileEntries[0] ?? null;

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
    setDraft(activeFile?.content ?? "");
  }, [activeFile?.name]);

  const saveFile = useMutation({
    mutationFn: ({ filename, markdown }: { filename: string; markdown: string }) =>
      apiRequest("PUT", `/api/tenants/${tid}/teams/${activeTeamId}/files/${encodeURIComponent(filename)}`, { markdown, owner: ownerId }).then((r) =>
        r.json(),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "teams", activeTeamId, "files"] });
      setEditing(false);
    },
  });

  const deleteFile = useMutation({
    mutationFn: (filename: string) =>
      apiRequest("DELETE", `/api/tenants/${tid}/teams/${activeTeamId}/files/${encodeURIComponent(filename)}`, { owner: ownerId }).then((r) => r.json()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "teams", activeTeamId, "files"] });
    },
  });

  const lockTeam = useMutation({
    mutationFn: () => apiRequest("POST", `/api/tenants/${tid}/teams/${activeTeamId}/lock`, { owner: ownerId }).then((r) => r.json()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "teams", activeTeamId, "lock"] });
    },
  });
  const unlockTeam = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/tenants/${tid}/teams/${activeTeamId}/lock`, { owner: ownerId }).then((r) => r.json()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "teams", activeTeamId, "lock"] });
    },
  });
  const publishDocs = useMutation({
    mutationFn: () => apiRequest("POST", `/api/tenants/${tid}/teams/${activeTeamId}/publish`, { owner: ownerId }).then((r) => r.json()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "messages"] });
    },
  });

  const onAdd = () => {
    if (lockedByOther) return;
    const name = window.prompt("File name (e.g. PLAYBOOK.md)");
    if (!name) return;
    const clean = name.trim();
    if (!clean) return;
    const finalName = clean.toLowerCase().endsWith(".md") ? clean : `${clean}.md`;
    saveFile.mutate({ filename: finalName, markdown: `# ${finalName}\n\n` });
    setActiveName(finalName);
  };

  const activeTeam = teams.find((t) => t.id === activeTeamId) ?? null;

  const { data: members = [] } = useQuery<TeamMemberRow[]>({
    queryKey: ["/api/teams", activeTeamId, "members"],
    queryFn: () => apiRequest("GET", `/api/teams/${activeTeamId}/members`).then((r) => r.json()),
    enabled: !!activeTeamId,
  });

  const teamAgents = useMemo(() => {
    const set = new Set(members.map((m) => m.agentId));
    return agents.filter((a) => set.has(a.id));
  }, [agents, members]);

  const [activeAgentId, setActiveAgentId] = useState<number | null>(null);
  useEffect(() => {
    if (teamAgents.length === 0) {
      setActiveAgentId(null);
      return;
    }
    if (activeAgentId && teamAgents.some((a) => a.id === activeAgentId)) return;
    setActiveAgentId(teamAgents[0]!.id);
  }, [teamAgents, activeAgentId]);

  const { data: agentDocs } = useQuery<AgentDocsResponse>({
    queryKey: ["/api/tenants", tid, "agents", activeAgentId, "docs"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents/${activeAgentId}/docs`).then((r) => r.json()),
    enabled: tid > 0 && !!activeAgentId,
  });

  const agentFileEntries = useMemo(() => {
    const rows = agentDocs?.files ?? [];
    return rows
      .slice()
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .map((r) => {
        const bytes = new TextEncoder().encode(r.markdown ?? "").length;
        const size = bytes >= 1024 ? `${Math.round(bytes / 1024)}KB` : `${bytes}B`;
        return { name: r.filename, size, content: r.markdown ?? "" };
      });
  }, [agentDocs?.files]);

  const [activeAgentFile, setActiveAgentFile] = useState<string>("AGENT.md");
  const shownAgentFile = agentFileEntries.find((f) => f.name === activeAgentFile) ?? agentFileEntries[0] ?? null;
  useEffect(() => {
    if (agentFileEntries.length === 0) return;
    if (activeAgentFile && agentFileEntries.some((f) => f.name === activeAgentFile)) return;
    setActiveAgentFile(agentFileEntries[0]!.name);
  }, [agentFileEntries, activeAgentFile]);

  const exportTeam = async () => {
    if (!activeTeamId) return;
    const resp = await fetch(`/api/tenants/${tid}/teams/${activeTeamId}/export`);
    if (!resp.ok) throw new Error("Export failed");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      resp.headers.get("content-disposition")?.match(/filename=\"(.+)\"/)?.[1] ??
      `team-${activeTeamId}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Teams</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Each team can keep its own markdown instructions ("knowledge") used as operating guidance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => publishDocs.mutate()}
            disabled={!activeTeamId || publishDocs.isPending}
            data-testid="team-publish"
            title="Post team docs into the team Collaboration channel as files"
          >
            <FileText className="w-4 h-4 mr-2" /> Publish to Collaboration
          </Button>

          {!lock?.locked ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => lockTeam.mutate()}
              disabled={!activeTeamId || lockTeam.isPending}
              data-testid="team-lock"
            >
              <Lock className="w-4 h-4 mr-2" /> Lock
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unlockTeam.mutate()}
              disabled={!activeTeamId || unlockTeam.isPending || lockedByOther}
              data-testid="team-unlock"
              title={lockedByOther ? `Locked by ${lock?.owner}` : "Unlock team"}
            >
              <Unlock className="w-4 h-4 mr-2" /> Unlock
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => exportTeam().catch(() => {})}
            disabled={!activeTeamId}
            data-testid="team-export"
          >
            <Download className="w-4 h-4 mr-2" /> Export Team (.zip)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Team list */}
        <Card className="bg-card border-border lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Team List
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {teams.length === 0 ? (
              <p className="text-xs text-muted-foreground">No teams yet. Create one from Collaboration or Admin APIs.</p>
            ) : (
              teams.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTeamId(t.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg border transition-colors",
                    activeTeamId === t.id
                      ? "border-primary/30 bg-primary/10 text-foreground"
                      : "border-border bg-muted/10 hover:bg-muted/30 text-muted-foreground",
                  )}
                  data-testid={`team-select-${t.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{t.name}</div>
                      {t.description ? <div className="text-xs opacity-80 truncate">{t.description}</div> : null}
                    </div>
                    <Badge variant="outline" className="text-[10px] py-0 shrink-0">
                      #{t.id}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* Team knowledge + agent docs (same team view) */}
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Team Knowledge Files
              {activeTeam ? (
                <span className="text-muted-foreground font-normal inline-flex items-center gap-2">
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                  <span className="text-foreground/90">{activeTeam.name}</span>
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            {!activeTeamId ? (
              <p className="text-sm text-muted-foreground">Pick a team to view its instruction files.</p>
            ) : (
              <>
                {lock?.locked ? (
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      lockedByOther ? "border-red-500/30 bg-red-500/5 text-red-200" : "border-yellow-500/30 bg-yellow-500/5 text-yellow-200",
                    )}
                  >
                    {lockedByOther ? (
                      <span>
                        Locked by <span className="font-mono">{lock.owner}</span>. You can view but cannot edit.
                      </span>
                    ) : (
                      <span>
                        You locked this team (<span className="font-mono">{lock.owner}</span>).
                      </span>
                    )}
                  </div>
                ) : null}

                <div className="flex items-center gap-2">
                  <select
                    value={activeName}
                    onChange={(e) => setActiveName(e.target.value)}
                    className="bg-muted border border-border rounded-md text-xs text-foreground px-2 py-2 outline-none"
                    data-testid="team-file-select"
                  >
                    {fileEntries.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="secondary" onClick={onAdd} data-testid="team-file-add" disabled={lockedByOther}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Add file
                  </Button>
                  {activeFile && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto text-destructive border-destructive/40 hover:bg-destructive/10"
                      onClick={() => deleteFile.mutate(activeFile.name)}
                      data-testid="team-file-delete"
                      disabled={deleteFile.isPending || lockedByOther}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                    </Button>
                  )}
                </div>

                {activeFile ? (
                  <>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] py-0">
                        {activeFile.size}
                      </Badge>
                      <span>Updated: {new Date(activeFile.updatedAt).toLocaleString()}</span>
                    </div>

                    {!editing ? (
                      <div className="space-y-2">
                        <Textarea value={activeFile.content} readOnly className="min-h-[360px] font-mono text-xs" />
                        <div className="flex justify-end">
                          <Button size="sm" onClick={() => setEditing(true)} data-testid="team-file-edit" disabled={lockedByOther}>
                            Edit
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          className="min-h-[360px] font-mono text-xs"
                          data-testid="team-file-draft"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saveFile.isPending}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => activeFile && saveFile.mutate({ filename: activeFile.name, markdown: draft })}
                            disabled={saveFile.isPending || lockedByOther}
                            data-testid="team-file-save"
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-lg border border-border bg-muted/20 p-4">
                    <p className="text-sm text-muted-foreground">No files yet for this team.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      A default <code className="font-mono">TEAM.md</code> and <code className="font-mono">INSTRUCTIONS.md</code> will be created
                      the first time you open a team.
                    </p>
                  </div>
                )}

                <div className="pt-2 border-t border-border/60" />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground inline-flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" /> Team Agent Docs (.md)
                    </div>
                    <Badge variant="outline" className="text-[10px] py-0">
                      {teamAgents.length} agent{teamAgents.length === 1 ? "" : "s"}
                    </Badge>
                  </div>

                  {teamAgents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No agents are assigned to this team yet.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={String(activeAgentId ?? "")}
                          onChange={(e) => setActiveAgentId(Number(e.target.value))}
                          className="bg-muted border border-border rounded-md text-xs text-foreground px-2 py-2 outline-none"
                          data-testid="team-agent-select"
                        >
                          {teamAgents.map((a) => (
                            <option key={a.id} value={String(a.id)}>
                              {a.displayName} ({a.role})
                            </option>
                          ))}
                        </select>

                        <select
                          value={activeAgentFile}
                          onChange={(e) => setActiveAgentFile(e.target.value)}
                          className="bg-muted border border-border rounded-md text-xs text-foreground px-2 py-2 outline-none"
                          data-testid="agent-doc-select"
                          disabled={agentFileEntries.length === 0}
                        >
                          {agentFileEntries.map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                        </select>

                        {shownAgentFile ? (
                          <Badge variant="outline" className="text-[10px] py-0">
                            {shownAgentFile.size}
                          </Badge>
                        ) : null}
                      </div>

                      {shownAgentFile ? (
                        <Textarea value={shownAgentFile.content} readOnly className="min-h-[360px] font-mono text-xs" />
                      ) : (
                        <p className="text-xs text-muted-foreground">No docs available for this agent.</p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

