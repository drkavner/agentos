import { FlateErrorCode, unzip } from "fflate";
import type { UnzipFileInfo } from "fflate";

/** Canonical instruction filenames the server accepts in `files`. */
export const IMPORT_DOC_FILENAMES = ["SOUL.md", "AGENT.md", "HEARTBEAT.md", "TOOLS.md", "SKILLS.md"] as const;
export type ImportDocFilename = (typeof IMPORT_DOC_FILENAMES)[number];

const DOC_LOWER = new Set(IMPORT_DOC_FILENAMES.map((f) => f.toLowerCase()));

export function basename(pathOrName: string): string {
  const s = pathOrName.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/** Map a path or filename to a canonical doc key (also accepts repo-style `skills.md` → SKILLS.md). */
export function matchCanonicalImportDoc(pathOrName: string): ImportDocFilename | null {
  const base = basename(pathOrName).toLowerCase();
  // Hermes / Cursor / many CLI bundles use AGENTS.md as the main instruction file; we persist as AGENT.md.
  if (base === "agents.md") return "AGENT.md";
  if (DOC_LOWER.has(base)) {
    return IMPORT_DOC_FILENAMES.find((f) => f.toLowerCase() === base) ?? null;
  }
  if (base === "skills.md") return "SKILLS.md";
  return null;
}

function scoreHirePayload(o: Record<string, unknown>): number {
  let s = 0;
  if (o.definitionId != null && Number.isFinite(Number(o.definitionId))) s += 5;
  if (typeof o.definitionName === "string" && o.definitionName.trim()) s += 4;
  if (typeof o.displayName === "string" && o.displayName.trim()) s += 3;
  if (typeof o.role === "string" && o.role.trim()) s += 2;
  if (Array.isArray(o.files)) s += Math.min(6, o.files.length);
  return s;
}

/** Pull `files[].filename` / `markdown` into a doc map when filenames match SOUL.md, etc. */
export function filesArrayToDocMap(files: unknown): Partial<Record<ImportDocFilename, string>> {
  if (!Array.isArray(files)) return {};
  const out: Partial<Record<ImportDocFilename, string>> = {};
  for (const row of files) {
    if (row == null || typeof row !== "object") continue;
    const fn = String((row as { filename?: unknown }).filename ?? "");
    const md = String((row as { markdown?: unknown }).markdown ?? "");
    const key = matchCanonicalImportDoc(fn);
    if (key && md) out[key] = md;
  }
  return out;
}

/**
 * Normalize common bundle shapes to a single hire/import JSON string (what the textarea expects).
 */
export function tryHireJsonString(parsed: unknown): string | null {
  if (parsed == null || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  if (o.import != null && typeof o.import === "object") {
    return tryHireJsonString(o.import);
  }

  // GET …/agents/:id/docs export, or hire bundle: agent + optional definition + runtime + files
  if (o.agent && typeof o.agent === "object") {
    const base: Record<string, unknown> = { ...(o.agent as Record<string, unknown>) };
    if (o.runtime && typeof o.runtime === "object") Object.assign(base, o.runtime as object);
    if (Array.isArray(o.files)) base.files = o.files;
    const def = o.definition;
    if (def && typeof def === "object" && base.definitionId == null && (def as { id?: unknown }).id != null) {
      base.definitionId = (def as { id: number }).id;
    }
    if (base.definitionId != null || base.definitionName != null || typeof base.displayName === "string") {
      return JSON.stringify(base, null, 2);
    }
  }

  if (o.definitionId != null || o.definitionName != null || typeof o.displayName === "string") {
    return JSON.stringify(o, null, 2);
  }
  return null;
}

/** Hard cap for reading a whole zip into RAM in the browser (filtered unzip still loads the archive). */
export const MAX_IMPORT_ZIP_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_IMPORT_DOC_UNCOMPRESSED = 2 * 1024 * 1024;
const MAX_IMPORT_JSON_UNCOMPRESSED = 16 * 1024 * 1024;
/** Cap for non-canonical .md plus .txt/.yaml/.mdx etc. per zip (avoids decompressing huge trees). */
const MAX_ZIP_AUX_TEXT_ENTRIES = 500;

export type ImportBundleExtraText = { path: string; text: string };

/** Appends zip/folder “extra” text into AGENT.md so Cortex/Hermes see the full bundle (server only persists canonical filenames). */
export function appendImportExtrasToAgentMarkdown(
  baseAgentMarkdown: string,
  extras: ImportBundleExtraText[],
): string {
  if (!extras.length) return baseAgentMarkdown;
  const parts = extras.map(({ path, text }) => `### ${path}\n\n${text.trim()}`);
  const section = `\n\n---\n\n## Imported bundle (extra files)\n\n${parts.join("\n\n---\n\n")}\n`;
  const base = baseAgentMarkdown.trim();
  return (base ? `${base}${section}` : section.trim()).trim();
}

function isAuxBundleTextLeaf(leaf: string): boolean {
  const l = leaf.toLowerCase();
  return (
    l.endsWith(".txt") ||
    l.endsWith(".mdx") ||
    l.endsWith(".yaml") ||
    l.endsWith(".yml") ||
    l.endsWith(".markdown")
  );
}

function importZipEntryFilter(fi: UnzipFileInfo, auxTextBudget: { n: number }): boolean {
  const path = fi.name.replace(/\\/g, "/");
  if (path.endsWith("/")) return false;
  if (path.includes("__MACOSX/") || path.includes("__MACOSX\\")) return false;
  const leaf = basename(path);
  if (leaf === ".DS_Store" || leaf.startsWith(".")) return false;
  // fflate only supports STORED (0) and DEFLATE (8); skip others without throwing.
  if (fi.compression !== 0 && fi.compression !== 8) return false;

  const unc = Number.isFinite(fi.originalSize) ? fi.originalSize : 0;
  const comp = fi.size ?? 0;
  const docKey = matchCanonicalImportDoc(path);
  if (docKey) {
    if (unc > MAX_IMPORT_DOC_UNCOMPRESSED) return false;
    // Many zip tools leave originalSize=0 in the local header; only cap by compressed size.
    if (unc === 0 && comp > 20 * 1024 * 1024) return false;
    return true;
  }
  if (leaf.toLowerCase().endsWith(".json")) {
    if (unc > MAX_IMPORT_JSON_UNCOMPRESSED) return false;
    if (unc === 0 && comp > 20 * 1024 * 1024) return false;
    return true;
  }
  // Non-canonical .md or other small text — listed and merged into AGENT.md on import.
  if (leaf.toLowerCase().endsWith(".md")) {
    if (auxTextBudget.n <= 0) return false;
    auxTextBudget.n -= 1;
    if (unc > MAX_IMPORT_DOC_UNCOMPRESSED) return false;
    if (unc === 0 && comp > 20 * 1024 * 1024) return false;
    return true;
  }
  if (isAuxBundleTextLeaf(leaf)) {
    if (auxTextBudget.n <= 0) return false;
    auxTextBudget.n -= 1;
    if (unc > MAX_IMPORT_DOC_UNCOMPRESSED) return false;
    if (unc === 0 && comp > 20 * 1024 * 1024) return false;
    return true;
  }
  return false;
}

function mapUnzipFailure(err: unknown, fileName: string): Error {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: number }).code;
    if (code === FlateErrorCode.UnknownCompressionMethod) {
      return new Error(
        `Zip "${fileName}" uses compression this tool cannot read (needs STORED or DEFLATE). Re-zip with Finder or zip -r.`,
      );
    }
  }
  const inner = err instanceof Error ? err.message : String(err);
  return new Error(`Invalid or unreadable zip: ${fileName}${inner ? ` (${inner})` : ""}`);
}

async function unzipImportRelevant(buf: ArrayBuffer, zipFileName: string): Promise<Record<string, Uint8Array>> {
  const u8 = new Uint8Array(buf);
  const auxTextBudget = { n: MAX_ZIP_AUX_TEXT_ENTRIES };
  return new Promise((resolve, reject) => {
    unzip(
      u8,
      { filter: (fi) => importZipEntryFilter(fi, auxTextBudget) },
      (err, data) => {
        if (err) reject(mapUnzipFailure(err, zipFileName));
        else resolve(data ?? {});
      },
    );
  });
}

async function hasZipLocalHeader(file: File): Promise<boolean> {
  if (file.size < 4) return false;
  const b = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return b[0] === 0x50 && b[1] === 0x4b;
}

/** Extension or ZIP local header (PK) — some tools omit `.zip` or use generic MIME. */
async function isZipUpload(file: File): Promise<boolean> {
  if (file.name.toLowerCase().endsWith(".zip")) return true;
  const mime = (file.type || "").toLowerCase();
  if (mime === "application/zip" || mime === "application/x-zip-compressed") {
    return hasZipLocalHeader(file);
  }
  // Downloads / pickers often report octet-stream, empty string, or "binary/octet-stream".
  if (
    mime === "application/octet-stream" ||
    mime === "binary/octet-stream" ||
    mime === "" ||
    mime === "multipart/x-zip"
  ) {
    return hasZipLocalHeader(file);
  }
  return false;
}

function utf8Text(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Scan uploaded files (and .zip contents): detect canonical .md by path/filename,
 * parse JSON bundles, merge embedded `files` into the doc map.
 */
export async function parseImportUploadFiles(files: File[]): Promise<{
  docMarkdown: Partial<Record<ImportDocFilename, string>>;
  hireJson: string | null;
  detected: string[];
  /** Zip archives we actually opened (useful when nothing importable was inside). */
  scannedZipArchives: string[];
  /** Every member path we read from zips plus loose file names (`archive.zip › inner/path.md`). */
  matchedPaths: string[];
  /** Non-canonical .md and other text files — merged into AGENT.md at import so the agent sees the whole bundle. */
  extraTextFiles: ImportBundleExtraText[];
}> {
  const docMarkdown: Partial<Record<ImportDocFilename, string>> = {};
  const detected: string[] = [];
  const matchedPaths: string[] = [];
  const extraTextFiles: ImportBundleExtraText[] = [];
  const scannedZipArchives: string[] = [];
  let bestHireJson: string | null = null;
  let bestHireScore = -1;

  function considerJson(text: string, label: string) {
    const trimmed = text.replace(/^\uFEFF/, "").trimStart();
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    const fromFiles = filesArrayToDocMap((parsed as { files?: unknown }).files);
    Object.assign(docMarkdown, fromFiles);
    const hire = tryHireJsonString(parsed);
    if (!hire) {
      if (Object.keys(fromFiles).length > 0) detected.push(`${label} (docs in JSON)`);
      return;
    }
    const score = scoreHirePayload(JSON.parse(hire) as Record<string, unknown>);
    if (score > bestHireScore) {
      bestHireScore = score;
      bestHireJson = hire;
    }
    detected.push(label);
  }

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (await isZipUpload(file)) {
      scannedZipArchives.push(file.name);
      if (file.size > MAX_IMPORT_ZIP_ARCHIVE_BYTES) {
        throw new Error(
          `Zip is too large for in-browser scan (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max ${Math.round(MAX_IMPORT_ZIP_ARCHIVE_BYTES / (1024 * 1024))} MB — re-export without huge folders (e.g. node_modules) or import the .md files only.`,
        );
      }
      let entries: Record<string, Uint8Array>;
      try {
        entries = await unzipImportRelevant(await file.arrayBuffer(), file.name);
      } catch (e) {
        throw e instanceof Error ? e : mapUnzipFailure(e, file.name);
      }
      detected.push(file.name);
      for (const [path, bytes] of Object.entries(entries)) {
        if (path.endsWith("/")) continue;
        if (path.includes("__MACOSX/") || path.includes("__MACOSX\\")) continue;
        const norm = path.replace(/\\/g, "/");
        const leaf = basename(norm);
        if (leaf === ".DS_Store" || leaf.startsWith(".")) continue;

        matchedPaths.push(`${file.name} › ${norm}`);

        const docKey = matchCanonicalImportDoc(path);
        if (docKey) {
          docMarkdown[docKey] = utf8Text(bytes);
          detected.push(docKey);
          continue;
        }
        if (leaf.toLowerCase().endsWith(".md")) {
          try {
            extraTextFiles.push({ path: `${file.name} › ${norm}`, text: utf8Text(bytes) });
          } catch {
            /* skip */
          }
          continue;
        }
        if (isAuxBundleTextLeaf(leaf)) {
          try {
            extraTextFiles.push({ path: `${file.name} › ${norm}`, text: utf8Text(bytes) });
          } catch {
            /* skip */
          }
          continue;
        }
        if (leaf.toLowerCase().endsWith(".json")) {
          try {
            considerJson(utf8Text(bytes), `${leaf} (in ${file.name})`);
          } catch {
            /* skip non-utf8 json */
          }
          continue;
        }
      }
      continue;
    }

    if (lower.endsWith(".json")) {
      matchedPaths.push(file.name);
      const text = await file.text();
      considerJson(text, file.name);
      continue;
    }

    const docKey = matchCanonicalImportDoc(file.name);
    if (docKey) {
      matchedPaths.push(file.name);
      docMarkdown[docKey] = await file.text();
      detected.push(docKey);
      continue;
    }

    if (isAuxBundleTextLeaf(file.name)) {
      matchedPaths.push(file.name);
      extraTextFiles.push({ path: file.name, text: await file.text() });
      continue;
    }

    if (lower.endsWith(".md")) {
      matchedPaths.push(file.name);
      extraTextFiles.push({ path: file.name, text: await file.text() });
      continue;
    }
  }

  const uniq = Array.from(new Set(detected));
  const matchedPathsSorted = Array.from(new Set(matchedPaths)).sort((a, b) => a.localeCompare(b));
  extraTextFiles.sort((a, b) => a.path.localeCompare(b.path));
  return {
    docMarkdown,
    hireJson: bestHireJson,
    detected: uniq,
    scannedZipArchives,
    matchedPaths: matchedPathsSorted,
    extraTextFiles,
  };
}
