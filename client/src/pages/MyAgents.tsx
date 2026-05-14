import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, readJsonOrApiHint } from "@/lib/queryClient";
import type { Agent, AgentDefinition, Tenant } from "@shared/schema";
import { useTenantContext } from "@/tenant/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle,
  Clock,
  Cpu,
  DollarSign,
  Loader2,
  Lock,
  ListTree,
  Pause,
  Play,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { cn, deployedAgentEmoji, formatDistanceToNow, agentCardStatus } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { HireAgentWizard } from "@/components/HireAgentWizard";
import { AddAgentDialog } from "@/components/AddAgentDialog";
import { EmojiPicker } from "@/components/EmojiPicker";
import {
  appendImportExtrasToAgentMarkdown,
  parseImportedBundleEntries,
  extractImportedBundlePaths,
  extractImportedBundleSection,
  IMPORT_DOC_FILENAMES,
  MAX_IMPORT_ZIP_ARCHIVE_BYTES,
  parseImportUploadFiles,
  type ImportBundleExtraText,
  type ImportDocFilename,
} from "@/lib/parseAgentImportUpload";
import { OPENROUTER_MODELS } from "@/lib/openrouterModels";
import { formatSkillsMarkdown } from "@shared/formatSkillsMarkdown";

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  running: { label: "Running", dot: "bg-green-500 status-running", badge: "bg-green-500/10 text-green-400 border-green-500/20" },
  idle: { label: "Idle", dot: "bg-yellow-500", badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  paused: { label: "Paused", dot: "bg-orange-500", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  error: { label: "Error", dot: "bg-destructive", badge: "bg-destructive/10 text-destructive border-destructive/25" },
  terminated: { label: "Terminated", dot: "bg-red-500", badge: "bg-red-500/10 text-red-400 border-red-500/20" },
};

const IMPORT_DOC_DESCRIPTIONS: Record<ImportDocFilename, string> = {
  "SOUL.md": "Persona & identity",
  "AGENT.md": "Agent behavior (Hermes AGENTS.md → this on import)",
  "HEARTBEAT.md": "Heartbeat checklist",
  "TOOLS.md": "Tools notes",
  "SKILLS.md": "Skills (instance override)",
};

const IMPORT_DOC_FILES = IMPORT_DOC_FILENAMES.map((filename) => ({
  filename,
  description: IMPORT_DOC_DESCRIPTIONS[filename],
}));

/** Keys returned by `GET …/runtime-context` → `mergedInstructionDocs` (same order as on-disk bundle). */
const DEPLOYED_INSTRUCTION_DOC_KEYS = ["SOUL", "AGENT", "HEARTBEAT", "TOOLS", "SKILLS"] as const;

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4": "Claude Opus 4",
  "claude-3-5-sonnet": "Claude 3.5 Sonnet",
  "gpt-4o": "GPT-4o",
};

/** UI adapter ids → backend `adapterType` + default CLI command (same mapping as Add Agent). */
const IMPORT_ADAPTER_TYPES = [
  { id: "hermes", label: "Hermes Agent", backend: "hermes" as const, cmd: "hermes" },
  { id: "claude-code", label: "Claude Code", backend: "cli" as const, cmd: "claude" },
  { id: "codex", label: "Codex", backend: "cli" as const, cmd: "codex" },
  { id: "gemini-cli", label: "Gemini CLI", backend: "cli" as const, cmd: "gemini" },
  { id: "opencode", label: "OpenCode", backend: "cli" as const, cmd: "opencode" },
  { id: "cursor", label: "Cursor", backend: "cli" as const, cmd: "cursor" },
  { id: "openclaw", label: "OpenClaw Gateway", backend: "openclaw" as const, cmd: "openclaw" },
] as const;

type ImportAdapterUiId = (typeof IMPORT_ADAPTER_TYPES)[number]["id"];

function importAdapterBackend(ui: ImportAdapterUiId): "hermes" | "cli" | "openclaw" {
  return IMPORT_ADAPTER_TYPES.find((r) => r.id === ui)?.backend ?? "hermes";
}

function importAdapterDefaultCmd(ui: ImportAdapterUiId): string {
  return IMPORT_ADAPTER_TYPES.find((r) => r.id === ui)?.cmd ?? "hermes";
}

/** Broad `accept` so Safari/macOS still offers .zip (MIME is often generic). */
const IMPORT_BUNDLE_FILE_ACCEPT =
  ".zip,.json,.md,.markdown,.mdx,.txt,.yaml,.yml,application/json,text/plain,text/markdown,application/zip,application/x-zip-compressed,application/octet-stream";

/** Short guidance in the modal; raw messages live under “Cause”. */
function startRunFailureFriendly(fr: { reason?: string; error?: string }) {
  switch (fr.reason) {
    case "llm_error":
    case "llm":
      return "LLM request failed — check API keys or provider credits (e.g. OpenRouter balance).";
    case "cooldown":
      return "Run blocked by cooldown; wait a few seconds and try again.";
    case "busy":
      return "Another run is still in progress for this agent.";
    case "prompt_error":
      return "Failed to build the agent prompt — check instance docs and configuration.";
    default:
      break;
  }
  if (fr.reason) return `The run stopped (${String(fr.reason).replace(/_/g, " ")}). See details below if available.`;
  if (fr.error?.trim()) return "The startup run did not complete. See the error detail below.";
  return "The startup run did not complete.";
}

type AgentStartFailCause = { error?: string; reason?: string; adapter?: string };

/** From GET/PATCH `latestFinishedRun` when the card shows Error from last finished run. */
type LatestFinishedRunDto = {
  id: number;
  status: string;
  trigger?: string;
  error?: string | null;
  summary?: string | null;
};

function causeFromFirstRun(fr: { ok?: boolean; adapter?: string; reason?: string; error?: string }): AgentStartFailCause | undefined {
  const error = typeof fr.error === "string" && fr.error.trim() ? fr.error.trim() : undefined;
  const reason = typeof fr.reason === "string" && fr.reason.trim() ? fr.reason.trim() : undefined;
  const adapter = typeof fr.adapter === "string" && fr.adapter.trim() ? fr.adapter.trim() : undefined;
  if (!error && !reason && !adapter) return undefined;
  return { error, reason, adapter };
}

function causeFromLatestFinishedRun(lr: LatestFinishedRunDto | null | undefined): AgentStartFailCause {
  if (!lr) {
    return {
      reason: "last_run_unknown",
      error: "Latest finished run failed, but no run details were returned. Open the Run tab for the log.",
    };
  }
  const lines: string[] = [`Run #${lr.id}`];
  if (lr.trigger) lines.push(`Trigger: ${lr.trigger}`);
  if (lr.error?.trim()) lines.push(lr.error.trim());
  if (lr.summary?.trim()) lines.push(lr.summary.trim());
  const errorBlock =
    lines.length > 1
      ? lines.join("\n")
      : `Run #${lr.id} — no error or summary stored. Open the Run tab for stderr / events.`;
  const errTrim = lr.error?.trim();
  const reason =
    errTrim && errTrim.length <= 80
      ? errTrim
      : lr.status === "failed"
        ? "run_failed"
        : lr.status;
  return { error: errorBlock, reason };
}

function causeHasDetail(c?: AgentStartFailCause): c is AgentStartFailCause {
  return !!(c && (c.error || c.reason || c.adapter));
}

/** One-line headline for the error modal (first meaningful line of technical error, else summary). */
function startResultErrorHeadline(summary: string, cause?: AgentStartFailCause): string {
  const raw = cause?.error?.trim();
  if (raw) {
    const line = raw.split("\n").find((l) => l.trim().length > 0)?.trim() ?? raw;
    return line.length > 260 ? `${line.slice(0, 257)}…` : line;
  }
  const s = summary.trim();
  if (!s) return "Something went wrong. Open the Run tab for the full log.";
  return s.length > 260 ? `${s.slice(0, 257)}…` : s;
}

function headlineDiffersFromSummaryFirstLine(headline: string, summary: string): boolean {
  const first = (summary.split("\n")[0] ?? "").trim().toLowerCase();
  return first.length > 0 && headline.trim().toLowerCase() !== first;
}

/** Single popup after Start: success or failure, with optional technical details. */
type AgentStartResultOpen = {
  open: true;
  outcome: "success" | "error";
  title: string;
  agentName: string;
  summary: string;
  isCeo: boolean;
  /** Error path: raw / structured cause. */
  cause?: AgentStartFailCause;
  /** Success path: from `firstRunOnStart` when present. */
  successMeta?: { adapter?: string; startupRunCompleted?: boolean };
};

type AgentStartResultState = { open: false } | AgentStartResultOpen;

const AGENT_START_RESULT_CLOSED: AgentStartResultState = { open: false };

export default function MyAgents() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  /** Modal when Start fails or status PATCH errors (popup instead of toast). */
  const [agentStartResult, setAgentStartResult] = useState<AgentStartResultState>(AGENT_START_RESULT_CLOSED);
  const closeAgentStartResult = useCallback(() => {
    setAgentStartResult(AGENT_START_RESULT_CLOSED);
  }, []);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  /** Markdown loaded from per-doc file pickers (optional overlays on hire/import). */
  const [importDocMarkdown, setImportDocMarkdown] = useState<Partial<Record<ImportDocFilename, string>>>({});
  const [importBundleHint, setImportBundleHint] = useState<string | null>(null);
  /** When true, show `importBundleHint` as a warning (e.g. zip opened but nothing importable). */
  const [importBundleHintWarn, setImportBundleHintWarn] = useState(false);
  const [importBundleScanning, setImportBundleScanning] = useState(false);
  /** Shown after a scan so native inputs don’t look “stuck” on No file chosen (we clear `value` for re-pick). */
  const [importLastScanLabel, setImportLastScanLabel] = useState<string | null>(null);
  /** 0 = zip upload & scan, 1 = runtime adapter, 2 = review */
  const [importWizardStep, setImportWizardStep] = useState(0);
  /** Shown after scan — paths / labels returned from the parser (zip contents signal). */
  const [importZipDetectedPaths, setImportZipDetectedPaths] = useState<string[]>([]);
  /** Non-canonical text from zip/folder — merged into AGENT.md on Import for Cortex. */
  const [importBundleExtraText, setImportBundleExtraText] = useState<ImportBundleExtraText[]>([]);
  /** Manifest of scanned paths (used to show “all .md files” after import). */
  const [importBundleMatchedPaths, setImportBundleMatchedPaths] = useState<string[]>([]);
  /** Inline message in the import dialog (validation, parse, upload read, API errors) — no corner toasts for these. */
  const [importWizardError, setImportWizardError] = useState<string | null>(null);
  const [importAdapterUiId, setImportAdapterUiId] = useState<ImportAdapterUiId>("hermes");
  const [importLlmProvider, setImportLlmProvider] = useState<"openrouter" | "ollama">("openrouter");
  const [importCommand, setImportCommand] = useState("hermes");
  const [importRuntimeModel, setImportRuntimeModel] = useState("");

  const [detailsAgentId, setDetailsAgentId] = useState<number | null>(null);
  /** Agent details modal (Dashboard / Docs / Skills / Run / Add skills → SKILLS.md). */
  const [agentDetailsTab, setAgentDetailsTab] = useState("dashboard");
  /** Expanded run log in agent modal (fetches `GET …/runs/:runId` → events). */
  const [openRunLogId, setOpenRunLogId] = useState<number | null>(null);

  const { data: ceoControl } = useQuery<{ enabled?: boolean; mode?: "agent" | "me" }>({
    queryKey: ["/api/tenants", tid, "ceo", "control"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ceo/control`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const { data: agents = [], isLoading } = useQuery<
    (Agent & {
      cardModel?: string;
      displayStatus?: string;
      latestFinishedRun?: LatestFinishedRunDto;
    })[]
  >({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then((r) => r.json()),
    enabled: tid > 0,
    /** Global default is staleTime: Infinity — without this, cards never pick up cardModel / emoji after server fixes. */
    staleTime: 0,
    refetchOnMount: "always",
  });

  const visibleAgents = useMemo(() => {
    if (ceoControl?.enabled === false) {
      return agents.filter((a) => String(a.role).toLowerCase() !== "ceo");
    }
    return agents;
  }, [agents, ceoControl?.enabled]);

  const { data: defs = [] } = useQuery<AgentDefinition[]>({
    queryKey: ["/api/agent-definitions"],
    queryFn: () => apiRequest("GET", "/api/agent-definitions").then(r => r.json()),
  });

  const buildImportHirePayload = useCallback((): Record<string, unknown> => {
    let base: Record<string, unknown> = {};
    try {
      if (importJson.trim()) base = JSON.parse(importJson) as Record<string, unknown>;
    } catch {
      base = {};
    }
    const definitionName = (String(base.definitionName ?? "") || String(defs[0]?.name ?? "")).trim();
    const def = defs.find((d) => String(d.name) === definitionName) ?? defs[0];
    const displayName = String(base.displayName ?? "Imported agent").trim() || "Imported agent";
    const role =
      typeof base.role === "string" && base.role.trim()
        ? base.role
        : String(def?.division ?? "Agent");
    return {
      ...base,
      displayName,
      ...(definitionName ? { definitionName } : {}),
      role,
    };
  }, [importJson, defs]);

  const importDraftObject = useMemo((): Record<string, unknown> => {
    if (!importJson.trim()) return {};
    try {
      return JSON.parse(importJson) as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [importJson]);

  const importJsonParseOk = useMemo(() => {
    if (!importJson.trim()) return false;
    try {
      JSON.parse(importJson);
      return true;
    } catch {
      return false;
    }
  }, [importJson]);

  /** Definition row for the import draft (picker default + review copy). */
  const importReviewDef = useMemo(() => {
    const id = Number(importDraftObject.definitionId);
    if (Number.isFinite(id) && id > 0) {
      const byId = defs.find((d) => d.id === id);
      if (byId) return byId;
    }
    const name = String(importDraftObject.definitionName ?? "").trim().toLowerCase();
    if (name) return defs.find((d) => String(d.name).trim().toLowerCase() === name) ?? null;
    return null;
  }, [importDraftObject.definitionId, importDraftObject.definitionName, defs]);

  /** Merge fields into hire JSON; pass `undefined` as a value to remove a key (e.g. clear definitionId when picking by name). */
  const patchImportJson = useCallback((patch: Record<string, unknown | undefined>) => {
    setImportJson((prev) => {
      let o: Record<string, unknown> = {};
      try {
        if (prev.trim()) o = JSON.parse(prev) as Record<string, unknown>;
      } catch {
        /* keep empty */
      }
      const next: Record<string, unknown> = { ...o };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v as unknown;
      }
      return JSON.stringify(next, null, 2);
    });
  }, []);

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["/api/tenants", tid],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}`).then(r => r.json()),
  });

  const { data: importOllamaModelsRes, isLoading: importOllamaModelsLoading, isError: importOllamaModelsError } = useQuery<{
    baseUsed: string;
    models: string[];
  }>({
    queryKey: ["/api/tenants", tid, "ollama", "models", "import", tenant?.ollamaBaseUrl ?? ""],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ollama/models`).then((r) => readJsonOrApiHint(r)),
    enabled: importOpen && tid > 0 && importWizardStep === 1 && importLlmProvider === "ollama",
    retry: false,
  });

  useEffect(() => {
    if (importLlmProvider !== "ollama") return;
    const list = importOllamaModelsRes?.models;
    if (!list?.length) return;
    setImportRuntimeModel((prev) => {
      const cur = prev.trim();
      if (cur && list.includes(cur)) return prev;
      return list[0]!;
    });
  }, [importLlmProvider, importOllamaModelsRes?.models]);

  /** OpenRouter: default model when Runtime step opens so import payload always carries runtimeModel. */
  useEffect(() => {
    if (!importOpen || importWizardStep !== 1) return;
    if (importLlmProvider !== "openrouter") return;
    if (importRuntimeModel.trim()) return;
    const free = OPENROUTER_MODELS.find((m) => m.id.endsWith(":free"))?.id ?? OPENROUTER_MODELS[0]?.id;
    if (free) setImportRuntimeModel(free);
  }, [importOpen, importWizardStep, importLlmProvider, importRuntimeModel]);

  useEffect(() => {
    setImportCommand(importAdapterDefaultCmd(importAdapterUiId));
  }, [importAdapterUiId]);

  /** Scan can finish before /api/agent-definitions loads — fill draft hire JSON once we have docs or bundle extras. */
  useEffect(() => {
    if (!importOpen || importWizardStep !== 0) return;
    if (importJson.trim() || defs.length === 0) return;
    const docKeys = Object.keys(importDocMarkdown);
    if (docKeys.length === 0 && importBundleExtraText.length === 0) return;
    const d0 = defs.find((d) => String(d.name ?? "").trim().length > 0) ?? defs[0];
    if (!d0?.name) return;
    setImportJson(
      JSON.stringify(
        {
          displayName: "Imported agent",
          role: String(d0.division ?? "Agent"),
          definitionName: String(d0.name),
        },
        null,
        2,
      ),
    );
  }, [importOpen, importWizardStep, importDocMarkdown, importBundleExtraText, importJson, defs]);

  const importDialogWasOpen = useRef(false);
  useEffect(() => {
    if (!importOpen) {
      importDialogWasOpen.current = false;
      return;
    }
    if (importDialogWasOpen.current) return;
    importDialogWasOpen.current = true;
    setImportWizardStep(0);
    setImportZipDetectedPaths([]);
    setImportBundleExtraText([]);
    setImportBundleMatchedPaths([]);
    const orgAdapter = String(tenant?.adapterType ?? "hermes").toLowerCase();
    setImportAdapterUiId(orgAdapter === "openclaw" ? "openclaw" : "hermes");
    setImportLlmProvider("openrouter");
    setImportRuntimeModel("");
    setImportWizardError(null);
  }, [importOpen, tenant?.adapterType]);

  const selectedAgent = useMemo(
    () => (detailsAgentId ? visibleAgents.find((a) => a.id === detailsAgentId) ?? null : null),
    [visibleAgents, detailsAgentId],
  );
  const selectedDef = useMemo(
    () => (selectedAgent ? defs.find((d) => d.id === selectedAgent.definitionId) ?? null : null),
    [defs, selectedAgent],
  );

  const { data: runtimeCtx } = useQuery<any>({
    // Bump key when runtime-context payload shape changes so old caches don’t omit `mergedInstructionDocs`.
    queryKey: ["/api/tenants", tid, "agents", selectedAgent?.id ?? 0, "runtime-context", "v2-merged-docs"],
    queryFn: () =>
      apiRequest("GET", `/api/tenants/${tid}/agents/${selectedAgent!.id}/runtime-context`).then((r) => r.json()),
    enabled: tid > 0 && !!selectedAgent?.id,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const [skillsDraft, setSkillsDraft] = useState("");
  const skillsFileInputRef = useRef<HTMLInputElement>(null);
  const hasInstanceSkillsOnDisk = !!(runtimeCtx?.hasInstanceSkillsFile && Number(runtimeCtx?.agent?.id) === Number(selectedAgent?.id));
  const librarySkillsBaseline =
    runtimeCtx && Number(runtimeCtx.agent?.id) === Number(selectedAgent?.id)
      ? String(runtimeCtx.skills?.markdown ?? "")
      : "";
  useEffect(() => {
    if (!selectedAgent?.id || detailsAgentId == null) {
      setSkillsDraft("");
      return;
    }
    if (!runtimeCtx || Number(runtimeCtx.agent?.id) !== Number(selectedAgent.id)) {
      setSkillsDraft("");
      return;
    }
    // Adding: start empty — library is reference only, not an editor target.
    if (!runtimeCtx.hasInstanceSkillsFile) {
      setSkillsDraft("");
      return;
    }
    setSkillsDraft(String(runtimeCtx.skills?.markdown ?? ""));
  }, [
    detailsAgentId,
    selectedAgent?.id,
    runtimeCtx?.agent?.id,
    runtimeCtx?.hasInstanceSkillsFile,
    runtimeCtx?.hasInstanceSkillsFile === true ? (runtimeCtx?.skills?.markdown ?? "") : "",
  ]);

  const saveInstanceSkillsMd = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) throw new Error("No agent");
      return apiRequest("PUT", `/api/tenants/${tid}/agents/${selectedAgent.id}/instance-docs/skills-md`, {
        markdown: formatSkillsMarkdown(skillsDraft),
      }).then((r) => r.json());
    },
    onSuccess: () => {
      const aid = selectedAgent?.id ?? 0;
      queryClient.invalidateQueries({
        queryKey: ["/api/tenants", tid, "agents", aid, "runtime-context", "v2-merged-docs"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents", aid] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      setAgentDetailsTab("skills");
      toast({
        title: "Skills file saved",
        description: "SKILLS.md is stored for this agent under agent-instructions.",
      });
    },
    onError: (e: unknown) => {
      toast({
        title: "Save failed",
        description: String((e as { message?: string })?.message ?? "Unable to save SKILLS.md"),
        variant: "destructive",
      });
    },
  });

  const onSkillsMdFileSelected = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const f = input.files?.[0];
      input.value = "";
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        setSkillsDraft(formatSkillsMarkdown(text));
        toast({ title: "SKILLS.md loaded", description: `${f.name} — normalized in the editor.` });
      };
      reader.onerror = () => {
        toast({
          title: "Could not read file",
          description: "Use a UTF-8 .md or .txt file.",
          variant: "destructive",
        });
      };
      reader.readAsText(f);
    },
    [toast],
  );

  useEffect(() => {
    setAgentDetailsTab("dashboard");
    setOpenRunLogId(null);
  }, [detailsAgentId]);

  useEffect(() => {
    if (agentDetailsTab !== "add-skills") return;
    if (!runtimeCtx) return;
    if (hasInstanceSkillsOnDisk) setAgentDetailsTab("skills");
  }, [agentDetailsTab, runtimeCtx, hasInstanceSkillsOnDisk]);

  /** Read-only effective / library skills markdown (Skills tab; Add tab can pass clearer headings). */
  const renderEffectiveSkillsPreview = (
    skillsRow: { markdown?: string; source?: string } | undefined,
    opts?: { heading?: string; blurb?: string; preClassName?: string },
  ) => (
    <Card className="bg-card border-border shadow-sm ring-1 ring-border/30">
      <CardContent className="space-y-3 p-5 sm:p-6">
        <div className="text-xs font-semibold text-foreground">
          {opts?.heading ?? "SKILLS.md (effective / library)"}
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {opts?.blurb ??
            "What runs for this agent until you add your own skills file on disk."}{" "}
          Source: <span className="font-mono">{skillsRow?.source ?? "—"}</span>
        </p>
        <pre
          className={cn(
            "max-h-[min(320px,40vh)] overflow-auto rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed whitespace-pre-wrap",
            opts?.preClassName,
          )}
        >
          {librarySkillsBaseline.trim() ? librarySkillsBaseline : "—"}
        </pre>
      </CardContent>
    </Card>
  );

  /** New on-disk SKILLS.md — only on the Add-skills tab. */
  const renderAddSkillsMdForm = () => (
    <Card className="bg-card border-primary/25 shadow-sm ring-1 ring-primary/15">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-foreground">Write agent skills (SKILLS.md)</div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Markdown <span className="font-medium text-foreground">skill instructions</span> for this deployment only, saved as{" "}
            <span className="font-mono">SKILLS.md</span> under <span className="font-mono">agent-instructions/</span>. Runs load this
            file as the skills bundle for this agent instead of relying on the library copy alone. The library role template is not
            changed.
          </p>
        </div>
        <Textarea
          value={skillsDraft}
          onChange={(e) => setSkillsDraft(e.target.value)}
          className="min-h-[min(280px,38vh)] max-h-[min(480px,50vh)] font-mono text-xs leading-relaxed resize-y"
          spellCheck={false}
          placeholder="Skill instructions in markdown (same idea as SKILLS.md: sections, bullet skills, when to use, etc.)."
        />
        <input
          ref={skillsFileInputRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="sr-only"
          aria-hidden
          onChange={onSkillsMdFileSelected}
        />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Save</span> sends normalized markdown (line endings, heading spaces, blank
          lines, trailing newline). Use <span className="font-medium text-foreground">Load file</span> to import an existing{" "}
          <span className="font-mono">SKILLS.md</span>.
        </p>
        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => skillsFileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Load SKILLS.md from file
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSkillsDraft((prev) => formatSkillsMarkdown(prev))}
            disabled={!skillsDraft.trim()}
          >
            Auto-format
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSkillsDraft(librarySkillsBaseline)}
            disabled={!librarySkillsBaseline.trim()}
          >
            Copy library skills into editor
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => saveInstanceSkillsMd.mutate()}
            disabled={saveInstanceSkillsMd.isPending || !skillsDraft.trim()}
          >
            {saveInstanceSkillsMd.isPending ? "Saving skills file…" : "Save SKILLS.md"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const { data: runs = [] } = useQuery<any[]>({
    queryKey: ["/api/tenants", tid, "agents", selectedAgent?.id ?? 0, "runs"],
    queryFn: () =>
      apiRequest("GET", `/api/tenants/${tid}/agents/${selectedAgent!.id}/runs?limit=30`).then((r) => r.json()),
    enabled: tid > 0 && !!selectedAgent?.id,
    refetchInterval: detailsAgentId ? 4000 : false,
  });

  const { data: runLogDetail, isFetching: runLogFetching } = useQuery<{
    events: Array<{ id: number; ts: string; kind: string; message: string }>;
  }>({
    queryKey: ["/api/tenants", tid, "agents", selectedAgent?.id ?? 0, "runs", openRunLogId, "events"],
    queryFn: () =>
      apiRequest("GET", `/api/tenants/${tid}/agents/${selectedAgent!.id}/runs/${openRunLogId}`).then((r) => r.json()),
    enabled: tid > 0 && !!selectedAgent?.id && openRunLogId != null,
  });

  const runOnce = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) throw new Error("No agent");
      return apiRequest("POST", `/api/tenants/${tid}/agents/${selectedAgent.id}/hermes/run-once`).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents", selectedAgent?.id ?? 0, "runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "audit"] });
    },
    onError: (e: any) => {
      toast({ title: "Run failed", description: String(e?.message ?? "Unable to run"), variant: "destructive" });
    },
  });

  const maxAgents = tenant?.maxAgents ?? 25;
  const atLimit = visibleAgents.length >= maxAgents;
  const limitPct = Math.min(100, (visibleAgents.length / maxAgents) * 100);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      let data = (await apiRequest("PATCH", `/api/agents/${id}`, { status }).then((r) =>
        r.json(),
      )) as Agent & {
        firstRunOnStart?: { ok: boolean; adapter?: string; reason?: string; error?: string };
        displayStatus?: string;
        cardModel?: string;
        latestFinishedRun?: LatestFinishedRunDto;
      };
      const needsRunDetail =
        tid > 0 &&
        !data.latestFinishedRun &&
        (String(data.displayStatus ?? "").toLowerCase() === "error" ||
          String(data.status ?? "").toLowerCase() === "error");
      if (needsRunDetail) {
        try {
          const runs = (await apiRequest("GET", `/api/tenants/${tid}/agents/${data.id}/runs`).then((r) =>
            r.json(),
          )) as Array<{ id: number; status: string; trigger?: string; error?: string | null; summary?: string | null }>;
          const pick = runs.find((u) => u.status !== "running") ?? runs[0];
          if (pick) {
            data = {
              ...data,
              latestFinishedRun: {
                id: pick.id,
                status: pick.status,
                trigger: String(pick.trigger ?? ""),
                error: pick.error ?? null,
                summary: pick.summary ?? null,
              },
            };
          }
        } catch {
          /* keep PATCH body */
        }
      }
      const agentsKey = ["/api/tenants", tid, "agents"] as const;
      const { firstRunOnStart: _fro, ...agentListPatch } = data;
      queryClient.setQueryData<(Agent & { cardModel?: string; displayStatus?: string; latestFinishedRun?: LatestFinishedRunDto })[]>(
        agentsKey,
        (old) => {
          const base =
            old ??
            queryClient.getQueryData<(Agent & { cardModel?: string; displayStatus?: string; latestFinishedRun?: LatestFinishedRunDto })[]>(
              agentsKey,
            ) ??
            agents;
          if (!Array.isArray(base) || base.length === 0) return old;
          return base.map((row) => (row.id === data.id ? { ...row, ...agentListPatch } : row));
        },
      );
      await queryClient.invalidateQueries({ queryKey: agentsKey });
      await queryClient.refetchQueries({ queryKey: agentsKey });
      return data;
    },
    onSuccess: (
      data: Agent & {
        firstRunOnStart?: { ok: boolean; adapter?: string; reason?: string; error?: string };
        displayStatus?: string;
        cardModel?: string;
        latestFinishedRun?: LatestFinishedRunDto;
      },
      variables: { id: number; status: string },
    ) => {
      const agentsKey = ["/api/tenants", tid, "agents"] as const;

      if (variables?.status === "running") {
        const row = queryClient
          .getQueryData<(Agent & { cardModel?: string; displayStatus?: string; latestFinishedRun?: LatestFinishedRunDto })[]>(agentsKey)
          ?.find((r) => r.id === data.id);
        /** Same row the cards use (GET …/agents + reconcile), not only the PATCH body. */
        const truth: Agent & { displayStatus?: string; latestFinishedRun?: LatestFinishedRunDto } = row ?? data;
        const fr = data.firstRunOnStart;
        const cardSt = agentCardStatus(truth);
        const failed =
          (fr != null && fr.ok !== true) ||
          (fr == null && String(truth.status).toLowerCase() === "error") ||
          cardSt === "error";

        if (failed) {
          let summary: string;
          if (fr != null && fr.ok !== true) {
            summary = startRunFailureFriendly(fr);
          } else if (cardSt === "error") {
            summary =
              "This agent still shows Error: the latest finished run failed (or hasn’t cleared yet). Open the Run tab for the transcript.";
          } else {
            summary = "This run did not complete successfully. Open the Run tab for the transcript.";
          }

          let cause: AgentStartFailCause | undefined =
            fr != null && fr.ok !== true ? causeFromFirstRun(fr) : undefined;
          if (!causeHasDetail(cause) && cardSt === "error") {
            cause = causeFromLatestFinishedRun(truth.latestFinishedRun);
          }

          setAgentStartResult({
            open: true,
            outcome: "error",
            title: "Run failed",
            agentName: truth.displayName,
            summary,
            isCeo: String(truth.role).toLowerCase() === "ceo",
            cause,
          });
        } else {
          const st = String(truth.status).toLowerCase();
          const summary =
            fr?.ok === true
              ? "The startup run finished successfully and the agent is running."
              : st === "running"
                ? "The agent is running."
                : `The server reported status “${truth.status}”. If that’s unexpected, check the Run tab.`;
          const adapter =
            typeof fr?.adapter === "string" && fr.adapter.trim() ? fr.adapter.trim() : undefined;
          const successMeta =
            adapter || fr?.ok === true
              ? {
                  adapter,
                  startupRunCompleted: fr?.ok === true,
                }
              : undefined;
          setAgentStartResult({
            open: true,
            outcome: "success",
            title: "Agent started",
            agentName: truth.displayName,
            summary,
            isCeo: String(truth.role).toLowerCase() === "ceo",
            successMeta,
          });
        }
      }
    },
    onError: (err: Error, variables: { id: number; status: string }) => {
      const ag = agents.find((x) => x.id === variables?.id);
      const isStart = variables?.status === "running";
      const msg = String(err?.message ?? "Request failed.");
      setAgentStartResult({
        open: true,
        outcome: "error",
        title: isStart ? "Couldn’t start agent" : "Couldn’t update status",
        agentName: ag?.displayName ?? "Agent",
        summary: isStart
          ? "The request didn’t go through — check your connection, session, or server logs."
          : "Could not update this agent’s status.",
        isCeo: ag ? String(ag.role).toLowerCase() === "ceo" : false,
        cause: { error: msg },
      });
    },
  });

  /** Card avatar emoji (`agents.emoji`) — PATCH so list refetches (agents query uses staleTime: 0). */
  const patchAgentProfile = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/agents/${id}`, body).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] }),
    onError: () => toast({ title: "Error", description: "Could not update profile emoji", variant: "destructive" }),
  });

  const deleteAgent = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/agents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      toast({ title: "Agent terminated" });
      setDeleteId(null);
    },
  });

  const importAgent = useMutation({
    mutationFn: (payload: unknown) =>
      apiRequest("POST", `/api/tenants/${tid}/agents/import`, { import: payload }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] });
      toast({ title: "Agent imported", description: "Agent was created from JSON." });
      setImportOpen(false);
      setImportJson("");
      setImportDocMarkdown({});
      setImportBundleHint(null);
      setImportBundleHintWarn(false);
      setImportLastScanLabel(null);
      setImportZipDetectedPaths([]);
      setImportBundleExtraText([]);
      setImportBundleMatchedPaths([]);
      setImportWizardStep(0);
      setImportWizardError(null);
    },
    onError: (e: Error) => {
      setImportWizardError(String(e?.message ?? "Import failed. Check the payload or try again."));
    },
  });

  const importBundleScanLock = useRef(false);
  const handleImportBundleScan = useCallback(
    async (incoming: File[] | FileList, opts?: { fromFolder?: boolean }) => {
      const files = Array.from(incoming as ArrayLike<File>).filter((f) => f?.name);
      if (!files.length) return;
      if (importBundleScanLock.current) return;
      importBundleScanLock.current = true;
      setImportBundleScanning(true);
      try {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        setImportWizardError(null);
        setImportBundleExtraText([]);
        for (const f of files) {
          if (f.name.toLowerCase().endsWith(".zip") && f.size > MAX_IMPORT_ZIP_ARCHIVE_BYTES) {
            setImportBundleHint(null);
            setImportBundleHintWarn(false);
            setImportLastScanLabel(f.name);
            setImportWizardError(
              `"${f.name}" is ${(f.size / (1024 * 1024)).toFixed(1)} MB. This importer accepts zips up to ${Math.round(MAX_IMPORT_ZIP_ARCHIVE_BYTES / (1024 * 1024))} MB. Make a smaller zip (instruction .md files only) or pick files without zipping the whole project.`,
            );
            return;
          }
        }
        const { docMarkdown, hireJson, detected, scannedZipArchives, matchedPaths, extraTextFiles } =
          await parseImportUploadFiles(files);
        setImportDocMarkdown((prev) => ({ ...prev, ...docMarkdown }));
        setImportZipDetectedPaths(matchedPaths.length > 0 ? matchedPaths : detected);
        setImportBundleExtraText(extraTextFiles);
        setImportBundleMatchedPaths(matchedPaths);
        const docKeysNew = Object.keys(docMarkdown);
        const usefulThisScan = hireJson != null || docKeysNew.length > 0 || extraTextFiles.length > 0;
        const zipNoImportable = scannedZipArchives.length > 0 && !usefulThisScan;
        const emptyZipNothingRead =
          zipNoImportable &&
          matchedPaths.length === 0 &&
          `Opened ${scannedZipArchives.map((n) => `"${n}"`).join(", ")} but we did not read any .md or .json entries to import (empty zip, wrong format, or no matching member types). Add SOUL.md / AGENT.md / AGENTS.md / HEARTBEAT.md / TOOLS.md / SKILLS.md, agent export JSON, or a smaller zip.`;
        const emptyZipNoncanonicalOnly =
          zipNoImportable &&
          matchedPaths.length > 0 &&
          `Read ${matchedPaths.length} path(s) from ${scannedZipArchives.map((n) => `"${n}"`).join(", ")} — none map to hire JSON or the instruction filenames we import. Check the list above; rename or add the canonical docs or export JSON.`;
        const emptyZip = emptyZipNothingRead || emptyZipNoncanonicalOnly;
        let filledDraftHire = false;
        let draftDefName: string | null = null;
        if (hireJson) {
          setImportJson(hireJson);
        } else if (docKeysNew.length > 0 && defs.length > 0) {
          const d0 = defs.find((d) => String(d.name ?? "").trim().length > 0) ?? defs[0];
          draftDefName = String(d0?.name ?? "").trim();
          if (draftDefName) {
            filledDraftHire = true;
            setImportJson(
              JSON.stringify(
                {
                  displayName: "Imported agent",
                  role: String(d0?.division ?? "Agent"),
                  definitionName: draftDefName,
                },
                null,
                2,
              ),
            );
          }
        }
        let hint = emptyZip
          ? emptyZip
          : filledDraftHire && draftDefName
            ? `Loaded instruction files: ${docKeysNew.join(", ")}. Using first library role "${draftDefName}" until you change it in Agent Library / after import. Press Next.`
            : !hireJson && docKeysNew.length > 0 && !filledDraftHire
              ? `Loaded: ${docKeysNew.join(", ")}. Waiting for agent library to load — draft hire JSON will appear automatically, or press Next in a moment.`
              : detected.length > 0
                ? opts?.fromFolder
                  ? `Detected (folder): ${detected.join(", ")}`
                  : `Detected: ${detected.join(", ")}`
                : extraTextFiles.length > 0
                  ? `Read ${extraTextFiles.length} auxiliary text file(s) from the bundle. They will be appended to AGENT.md on Import so Cortex can use them. Press Next.`
                : opts?.fromFolder
                  ? "Folder had no matching docs."
                  : "No matching docs or hire JSON in selection.";
        if (!emptyZip && extraTextFiles.length > 0) {
          hint = `${hint} ${extraTextFiles.length} other text file(s) from the bundle will be appended to AGENT.md on Import so Cortex can use the full folder.`;
        }
        setImportBundleHintWarn(!!emptyZip);
        setImportBundleHint(hint);
        const scanLabel =
          files.length === 1
            ? files[0].name
            : `${files.length} files: ${files
                .map((f) => f.name)
                .slice(0, 4)
                .join(", ")}${files.length > 4 ? "…" : ""}`;
        setImportLastScanLabel(scanLabel);
        toast({
          title: opts?.fromFolder ? "Folder scanned" : "Bundle scanned",
          description: [
            filledDraftHire ? `Preset role: ${draftDefName}` : null,
            matchedPaths.length
              ? `${matchedPaths.length} path(s) in list`
              : detected.length
                ? `${detected.length} path(s) matched`
                : null,
            hireJson ? "Hire data from archive applied" : null,
            extraTextFiles.length ? `${extraTextFiles.length} extra → AGENT.md` : null,
          ]
            .filter(Boolean)
            .join(" · ") || (docKeysNew.length ? "Instruction files merged" : "Nothing new matched."),
        });
      } catch (err: unknown) {
        setImportBundleHint(null);
        setImportBundleHintWarn(false);
        setImportLastScanLabel(null);
        setImportZipDetectedPaths([]);
        setImportBundleExtraText([]);
        setImportBundleMatchedPaths([]);
        setImportWizardError(
          opts?.fromFolder
            ? `Could not read that folder: ${String((err as Error)?.message ?? err)}. Check permissions or try a smaller selection.`
            : `Could not read that upload: ${String((err as Error)?.message ?? err)}. Try another zip or fewer files.`,
        );
      } finally {
        importBundleScanLock.current = false;
        setImportBundleScanning(false);
      }
    },
    [toast, defs],
  );

  const bundleDropDepth = useRef(0);
  const [bundleDropActive, setBundleDropActive] = useState(false);

  const onBundleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    bundleDropDepth.current += 1;
    setBundleDropActive(true);
  };
  const onBundleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    bundleDropDepth.current = Math.max(0, bundleDropDepth.current - 1);
    if (bundleDropDepth.current === 0) setBundleDropActive(false);
  };
  const onBundleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onBundleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    bundleDropDepth.current = 0;
    setBundleDropActive(false);
    void handleImportBundleScan(e.dataTransfer.files);
  };

  const totalSpent = visibleAgents.reduce((s, a) => s + a.spentThisMonth, 0);
  const totalCompleted = visibleAgents.reduce((s, a) => s + a.tasksCompleted, 0);

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground">My Agents</h1>
          <p className="text-sm text-foreground/70 mt-0.5">
            {visibleAgents.length} agents deployed · {visibleAgents.filter((a) => agentCardStatus(a) === "running").length} running
          </p>
          {/* Agent usage bar */}
          <div className="mt-2 flex items-center gap-3 max-w-xs">
            <Progress
              value={limitPct}
              className={cn("h-1.5 flex-1", atLimit ? "[&>div]:bg-destructive" : limitPct > 80 ? "[&>div]:bg-orange-400" : "")}
            />
            <span className={cn("text-xs font-medium tabular-nums shrink-0", atLimit ? "text-destructive" : "text-foreground/70")}>
              {visibleAgents.length} / {maxAgents}
            </span>
          </div>
          {atLimit && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <Lock className="w-3 h-3" /> Agent limit reached — raise it in Settings to hire more
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            data-testid="hire-agent-btn"
            onClick={() => setWizardOpen(true)}
            disabled={atLimit}
            title={atLimit ? `Limit of ${maxAgents} agents reached` : undefined}
          >
            <Bot className="w-4 h-4 mr-1.5" /> Hire from Library
          </Button>
          <Button
            variant="outline"
            data-testid="import-agent-btn"
            onClick={() => setImportOpen(true)}
            disabled={atLimit}
            title={atLimit ? `Limit of ${maxAgents} agents reached` : undefined}
          >
            <Upload className="w-4 h-4 mr-1.5" /> Import
          </Button>
          <Button
            data-testid="add-agent-btn"
            onClick={() => setAddAgentOpen(true)}
            disabled={atLimit}
            title={atLimit ? `Limit of ${maxAgents} agents reached` : undefined}
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add Agent
          </Button>
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: Bot, label: "Total Agents", value: visibleAgents.length, sub: `${visibleAgents.filter((a) => agentCardStatus(a) === "running").length} running` },
          { icon: CheckCircle, label: "Tasks Completed", value: totalCompleted, sub: "all time" },
          { icon: DollarSign, label: "Total Spent", value: `$${totalSpent.toFixed(2)}`, sub: "this month" },
        ].map(s => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <s.icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs font-medium text-foreground/70">{s.label}</p>
                <p className="text-lg font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-foreground/65">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Agent cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="bg-card border-border animate-pulse">
              <CardContent className="p-5 h-48" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleAgents.map(agent => {
            const def = defs.find(d => d.id === agent.definitionId);
            const cardSt = agentCardStatus(agent);
            const s = STATUS_CONFIG[cardSt] ?? STATUS_CONFIG.idle;
            const budgetPct = (agent.spentThisMonth / agent.monthlyBudget) * 100;
            const isCeo = String(agent.role).toLowerCase() === "ceo";
            const statusBusy = updateStatus.isPending && updateStatus.variables?.id === agent.id;
            return (
              <Card
                key={agent.id}
                className="bg-card border-border hover:border-primary/30 transition-all cursor-pointer"
                data-testid={`agent-card-${agent.id}`}
                onClick={() => {
                  if (isCeo) return; // CEO has its own dedicated section
                  setDetailsAgentId(agent.id);
                }}
              >
                <CardContent className="p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-xl flex-shrink-0">
                          {deployedAgentEmoji(agent, def)}
                        </div>
                        <span className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card", s.dot)} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{agent.displayName}</h3>
                        <p className="text-xs text-foreground/72">{agent.role}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("text-xs py-0 shrink-0", s.badge)}>{s.label}</Badge>
                  </div>
                  {isCeo ? (
                    <div className="text-[11px] text-foreground/72">
                      Manage details in the CEO section.
                    </div>
                  ) : null}

                  {/* Goal */}
                  {agent.goal && (
                    <p className="text-xs text-foreground/80 leading-relaxed line-clamp-2 bg-muted/55 rounded-md px-2.5 py-1.5 border border-border/50">
                      {agent.goal}
                    </p>
                  )}

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-muted/55 rounded-md p-2 border border-border/40">
                      <p className="text-xs font-semibold text-foreground">{agent.tasksCompleted}</p>
                      <p className="text-[11px] font-medium text-foreground/72">done</p>
                    </div>
                    <div className="bg-muted/55 rounded-md p-2 border border-border/40">
                      <p className="text-xs font-semibold text-foreground">${agent.spentThisMonth.toFixed(0)}</p>
                      <p className="text-[11px] font-medium text-foreground/72">spent</p>
                    </div>
                    <div className="bg-muted/55 rounded-md p-2 border border-border/40">
                      {(() => {
                        const cm = String((agent as { cardModel?: string }).cardModel ?? agent.model ?? "");
                        const short = cm.includes("/")
                          ? (cm.split("/").pop()?.split(":")[0] ?? cm)
                          : (MODEL_LABELS[cm] ?? cm.split("-").pop() ?? cm);
                        return (
                          <p className="text-xs font-semibold text-foreground truncate" title={cm}>
                            {short}
                          </p>
                        );
                      })()}
                      <p className="text-[11px] font-medium text-foreground/72">model</p>
                    </div>
                  </div>

                  {/* Budget bar */}
                  <div>
                    <div className="flex justify-between text-xs text-foreground/75 font-medium mb-1">
                      <span>Budget</span>
                      <span>${agent.spentThisMonth.toFixed(2)} / ${agent.monthlyBudget}</span>
                    </div>
                    <Progress value={Math.min(100, budgetPct)} className="h-1" />
                  </div>

                  {/* Last heartbeat */}
                  {agent.lastHeartbeat && (
                    <div className="flex items-center gap-1.5 text-xs text-foreground/72">
                      <Clock className="w-3 h-3 shrink-0 opacity-80" />
                      <span>Last heartbeat {formatDistanceToNow(agent.lastHeartbeat)}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    {agentCardStatus(agent) === "running" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs"
                        disabled={statusBusy}
                        onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: agent.id, status: "paused" }); }}
                        data-testid={`pause-${agent.id}`}
                      >
                        <Pause className="w-3 h-3 mr-1" /> Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        disabled={statusBusy}
                        onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: agent.id, status: "running" }); }}
                        data-testid={`start-${agent.id}`}
                      >
                        {statusBusy && updateStatus.variables?.status === "running" ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Starting…
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 mr-1" /> Start
                          </>
                        )}
                      </Button>
                    )}
                    {!isCeo ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10 border-destructive/30"
                        onClick={(e) => { e.stopPropagation(); setDeleteId(agent.id); }}
                        data-testid={`delete-${agent.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <HireAgentWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <AddAgentDialog open={addAgentOpen} onClose={() => setAddAgentOpen(false)} />

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) {
            setImportJson("");
            setImportDocMarkdown({});
            setImportBundleHint(null);
            setImportBundleHintWarn(false);
            setImportLastScanLabel(null);
            setImportZipDetectedPaths([]);
            setImportBundleExtraText([]);
            setImportBundleMatchedPaths([]);
            setImportWizardStep(0);
            setImportWizardError(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Import agent</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {importWizardStep === 0 &&
                "Upload a .zip or folder. Canonical instruction files apply as usual; other text (.md, .txt, .yaml, …) is bundled into AGENT.md on Import so Cortex can use the whole tree. Hire JSON still wins when present. Use Next when ready."}
              {importWizardStep === 1 && "Pick the adapter and LLM routing for this deployment (overrides any adapter fields in JSON)."}
              {importWizardStep === 2 && "Set the agent name and role, confirm runtime, then Import."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1.5 shrink-0 px-0.5" aria-hidden>
            {(["Upload", "Runtime", "Review"] as const).map((label, i) => (
              <div key={label} className="flex-1 flex flex-col gap-1 min-w-0">
                <div className={cn("h-1 rounded-full transition-colors", importWizardStep >= i ? "bg-primary" : "bg-muted")} />
                <span
                  className={cn(
                    "text-[9px] text-center truncate",
                    importWizardStep === i ? "text-primary font-semibold" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>

          <div className="min-h-[240px] max-h-[min(52vh,420px)] overflow-y-auto flex-1 space-y-3 pr-1">
            {importWizardStep === 0 && (
              <div className="space-y-3">
                <div className="rounded-md border border-border bg-muted/15 px-3 py-2.5 space-y-2">
                  <Label className="text-xs font-medium">Scan upload</Label>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Multi-select, <span className="font-mono">.zip</span>, or folder. We match{" "}
                    <span className="font-mono">SOUL.md</span>, <span className="font-mono">AGENTS.md</span> (→{" "}
                    <span className="font-mono">AGENT.md</span>), <span className="font-mono">HEARTBEAT.md</span>,{" "}
                    <span className="font-mono">TOOLS.md</span>, <span className="font-mono">SKILLS.md</span>, and hire JSON.
                  </p>
                  <div
                    role="presentation"
                    onDragEnter={onBundleDragEnter}
                    onDragLeave={onBundleDragLeave}
                    onDragOver={onBundleDragOver}
                    onDrop={onBundleDrop}
                    className={cn(
                      "relative rounded-md border border-dashed px-3 py-3 text-center transition-colors",
                      bundleDropActive
                        ? "border-primary bg-primary/5 ring-2 ring-primary/25"
                        : "border-border bg-muted/10 hover:border-primary/40",
                      importBundleScanning && "pointer-events-none opacity-70",
                    )}
                  >
                    {importBundleScanning ? (
                      <div className="flex flex-col items-center gap-2 py-1">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                        <p className="text-[11px] text-muted-foreground">Reading zip / files… (big zips can take a few seconds)</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          Drag and drop a <span className="font-mono">.zip</span>, multiple files, or use the button. To use a
                          whole folder, drag the folder here (Finder / Explorer).
                        </p>
                        <label
                          htmlFor="import-agent-bundle-input"
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "mt-2 h-8 text-xs cursor-pointer",
                            importBundleScanning && "pointer-events-none opacity-50",
                          )}
                          data-testid="import-agent-bundle-browse"
                        >
                          Choose files / zip
                        </label>
                      </>
                    )}
                    <input
                      id="import-agent-bundle-input"
                      type="file"
                      multiple
                      accept={IMPORT_BUNDLE_FILE_ACCEPT}
                      className="sr-only"
                      disabled={importBundleScanning}
                      data-testid="import-agent-bundle"
                      onChange={(e) => {
                        const input = e.target as HTMLInputElement;
                        // Copy before reset: clearing `value` empties the live `files` list (WebKit/Chromium).
                        const picked = input.files ? Array.from(input.files) : [];
                        input.value = "";
                        if (picked.length) void handleImportBundleScan(picked);
                      }}
                    />
                  </div>
                  {importLastScanLabel ? (
                    <p className="text-[10px] text-muted-foreground leading-snug" data-testid="import-last-scan">
                      Last scan: <span className="font-medium text-foreground">{importLastScanLabel}</span>.
                    </p>
                  ) : null}
                  {importBundleHint ? (
                    <p
                      className={cn(
                        "text-[11px] leading-snug",
                        importBundleHintWarn
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-green-600 dark:text-green-400/90",
                      )}
                      data-testid="import-bundle-hint"
                    >
                      {importBundleHint}
                    </p>
                  ) : null}
                </div>
                {importZipDetectedPaths.length > 0 ? (
                  <div className="rounded-md border border-border bg-background/40 px-2.5 py-2 space-y-1">
                    <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Paths scanned (inside zip and loose files)
                    </Label>
                    <ul
                      className="text-[10px] font-mono text-foreground/90 max-h-32 overflow-y-auto space-y-0.5 list-disc pl-4"
                      data-testid="import-zip-detected-list"
                    >
                      {importZipDetectedPaths.slice(0, 80).map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                      {importZipDetectedPaths.length > 80 ? (
                        <li className="text-muted-foreground list-none">…and {importZipDetectedPaths.length - 80} more</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}

            {importWizardStep === 1 && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5 space-y-3">
                <p className="text-xs font-medium text-foreground">Runtime adapter (this import)</p>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  CLI options map to backend <span className="font-mono">cli</span> with your command.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Adapter</Label>
                    <Select
                      value={importAdapterUiId}
                      onValueChange={(v) => {
                        setImportWizardError(null);
                        setImportAdapterUiId(v as ImportAdapterUiId);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid="import-adapter-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {IMPORT_ADAPTER_TYPES.map((a) => (
                          <SelectItem key={a.id} value={a.id} className="text-xs">
                            {a.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">LLM routing</Label>
                    <div className="flex rounded-md border border-border overflow-hidden h-8">
                      <button
                        type="button"
                        className={cn(
                          "flex-1 text-xs font-medium transition-colors",
                          importLlmProvider === "openrouter" ? "bg-primary text-primary-foreground" : "bg-muted/40 hover:bg-muted/60",
                        )}
                        onClick={() => {
                          setImportWizardError(null);
                          setImportLlmProvider("openrouter");
                        }}
                        data-testid="import-llm-openrouter"
                      >
                        OpenRouter
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "flex-1 text-xs font-medium transition-colors border-l border-border",
                          importLlmProvider === "ollama" ? "bg-primary text-primary-foreground" : "bg-muted/40 hover:bg-muted/60",
                        )}
                        onClick={() => {
                          setImportWizardError(null);
                          setImportLlmProvider("ollama");
                        }}
                        data-testid="import-llm-ollama"
                      >
                        Ollama
                      </button>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      {importLlmProvider === "openrouter" ? "OpenRouter model" : "Ollama model"}
                    </Label>
                    {importLlmProvider === "openrouter" ? (
                      <>
                        <ScrollArea className="h-[min(200px,36vh)] rounded-md border border-border">
                          <div className="p-2 space-y-1.5 pr-3">
                            {OPENROUTER_MODELS.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  setImportWizardError(null);
                                  setImportRuntimeModel(m.id);
                                }}
                                className={cn(
                                  "flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                                  importRuntimeModel.trim() === m.id
                                    ? "border-primary bg-primary/10"
                                    : "border-border bg-background/60 hover:bg-muted/50",
                                )}
                                data-testid={`import-model-openrouter-${m.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                              >
                                <span className="min-w-0">
                                  <span className="font-medium text-foreground block truncate">{m.label}</span>
                                  <span className="text-[10px] text-muted-foreground line-clamp-1">{m.desc}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1.5">
                                  <span className="text-[10px] font-mono text-muted-foreground">{m.cost}</span>
                                  {importRuntimeModel.trim() === m.id ? (
                                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                                  ) : null}
                                </span>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          Same curated list as Hire Agent. You can still type any other OpenRouter model id below.
                        </p>
                      </>
                    ) : importOllamaModelsLoading ? (
                      <p className="text-[10px] text-muted-foreground py-3">Loading models from Ollama…</p>
                    ) : importOllamaModelsError ? (
                      <p className="text-[10px] text-destructive leading-snug">
                        Could not list models. Set Ollama base URL in Settings → Organization, run{" "}
                        <span className="font-mono">ollama serve</span>, then come back to this step — or type a model
                        name below.
                      </p>
                    ) : (importOllamaModelsRes?.models?.length ?? 0) === 0 ? (
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        No models at{" "}
                        <span className="font-mono text-foreground">{importOllamaModelsRes?.baseUsed ?? "—"}</span>. Pull
                        one (e.g. <span className="font-mono">ollama pull llama3</span>) or enter a name below.
                      </p>
                    ) : (
                      <ScrollArea className="h-[min(200px,36vh)] rounded-md border border-border">
                        <div className="p-2 space-y-1.5 pr-3">
                          {importOllamaModelsRes!.models.map((id) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                setImportWizardError(null);
                                setImportRuntimeModel(id);
                              }}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                                importRuntimeModel.trim() === id
                                  ? "border-primary bg-primary/10"
                                  : "border-border bg-background/60 hover:bg-muted/50",
                              )}
                              data-testid={`import-model-ollama-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                            >
                              <span className="font-mono truncate text-foreground" title={id}>
                                {id}
                              </span>
                              {importRuntimeModel.trim() === id ? (
                                <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                    <Input
                      value={importRuntimeModel}
                      onChange={(e) => {
                        setImportWizardError(null);
                        setImportRuntimeModel(e.target.value);
                      }}
                      placeholder={
                        importLlmProvider === "openrouter"
                          ? "e.g. nousresearch/hermes-3-llama-3.1-405b:free"
                          : "e.g. llama3.2"
                      }
                      className="h-8 text-xs font-mono"
                      data-testid="import-runtime-model"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">CLI command</Label>
                    <Input
                      value={importCommand}
                      onChange={(e) => {
                        setImportWizardError(null);
                        setImportCommand(e.target.value);
                      }}
                      placeholder="hermes, claude, …"
                      className="h-8 text-xs font-mono"
                      data-testid="import-cli-command"
                    />
                  </div>
                </div>
              </div>
            )}

            {importWizardStep === 2 && (
              <div className="space-y-3 text-xs">
                {(() => {
                  const docKeys = IMPORT_DOC_FILES.filter((f) => importDocMarkdown[f.filename] != null).map((f) => f.filename);
                  const adapterLabel = IMPORT_ADAPTER_TYPES.find((a) => a.id === importAdapterUiId)?.label ?? importAdapterUiId;
                  return (
                    <>
                      <div className="rounded-md border border-border bg-muted/15 px-3 py-2 space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Source</p>
                        <p className="text-foreground">Zip / folder scan</p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/15 px-3 py-2.5 space-y-3">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Name and role for this import
                        </p>
                        {!importJsonParseOk ? (
                          <p className="text-destructive text-[11px]">Invalid payload — go back to Upload to fix.</p>
                        ) : (
                          <>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground">Profile (emoji)</Label>
                              <div className="flex items-center gap-2">
                                <EmojiPicker
                                  value={
                                    String(importDraftObject.emoji ?? "").trim() ||
                                    importReviewDef?.emoji ||
                                    "🤖"
                                  }
                                  onChange={(emoji) => {
                                    setImportWizardError(null);
                                    patchImportJson({ emoji });
                                  }}
                                  className="w-11 h-9 shrink-0 text-lg"
                                />
                                <p className="text-[10px] text-muted-foreground leading-snug flex-1 min-w-0">
                                  Shown on the agent card avatar only — not appended to the display name.
                                </p>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="import-review-display-name" className="text-[10px] text-muted-foreground">
                                Display name
                              </Label>
                              <Input
                                id="import-review-display-name"
                                value={String(importDraftObject.displayName ?? "")}
                                onChange={(e) => {
                                  setImportWizardError(null);
                                  patchImportJson({ displayName: e.target.value });
                                }}
                                placeholder="e.g. Sage"
                                className="h-8 text-xs"
                                data-testid="import-review-display-name"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="import-review-role" className="text-[10px] text-muted-foreground">
                                Role
                              </Label>
                              <Input
                                id="import-review-role"
                                value={String(importDraftObject.role ?? "")}
                                onChange={(e) => patchImportJson({ role: e.target.value })}
                                placeholder="e.g. Support, Engineering"
                                className="h-8 text-xs"
                                data-testid="import-review-role"
                              />
                              <p className="text-[10px] text-muted-foreground leading-snug">
                                Shown on the agent card (job title / function).
                              </p>
                            </div>
                            <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4 pt-1 border-t border-border/60">
                              {docKeys.length > 0 ? (
                                <li>
                                  Instruction files: <span className="text-foreground font-mono">{docKeys.join(", ")}</span>
                                </li>
                              ) : (
                                <li>No canonical instruction files (SOUL / AGENT / …) — defaults come from the library template on the server.</li>
                              )}
                              {importBundleExtraText.length > 0 ? (
                                <li>
                                  Bundle text merged into <span className="font-mono">AGENT.md</span> on Import:{" "}
                                  <span className="text-foreground tabular-nums">{importBundleExtraText.length}</span> file(s) so
                                  Cortex sees the rest of the zip/folder.
                                </li>
                              ) : null}
                            </ul>
                          </>
                        )}
                      </div>
                      <div className="rounded-md border border-border bg-muted/15 px-3 py-2 space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Runtime</p>
                        <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
                          <li>
                            Adapter: <span className="text-foreground">{adapterLabel}</span> (
                            <span className="font-mono">{importAdapterBackend(importAdapterUiId)}</span>)
                          </li>
                          <li>
                            LLM: <span className="text-foreground">{importLlmProvider}</span>
                          </li>
                          <li>
                            Profile:{" "}
                            <span className="text-foreground text-base leading-none" aria-hidden>
                              {String(importDraftObject.emoji ?? "").trim() || importReviewDef?.emoji || "🤖"}
                            </span>
                            <span className="text-muted-foreground">
                              {String(importDraftObject.emoji ?? "").trim() ? " (override)" : " (from definition)"}
                            </span>
                          </li>
                          <li>
                            Command: <span className="text-foreground font-mono">{importCommand.trim() || importAdapterDefaultCmd(importAdapterUiId)}</span>
                          </li>
                          {importRuntimeModel.trim() ? (
                            <li>
                              Model override: <span className="text-foreground font-mono">{importRuntimeModel.trim()}</span>
                            </li>
                          ) : null}
                        </ul>
                      </div>
                      {importJson.trim() && importJsonParseOk ? (
                        <div className="rounded-md border border-dashed border-border bg-background/50 px-2 py-1.5">
                          <p className="text-[10px] text-muted-foreground font-medium mb-0.5">JSON preview</p>
                          <pre className="text-[10px] font-mono text-muted-foreground max-h-28 overflow-y-auto whitespace-pre-wrap break-all">
                            {importJson.slice(0, 900)}
                            {importJson.length > 900 ? "…" : ""}
                          </pre>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {importWizardError ? (
            <Alert
              variant="default"
              aria-live="polite"
              className="shrink-0 border-amber-500/50 bg-muted py-3 pl-9 pr-3 text-foreground shadow-sm [&>svg]:left-3 [&>svg]:top-3 [&>svg]:text-amber-600 dark:border-amber-400/45 dark:bg-zinc-900/90 dark:[&>svg]:text-amber-400"
              data-testid="import-wizard-error"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="text-sm font-semibold text-foreground mb-1">Something needs fixing</AlertTitle>
              <AlertDescription className="text-sm leading-relaxed text-foreground/95 dark:text-zinc-100 space-y-2">
                <p className="text-foreground">{importWizardError}</p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-2 -ml-2 text-sm font-medium text-primary hover:text-primary hover:bg-primary/10"
                  onClick={() => setImportWizardError(null)}
                >
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter className="border-t border-border pt-3 mt-2 shrink-0 flex flex-row flex-wrap items-center justify-between gap-2 sm:space-x-0">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setImportOpen(false);
                  setImportJson("");
                  setImportDocMarkdown({});
                  setImportBundleHint(null);
                  setImportBundleHintWarn(false);
                  setImportLastScanLabel(null);
                  setImportZipDetectedPaths([]);
                  setImportBundleExtraText([]);
                  setImportBundleMatchedPaths([]);
                  setImportWizardStep(0);
                  setImportWizardError(null);
                }}
              >
                Cancel
              </Button>
              {importWizardStep > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setImportWizardError(null);
                    setImportWizardStep((s) => Math.max(0, s - 1));
                  }}
                  data-testid="import-wizard-back"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back
                </Button>
              ) : null}
            </div>
            {importWizardStep >= 0 && importWizardStep < 2 ? (
              <Button
                type="button"
                onClick={() => {
                  if (importWizardStep === 0) {
                    const docKeys = Object.keys(importDocMarkdown);
                    if (docKeys.length === 0 && !importJson.trim() && importBundleExtraText.length === 0) {
                      setImportWizardError("Upload and scan a .zip or folder first.");
                      return;
                    }
                    if (!defs.length) {
                      setImportWizardError("Agent library is still loading. Wait a second, then press Next again.");
                      return;
                    }
                    try {
                      const merged = buildImportHirePayload();
                      if (merged.definitionId == null && !String(merged.definitionName ?? "").trim()) {
                        setImportWizardError("No definition in payload — wait for library to load or re-scan the zip.");
                        return;
                      }
                      setImportJson(JSON.stringify(merged, null, 2));
                    } catch {
                      setImportWizardError("Could not build hire payload.");
                      return;
                    }
                  }
                  setImportWizardError(null);
                  setImportWizardStep((s) => Math.min(2, s + 1));
                }}
                data-testid="import-wizard-next"
              >
                Next <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            ) : importWizardStep === 2 ? (
              <Button
                disabled={importAgent.isPending || !importJson.trim()}
                onClick={() => {
                  try {
                    const raw = buildImportHirePayload();
                    const fromJson = Array.isArray(raw.files)
                      ? (raw.files as { filename?: string; markdown?: string }[])
                      : [];
                    const byName = new Map<string, { filename: string; markdown: string }>();
                    for (const entry of fromJson) {
                      const fn = String(entry?.filename ?? "").trim();
                      const md = String(entry?.markdown ?? "");
                      if (fn && md) byName.set(fn, { filename: fn, markdown: md });
                    }
                    for (const { filename } of IMPORT_DOC_FILES) {
                      const md = importDocMarkdown[filename];
                      if (md != null && md.length > 0) byName.set(filename, { filename, markdown: md });
                    }
                    const baseAgentMd =
                      importDocMarkdown["AGENT.md"] ?? byName.get("AGENT.md")?.markdown ?? "";
                    const mdManifest = importBundleMatchedPaths
                      .filter((p) => {
                        const lower = p.toLowerCase();
                        return lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx");
                      })
                      .slice(0, 600)
                      .join("\n");
                    const extrasWithManifest =
                      mdManifest.trim().length > 0
                        ? [{ path: "Bundle manifest (.md paths scanned)", text: mdManifest }, ...importBundleExtraText]
                        : importBundleExtraText;
                    const mergedAgentMd = appendImportExtrasToAgentMarkdown(baseAgentMd, extrasWithManifest);
                    if (mergedAgentMd.trim()) {
                      byName.set("AGENT.md", { filename: "AGENT.md", markdown: mergedAgentMd });
                    }
                    if (byName.size > 0) raw.files = Array.from(byName.values());
                    raw.adapterType = importAdapterBackend(importAdapterUiId);
                    raw.llmProvider = importLlmProvider;
                    raw.command = importCommand.trim() || importAdapterDefaultCmd(importAdapterUiId);
                    const rm = importRuntimeModel.trim() || String(raw.runtimeModel ?? "").trim();
                    raw.runtimeModel = rm;
                    const emImp = String(importDraftObject.emoji ?? "").trim();
                    if (emImp) raw.emoji = emImp;
                    setImportWizardError(null);
                    importAgent.mutate(raw);
                  } catch {
                    setImportWizardError("Couldn’t finalize import payload. Go back to Upload or Runtime and try again.");
                  }
                }}
                data-testid="import-agent-submit"
              >
                {importAgent.isPending ? "Importing…" : "Import"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailsAgentId != null} onOpenChange={(o) => setDetailsAgentId(o ? detailsAgentId : null)}>
        <DialogContent className="!flex max-w-5xl max-h-[90vh] min-h-0 flex-col gap-3 overflow-hidden p-6 sm:max-w-5xl">
          <DialogHeader className="shrink-0 space-y-1.5 text-center sm:text-left">
            <DialogTitle className="text-sm">
              {selectedAgent ? deployedAgentEmoji(selectedAgent, selectedDef) : "🤖"}{" "}
              {selectedAgent?.displayName ?? "Agent"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedAgent?.role ?? "—"}{selectedAgent ? ` · #${selectedAgent.id}` : ""}
            </DialogDescription>
          </DialogHeader>

          {!selectedAgent ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <Tabs value={agentDetailsTab} onValueChange={setAgentDetailsTab} className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
              <div className="shrink-0">
                <ScrollArea className="w-full">
                  <TabsList className="flex h-auto min-h-11 w-full max-w-full flex-nowrap justify-start gap-1.5 overflow-x-auto rounded-lg bg-muted/90 p-1.5 sm:min-h-12 sm:gap-2 sm:p-2">
                    <TabsTrigger value="dashboard" className="shrink-0 px-3.5 sm:px-4">Dashboard</TabsTrigger>
                    <TabsTrigger value="docs" className="shrink-0 px-3.5 sm:px-4">Docs</TabsTrigger>
                    <TabsTrigger value="skills" className="shrink-0 px-3.5 sm:px-4">Skills</TabsTrigger>
                    <TabsTrigger value="run" className="shrink-0 px-3.5 sm:px-4">Run</TabsTrigger>
                    {!runtimeCtx || !hasInstanceSkillsOnDisk ? (
                      <TabsTrigger
                        value="add-skills"
                        className="shrink-0 gap-1.5 border border-primary/35 bg-primary/10 px-3.5 text-primary sm:px-4 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs"
                        title="Add a SKILLS.md file — skill instructions for this agent only"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Add skills
                      </TabsTrigger>
                    ) : null}
                  </TabsList>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </div>

              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1 [-webkit-overflow-scrolling:touch]">
                <TabsContent value="dashboard" className="mt-0 space-y-4 pt-2 outline-none sm:space-y-5 sm:pt-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
                  <Card className="bg-card border-border">
                    <CardContent className="p-5 sm:p-6">
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <CheckCircle className="w-3.5 h-3.5" /> Tasks completed
                      </div>
                      <div className="text-xl font-semibold">{selectedAgent.tasksCompleted}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border-border">
                    <CardContent className="p-5 sm:p-6">
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <DollarSign className="w-3.5 h-3.5" /> Spent this month
                      </div>
                      <div className="text-xl font-semibold">${selectedAgent.spentThisMonth.toFixed(2)}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border-border">
                    <CardContent className="p-5 sm:p-6">
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <Cpu className="w-3.5 h-3.5" /> Model
                      </div>
                      <div
                        className="text-sm font-semibold truncate"
                        title={String((selectedAgent as { cardModel?: string }).cardModel ?? selectedAgent.model ?? "")}
                      >
                        {(() => {
                          const cm = String((selectedAgent as { cardModel?: string }).cardModel ?? selectedAgent.model ?? "");
                          if (MODEL_LABELS[cm]) return MODEL_LABELS[cm];
                          if (cm.includes("/")) return cm.split("/").pop()?.split(":")[0] ?? cm;
                          return cm.split("-").pop() ?? cm;
                        })()}
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <Card className="bg-card border-border">
                  <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="text-xs font-medium text-muted-foreground">Card profile emoji</div>
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        Saves to this agent only (overrides the library icon on My Agents).
                      </p>
                    </div>
                    <EmojiPicker
                      value={deployedAgentEmoji(selectedAgent, selectedDef)}
                      onChange={(emoji) => {
                        patchAgentProfile.mutate({ id: selectedAgent.id, body: { emoji } });
                      }}
                      className="w-11 h-9 shrink-0 text-lg"
                    />
                  </CardContent>
                </Card>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    Last heartbeat {selectedAgent.lastHeartbeat ? formatDistanceToNow(selectedAgent.lastHeartbeat) : "—"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Status: <span className="text-foreground">{agentCardStatus(selectedAgent)}</span> · Budget:{" "}
                  <span className="text-foreground">${selectedAgent.spentThisMonth.toFixed(2)} / ${selectedAgent.monthlyBudget}</span>
                </div>
              </TabsContent>

              <TabsContent value="docs" className="mt-0 flex min-h-0 flex-1 flex-col space-y-3 outline-none">
                {!runtimeCtx?.mergedInstructionDocs ? (
                  <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
                    Loading docs… if this stays empty, refresh once.
                  </p>
                ) : (
                  (() => {
                    const merged = runtimeCtx.mergedInstructionDocs as Record<
                      string,
                      { markdown?: string; source?: string }
                    >;
                    const agentMd = String(merged?.AGENT?.markdown ?? "");
                    const importedEntries = parseImportedBundleEntries(agentMd);
                    const manifestPaths = extractImportedBundlePaths(agentMd);

                    const canon = DEPLOYED_INSTRUCTION_DOC_KEYS.map((key) => {
                      const row = merged[key];
                      return {
                        id: `canon:${key}`,
                        title: `${key}.md`,
                        markdown: String(row?.markdown ?? ""),
                        source: row?.source,
                      };
                    }).filter((d) => d.markdown.trim().length > 0);

                    const imported = importedEntries
                      .filter((e) => e.path !== "Bundle manifest (.md paths scanned)")
                      .map((e) => ({
                        id: `import:${e.path}`,
                        title: e.path,
                        markdown: e.markdown,
                        source: "import",
                      }));

                    const all = [...canon, ...imported];
                    const defaultDoc = all[0]?.id ?? "canon:AGENT";

                    return (
                      <div className="space-y-3">
                        {manifestPaths.length ? (
                          <div className="rounded-md border border-border bg-muted/10 px-3 py-2">
                            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                              Import manifest
                            </div>
                            <p className="text-[10px] text-muted-foreground leading-snug mt-1">
                              {manifestPaths.length} markdown file(s) detected in your zip · showing{" "}
                              <span className="font-medium text-foreground">{canon.length + imported.length}</span> doc tab(s)
                            </p>
                          </div>
                        ) : null}

                        <Tabs defaultValue={defaultDoc} className="w-full flex-1 min-h-0">
                          <ScrollArea className="w-full">
                            <TabsList className="w-full max-w-full justify-start flex-nowrap overflow-x-auto">
                              {canon.map((d) => (
                                <TabsTrigger key={d.id} value={d.id} className="text-xs shrink-0">
                                  {d.title}
                                </TabsTrigger>
                              ))}
                              {imported.map((d) => (
                                <TabsTrigger
                                  key={d.id}
                                  value={d.id}
                                  className="text-xs shrink-0"
                                  title={d.title}
                                >
                                  {d.title.split("/").slice(-1)[0]}
                                </TabsTrigger>
                              ))}
                            </TabsList>
                            <ScrollBar orientation="horizontal" />
                          </ScrollArea>

                          {all.map((d) => (
                            <TabsContent key={d.id} value={d.id} className="mt-3 flex-1 min-h-0">
                              <Card className="bg-card border-border">
                                <CardContent className="p-3 space-y-2">
                                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-foreground">{d.title}</span>
                                    <span className="text-[10px] text-muted-foreground">source: {d.source ?? "—"}</span>
                                  </div>
                                  <pre className="text-xs whitespace-pre-wrap bg-muted/30 border border-border rounded-md p-3 max-h-[min(560px,55vh)] overflow-auto">
                                    {d.markdown.trim() ? d.markdown : "—"}
                                  </pre>
                                </CardContent>
                              </Card>
                            </TabsContent>
                          ))}
                        </Tabs>
                      </div>
                    );
                  })()
                )}
              </TabsContent>

              <TabsContent value="skills" className="mt-0 space-y-3 outline-none">
                {(() => {
                  const agentMd = String(
                    (runtimeCtx?.mergedInstructionDocs as Record<string, { markdown?: string }> | undefined)?.AGENT
                      ?.markdown ?? "",
                  );
                  const fromZip = extractImportedBundleSection(agentMd);
                  const skillsRow = runtimeCtx?.skills as { markdown?: string; source?: string } | undefined;
                  return (
                    <div className="space-y-3">
                      {fromZip ? (
                        <Card className="bg-card border-border border-primary/25">
                          <CardContent className="p-4 space-y-2">
                            <div className="text-xs font-semibold text-foreground">From your uploaded zip / folder</div>
                            <p className="text-[10px] text-muted-foreground leading-snug">
                              Stored inside <span className="font-mono">AGENT.md</span> under{" "}
                              <span className="font-mono">Imported bundle (extra files)</span> so Cortex can use paths that are not
                              named <span className="font-mono">SKILLS.md</span>.
                            </p>
                            <pre className="text-xs whitespace-pre-wrap bg-muted/30 border border-border rounded-md p-3 max-h-[min(480px,50vh)] overflow-auto">
                              {fromZip}
                            </pre>
                          </CardContent>
                        </Card>
                      ) : (
                        <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-md p-3">
                          No <span className="font-mono">Imported bundle</span> block in <span className="font-mono">AGENT.md</span> —
                          open <span className="font-mono">AGENT.md</span> under Instructions for the full file, or re-import a zip
                          that includes extra <span className="font-mono">.md</span> / text files (they are merged into{" "}
                          <span className="font-mono">AGENT.md</span>).
                        </p>
                      )}

                      {!runtimeCtx ? (
                        <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">Loading skills…</p>
                      ) : !hasInstanceSkillsOnDisk ? (
                        renderEffectiveSkillsPreview(skillsRow)
                      ) : (
                        <Card className="bg-card border-border shadow-sm ring-1 ring-border/30">
                          <CardContent className="space-y-4 p-5 sm:p-6">
                            <div className="space-y-1">
                              <div className="text-xs font-semibold text-foreground">Instance SKILLS.md</div>
                              <p className="text-[10px] text-muted-foreground leading-snug">
                                This agent has <span className="font-mono">SKILLS.md</span> on disk — it overrides the library for
                                runs. Source shown in merged view: <span className="font-mono">{skillsRow?.source ?? "—"}</span>
                              </p>
                            </div>
                            <Textarea
                              value={skillsDraft}
                              onChange={(e) => setSkillsDraft(e.target.value)}
                              className="min-h-[min(360px,45vh)] max-h-[min(560px,55vh)] font-mono text-xs leading-relaxed resize-y"
                              spellCheck={false}
                              placeholder="Instance SKILLS.md markdown…"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => saveInstanceSkillsMd.mutate()}
                                disabled={saveInstanceSkillsMd.isPending}
                              >
                                {saveInstanceSkillsMd.isPending ? "Saving…" : "Update SKILLS.md"}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  );
                })()}
              </TabsContent>

              <TabsContent value="add-skills" className="mt-0 outline-none">
                {!runtimeCtx ? (
                  <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">Loading…</p>
                ) : hasInstanceSkillsOnDisk ? (
                  <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
                    This agent already has <span className="font-mono">SKILLS.md</span> on disk — open the <span className="font-medium text-foreground">Skills</span> tab to view or update it.
                  </p>
                ) : (
                  <div className="flex flex-col gap-6 sm:gap-7">
                    <div className="rounded-lg border border-border/80 bg-muted/20 px-4 py-4 sm:px-5 sm:py-5 space-y-2 shadow-sm">
                      <div className="text-xs font-semibold text-foreground">Add skills for this agent</div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Current <span className="font-mono">SKILLS.md</span> from the library (read-only) is in the next card. Under
                        that, write or load the <span className="font-medium text-foreground">new skills markdown</span> — saved as a
                        new <span className="font-mono">SKILLS.md</span> on this agent only.
                      </p>
                    </div>
                    {renderEffectiveSkillsPreview(runtimeCtx.skills as { markdown?: string; source?: string } | undefined, {
                      heading: "Skills markdown in use (library)",
                      blurb: "Skill instructions from the role / library — read-only reference while you compose your file below.",
                      preClassName: "max-h-[min(200px,26vh)] sm:max-h-[min(240px,32vh)]",
                    })}
                    {renderAddSkillsMdForm()}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="run" className="mt-0 space-y-3 outline-none">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm text-muted-foreground">Run logs</div>
                  <Button size="sm" onClick={() => runOnce.mutate()} disabled={runOnce.isPending}>
                    {runOnce.isPending ? "Running…" : "Run now"}
                  </Button>
                </div>
                {tenant?.adapterType === "openclaw" ? (
                  <p className="text-xs text-muted-foreground border border-border rounded-md p-3 bg-muted/20 leading-relaxed">
                    OpenClaw: <span className="font-medium text-foreground">Run now</span> does not call an LLM inside Cortex — it
                    logs a run, stores the merged <span className="font-mono">SKILLS</span> snapshot on that run’s events, and posts
                    to collaboration. Use <span className="font-medium text-foreground">Hermes</span> here for a real model loop, or
                    wire your gateway to <span className="font-mono">GET …/runtime-context</span>.
                  </p>
                ) : null}
                <div className="border border-border rounded-md divide-y divide-border max-h-[420px] overflow-auto">
                  {runs.map((r) => (
                    <div key={r.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="text-xs font-mono shrink-0">#{r.id}</div>
                          <Badge variant="outline" className="text-[10px] py-0 shrink-0">
                            {r.trigger}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] py-0 shrink-0",
                              r.status === "failed" ? "border-red-500/30 text-red-300" : "",
                            )}
                          >
                            {r.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 ml-auto shrink-0">
                          <div className="text-xs text-muted-foreground">{new Date(r.startedAt).toLocaleTimeString()}</div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-[10px]"
                            onClick={() => setOpenRunLogId((cur) => (cur === r.id ? null : r.id))}
                          >
                            <ListTree className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {openRunLogId === r.id ? "Hide events" : "Events"}
                          </Button>
                        </div>
                      </div>
                      <div className="text-xs text-foreground mt-1 whitespace-pre-wrap break-words leading-relaxed">
                        {r.error ? `Error: ${r.error}` : (r.summary ?? "—")}
                      </div>
                      {openRunLogId === r.id ? (
                        <div className="mt-2 rounded-md border border-border/80 bg-muted/25 p-2">
                          {runLogFetching ? (
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground py-1">
                              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
                              Loading run events…
                            </div>
                          ) : Array.isArray(runLogDetail?.events) && runLogDetail.events.length > 0 ? (
                            <ul className="space-y-2 max-h-[min(320px,50vh)] overflow-auto">
                              {runLogDetail.events.map((ev) => (
                                <li key={ev.id} className="text-[10px] leading-relaxed">
                                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5 text-muted-foreground">
                                    <Badge variant="secondary" className="text-[9px] py-0 h-4 font-mono">
                                      {ev.kind}
                                    </Badge>
                                    <span className="font-mono text-[9px]">{ev.ts}</span>
                                  </div>
                                  <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-foreground/95 bg-background/40 rounded px-1.5 py-1 border border-border/50">
                                    {ev.message}
                                  </pre>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-[10px] text-muted-foreground py-1">No events for this run.</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {runs.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No runs yet.</div>
                  ) : null}
                </div>
              </TabsContent>
              </div>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={agentStartResult.open} onOpenChange={(open) => !open && closeAgentStartResult()}>
        <DialogContent
          className={cn(
            "gap-0 overflow-hidden p-0 sm:rounded-xl",
            agentStartResult.open === true && agentStartResult.outcome === "success"
              ? "sm:max-w-md border-primary/30 shadow-lg shadow-primary/5"
              : agentStartResult.open === true
                ? "sm:max-w-lg border-destructive/35 shadow-lg shadow-destructive/10"
                : undefined,
          )}
        >
          {agentStartResult.open === true ? (
            agentStartResult.outcome === "error" ? (
              <>
                <div className="relative border-b border-destructive/15 bg-gradient-to-br from-destructive/[0.14] via-destructive/[0.06] to-transparent px-6 pb-5 pt-6">
                  <div className="flex gap-4 pr-8">
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-destructive/15 ring-1 ring-destructive/25"
                      aria-hidden
                    >
                      <AlertCircle className="h-7 w-7 text-destructive" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <Badge
                        variant="outline"
                        className="w-fit border-destructive/45 bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-destructive"
                      >
                        Failed
                      </Badge>
                      <DialogTitle className="text-xl font-semibold tracking-tight text-destructive sm:text-2xl">
                        {agentStartResult.title}
                      </DialogTitle>
                      <p className="text-sm font-medium text-foreground">{agentStartResult.agentName}</p>
                      <div className="rounded-xl border border-destructive/25 bg-background/90 px-3.5 py-3 text-sm font-medium leading-snug text-foreground shadow-sm backdrop-blur-sm">
                        {startResultErrorHeadline(agentStartResult.summary, agentStartResult.cause)}
                      </div>
                    </div>
                  </div>
                  <DialogDescription className="sr-only">
                    {[
                      "Failed.",
                      agentStartResult.summary,
                      agentStartResult.cause?.error,
                      agentStartResult.cause?.reason,
                      agentStartResult.cause?.adapter,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </DialogDescription>
                </div>
                <div className="space-y-4 px-6 py-5 text-sm">
                  {headlineDiffersFromSummaryFirstLine(
                    startResultErrorHeadline(agentStartResult.summary, agentStartResult.cause),
                    agentStartResult.summary,
                  ) ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">{agentStartResult.summary}</p>
                  ) : null}

                  {causeHasDetail(agentStartResult.cause) ? (
                    <div className="rounded-xl border border-destructive/20 bg-muted/30 px-3.5 py-3 space-y-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Technical details
                      </p>
                      {agentStartResult.cause.error ? (
                        <p className="text-xs text-foreground whitespace-pre-wrap break-words font-mono leading-relaxed">
                          {agentStartResult.cause.error}
                        </p>
                      ) : null}
                      {agentStartResult.cause.reason ? (
                        <p className="text-xs text-muted-foreground">
                          Reason:{" "}
                          <span className="font-mono text-foreground">{agentStartResult.cause.reason}</span>
                        </p>
                      ) : null}
                      {agentStartResult.cause.adapter ? (
                        <p className="text-xs text-muted-foreground">
                          Adapter:{" "}
                          <span className="font-mono text-foreground">{agentStartResult.cause.adapter}</span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                    {agentStartResult.isCeo ? (
                      <>
                        Tip: open{" "}
                        <Link href="/ceo/runs">
                          <a className="font-medium text-primary underline underline-offset-2">CEO → Runs</a>
                        </Link>{" "}
                        for the full transcript and stderr.
                      </>
                    ) : (
                      <>
                        Tip: open this agent’s <strong className="text-foreground">Run</strong> tab for timestamps and
                        full events.
                      </>
                    )}
                  </div>
                </div>
                <DialogFooter className="gap-2 border-t border-border/60 bg-muted/25 px-6 py-3.5 sm:gap-0">
                  {agentStartResult.isCeo ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="sm:mr-auto"
                      onClick={() => {
                        closeAgentStartResult();
                        navigate("/ceo/runs");
                      }}
                    >
                      CEO Runs
                    </Button>
                  ) : null}
                  <Button type="button" onClick={closeAgentStartResult}>
                    OK
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <div className="relative border-b border-primary/15 bg-gradient-to-br from-primary/[0.12] via-primary/[0.05] to-transparent px-6 pb-5 pt-6">
                  <div className="flex gap-4 pr-8">
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/25"
                      aria-hidden
                    >
                      <CheckCircle className="h-7 w-7 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <Badge
                        variant="outline"
                        className="w-fit border-emerald-500/45 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
                      >
                        Successful
                      </Badge>
                      <DialogTitle className="text-xl font-semibold tracking-tight text-primary sm:text-2xl">
                        {agentStartResult.title}
                      </DialogTitle>
                      <p className="text-sm font-medium text-foreground">{agentStartResult.agentName}</p>
                    </div>
                  </div>
                  <DialogDescription className="sr-only">{agentStartResult.summary}</DialogDescription>
                </div>
                <div className="space-y-4 px-6 py-5 text-sm">
                  <p className="text-muted-foreground leading-relaxed">{agentStartResult.summary}</p>
                  {agentStartResult.successMeta ? (
                    <div className="rounded-xl border border-border/80 bg-muted/30 px-3.5 py-3 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
                      {agentStartResult.successMeta.startupRunCompleted ? (
                        <p className="text-xs text-muted-foreground">
                          Startup run:{" "}
                          <span className="font-medium text-foreground">completed OK</span>
                        </p>
                      ) : null}
                      {agentStartResult.successMeta.adapter ? (
                        <p className="text-xs text-muted-foreground">
                          Adapter:{" "}
                          <span className="font-mono text-foreground">{agentStartResult.successMeta.adapter}</span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                    {agentStartResult.isCeo ? (
                      <>
                        For transcripts, open{" "}
                        <Link href="/ceo/runs">
                          <a className="font-medium text-primary underline underline-offset-2">CEO → Runs</a>
                        </Link>
                        .
                      </>
                    ) : (
                      <>
                        Use the <strong className="text-foreground">Run</strong> tab on this agent for the live log.
                      </>
                    )}
                  </div>
                </div>
                <DialogFooter className="gap-2 border-t border-border/60 bg-muted/25 px-6 py-3.5 sm:gap-0">
                  {agentStartResult.isCeo ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="sm:mr-auto"
                      onClick={() => {
                        closeAgentStartResult();
                        navigate("/ceo/runs");
                      }}
                    >
                      CEO Runs
                    </Button>
                  ) : null}
                  <Button type="button" onClick={closeAgentStartResult}>
                    OK
                  </Button>
                </DialogFooter>
              </>
            )
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminate Agent?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the agent and all their task history. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteId && deleteAgent.mutate(deleteId)}>
              Terminate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
