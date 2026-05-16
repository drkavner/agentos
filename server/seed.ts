import { db } from "./db";
import { storage } from "./storage";
import { eq } from "drizzle-orm";
import { tenants } from "@shared/schema";
import { ensureAgentDefinitionsCatalog } from "./agentDefinitionsCatalog";

export function removeDemoTenantIfPresent() {
  const demo = db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, "cerebratech")).get() as any;
  if (!demo?.id) return false;
  storage.deleteTenant(Number(demo.id));
  return true;
}

// Demo build: pre-built role templates are not shipped, so the legacy
// SEED=true demo org (which assigned agents to specific templates by name)
// cannot be reconstructed. Keep the entry point so SEED=true does not crash;
// just ensure the minimal catalog exists.
export function seedDatabase() {
  ensureAgentDefinitionsCatalog();
  console.log("[seed] Demo seeding is disabled in this build (templates removed).");
}
