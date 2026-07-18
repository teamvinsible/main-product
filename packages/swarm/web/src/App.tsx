import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { LearningsPage } from "./pages/LearningsPage";
import { LaunchPage } from "./pages/LaunchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { api } from "./api";
import type { Config } from "./types";
import { ConfigContext } from "./config";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function App() {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig({
      controlMode: false, projectTypes: [], phaseAgents: {}, allPhases: [],
    }));
  }, []);

  if (!config) return <div className="p-10 text-muted-foreground">Loading…</div>;

  return (
    <ConfigContext.Provider value={config}>
      <TooltipProvider delayDuration={200}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="project/:name" element={<ProjectPage />} />
            <Route path="project/:name/:section" element={<ProjectPage />} />
            <Route path="learnings" element={<LearningsPage />} />
            {config.controlMode && <Route path="launch" element={<LaunchPage />} />}
            {config.controlMode && <Route path="settings" element={<SettingsPage />} />}
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Route>
        </Routes>
        <Toaster />
      </TooltipProvider>
    </ConfigContext.Provider>
  );
}
