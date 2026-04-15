import { useEffect } from "react";
import { queryClient } from "@/lib/queryClient";

function invalidateTenantQueries(tenantId: number, resources: string[]) {
  for (const r of resources) {
    switch (r) {
      case "agents":
        queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId, "agents"] });
        break;
      case "tasks":
        queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId, "tasks"] });
        break;
      case "goals":
        queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId, "goals"] });
        break;
      case "teams":
        queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId, "teams"] });
        break;
      case "audit":
        queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId, "audit"] });
        break;
      case "messages":
        queryClient.invalidateQueries({
          predicate: (q) =>
            q.queryKey[0] === "/api/tenants" &&
            q.queryKey[1] === tenantId &&
            q.queryKey[2] === "messages",
        });
        break;
      case "tenant":
        queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId] });
        break;
      case "ceo_files":
        queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId, "ceo-files"] });
        break;
      default:
        break;
    }
  }
}

/**
 * Subscribes to server-sent events for the active tenant so React Query data stays fresh without polling.
 */
export function useTenantEventStream(tenantId: number | null) {
  useEffect(() => {
    if (!tenantId || tenantId <= 0) return;

    const url = `/api/tenants/${tenantId}/events`;
    const es = new EventSource(url);

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: "connected"; tenantId: number }
          | { type: "invalidate"; tenantId: number; resources: string[] }
          | { type: "invalidate"; resources: ["tenants"] };

        if (msg.type === "invalidate" && "resources" in msg && msg.resources[0] === "tenants") {
          queryClient.invalidateQueries({ queryKey: ["/api/tenants"], exact: true });
          return;
        }
        if (msg.type === "invalidate" && "tenantId" in msg && Array.isArray(msg.resources)) {
          invalidateTenantQueries(msg.tenantId, msg.resources);
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      es.close();
    };
  }, [tenantId]);
}
