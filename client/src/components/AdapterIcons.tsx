import { cn } from "@/lib/utils";
import type { TenantAdapterType } from "@shared/schema";

type IconProps = { className?: string };

function Hermes({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("w-6 h-6", className)}>
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 7v10M8 9.5l4 2.5 4-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function Claude({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("w-6 h-6", className)}>
      <path d="M12 3C7.029 3 3 7.029 3 12s4.029 9 9 9 9-4.029 9-9-4.029-9-9-9z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.5 9.5C9.5 9.5 10.5 8 12 8s2.5 1.5 2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="12.5" r="1" fill="currentColor" />
      <circle cx="15" cy="12.5" r="1" fill="currentColor" />
      <path d="M9.5 15.5s1 1.5 2.5 1.5 2.5-1.5 2.5-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Codex({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("w-6 h-6", className)}>
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" fill="currentColor" opacity="0.4" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function Gemini({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("w-6 h-6", className)}>
      <path d="M12 2C12 2 17 7 17 12s-5 10-5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 2C12 2 7 7 7 12s5 10 5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function OpenCode({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("w-6 h-6", className)}>
      <path d="M8 9l-4 3 4 3M16 9l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 5l-4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CursorIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("w-6 h-6", className)}>
      <path d="M5 3l14 9-6 1.5L10 20l-1-6.5L5 3z" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 13.5l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function OpenClaw({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("w-6 h-6", className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <path d="M8 8l2 4-2 4M16 8l-2 4 2 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ADAPTER_ICON_MAP: Record<TenantAdapterType, (props: IconProps) => JSX.Element> = {
  hermes: Hermes,
  "claude-code": Claude,
  codex: Codex,
  "gemini-cli": Gemini,
  opencode: OpenCode,
  cursor: CursorIcon,
  openclaw: OpenClaw,
};

export function AdapterIcon({ adapter, className }: { adapter: TenantAdapterType; className?: string }) {
  const Icon = ADAPTER_ICON_MAP[adapter];
  if (!Icon) return null;
  return <Icon className={className} />;
}

export { ADAPTER_ICON_MAP };
