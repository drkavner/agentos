import { db } from "./db";
import { agentDefinitions } from "@shared/schema";

// Demo build: pre-built role templates are not shipped. A single internal
// "Agents Orchestrator" definition remains so CEO bootstrap has a row to
// reference (every agent row requires a non-null definitionId). The public
// /api/agent-definitions endpoint filters source="internal" out.
const AGENT_DEFINITION_CATALOG = [
  {
    name: "Agents Orchestrator",
    emoji: "🎭",
    division: "Specialized",
    specialty: "Multi-agent coordination, workflow management",
    description: "Coordinates complex projects requiring multiple agents",
    whenToUse: "Complex projects requiring multiple agent coordination",
    source: "internal",
    color: "#f97316",
  },
] as const;

/** Inserts the Agent Library catalog if the table is empty (required for hiring + CEO bootstrap). */
export function ensureAgentDefinitionsCatalog() {
  const existing = db.select().from(agentDefinitions).limit(1).all();
  if (existing.length > 0) return;
  console.log("[catalog] Installing agent definition library…");
  for (const def of AGENT_DEFINITION_CATALOG) {
    db.insert(agentDefinitions).values(def as any).run();
  }
}
