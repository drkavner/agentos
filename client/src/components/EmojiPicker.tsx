import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Roles",
    emojis: [
      "🤖", "🧠", "👨‍💻", "👩‍💻", "🧑‍💼", "👨‍💼", "👩‍💼", "🧑‍🔬",
      "👨‍🔬", "👩‍🎨", "🧑‍🏫", "🦸", "🥷", "🧙", "🧑‍🚀", "👷",
    ],
  },
  {
    label: "Tech",
    emojis: [
      "💻", "🖥️", "⚙️", "🔧", "🛠️", "⚡", "🔌", "📡",
      "🧬", "🔬", "🔭", "💡", "🔑", "🛡️", "🧩", "📦",
    ],
  },
  {
    label: "Work",
    emojis: [
      "📊", "📈", "📉", "📋", "📝", "✏️", "🎯", "🏆",
      "💰", "💎", "🔥", "⭐", "🚀", "🎨", "🎭", "📣",
    ],
  },
  {
    label: "Nature",
    emojis: [
      "🐙", "🦊", "🐺", "🦅", "🦉", "🐝", "🦋", "🐉",
      "🌟", "☀️", "🌊", "🌍", "🌸", "🍀", "🌵", "🎄",
    ],
  },
  {
    label: "Symbols",
    emojis: [
      "❤️", "💜", "💙", "💚", "🧡", "💛", "🤍", "🖤",
      "♟️", "🎲", "🎮", "🕹️", "📱", "💬", "🔔", "🏳️",
    ],
  },
];

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  className?: string;
}

export function EmojiPicker({ value, onChange, className }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center justify-center w-16 h-10 rounded-md border border-input bg-background text-2xl",
            "hover:border-primary/60 hover:bg-primary/5 transition-all cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          title="Pick emoji"
        >
          {value || "🤖"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" sideOffset={6}>
        {/* Category tabs */}
        <div className="flex border-b border-border px-1 pt-1 gap-0.5 overflow-x-auto">
          {EMOJI_GROUPS.map((g, i) => (
            <button
              key={g.label}
              type="button"
              onClick={() => setTab(i)}
              className={cn(
                "px-2.5 py-1.5 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap",
                i === tab
                  ? "bg-primary/10 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Emoji grid */}
        <div className="p-2 grid grid-cols-8 gap-0.5 max-h-48 overflow-y-auto">
          {EMOJI_GROUPS[tab]!.emojis.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onChange(e); setOpen(false); }}
              className={cn(
                "w-8 h-8 flex items-center justify-center rounded-md text-lg transition-all",
                "hover:bg-primary/10 hover:scale-110",
                value === e && "bg-primary/15 ring-1 ring-primary/40",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
