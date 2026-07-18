import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FolderKanban, Lightbulb, Moon, Settings, Sun, Zap, type LucideIcon } from "lucide-react";
import { useConfig } from "../config";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { RunningRun } from "../types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface NavItem { to: string; label: string; icon: LucideIcon; match?: string }

export function Layout() {
  const { controlMode } = useConfig();
  const { pathname } = useLocation();
  const { data: running } = usePoll<RunningRun[]>(api.running, 2000, []);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("agent-swarm-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("agent-swarm-sidebar") === "collapsed";
  });
  const activeRuns = running?.length ?? 0;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("agent-swarm-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("agent-swarm-sidebar", sidebarCollapsed ? "collapsed" : "expanded");
  }, [sidebarCollapsed]);

  const workspace: NavItem[] = [
    ...(controlMode ? [{ to: "/launch", label: "New Run", icon: Zap }] : []),
    { to: "/projects", label: "Projects", icon: FolderKanban, match: "/project" },
  ];
  const global: NavItem[] = [
    { to: "/learnings", label: "Learnings", icon: Lightbulb },
    ...(controlMode ? [{ to: "/settings", label: "Settings", icon: Settings }] : []),
  ];

  return (
    <div className="flex h-full bg-background text-foreground">
      <button
        type="button"
        onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
        className="fixed right-4 top-4 z-40 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <aside
        className={cn(
          "flex flex-col overflow-hidden border-r border-border bg-[hsl(var(--sidebar))] transition-[width,min-width] duration-200 ease-out",
          sidebarCollapsed ? "w-[64px] min-w-[64px]" : "w-[228px] min-w-[228px]",
        )}
      >
        <div className={cn("flex items-center border-b border-border/60 p-3", sidebarCollapsed ? "justify-center" : "gap-2.5")}>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              !sidebarCollapsed && "order-last ml-auto",
            )}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-accent font-mono text-[13px] font-bold text-white", sidebarCollapsed && "hidden")}>
            &gt;_
          </div>
          <div className={cn("min-w-0", sidebarCollapsed && "hidden")}>
            <h1 className="m-0 truncate text-[15px] font-bold leading-tight tracking-[-0.02em]">Agent Swarm</h1>
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Control Panel</div>
          </div>
        </div>

        <div
          className={cn(
            "m-3 flex items-center rounded-lg border border-success/25 bg-success/10 py-2",
            sidebarCollapsed ? "hidden" : "gap-2 px-3",
          )}
          title={`${activeRuns} run${activeRuns === 1 ? "" : "s"} active`}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-success" />
            <span className="relative h-2 w-2 rounded-full bg-success" />
          </span>
          <span className={cn("font-mono text-xs font-medium text-success", sidebarCollapsed && "hidden")}>{activeRuns} run{activeRuns === 1 ? "" : "s"} active</span>
        </div>

        <nav className={cn("flex flex-1 flex-col overflow-y-auto", sidebarCollapsed ? "items-center gap-1 px-0 py-3" : "gap-px p-2")}>
          <NavSection title="Workspace" items={workspace} pathname={pathname} collapsed={sidebarCollapsed} />
          <NavSection title="Global" items={global} pathname={pathname} collapsed={sidebarCollapsed} />
        </nav>
        <div className={cn("border-t border-border/60 px-4 py-3 font-mono text-[11px] text-muted-foreground", sidebarCollapsed && "hidden")}>
          swarm v0.1.0 - local
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function NavSection({ title, items, pathname, collapsed }: { title: string; items: NavItem[]; pathname: string; collapsed: boolean }) {
  return (
    <div className={cn(collapsed ? "flex flex-col items-center gap-1" : "mb-4")}>
      <div className={cn("px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground", collapsed && "sr-only")}>{title}</div>
      {items.map((it) => {
        const matched = it.match ? pathname.startsWith(it.match) : false;
        const Icon = it.icon;
        const link = (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) => cn(
              "flex items-center rounded-md border-l-2 border-transparent text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
              collapsed ? "h-11 w-11 justify-center border-l-0 p-0" : "gap-2 px-2.5 py-1.5",
              (isActive || matched) && "border-primary bg-primary/15 font-semibold text-primary",
            )}
            aria-label={collapsed ? it.label : undefined}
            title={collapsed ? it.label : undefined}
          >
            <Icon className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-3.5 w-3.5")} />
            <span className={cn(collapsed && "sr-only")}>{it.label}</span>
          </NavLink>
        );

        if (!collapsed) return link;

        return (
          <Tooltip key={it.to}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{it.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
