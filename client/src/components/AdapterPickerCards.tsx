import { cn } from "@/lib/utils";
import type { TenantAdapterType } from "@shared/schema";

/** Caduceus-style mark for Hermes (multi-provider local agent). */
function HermesLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path
        d="M12 3v18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M12 6.5c-2.8 0-4.5 1.6-4.5 3.5 0 1.2.7 2.2 1.8 2.9M12 6.5c2.8 0 4.5 1.6 4.5 3.5 0 1.2-.7 2.2-1.8 2.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7.5 17.5c1.2-1.8 2.5-2.8 4.5-2.8s3.3 1 4.5 2.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="9" cy="5" r="1.35" fill="currentColor" />
      <circle cx="15" cy="5" r="1.35" fill="currentColor" />
    </svg>
  );
}

/** Robot / gateway terminal mark for OpenClaw. */
function OpenClawLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect
        x="4.5"
        y="6"
        width="15"
        height="12"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 10h8M8 13.5h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="9.5" cy="17" r="1" fill="currentColor" />
      <circle cx="14.5" cy="17" r="1" fill="currentColor" />
      <path
        d="M10 4.5h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const OPTIONS: {
  value: TenantAdapterType;
  title: string;
  subtitle: string;
  Logo: typeof HermesLogo;
}[] = [
  {
    value: "hermes",
    title: "Hermes Agent",
    subtitle: "Local multi-provider agent",
    Logo: HermesLogo,
  },
  {
    value: "openclaw",
    title: "OpenClaw Gateway",
    subtitle: "Configure OpenClaw within the App",
    Logo: OpenClawLogo,
  },
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
      <div className="grid grid-cols-2 gap-3" data-testid={testId}>
        {OPTIONS.map(({ value: v, title, subtitle, Logo }) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={cn(
                "flex flex-col items-center rounded-xl border-2 px-3 py-4 text-center transition-all outline-none",
                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected
                  ? "border-primary bg-muted/90 text-foreground shadow-sm ring-1 ring-primary/15"
                  : "border-border/90 bg-background/50 text-muted-foreground hover:border-muted-foreground/35 hover:bg-muted/20",
              )}
              data-testid={`adapter-card-${v}`}
              aria-pressed={selected}
            >
              <Logo
                className={cn(
                  "mb-3 h-9 w-9",
                  selected ? "text-foreground" : "text-muted-foreground",
                )}
              />
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
