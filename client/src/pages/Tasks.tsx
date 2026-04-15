import { useMemo, useState } from "react";
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
import { Plus, CheckSquare, AlertTriangle, Clock, Loader, Eye, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface TaskCardProps {
  task: Task;
  agents: Agent[];
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  dragAttributes?: Record<string, any>;
  dragListeners?: Record<string, any>;
  dragRef?: (node: HTMLElement | null) => void;
  dragStyle?: React.CSSProperties;
}

function TaskCard({ task, agents, onStatusChange, onDelete, dragAttributes, dragListeners, dragRef, dragStyle }: TaskCardProps) {
  const agent = agents.find(a => a.id === task.assignedAgentId);
  const s = STATUS_CONFIG[task.status as Status];
  return (
    <div
      ref={dragRef}
      style={dragStyle}
      {...dragAttributes}
      {...dragListeners}
      className={cn(
        "group border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-all bg-card",
        "touch-none select-none",
        s.bg,
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
      {/* Status change buttons */}
      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-all">
        {STATUSES.filter(s => s !== task.status).map(ns => (
          <button
            key={ns}
            onClick={() => onStatusChange(task.id, ns)}
            className="text-xs px-1.5 py-0.5 rounded bg-muted hover:bg-primary/20 text-muted-foreground hover:text-primary transition-all"
          >
            → {ns.replace("_", " ")}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortableTaskCard({
  task,
  agents,
  onStatusChange,
  onDelete,
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
}: {
  status: Status;
  label: string;
  icon: any;
  color: string;
  tasks: Task[];
  agents: Agent[];
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
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
                    <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`task-row-${t.id}`}>
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
                        <button onClick={() => deleteTask.mutate(t.id)} className="text-muted-foreground hover:text-destructive transition-colors" data-testid={`delete-task-${t.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

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
