import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
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
  Pause,
  Play,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { cn, deployedAgentEmoji, formatDistanceToNow } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  running: { label: "Running", dot: "bg-green-500 status-running", badge: "bg-green-500/10 text-green-400 border-green-500/20" },
  idle: { label: "Idle", dot: "bg-yellow-500", badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  paused: { label: "Paused", dot: "bg-orange-500", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
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

export default function MyAgents() {
  const { activeTenantId } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);
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

  const { data: ceoControl } = useQuery<{ enabled?: boolean; mode?: "agent" | "me" }>({
    queryKey: ["/api/tenants", tid, "ceo", "control"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/ceo/control`).then((r) => r.json()),
    enabled: tid > 0,
  });

  const { data: agents = [], isLoading } = useQuery<(Agent & { cardModel?: string })[]>({
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

  const { data: runs = [] } = useQuery<any[]>({
    queryKey: ["/api/tenants", tid, "agents", selectedAgent?.id ?? 0, "runs"],
    queryFn: () =>
      apiRequest("GET", `/api/tenants/${tid}/agents/${selectedAgent!.id}/runs?limit=30`).then((r) => r.json()),
    enabled: tid > 0 && !!selectedAgent?.id,
    refetchInterval: detailsAgentId ? 4000 : false,
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
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/agents/${id}`, { status }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "agents"] }),
    onError: () => toast({ title: "Error", description: "Failed to update agent", variant: "destructive" }),
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
          <p className="text-sm text-muted-foreground mt-0.5">
            {visibleAgents.length} agents deployed · {visibleAgents.filter(a => a.status === "running").length} running
          </p>
          {/* Agent usage bar */}
          <div className="mt-2 flex items-center gap-3 max-w-xs">
            <Progress
              value={limitPct}
              className={cn("h-1.5 flex-1", atLimit ? "[&>div]:bg-destructive" : limitPct > 80 ? "[&>div]:bg-orange-400" : "")}
            />
            <span className={cn("text-xs font-medium tabular-nums shrink-0", atLimit ? "text-destructive" : "text-muted-foreground")}>
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
          { icon: Bot, label: "Total Agents", value: visibleAgents.length, sub: `${visibleAgents.filter(a => a.status === "running").length} running` },
          { icon: CheckCircle, label: "Tasks Completed", value: totalCompleted, sub: "all time" },
          { icon: DollarSign, label: "Total Spent", value: `$${totalSpent.toFixed(2)}`, sub: "this month" },
        ].map(s => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <s.icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.sub}</p>
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
            const s = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
            const budgetPct = (agent.spentThisMonth / agent.monthlyBudget) * 100;
            const isCeo = String(agent.role).toLowerCase() === "ceo";
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
                        <p className="text-xs text-muted-foreground">{agent.role}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("text-xs py-0 shrink-0", s.badge)}>{s.label}</Badge>
                  </div>
                  {isCeo ? (
                    <div className="text-[11px] text-muted-foreground">
                      Manage details in the CEO section.
                    </div>
                  ) : null}

                  {/* Goal */}
                  {agent.goal && (
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 bg-muted/40 rounded-md px-2.5 py-1.5">
                      {agent.goal}
                    </p>
                  )}

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs font-semibold text-foreground">{agent.tasksCompleted}</p>
                      <p className="text-xs text-muted-foreground">done</p>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs font-semibold text-foreground">${agent.spentThisMonth.toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground">spent</p>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
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
                      <p className="text-xs text-muted-foreground">model</p>
                    </div>
                  </div>

                  {/* Budget bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Budget</span>
                      <span>${agent.spentThisMonth.toFixed(2)} / ${agent.monthlyBudget}</span>
                    </div>
                    <Progress value={Math.min(100, budgetPct)} className="h-1" />
                  </div>

                  {/* Last heartbeat */}
                  {agent.lastHeartbeat && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>Last heartbeat {formatDistanceToNow(agent.lastHeartbeat)}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    {agent.status === "running" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs"
                        onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: agent.id, status: "paused" }); }}
                        data-testid={`pause-${agent.id}`}
                      >
                        <Pause className="w-3 h-3 mr-1" /> Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: agent.id, status: "running" }); }}
                        data-testid={`start-${agent.id}`}
                      >
                        <Play className="w-3 h-3 mr-1" /> Start
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
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
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
            <Tabs defaultValue="dashboard" className="w-full flex-1 min-h-0">
              <ScrollArea className="w-full">
                <TabsList className="w-full max-w-full justify-start flex-nowrap overflow-x-auto">
                  <TabsTrigger value="dashboard" className="shrink-0">Dashboard</TabsTrigger>
                  <TabsTrigger value="docs" className="shrink-0">Docs</TabsTrigger>
                  {runtimeCtx?.hasInstanceSkillsFile ? <TabsTrigger value="skills" className="shrink-0">Skills</TabsTrigger> : null}
                  <TabsTrigger value="run" className="shrink-0">Run</TabsTrigger>
                </TabsList>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>

              <TabsContent value="dashboard" className="mt-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Card className="bg-card border-border">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <CheckCircle className="w-3.5 h-3.5" /> Tasks completed
                      </div>
                      <div className="text-xl font-semibold">{selectedAgent.tasksCompleted}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border-border">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <DollarSign className="w-3.5 h-3.5" /> Spent this month
                      </div>
                      <div className="text-xl font-semibold">${selectedAgent.spentThisMonth.toFixed(2)}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border-border">
                    <CardContent className="p-4">
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
                  Status: <span className="text-foreground">{selectedAgent.status}</span> · Budget:{" "}
                  <span className="text-foreground">${selectedAgent.spentThisMonth.toFixed(2)} / ${selectedAgent.monthlyBudget}</span>
                </div>
              </TabsContent>

              <TabsContent value="docs" className="mt-4 space-y-3 flex-1 min-h-0">
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

              {runtimeCtx?.hasInstanceSkillsFile ? (
              <TabsContent value="skills" className="mt-4 space-y-3">
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
                      <Card className="bg-card border-border">
                        <CardContent className="p-4 space-y-2">
                          <div className="text-xs font-semibold text-foreground">SKILLS.md (role / library)</div>
                          <p className="text-[10px] text-muted-foreground leading-snug">
                            Effective skills for runs (library template when your zip did not ship a dedicated{" "}
                            <span className="font-mono">SKILLS.md</span>). Source:{" "}
                            <span className="font-mono">{skillsRow?.source ?? "—"}</span>
                          </p>
                          <pre className="text-xs whitespace-pre-wrap bg-muted/30 border border-border rounded-md p-3 max-h-[280px] overflow-auto">
                            {skillsRow?.markdown ?? "—"}
                          </pre>
                        </CardContent>
                      </Card>
                    </div>
                  );
                })()}
              </TabsContent>
              ) : null}

              <TabsContent value="run" className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm text-muted-foreground">Run logs</div>
                  <Button size="sm" onClick={() => runOnce.mutate()} disabled={runOnce.isPending}>
                    {runOnce.isPending ? "Running…" : "Run now"}
                  </Button>
                </div>
                {tenant?.adapterType === "openclaw" ? (
                  <p className="text-xs text-muted-foreground border border-border rounded-md p-3 bg-muted/20">
                    OpenClaw: Cortex records the run and posts a channel update. Heavy execution still happens in your OpenClaw gateway.
                  </p>
                ) : null}
                <div className="border border-border rounded-md divide-y divide-border max-h-[420px] overflow-auto">
                  {runs.map((r) => (
                    <div key={r.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-mono">#{r.id}</div>
                        <Badge variant="outline" className="text-[10px] py-0">{r.trigger}</Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] py-0",
                            r.status === "failed" ? "border-red-500/30 text-red-300" : "",
                          )}
                        >
                          {r.status}
                        </Badge>
                        <div className="text-xs text-muted-foreground ml-auto">{new Date(r.startedAt).toLocaleTimeString()}</div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {r.error ? `Error: ${r.error}` : (r.summary ?? "—")}
                      </div>
                    </div>
                  ))}
                  {runs.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No runs yet.</div>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
          )}
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
