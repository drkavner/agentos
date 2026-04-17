import { useMemo, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Task, Agent, Team } from "@shared/schema";
import { useTenantContext } from "@/tenant/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, CheckSquare, AlertTriangle, Clock, Loader, Eye, Trash2, ThumbsUp, MessageSquareWarning, Send, Download, FileCode, Copy, User, Activity, GitBranch, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea as TextareaBase } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

const STATUSES = ["todo", "in_progress", "review", "done", "blocked"] as const;
type Status = typeof STATUSES[number];

const STATUS_CONFIG: Record<Status, { label: string; icon: any; color: string; bg: string }> = {
  todo: { label: "To Do", icon: Clock, color: "text-muted-foreground", bg: "bg-muted/50" },
  in_progress: { label: "In Progress", icon: Loader, color: "text-primary", bg: "bg-primary/5" },
  review: { label: "In Review", icon: Eye, color: "text-yellow-400", bg: "bg-yellow-400/5" },
  done: { label: "Done", icon: CheckSquare, color: "text-green-400", bg: "bg-green-400/5" },
  blocked: { label: "Blocked", icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/5" },
};

const PRIORITY_CONFIG: Record<string, string> = {
  urgent: "text-destructive border-destructive/30",
  high: "text-orange-400 border-orange-400/30",
  medium: "text-yellow-400 border-yellow-400/30",
  low: "text-muted-foreground border-muted",
};

// ─── Rendered code block (shared with Collab.tsx) ───────────────────────────
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-md border border-border bg-black/40 text-xs overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-1 bg-muted/30 border-b border-border">
        <span className="text-muted-foreground text-[10px] font-mono">{lang || "code"}</span>
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? <CheckSquare className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-foreground/90 leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

function RenderContent({ content }: { content: string }) {
  const parts: { type: "text" | "code"; lang?: string; value: string }[] = [];
  const lines = content.split("\n");
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (const line of lines) {
    if (!inCode && line.startsWith("```")) {
      inCode = true;
      codeLang = line.slice(3).trim();
      codeLines = [];
    } else if (inCode && line.startsWith("```")) {
      parts.push({ type: "code", lang: codeLang, value: codeLines.join("\n") });
      inCode = false;
    } else if (inCode) {
      codeLines.push(line);
    } else {
      const last = parts[parts.length - 1];
      if (last?.type === "text") {
        last.value += "\n" + line;
      } else {
        parts.push({ type: "text", value: line });
      }
    }
  }
  if (inCode && codeLines.length > 0) {
    parts.push({ type: "code", lang: codeLang, value: codeLines.join("\n") });
  }

  return (
    <div>
      {parts.map((p, i) =>
        p.type === "code" ? (
          <CodeBlock key={i} lang={p.lang ?? ""} code={p.value} />
        ) : (
          <div key={i} className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
            {p.value.split("\n").map((line, j) => {
              if (line.match(/^#{1,3}\s/)) {
                const level = line.match(/^(#+)/)![1].length;
                const text = line.replace(/^#+\s*/, "");
                const cls = level === 1 ? "text-base font-bold mt-3 mb-1" : level === 2 ? "text-sm font-semibold mt-2 mb-1" : "text-sm font-medium mt-1.5";
                return <div key={j} className={cls}>{text}</div>;
              }
              if (line.match(/^[-*]\s/)) {
                return <div key={j} className="pl-3 flex gap-1.5"><span className="text-muted-foreground">•</span><span>{line.replace(/^[-*]\s/, "")}</span></div>;
              }
              if (line.trim() === "") return <div key={j} className="h-2" />;
              return <div key={j}>{line}</div>;
            })}
          </div>
        ),
      )}
    </div>
  );
}

// ─── Task Detail Modal ──────────────────────────────────────────────────────
function TaskDetailModal({
  taskId,
  tenantId,
  agents,
  open,
  onClose,
  onApprove,
  onReject,
}: {
  taskId: number;
  tenantId: number;
  agents: Agent[];
  open: boolean;
  onClose: () => void;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
}) {
  const { data, isLoading } = useQuery<{
    task: Task;
    agent: { id: number; displayName: string; role: string } | null;
    messages: any[];
    runs: any[];
    children: Task[];
  }>({
    queryKey: ["/api/tenants", tenantId, "tasks", taskId, "detail"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tenantId}/tasks/${taskId}/detail`).then((r) => r.json()),
    enabled: open && taskId > 0,
    refetchInterval: open ? 8000 : false,
  });

  const { data: deliverables } = useQuery<{ items: { name: string; size: number }[] }>({
    queryKey: ["/api/tenants", tenantId, "tasks", taskId, "deliverables"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tenantId}/tasks/${taskId}/deliverables`).then((r) => r.json()),
    enabled: open && taskId > 0,
  });

  const task = data?.task;
  const agent = data?.agent;
  const msgs = data?.messages ?? [];
  const children = data?.children ?? [];
  const files = deliverables?.items ?? [];
  const isReview = task?.status === "review";

  const handleDownload = useCallback(async () => {
    const resp = await fetch(`/api/tenants/${tenantId}/tasks/${taskId}/deliverables/download`);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `task-${taskId}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [tenantId, taskId]);

  const sc = task ? STATUS_CONFIG[task.status as Status] : null;

  const runs = data?.runs ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden" style={{ height: "85vh", display: "flex", flexDirection: "column" }}>
        {isLoading || !task ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Fixed Header */}
            <div className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-foreground leading-tight">{task.title}</h2>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {sc && (
                      <Badge variant="outline" className={cn("text-xs", sc.color)}>
                        <sc.icon className="w-3 h-3 mr-1" />
                        {sc.label}
                      </Badge>
                    )}
                    <Badge variant="outline" className={cn("text-xs", PRIORITY_CONFIG[task.priority])}>
                      {task.priority}
                    </Badge>
                    {agent && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="w-3 h-3" />
                        {agent.displayName} ({agent.role})
                      </div>
                    )}
                  </div>
                </div>
                {isReview && (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button size="sm" variant="outline" className="border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-300" onClick={() => onApprove(task.id)}>
                      <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300" onClick={() => { onClose(); onReject(task.id); }}>
                      <MessageSquareWarning className="w-3.5 h-3.5 mr-1" /> Request Changes
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Tabs + scrollable body */}
            <Tabs defaultValue="output" className="flex-1 flex flex-col min-h-0">
              <div className="px-6 pt-3 pb-0 flex-shrink-0">
                <TabsList className="bg-muted/40 w-fit">
                  <TabsTrigger value="output" className="text-xs">Agent Output</TabsTrigger>
                  <TabsTrigger value="logs" className="text-xs">Logs ({runs.length})</TabsTrigger>
                  {files.length > 0 && <TabsTrigger value="files" className="text-xs">Files ({files.length})</TabsTrigger>}
                  {children.length > 0 && <TabsTrigger value="subtasks" className="text-xs">Sub-tasks ({children.length})</TabsTrigger>}
                  <TabsTrigger value="info" className="text-xs">Details</TabsTrigger>
                </TabsList>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="px-6 py-4">

                  {/* ── Output tab ─────────────────────────────── */}
                  <TabsContent value="output" className="mt-0 space-y-4">
                    {msgs.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground text-sm">
                        <Activity className="w-8 h-8 mx-auto mb-3 opacity-40" />
                        {task.status === "todo" || task.status === "in_progress"
                          ? "Agent is still working on this task..."
                          : "No output recorded for this task."}
                      </div>
                    ) : (
                      msgs.map((m) => (
                        <div key={m.id} className="border border-border rounded-lg overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
                            <span className="text-sm">{m.senderEmoji ?? "🤖"}</span>
                            <span className="text-xs font-medium text-foreground">{m.senderName}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {new Date(m.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <div className="px-3 py-3">
                            {m.content.includes("```") ? (
                              <RenderContent content={m.content} />
                            ) : (
                              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{m.content}</p>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </TabsContent>

                  {/* ── Logs tab ───────────────────────────────── */}
                  <TabsContent value="logs" className="mt-0 space-y-3">
                    {runs.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground text-sm">
                        <Activity className="w-8 h-8 mx-auto mb-3 opacity-40" />
                        No runs recorded yet.
                      </div>
                    ) : (
                      runs.map((r: any) => {
                        const events: any[] = r.events ?? [];
                        const statusColor = r.status === "ok" ? "text-green-400" : r.status === "running" ? "text-blue-400" : "text-destructive";
                        const statusBg = r.status === "ok" ? "bg-green-400/5 border-green-500/20" : r.status === "running" ? "bg-blue-400/5 border-blue-500/20" : "bg-destructive/5 border-destructive/20";
                        return (
                          <div key={r.id} className={cn("border rounded-lg overflow-hidden", statusBg)}>
                            <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border">
                              <Activity className={cn("w-3.5 h-3.5", statusColor)} />
                              <span className="text-xs font-medium text-foreground">Run #{r.id}</span>
                              <Badge variant="outline" className={cn("text-[10px] py-0 h-4", statusColor)}>{r.status}</Badge>
                              <span className="text-[10px] text-muted-foreground">{r.trigger}</span>
                              {r.durationMs && <span className="text-[10px] text-muted-foreground ml-auto">{(r.durationMs / 1000).toFixed(1)}s</span>}
                              {!r.durationMs && r.startedAt && <span className="text-[10px] text-muted-foreground ml-auto">{new Date(r.startedAt).toLocaleString()}</span>}
                            </div>
                            {r.summary && (
                              <div className="px-3 py-1.5 text-xs text-foreground/80 border-b border-border bg-muted/10">{r.summary}</div>
                            )}
                            {r.error && (
                              <div className="px-3 py-1.5 text-xs text-destructive border-b border-border bg-destructive/5">{r.error}</div>
                            )}
                            {events.length > 0 && (
                              <div className="px-3 py-2 space-y-1">
                                {events.map((e: any, ei: number) => {
                                  const kindColor = e.kind === "stderr" ? "text-destructive" : e.kind === "event" ? "text-blue-400" : e.kind === "system" ? "text-muted-foreground" : "text-foreground/70";
                                  return (
                                    <div key={ei} className="flex items-start gap-2 text-[11px] font-mono leading-relaxed">
                                      <span className={cn("flex-shrink-0 w-12 text-right", kindColor)}>[{e.kind}]</span>
                                      <span className="text-foreground/70 break-all">{e.message}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </TabsContent>

                  {/* ── Files tab ──────────────────────────────── */}
                  <TabsContent value="files" className="mt-0">
                    <div className="space-y-2">
                      {files.map((f, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-muted/20">
                          <FileCode className="w-4 h-4 text-primary flex-shrink-0" />
                          <span className="text-sm text-foreground font-mono flex-1 truncate">{f.name}</span>
                          <span className="text-xs text-muted-foreground">{f.size > 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`}</span>
                        </div>
                      ))}
                      <Button size="sm" variant="outline" className="mt-3" onClick={handleDownload}>
                        <Download className="w-3.5 h-3.5 mr-1" /> Download All (.zip)
                      </Button>
                    </div>
                  </TabsContent>

                  {/* ── Subtasks tab ───────────────────────────── */}
                  <TabsContent value="subtasks" className="mt-0">
                    <div className="space-y-2">
                      {children.map((c) => {
                        const cAgent = agents.find((a) => a.id === c.assignedAgentId);
                        const cSc = STATUS_CONFIG[c.status as Status];
                        return (
                          <div key={c.id} className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border", cSc?.bg)}>
                            <cSc.icon className={cn("w-4 h-4 flex-shrink-0", cSc?.color)} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground truncate">{c.title}</p>
                              {cAgent && <p className="text-xs text-muted-foreground">{cAgent.displayName} ({cAgent.role})</p>}
                            </div>
                            <Badge variant="outline" className={cn("text-xs flex-shrink-0", cSc?.color)}>
                              {cSc?.label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </TabsContent>

                  {/* ── Details tab ────────────────────────────── */}
                  <TabsContent value="info" className="mt-0 space-y-4">
                    {task.description && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Description</h4>
                        <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed bg-muted/20 rounded-lg px-3 py-2 border border-border">
                          {task.description}
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Status</h4>
                        <p className={cn("text-sm font-medium", sc?.color)}>{sc?.label}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Priority</h4>
                        <p className="text-sm font-medium">{task.priority}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Assigned To</h4>
                        <p className="text-sm">{agent ? `${agent.displayName} (${agent.role})` : "Unassigned"}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Created</h4>
                        <p className="text-sm text-muted-foreground">{new Date(task.createdAt).toLocaleString()}</p>
                      </div>
                      {task.completedAt && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Completed</h4>
                          <p className="text-sm text-muted-foreground">{new Date(task.completedAt).toLocaleString()}</p>
                        </div>
                      )}
                      {task.parentTaskId && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Parent Task</h4>
                          <p className="text-sm text-muted-foreground">#{task.parentTaskId}</p>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                </div>
              </div>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Task Card ──────────────────────────────────────────────────────────────
interface TaskCardProps {
  task: Task;
  agents: Agent[];
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
  onOpenDetail?: (id: number) => void;
  dragAttributes?: Record<string, any>;
  dragListeners?: Record<string, any>;
  dragRef?: (node: HTMLElement | null) => void;
  dragStyle?: React.CSSProperties;
}

function TaskCard({ task, agents, onStatusChange, onDelete, onApprove, onReject, onOpenDetail, dragAttributes, dragListeners, dragRef, dragStyle }: TaskCardProps) {
  const agent = agents.find(a => a.id === task.assignedAgentId);
  const s = STATUS_CONFIG[task.status as Status];
  const isReview = task.status === "review";
  return (
    <div
      ref={dragRef}
      style={dragStyle}
      {...dragAttributes}
      {...dragListeners}
      onClick={() => onOpenDetail?.(task.id)}
      className={cn(
        "group border border-border rounded-lg p-3 cursor-pointer hover:border-primary/40 transition-all bg-card",
        "touch-none select-none",
        s.bg,
        isReview && "border-yellow-400/40 ring-1 ring-yellow-400/20",
      )}
      data-testid={`task-${task.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-foreground leading-tight">{task.title}</p>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
          data-testid={`delete-task-${task.id}`}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2 leading-relaxed">{task.description}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {agent && (
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-primary/10 flex items-center justify-center text-xs">
                {agent.displayName[0]}
              </div>
              <span className="text-xs text-muted-foreground">{agent.displayName}</span>
            </div>
          )}
        </div>
        <Badge variant="outline" className={cn("text-xs py-0 h-4", PRIORITY_CONFIG[task.priority])}>
          {task.priority}
        </Badge>
      </div>
      {task.goalTag && (
        <div className="mt-2 text-xs text-muted-foreground/60 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
          {task.goalTag}
        </div>
      )}

      {isReview && onApprove && onReject ? (
        <div className="flex gap-1.5 mt-2.5">
          <button
            onClick={(e) => { e.stopPropagation(); onApprove(task.id); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-green-500/10 text-green-400 hover:bg-green-500/25 hover:text-green-300 font-medium transition-all"
          >
            <ThumbsUp className="w-3 h-3" /> Approve
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReject(task.id); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-orange-500/10 text-orange-400 hover:bg-orange-500/25 hover:text-orange-300 font-medium transition-all"
          >
            <MessageSquareWarning className="w-3 h-3" /> Request Changes
          </button>
        </div>
      ) : (
        <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-all">
          {STATUSES.filter(s => s !== task.status).map(ns => (
            <button
              key={ns}
              onClick={(e) => { e.stopPropagation(); onStatusChange(task.id, ns); }}
              className="text-xs px-1.5 py-0.5 rounded bg-muted hover:bg-primary/20 text-muted-foreground hover:text-primary transition-all"
            >
              → {ns.replace("_", " ")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableTaskCard({
  task,
  agents,
  onStatusChange,
  onDelete,
  onApprove,
  onReject,
  onOpenDetail,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task:${task.id}`,
    data: { type: "task", taskId: task.id },
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };
  return (
    <TaskCard
      task={task}
      agents={agents}
      onStatusChange={onStatusChange}
      onDelete={onDelete}
      onApprove={onApprove}
      onReject={onReject}
      onOpenDetail={onOpenDetail}
      dragAttributes={attributes}
      dragListeners={listeners}
      dragRef={setNodeRef}
      dragStyle={style}
    />
  );
}

function KanbanColumn({
  status,
  label,
  icon: Icon,
  color,
  tasks,
  agents,
  onStatusChange,
  onDelete,
  onApprove,
  onReject,
  onOpenDetail,
}: {
  status: Status;
  label: string;
  icon: any;
  color: string;
  tasks: Task[];
  agents: Agent[];
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
  onOpenDetail?: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { type: "column", status } });
  return (
    <div key={status} className="flex flex-col gap-3 kanban-col">
      <div className="flex items-center gap-2 px-1">
        <Icon className={cn("w-3.5 h-3.5", color)} />
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className="ml-auto text-xs text-muted-foreground bg-muted rounded-full px-1.5">{tasks.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "space-y-2 rounded-lg p-1 transition-colors",
          isOver ? "bg-primary/5" : "bg-transparent",
        )}
      >
        <SortableContext items={tasks.map((t) => `task:${t.id}`)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <SortableTaskCard
              key={t.id}
              task={t}
              agents={agents}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
              onApprove={onApprove}
              onReject={onReject}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className={cn(
            "border border-dashed border-border rounded-lg p-4 text-center text-xs text-muted-foreground/60",
            isOver && "border-primary/50 text-primary/70",
          )}>
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}

export default function Tasks() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const { toast } = useToast();
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [showCreate, setShowCreate] = useState(false);
  const form = useForm({ defaultValues: { title: "", description: "", priority: "medium", assignedAgentId: "", teamId: "", goalTag: "", status: "todo" } });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tenants", tid, "tasks"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/tasks`).then(r => r.json()),
  });

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then(r => r.json()),
  });

  const { data: ceoControl } = useQuery<{ mode: "agent" | "me" }>({
    queryKey: ["/api/tenants", tid, "ceo", "control"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ceo/control`).then((r) => r.json()),
    enabled: tid > 0,
  });

  // No auth yet: treat the org's CEO agent as "me" for assignment shortcuts.
  const meAgent = useMemo(() => {
    const byRole = agents.find((a) => String(a.role).toLowerCase() === "ceo");
    if (byRole) return byRole;
    return agents.find((a) => String(a.displayName).trim().toLowerCase() === "ceo") ?? null;
  }, [agents]);

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/tenants", tid, "teams"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/teams`).then(r => r.json()),
  });

  const updateTask = useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Record<string, any>) =>
      apiRequest("PATCH", `/api/tasks/${id}`, data).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] }),
  });

  const deleteTask = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] });
      toast({ title: "Task deleted" });
    },
  });

  const createTask = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/tenants/${tid}/tasks`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] });
      toast({ title: "Task created" });
      setShowCreate(false);
      form.reset();
    },
  });

  const onSubmit = (data: any) => {
    const rawAssigned = data.assignedAgentId;
    const resolvedAssigned =
      rawAssigned === "__me__"
        ? (meAgent ? String(meAgent.id) : "")
        : rawAssigned === "__none__"
          ? ""
          : rawAssigned;
    createTask.mutate({
      ...data,
      assignedAgentId: resolvedAssigned ? Number(resolvedAssigned) : null,
      teamId: data.teamId ? Number(data.teamId) : null,
    });
  };

  const tasksByStatus = STATUSES.reduce((acc, s) => {
    acc[s] = tasks.filter(t => t.status === s);
    return acc;
  }, {} as Record<Status, Task[]>);

  const [rejectTaskId, setRejectTaskId] = useState<number | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null);

  const approveTask = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/${id}/approve`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] });
      toast({ title: "Task approved", description: "Task has been marked as done." });
    },
  });

  const rejectTask = useMutation({
    mutationFn: ({ id, feedback }: { id: number; feedback: string }) =>
      apiRequest("POST", `/api/tasks/${id}/reject`, { feedback }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] });
      toast({ title: "Changes requested", description: "Agent will re-work the task with your feedback." });
      setRejectTaskId(null);
      setRejectFeedback("");
    },
  });

  const reviewCount = useMemo(() => tasks.filter(t => t.status === "review").length, [tasks]);

  const [activeDragTaskId, setActiveDragTaskId] = useState<number | null>(null);
  const activeDragTask = useMemo(
    () => (activeDragTaskId ? tasks.find((t) => t.id === activeDragTaskId) ?? null : null),
    [activeDragTaskId, tasks],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{tasks.length} tasks · {tasks.filter(t => t.status === "in_progress").length} in progress</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["kanban", "list"] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={cn("px-3 py-1.5 text-xs font-medium transition-all", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {v === "kanban" ? "Kanban" : "List"}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="create-task-btn">
            <Plus className="w-3.5 h-3.5 mr-1" /> New Task
          </Button>
        </div>
      </div>

      {reviewCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-400/30 bg-yellow-400/5 px-4 py-3">
          <Eye className="w-4 h-4 text-yellow-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-300">{reviewCount} task{reviewCount > 1 ? "s" : ""} awaiting your review</p>
            <p className="text-xs text-muted-foreground">Review agent output and approve or request changes before marking as done.</p>
          </div>
        </div>
      )}

      {view === "kanban" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(e) => {
            const id = String(e.active.id);
            if (id.startsWith("task:")) setActiveDragTaskId(Number(id.split(":")[1]));
          }}
          onDragCancel={() => setActiveDragTaskId(null)}
          onDragEnd={(e) => {
            const activeId = String(e.active.id);
            const overId = e.over ? String(e.over.id) : "";
            setActiveDragTaskId(null);
            if (!activeId.startsWith("task:") || !overId.startsWith("col:")) return;
            const taskId = Number(activeId.split(":")[1]);
            const nextStatus = overId.split(":")[1] as Status;
            const current = tasks.find((t) => t.id === taskId);
            if (!current || current.status === nextStatus) return;
            updateTask.mutate({ id: taskId, status: nextStatus });
          }}
        >
          <div className="grid grid-cols-5 gap-4 overflow-x-auto pb-4" style={{ minWidth: "900px" }}>
            {STATUSES.map((s) => {
              const sc = STATUS_CONFIG[s];
              return (
                <KanbanColumn
                  key={s}
                  status={s}
                  label={sc.label}
                  icon={sc.icon}
                  color={sc.color}
                  tasks={tasksByStatus[s]}
                  agents={agents}
                  onStatusChange={(id, ns) => updateTask.mutate({ id, status: ns })}
                  onDelete={(id) => deleteTask.mutate(id)}
                  onApprove={(id) => approveTask.mutate(id)}
                  onReject={(id) => { setRejectTaskId(id); setRejectFeedback(""); }}
                  onOpenDetail={(id) => setDetailTaskId(id)}
                />
              );
            })}
          </div>
          <DragOverlay>
            {activeDragTask ? (
              <div className="w-[260px]">
                <TaskCard
                  task={activeDragTask}
                  agents={agents}
                  onStatusChange={() => {}}
                  onDelete={() => {}}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Task</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Priority</th>
                  <th className="text-left px-4 py-3 font-medium">Assigned</th>
                  <th className="text-left px-4 py-3 font-medium">Goal</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => {
                  const agent = agents.find(a => a.id === t.assignedAgentId);
                  const sc = STATUS_CONFIG[t.status as Status];
                  const Icon = sc.icon;
                  return (
                    <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`task-row-${t.id}`} onClick={() => setDetailTaskId(t.id)}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{t.title}</p>
                        {t.description && <p className="text-xs text-muted-foreground truncate max-w-xs">{t.description}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <div className={cn("flex items-center gap-1.5 text-xs font-medium", sc.color)}>
                          <Icon className="w-3 h-3" />
                          {sc.label}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn("text-xs py-0", PRIORITY_CONFIG[t.priority])}>
                          {t.priority}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{agent?.displayName ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{t.goalTag ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {t.status === "review" && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); approveTask.mutate(t.id); }}
                                className="text-green-400 hover:text-green-300 transition-colors"
                                title="Approve"
                              >
                                <ThumbsUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setRejectTaskId(t.id); setRejectFeedback(""); }}
                                className="text-orange-400 hover:text-orange-300 transition-colors"
                                title="Request Changes"
                              >
                                <MessageSquareWarning className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button onClick={() => deleteTask.mutate(t.id)} className="text-muted-foreground hover:text-destructive transition-colors" data-testid={`delete-task-${t.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Task detail modal */}
      {detailTaskId !== null && (
        <TaskDetailModal
          taskId={detailTaskId}
          tenantId={tid}
          agents={agents}
          open={true}
          onClose={() => setDetailTaskId(null)}
          onApprove={(id) => { approveTask.mutate(id); setDetailTaskId(null); }}
          onReject={(id) => { setDetailTaskId(null); setRejectTaskId(id); setRejectFeedback(""); }}
        />
      )}

      {/* Rejection feedback dialog */}
      <Dialog open={rejectTaskId !== null} onOpenChange={(open) => { if (!open) { setRejectTaskId(null); setRejectFeedback(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquareWarning className="w-4 h-4 text-orange-400" />
              Request Changes
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Provide feedback so the agent knows what to improve. The task will be re-assigned and the agent will re-work it.
            </p>
            <TextareaBase
              placeholder="What needs to change? Be specific..."
              rows={4}
              value={rejectFeedback}
              onChange={(e) => setRejectFeedback(e.target.value)}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTaskId(null); setRejectFeedback(""); }}>Cancel</Button>
            <Button
              variant="default"
              className="bg-orange-500 hover:bg-orange-600 text-white"
              disabled={rejectTask.isPending}
              onClick={() => { if (rejectTaskId) rejectTask.mutate({ id: rejectTaskId, feedback: rejectFeedback }); }}
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              {rejectTask.isPending ? "Sending..." : "Send Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input placeholder="Task title..." {...field} data-testid="task-title-input" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea placeholder="Task details..." rows={3} {...field} data-testid="task-desc-input" /></FormControl>
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="priority" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {["urgent", "high", "medium", "low"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="assignedAgentId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assign to</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        if (v === "__me__" && !meAgent) {
                          toast({
                            title: "No CEO found",
                            description: "Hire an agent with role “CEO” to enable “Assign to me”.",
                            variant: "destructive",
                          });
                          field.onChange("__none__");
                          return;
                        }
                        field.onChange(v);
                      }}
                      defaultValue={field.value}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">No assignee</SelectItem>
                        {meAgent && (
                          <SelectItem value="__me__">
                            {ceoControl?.mode === "me" ? "Assign to me" : "Assign to me (CEO)"}
                          </SelectItem>
                        )}
                        {agents.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.displayName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="goalTag" render={({ field }) => (
                <FormItem>
                  <FormLabel>Goal</FormLabel>
                  <FormControl><Input placeholder="e.g. Reach $1M ARR" {...field} /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" disabled={createTask.isPending} data-testid="submit-task">
                  {createTask.isPending ? "Creating..." : "Create Task"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
