import fs from "fs";
import path from "path";
import archiver from "archiver";
import { Writable } from "stream";

const DELIVERABLES_ROOT = path.resolve("deliverables");

interface ExtractedFile {
  filename: string;
  language: string;
  content: string;
}

/**
 * Parse markdown output from LLM and extract code blocks that have filenames.
 * Supports patterns like:
 *   ## File: `server.js`
 *   ## 📁 server.js
 *   ```javascript  // filename: server.js
 *   ### server.js
 */
export function extractCodeFiles(markdown: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  const lines = markdown.split("\n");

  let pendingFilename: string | null = null;
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (inCodeBlock) {
      if (line.trimEnd() === "```") {
        if (pendingFilename && codeLines.length > 0) {
          files.push({
            filename: pendingFilename,
            language: codeBlockLang,
            content: codeLines.join("\n"),
          });
        }
        inCodeBlock = false;
        pendingFilename = null;
        codeLines = [];
        codeBlockLang = "";
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const codeStart = line.match(/^```(\w*)/);
    if (codeStart) {
      inCodeBlock = true;
      codeBlockLang = codeStart[1] || "";
      codeLines = [];

      if (!pendingFilename) {
        const inlineFile = line.match(/```\w+\s+\/\/\s*(?:filename:\s*)?(.+)/i);
        if (inlineFile) pendingFilename = cleanFilename(inlineFile[1]!);
      }

      if (!pendingFilename && i > 0) {
        const prevLine = lines[i - 1]!;
        const textRef = prevLine.match(/(?:working|complete|full)\s+([a-zA-Z0-9_.-]+\.\w{1,10})\s*(?:code|file)?/i);
        if (textRef) pendingFilename = cleanFilename(textRef[1]!);
      }

      if (!pendingFilename && i + 1 < lines.length) {
        const nextLine = lines[i + 1]!;
        const commentFile = nextLine.match(/^(?:\/\/|#|--)\s*(?:file:?\s*)?([a-zA-Z0-9_./-]+\.\w{1,10})\s*$/i);
        if (commentFile) {
          pendingFilename = cleanFilename(commentFile[1]!);
        }
      }
      continue;
    }

    const headingFile = line.match(
      /^#{1,4}\s+(?:📁\s*)?(?:File:\s*)?[`"']?([^\s`"'#][^`"'#]*\.\w{1,10})[`"']?\s*$/i,
    );
    if (headingFile) {
      pendingFilename = cleanFilename(headingFile[1]!);
      continue;
    }

    const boldFile = line.match(
      /^\*{0,2}📁?\s*(?:File:\s*)?[`"']?([^\s`"'*][^`"'*]*\.\w{1,10})[`"']?\*{0,2}\s*$/i,
    );
    if (boldFile) {
      pendingFilename = cleanFilename(boldFile[1]!);
      continue;
    }

    const markdownBoldFile = line.match(
      /^(?:#{1,4}\s+)?(?:\*{1,2})?📁?\s*(?:File:\s*)?[`"']?([a-zA-Z0-9_./-]+\.\w{1,10})[`"']?(?:\*{1,2})?\s*$/i,
    );
    if (markdownBoldFile && markdownBoldFile[1]!.includes(".")) {
      pendingFilename = cleanFilename(markdownBoldFile[1]!);
      continue;
    }
  }

  return files;
}

function cleanFilename(raw: string): string {
  return raw
    .replace(/^[`"']+|[`"']+$/g, "")
    .replace(/\.\.\//g, "")
    .replace(/^\//, "")
    .trim();
}

function taskDir(tenantId: number, taskId: number): string {
  return path.join(DELIVERABLES_ROOT, `tenant-${tenantId}`, `task-${taskId}`);
}

/**
 * Save extracted files to disk for a given task.
 * Returns list of saved file paths (relative to task dir).
 */
export function saveDeliverableFiles(
  tenantId: number,
  taskId: number,
  agentName: string,
  files: ExtractedFile[],
): string[] {
  if (files.length === 0) return [];

  const safeAgent = agentName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const dir = path.join(taskDir(tenantId, taskId), safeAgent);
  fs.mkdirSync(dir, { recursive: true });

  const saved: string[] = [];
  for (const f of files) {
    const filePath = path.join(dir, f.filename);
    const fileDir = path.dirname(filePath);
    if (fileDir !== dir) fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(filePath, f.content, "utf-8");
    saved.push(path.join(safeAgent, f.filename));
  }

  return saved;
}

/**
 * Process an agent's message content: extract code files and save them.
 * Returns the list of saved relative paths, or empty if no code blocks found.
 */
export function processAgentDeliverable(
  tenantId: number,
  taskId: number,
  agentName: string,
  content: string,
): string[] {
  const files = extractCodeFiles(content);
  if (files.length === 0) return [];
  return saveDeliverableFiles(tenantId, taskId, agentName, files);
}

/** Check if a task has any deliverable files on disk. */
export function hasDeliverables(tenantId: number, taskId: number): boolean {
  const dir = taskDir(tenantId, taskId);
  if (!fs.existsSync(dir)) return false;
  try {
    const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: false });
    return entries.length > 0;
  } catch {
    return false;
  }
}

/** List deliverable files for a task. */
export function listDeliverables(
  tenantId: number,
  taskId: number,
): { agent: string; files: string[] }[] {
  const dir = taskDir(tenantId, taskId);
  if (!fs.existsSync(dir)) return [];

  const result: { agent: string; files: string[] }[] = [];
  try {
    const agentDirs = fs.readdirSync(dir, { withFileTypes: true });
    for (const d of agentDirs) {
      if (!d.isDirectory()) continue;
      const agentDir = path.join(dir, d.name);
      const files = collectFiles(agentDir, "");
      if (files.length > 0) result.push({ agent: d.name, files });
    }
  } catch {
    /* empty */
  }
  return result;
}

function collectFiles(baseDir: string, prefix: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(path.join(baseDir, prefix), { withFileTypes: true });
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      results.push(...collectFiles(baseDir, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

/** Create a zip buffer of all deliverable files for a task. */
export async function createDeliverableZip(
  tenantId: number,
  taskId: number,
  taskTitle?: string,
): Promise<Buffer | null> {
  const dir = taskDir(tenantId, taskId);
  if (!fs.existsSync(dir)) return null;

  const items = listDeliverables(tenantId, taskId);
  if (items.length === 0) return null;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const writeable = new Writable({
      write(chunk, _encoding, cb) {
        chunks.push(chunk as Buffer);
        cb();
      },
    });

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", reject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });

    writeable.on("finish", () => resolve(Buffer.concat(chunks)));

    archive.pipe(writeable);

    for (const item of items) {
      const agentDir = path.join(dir, item.agent);
      for (const file of item.files) {
        archive.file(path.join(agentDir, file), { name: file });
      }
    }

    archive.finalize();
  });
}
