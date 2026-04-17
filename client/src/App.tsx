import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AppShell } from "./components/AppShell";
import { TenantProvider } from "./tenant/TenantContext";
import Dashboard from "./pages/Dashboard";
import AgentLibrary from "./pages/AgentLibrary";
import MyAgents from "./pages/MyAgents";
import OrgChart from "./pages/OrgChart";
import Tasks from "./pages/Tasks";
import Collab from "./pages/Collab";
import Teams from "./pages/Teams";
import Settings from "./pages/Settings";
import Tenants from "./pages/Tenants";
import AuditLog from "./pages/AuditLog";
import NotFound from "./pages/not-found";
import CeoDashboard from "./pages/ceo/CeoDashboard";
import CeoInstruction from "./pages/ceo/CeoInstruction";
import CeoSkills from "./pages/ceo/CeoSkills";
import CeoConfiguration from "./pages/ceo/CeoConfiguration";
import CeoRuns from "./pages/ceo/CeoRuns";
import CeoBudgets from "./pages/ceo/CeoBudgets";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <TenantProvider>
          <AppShell>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/agents/library" component={AgentLibrary} />
              <Route path="/agents/my-agents" component={MyAgents} />
              <Route path="/org" component={OrgChart} />
              <Route path="/tasks" component={Tasks} />
              <Route path="/collab" component={Collab} />
              <Route path="/teams" component={Teams} />
              <Route path="/audit" component={AuditLog} />
              <Route path="/tenants" component={Tenants} />
              <Route path="/settings" component={Settings} />
              <Route path="/ceo/dashboard" component={CeoDashboard} />
              <Route path="/ceo/instruction" component={CeoInstruction} />
              <Route path="/ceo/skills" component={CeoSkills} />
              <Route path="/ceo/configuration" component={CeoConfiguration} />
              <Route path="/ceo/runs" component={CeoRuns} />
              <Route path="/ceo/budgets" component={CeoBudgets} />
              <Route component={NotFound} />
            </Switch>
          </AppShell>
        </TenantProvider>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
