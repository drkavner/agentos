import type { AgentDefinition } from "@shared/schema";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles } from "lucide-react";

interface HireAgentWizardProps {
  open: boolean;
  onClose: () => void;
  // Kept for API compatibility with callers; ignored in the demo build.
  preselectedDef?: AgentDefinition | null;
}

// Demo build: the multi-step hire flow is gated behind the full version. We
// keep the same component name/props so existing pages can mount it as before.
export function HireAgentWizard({ open, onClose }: HireAgentWizardProps) {
  const [, setLocation] = useLocation();
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="hire-upsell-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Hire an Agent
          </DialogTitle>
          <DialogDescription className="pt-2 leading-relaxed">
            The agent template library and one-click hiring are part of the full
            version of AgentOS. Upgrade to unlock 40+ ready-made roles across
            Engineering, Design, Marketing, Sales, Product, Finance, and Support.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-start gap-3">
          <Lock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            You're using the demo build. New agents can't be hired from
            templates here — explore the rest of the workspace to see how tasks,
            goals, collaboration, and the CEO control plane work.
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} data-testid="hire-upsell-close">
            Close
          </Button>
          <Button
            onClick={() => { onClose(); setLocation("/pricing"); }}
            data-testid="hire-upsell-upgrade"
          >
            Get the full version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
