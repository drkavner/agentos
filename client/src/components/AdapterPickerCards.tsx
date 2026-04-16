import { cn } from "@/lib/utils";
import type { TenantAdapterType } from "@shared/schema";
import { AdapterIcon } from "./AdapterIcons";

const OPTIONS: {
  value: TenantAdapterType;
  title: string;
  subtitle: string;
  recommended?: boolean;
}[] = [
  { value: "hermes", title: "Hermes Agent", subtitle: "Local multi-provider agent" },
  { value: "claude-code", title: "Claude Code", subtitle: "Local Claude agent" },
  { value: "codex", title: "Codex", subtitle: "Local Codex agent" },
  { value: "gemini-cli", title: "Gemini CLI", subtitle: "Local Gemini agent" },
  { value: "opencode", title: "OpenCode", subtitle: "Local multi-provider agent" },
  { value: "cursor", title: "Cursor", subtitle: "Local Cursor agent" },
  { value: "openclaw", title: "OpenClaw Gateway", subtitle: "Invoke OpenClaw via gateway protocol" },
];

type AdapterPickerCardsProps = {
  value: TenantAdapterType;
  onChange: (value: TenantAdapterType) => void;
  /** Shown under the cards */
  helperText?: string;
  className?: string;
  "data-testid"?: string;
};

export function AdapterPickerCards({
  value,
  onChange,
  helperText,
  className,
  "data-testid": testId,
}: AdapterPickerCardsProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid={testId}>
        {OPTIONS.map(({ value: v, title, subtitle, recommended }) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={cn(
                "relative flex flex-col items-center rounded-xl border-2 px-3 py-4 text-center transition-all outline-none",
                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected
                  ? "border-primary bg-muted/90 text-foreground shadow-sm ring-1 ring-primary/15"
                  : "border-border/90 bg-background/50 text-muted-foreground hover:border-muted-foreground/35 hover:bg-muted/20",
              )}
              data-testid={`adapter-card-${v}`}
              aria-pressed={selected}
            >
              {recommended && (
                <span className="absolute -top-2 right-2 bg-green-500 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none">
                  Recommended
                </span>
              )}
              <span className={cn("mb-3 h-9 w-9 shrink-0 flex items-center justify-center", selected ? "text-foreground" : "text-muted-foreground")}>
                <AdapterIcon adapter={v} className="w-6 h-6" />
              </span>
              <span
                className={cn(
                  "text-sm font-semibold leading-tight",
                  selected ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {title}
              </span>
              <span
                className={cn(
                  "mt-1.5 text-[11px] leading-snug px-0.5",
                  selected ? "text-muted-foreground" : "text-muted-foreground/80",
                )}
              >
                {subtitle}
              </span>
            </button>
          );
        })}
      </div>
      {helperText ? (
        <p className="text-xs text-muted-foreground pt-0.5">{helperText}</p>
      ) : null}
    </div>
  );
}
