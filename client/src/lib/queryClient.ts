import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

type ApiErrorBody = { code?: string; message?: string; details?: unknown };

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      const code = body?.code || "http_error";
      const message = body?.message || res.statusText || "Request failed";
      const details = body?.details;
      const err = new Error(`${res.status} ${code}: ${message}`) as Error & {
        status?: number;
        code?: string;
        details?: unknown;
      };
      err.status = res.status;
      err.code = code;
      err.details = details;
      throw err;
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

/** Parse a successful API response; if the body is HTML (SPA fallback), explain restart instead of JSON.parse noise. */
export async function readJsonOrApiHint<T>(res: Response): Promise<T> {
  const raw = await res.text();
  const trimmed = raw.trimStart();
  if (!trimmed) {
    throw new Error("Empty response from API.");
  }
  if (trimmed.startsWith("<")) {
    const port =
      typeof window !== "undefined" && window.location.port ? window.location.port : "";
    const hint517 =
      port === "5173" || port === "5174"
        ? ` You are on port ${port} (typical Vite-only dev). Either open the URL printed by \`npm run dev\` (usually http://127.0.0.1:5050), or keep Vite on ${port} and run the API on 5050 so vite.config proxy can forward /api.`
        : "";
    throw new Error(
      `The server returned HTML instead of JSON for this API call.${hint517} Fix: from the repo root run \`npm run dev\` and use the port it logs (Express + Vite together).`,
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON from API: ${msg}`);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
