import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Agent, AgentDefinition } from "@shared/schema"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Card / tree avatar: per-agent override, else library definition emoji. */
export function deployedAgentEmoji(
  agent: Pick<Agent, "emoji">,
  def: Pick<AgentDefinition, "emoji"> | null | undefined,
): string {
  const o = String(agent.emoji ?? "").trim();
  if (o) return o;
  const d = String(def?.emoji ?? "").trim();
  return d || "🤖";
}

export function formatDistanceToNow(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Badge / counts: server sets `displayStatus` when latest finished run failed but row was forced `running`. */
export function agentCardStatus(agent: { status: string; displayStatus?: string }) {
  return agent.displayStatus ?? agent.status;
}
