import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Bot, Users, Network, CheckSquare,
  MessageSquare, Settings, Building2, ScrollText,
  ChevronDown, ChevronRight, Zap, Moon, Sun, Menu, X,
  Bell, Search, Crown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenantContext } from "@/tenant/TenantContext";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV = [
  {
    label: "Overview",
    items: [
      { href: "/", icon: LayoutDashboard, label: "Dashboard" },
    ],
  },
  
  {
    label: "Agents",
    items: [
      { href: "/agents/my-agents", icon: Bot, label: "My Agents" },
      { href: "/agents/library", icon: Zap, label: "Agent Library" },
      { href: "/org", icon: Network, label: "Org Chart" },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/tasks", icon: CheckSquare, label: "Tasks" },
      { href: "/collab", icon: MessageSquare, label: "Collaboration" },
      { href: "/audit", icon: ScrollText, label: "Audit Log" },
      { href: "/ceo/dashboard", icon: Crown, label: "CEO" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/tenants", icon: Building2, label: "Organizations" },
      { href: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

interface AppShellProps { children: React.ReactNode; }

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation();
  const [dark, setDark] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const { tenants, activeTenantId, setActiveTenantId, activeTenant } = useTenantContext();

  useEffect(() => {
    document.documentElement.classList.toggle("light", !dark);
  }, [dark]);

  const sidebar = (
    <aside className={cn(
      "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-200",
      sidebarOpen ? "w-60" : "w-16"
    )}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-sidebar-border min-h-[60px]">
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-primary" fill="none" stroke="currentColor" strokeWidth="1.5" aria-label="AgentOS Logo">
            <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.8"/>
            <path d="M12 2 L12 5 M12 19 L12 22 M2 12 L5 12 M19 12 L22 12"/>
            <path d="M5.6 5.6 L7.8 7.8 M16.2 16.2 L18.4 18.4 M18.4 5.6 L16.2 7.8 M7.8 16.2 L5.6 18.4"/>
          </svg>
        </div>
        {sidebarOpen && (
          <div>
            <div className="text-sm font-semibold text-sidebar-foreground tracking-wide">Cortex</div>
            <div className="text-xs text-muted-foreground">Multi-Agent Platform</div>
          </div>
        )}
        <button onClick={() => setSidebarOpen(v => !v)} className="ml-auto text-muted-foreground hover:text-foreground p-1 rounded hidden md:flex" data-testid="sidebar-toggle">
          {sidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 rotate-90" />}
        </button>
      </div>

      {/* Tenant Switcher */}
      {sidebarOpen && (
        <div className="px-3 py-2 border-b border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-sidebar-accent text-left" data-testid="tenant-switcher">
                <div className="w-6 h-6 rounded-md bg-primary/30 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                  {activeTenant?.name?.[0] ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-sidebar-foreground truncate">{activeTenant?.name ?? "Loading..."}</div>
                  <div className="text-xs text-muted-foreground capitalize">{activeTenant?.plan ?? ""} plan</div>
                </div>
                <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52" side="right">
              <DropdownMenuLabel>Switch Organization</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {tenants?.map(t => (
                <DropdownMenuItem key={t.id} onClick={() => setActiveTenantId(t.id)}>
                  <span className="mr-2">{t.name}</span>
                  <Badge variant="outline" className="ml-auto text-xs">{t.plan}</Badge>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {NAV.map(group => (
          <div key={group.label}>
            {sidebarOpen && (
              <div className="px-2 mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                {group.label}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon;
                const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileSidebarOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-2 py-2 rounded-md text-sm transition-all",
                        sidebarOpen ? "" : "justify-center",
                        active
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Icon className={cn("flex-shrink-0", sidebarOpen ? "w-4 h-4" : "w-5 h-5")} />
                      {sidebarOpen && <span>{item.label}</span>}
                      {active && sidebarOpen && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Budget indicator */}
      {sidebarOpen && activeTenant && (
        <div className="px-3 py-3 border-t border-sidebar-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Monthly Budget</span>
            <span className="text-xs font-medium text-foreground">
              ${activeTenant.spentThisMonth.toFixed(0)} / ${activeTenant.monthlyBudget.toFixed(0)}
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", 
                (activeTenant.spentThisMonth / activeTenant.monthlyBudget) > 0.8 ? "bg-destructive" : "bg-primary"
              )}
              style={{ width: `${Math.min(100, (activeTenant.spentThisMonth / activeTenant.monthlyBudget) * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {(100 - (activeTenant.spentThisMonth / activeTenant.monthlyBudget) * 100).toFixed(0)}% remaining
          </div>
        </div>
      )}
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col flex-shrink-0">{sidebar}</div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-60">{sidebar}</div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-[60px] border-b border-border flex items-center gap-4 px-4 flex-shrink-0 bg-card/50 backdrop-blur-sm">
          <button onClick={() => setMobileSidebarOpen(true)} className="md:hidden text-muted-foreground hover:text-foreground" data-testid="mobile-menu">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              placeholder="Search agents, tasks, messages..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              data-testid="global-search"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="relative text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent/10" data-testid="notifications">
              <Bell className="w-4 h-4" />
              <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-primary" />
            </button>
            <button onClick={() => setDark(v => !v)} className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-accent/10" data-testid="theme-toggle">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Avatar className="w-8 h-8 cursor-pointer">
              <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">DK</AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto" data-active-tenant={activeTenantId ?? ""}>
          {children}
        </main>
      </div>
    </div>
  );
}
