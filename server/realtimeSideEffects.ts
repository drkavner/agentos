import { storage } from "./storage";
import { publishTenantInvalidate, publishTenantsListChanged, type TenantResource } from "./tenantEvents";
import type { InsertAuditLog } from "@shared/schema";

export type { TenantResource };

/** Merge audit into invalidations and append a row to `audit_log`. */
export function auditAndInvalidate(
  tenantId: number,
  resources: TenantResource[],
  row: Omit<InsertAuditLog, "tenantId" | "createdAt">,
) {
  storage.createAuditLog({
    tenantId,
    agentId: row.agentId ?? null,
    agentName: row.agentName ?? null,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId ?? null,
    detail: row.detail ?? null,
    tokensUsed: row.tokensUsed ?? 0,
    cost: row.cost ?? 0,
  });
  publishTenantInvalidate(tenantId, Array.from(new Set<TenantResource>([...resources, "audit"])));
}

export function invalidateTenant(tenantId: number, resources: TenantResource[]) {
  if (resources.length === 0) return;
  publishTenantInvalidate(tenantId, Array.from(new Set(resources)));
}

export function invalidateTenantsList() {
  publishTenantsListChanged();
}
