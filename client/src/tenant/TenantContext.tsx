import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTenantEventStream } from "@/hooks/useTenantEventStream";
import type { Tenant } from "@shared/schema";

type TenantContextValue = {
  tenants: Tenant[];
  activeTenantId: number | null;
  setActiveTenantId: (id: number) => void;
  activeTenant: Tenant | null;
  isLoadingTenants: boolean;
};

const TenantContext = createContext<TenantContextValue | null>(null);

const STORAGE_KEY = "agentos.activeTenantId";

function readStoredTenantId(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStoredTenantId(id: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // ignore
  }
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { data: tenants = [], isLoading: isLoadingTenants } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    queryFn: () => apiRequest("GET", "/api/tenants").then((r) => r.json()),
  });

  const [activeTenantId, _setActiveTenantId] = useState<number | null>(() => {
    return readStoredTenantId();
  });

  const activeTenant = useMemo(() => {
    if (!activeTenantId) return null;
    return tenants.find((t) => t.id === activeTenantId) ?? null;
  }, [tenants, activeTenantId]);

  useTenantEventStream(activeTenantId);

  // Ensure we always have a valid active tenant when tenant list changes.
  useEffect(() => {
    if (tenants.length === 0) return;
    if (activeTenantId && tenants.some((t) => t.id === activeTenantId)) return;
    const next = tenants[0]!.id;
    _setActiveTenantId(next);
    writeStoredTenantId(next);
  }, [tenants, activeTenantId]);

  const setActiveTenantId = (id: number) => {
    _setActiveTenantId(id);
    writeStoredTenantId(id);
  };

  const value: TenantContextValue = {
    tenants,
    activeTenantId,
    setActiveTenantId,
    activeTenant,
    isLoadingTenants,
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenantContext() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenantContext must be used within TenantProvider");
  return ctx;
}

