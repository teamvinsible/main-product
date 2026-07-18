import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./layout/Shell";
import { IntakePage } from "./pages/IntakePage";
import { SpinePage } from "./pages/SpinePage";
import { FilesPage } from "./pages/FilesPage";

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/intake" replace />} />
        <Route path="/intake" element={<IntakePage />} />
        <Route path="/spine" element={<SpinePage />} />
        <Route path="/spine/:project" element={<SpinePage />} />
        <Route path="/files/:project?" element={<FilesPage />} />
      </Route>
    </Routes>
  );
}
