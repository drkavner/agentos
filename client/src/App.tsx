import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AppShell } from "./components/AppShell";
import Dashboard from "./pages/Dashboard";
import AgentLibrary from "./pages/AgentLibrary";
import MyAgents from "./pages/MyAgents";
import OrgChart from "./pages/OrgChart";
import Tasks from "./pages/Tasks";
import Collab from "./pages/Collab";
import Settings from "./pages/Settings";
import Tenants from "./pages/Tenants";
import AuditLog from "./pages/AuditLog";
import NotFound from "./pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AppShell>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/agents/library" component={AgentLibrary} />
            <Route path="/agents/my-agents" component={MyAgents} />
            <Route path="/org" component={OrgChart} />
            <Route path="/tasks" component={Tasks} />
            <Route path="/collab" component={Collab} />
            <Route path="/audit" component={AuditLog} />
            <Route path="/tenants" component={Tenants} />
            <Route path="/settings" component={Settings} />
            <Route component={NotFound} />
          </Switch>
        </AppShell>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
