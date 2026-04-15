/**
 * LLM calls via OpenRouter (OpenAI-compatible) or local Ollama.
 * Server env:
 *   OPENROUTER_API_KEY — required for OpenRouter routing
 *   OLLAMA_BASE_URL — optional, default http://127.0.0.1:11434
 *
 * Ollama HTTP API lives under `/api` on the daemon host (see https://docs.ollama.com/api/introduction ).
 * We store the host root only (e.g. `http://localhost:11434`) and append `/api/tags`, `/api/chat`, etc.
 * If someone pastes the doc-style base `http://localhost:11434/api`, we strip the trailing `/api` so paths are not doubled.
 */

export type LlmRouting = "openrouter" | "ollama";

export function normalizeLlmRouting(value: unknown): LlmRouting {
  return value === "ollama" ? "ollama" : "openrouter";
}

export function getOpenRouterApiKey(): string | null {
  return (process.env.OPENROUTER_API_KEY ?? "").trim() || null;
}

export function getOllamaBaseUrl(): string {
  const raw = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").trim();
  return raw.replace(/\/+$/, "");
}

function normalizeOllamaBase(raw: string): string {
  let s = raw.trim().replace(/\/+$/, "");
  // Doc-style base URL ends with `/api`; we already add `/api/...` when calling Ollama.
  if (/\/api$/i.test(s)) {
    s = s.replace(/\/api$/i, "").replace(/\/+$/, "");
  }
  return s;
}

/** Prefer per-tenant URL from DB; otherwise server env default. */
export function resolveOllamaBaseUrl(tenantOllamaBaseUrl?: string | null): string {
  const t = (tenantOllamaBaseUrl ?? "").trim();
  if (t) return normalizeOllamaBase(t);
  return getOllamaBaseUrl();
}

/**
 * Validates an optional URL from query params (Settings “probe” before save).
 * Returns normalized base or null if unsafe/invalid.
 */
export function sanitizeOllamaProbeUrl(input: string | undefined | null): string | null {
  const u = (input ?? "").trim();
  if (!u || u.length > 512) return null;
  if (!/^https?:\/\//i.test(u)) return null;
  if (/[\s<>]/.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  return normalizeOllamaBase(u);
}

/** Lists model names from a running Ollama instance (`GET /api/tags`). */
export async function listOllamaModels(
  baseUrl: string,
): Promise<{ ok: true; models: string[]; baseUsed: string } | { ok: false; error: string }> {
  const baseUsed = normalizeOllamaBase(baseUrl);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(`${baseUsed}/api/tags`, { method: "GET", signal: ac.signal });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: raw.slice(0, 800) || res.statusText };
    }
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Ollama /api/tags response was not JSON" };
    }
    const arr = Array.isArray(json?.models) ? json.models : [];
    const names: string[] = arr
      .map((m: any) => String(m?.name ?? m?.model ?? "").trim())
      .filter((x: string): x is string => x.length > 0);
    const seen = new Map<string, true>();
    const unique: string[] = [];
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.set(n, true);
      unique.push(n);
    }
    unique.sort((a, b) => a.localeCompare(b));
    return { ok: true, models: unique, baseUsed };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Timed out reaching Ollama (8s)" : String(e?.message ?? e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** For Settings / test-environment: what’s configured on the server. */
export function getLlmServerStatus(routing: LlmRouting, modelId: string, tenantOllamaBaseUrl?: string | null) {
  return {
    routing,
    model: modelId,
    openRouterKeyConfigured: !!getOpenRouterApiKey(),
    ollamaBaseUrl: resolveOllamaBaseUrl(tenantOllamaBaseUrl),
  };
}

function estimateOpenRouterUsd(model: string, promptTokens: number, completionTokens: number): number {
  const m = model.toLowerCase();
  let inPerM = 3;
  let outPerM = 12;
  if (m.includes("gpt-4o") && !m.includes("mini")) {
    inPerM = 2.5;
    outPerM = 10;
  } else if (m.includes("mini")) {
    inPerM = 0.15;
    outPerM = 0.6;
  } else if (m.includes("claude") && m.includes("opus")) {
    inPerM = 15;
    outPerM = 75;
  } else if (m.includes("claude")) {
    inPerM = 3;
    outPerM = 15;
  } else if (m.includes("gemini")) {
    inPerM = 0.5;
    outPerM = 2;
  }
  return (promptTokens / 1e6) * inPerM + (completionTokens / 1e6) * outPerM;
}

export type LlmOk = {
  ok: true;
  text: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  routing: LlmRouting;
  modelUsed: string;
};

export type LlmErr = { ok: false; error: string; status?: number };

export async function completeLlmChat(opts: {
  routing: LlmRouting;
  model: string;
  system: string;
  user: string;
  timeoutMs: number;
  /** Resolved Ollama base URL (per-tenant or env); only used when routing is ollama. */
  ollamaBaseUrl?: string;
}): Promise<LlmOk | LlmErr> {
  const timeoutMs = Math.max(5000, opts.timeoutMs);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    if (opts.routing === "openrouter") {
      const key = getOpenRouterApiKey();
      if (!key) {
        return { ok: false, error: "Missing OPENROUTER_API_KEY for OpenRouter routing" };
      }
      const modelUsed = opts.model.trim();
      if (!modelUsed) {
        return { ok: false, error: "Model id is empty" };
      }
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelUsed,
          temperature: 0.7,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
        }),
        signal: ac.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        return { ok: false, error: raw.slice(0, 2000) || res.statusText, status: res.status };
      }
      let json: any;
      try {
        json = JSON.parse(raw);
      } catch {
        return { ok: false, error: "OpenRouter response was not JSON" };
      }
      const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
      if (!text) {
        return { ok: false, error: "OpenRouter returned empty content" };
      }
      const usage = json?.usage ?? {};
      const promptTokens = Number(usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0;
      const completionTokens = Number(usage.completion_tokens ?? usage.completionTokens ?? 0) || 0;
      const estimatedCostUsd = estimateOpenRouterUsd(modelUsed, promptTokens, completionTokens);
      return {
        ok: true,
        text,
        promptTokens,
        completionTokens,
        estimatedCostUsd,
        routing: "openrouter",
        modelUsed,
      };
    }

    // Ollama — local, $0 estimated
    const base = normalizeOllamaBase(opts.ollamaBaseUrl ?? getOllamaBaseUrl());
    const modelUsed = opts.model.trim();
    if (!modelUsed) {
      return { ok: false, error: "Model id is empty" };
    }
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelUsed,
        stream: false,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: ac.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: raw.slice(0, 2000) || res.statusText, status: res.status };
    }
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Ollama response was not JSON" };
    }
    const text = String(json?.message?.content ?? "").trim();
    if (!text) {
      return { ok: false, error: "Ollama returned empty content" };
    }
    const promptTokens = Number(json?.prompt_eval_count ?? 0) || 0;
    const completionTokens = Number(json?.eval_count ?? 0) || 0;
    return {
      ok: true,
      text,
      promptTokens,
      completionTokens,
      estimatedCostUsd: 0,
      routing: "ollama",
      modelUsed,
    };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? `LLM request timed out after ${timeoutMs}ms` : String(e?.message ?? e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}
