import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Check } from "lucide-react";

const FULL_VERSION_FEATURES = [
  "40+ pre-built agent role templates across 8 divisions",
  "One-click hiring with model, budget, and team assignment",
  "Editable skills.md per organization",
  "Full demo seed (sample org, agents, tasks, goals)",
  "Priority support",
];

export default function Pricing() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Upgrade to the full version
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          You're running the AgentOS demo build. The full version ships with the
          complete agent template library and hiring flow.
        </p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <h2 className="text-lg font-semibold text-foreground">What you get</h2>
        </CardHeader>
        <CardContent className="space-y-2">
          {FULL_VERSION_FEATURES.map((f) => (
            <div key={f} className="flex items-start gap-2 text-sm text-foreground">
              <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <span>{f}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Ready to upgrade?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Reach out and we'll get you set up with the full version.
            </p>
          </div>
          <Button asChild data-testid="pricing-contact-btn">
            <a href="mailto:sales@agentos.example?subject=AgentOS%20full%20version">
              Contact sales
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
