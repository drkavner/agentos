import { storage } from "./storage";
import { ApiError } from "./apiError";

/**
 * Normalize JSON from "Import agent" (flat hire body, or bundle like GET /agents/:id/docs + nested agent/runtime).
 */
export function normalizeAgentImportPayload(raw: unknown): Record<string, unknown> {
  if (raw == null || typeof raw !== "object") {
    throw new ApiError(400, "validation_error", "Import payload must be a JSON object");
  }
  const r = raw as Record<string, unknown>;
  const wrapped = (r as any).import != null ? (r as any).import : raw;
  if (wrapped == null || typeof wrapped !== "object") {
    throw new ApiError(400, "validation_error", "Import payload must be a JSON object");
  }
  const w = wrapped as any;
  let base: Record<string, unknown>;
  if (w.agent && typeof w.agent === "object") {
    base = { ...(w.agent as Record<string, unknown>) };
    if (w.definition && typeof w.definition === "object") {
      const d = w.definition as Record<string, unknown>;
      if (base.definitionId == null && d.id != null) base.definitionId = d.id;
      if (base.definitionName == null && d.name != null) base.definitionName = d.name;
    }
    if (w.runtime && typeof w.runtime === "object") {
      Object.assign(base, w.runtime as Record<string, unknown>);
    }
  } else {
    base = { ...(wrapped as Record<string, unknown>) };
  }
  delete base.id;
  delete (base as any).tenantId;
  delete (base as any).tasksCompleted;
  delete (base as any).spentThisMonth;
  delete (base as any).lastHeartbeat;
  delete (base as any).tenant;
  delete (base as any).definition;
  return base;
}

export function resolveDefinitionIdForImport(body: Record<string, unknown>): number {
  const id = Number(body.definitionId);
  if (Number.isFinite(id) && id > 0) {
    const def = storage.getAgentDefinition(id);
    if (def) return id;
  }
  const name = String(body.definitionName ?? "").trim().toLowerCase();
  if (!name) {
    throw new ApiError(400, "validation_error", "Provide definitionId or definitionName to import an agent");
  }
  const defs = storage.getAgentDefinitions();
  const hit = defs.find((d) => String(d.name).trim().toLowerCase() === name);
  if (!hit) {
    throw new ApiError(400, "validation_error", `Unknown definitionName "${String(body.definitionName)}"`);
  }
  return hit.id;
}
