import type { Response } from "express";
import { ApiError } from "./apiError";

/** Resources the client maps to React Query keys for this tenant. */
export type TenantResource =
  | "agents"
  | "tasks"
  | "messages"
  | "goals"
  | "audit"
  | "teams"
  | "ceo_files"
  | "tenant";

export type TenantSseMessage =
  | { type: "connected"; tenantId: number }
  | { type: "invalidate"; tenantId: number; resources: TenantResource[] }
  | { type: "invalidate"; resources: ["tenants"] };

const byTenant = new Map<number, Set<Response>>();
const all = new Set<Response>();
const resTenant = new WeakMap<Response, number>();

function writeSse(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function dropConnection(res: Response) {
  const tid = resTenant.get(res);
  if (tid !== undefined) {
    const set = byTenant.get(tid);
    if (set) {
      set.delete(res);
      if (set.size === 0) byTenant.delete(tid);
    }
    resTenant.delete(res);
  }
  all.delete(res);
}

export function subscribeTenantSse(tenantId: number, res: Response) {
  let set = byTenant.get(tenantId);
  if (!set) {
    set = new Set();
    byTenant.set(tenantId, set);
  }
  set.add(res);
  all.add(res);
  resTenant.set(res, tenantId);
}

export function unsubscribeTenantSse(tenantId: number, res: Response) {
  const set = byTenant.get(tenantId);
  if (set) {
    set.delete(res);
    if (set.size === 0) byTenant.delete(tenantId);
  }
  resTenant.delete(res);
  all.delete(res);
}

export function publishTenantInvalidate(tenantId: number, resources: TenantResource[]) {
  if (resources.length === 0) return;
  const uniq = Array.from(new Set(resources));
  const payload: TenantSseMessage = { type: "invalidate", tenantId, resources: uniq };
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  const set = byTenant.get(tenantId);
  if (!set || set.size === 0) return;
  for (const res of Array.from(set)) {
    try {
      res.write(line);
    } catch {
      dropConnection(res);
    }
  }
}

/** Notify every connected browser (e.g. tenant list changed). */
export function publishTenantsListChanged() {
  const payload: TenantSseMessage = { type: "invalidate", resources: ["tenants"] };
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of Array.from(all)) {
    try {
      res.write(line);
    } catch {
      dropConnection(res);
    }
  }
}

export function setupTenantSseRoute(
  app: import("express").Express,
  getTenant: (id: number) => { id: number } | undefined,
) {
  app.get("/api/tenants/:tenantId/events", (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || !getTenant(tenantId)) {
      throw new ApiError(404, "not_found", "Tenant not found");
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    const flush = (res as unknown as { flushHeaders?: () => void }).flushHeaders;
    if (typeof flush === "function") flush.call(res);

    writeSse(res, { type: "connected", tenantId } satisfies TenantSseMessage);
    subscribeTenantSse(tenantId, res);

    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(ping);
      }
    }, 25000);

    req.on("close", () => {
      clearInterval(ping);
      unsubscribeTenantSse(tenantId, res);
    });
  });
}
