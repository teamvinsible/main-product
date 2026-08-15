import { lazy, Suspense } from "react";
import { Navigate, Link, Route, Routes, useParams } from "react-router-dom";
import { BrandLoader } from "./components/BrandLoader";
import { PostHogPageView } from "./components/PostHogPageView";
import { SeoMetadata } from "./components/SeoMetadata";
import { AgentPage } from "./pages/AgentPage";
import { AgentsHubPage } from "./pages/AgentsHubPage";
import { ComparisonPage } from "./pages/ComparisonPage";
import { FeaturesPage } from "./pages/FeaturesPage";
import { LandingPage } from "./pages/LandingPage";
import { UseCasePage } from "./pages/UseCasePage";
import { PrivacyPage, TermsPage } from "./pages/LegalPages";

const RequireAuth = lazy(() =>
  import("./auth/RequireAuth").then((module) => ({ default: module.RequireAuth })),
);
const BriefProvider = lazy(() =>
  import("./components/BriefProvider").then((module) => ({ default: module.BriefProvider })),
);
const Shell = lazy(() =>
  import("./layout/Shell").then((module) => ({ default: module.Shell })),
);
const AuthCallbackPage = lazy(() =>
  import("./pages/AuthCallbackPage").then((module) => ({ default: module.AuthCallbackPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const SignupPage = lazy(() =>
  import("./pages/SignupPage").then((module) => ({ default: module.SignupPage })),
);
const SpinePage = lazy(() =>
  import("./pages/SpinePage").then((module) => ({ default: module.SpinePage })),
);

function RouteFallback() {
  return (
    <main className="page-state">
      <BrandLoader label="Loading Teamvinsible…" />
    </main>
  );
}

function LegacySpineRedirect() {
  const { project } = useParams();
  return (
    <Navigate
      to={project ? `/dashboard/${encodeURIComponent(project)}` : "/dashboard"}
      replace
    />
  );
}

function NotFoundPage() {
  return (
    <main className="page-state card" aria-labelledby="not-found-title">
      <p className="orch-kicker">404</p>
      <h1 className="page-state-title" id="not-found-title">Page not found</h1>
      <p className="muted">The page you requested does not exist or has moved.</p>
      <Link to="/" className="legal-back">Back to Teamvinsible</Link>
    </main>
  );
}

export function App() {
  return (
    <>
      <SeoMetadata />
      <PostHogPageView />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/agents" element={<AgentsHubPage />} />
          <Route path="/agents/:slug" element={<AgentPage />} />
          <Route path="/vs/:slug" element={<ComparisonPage />} />
          <Route path="/for/:slug" element={<UseCasePage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          <Route
            element={
              <RequireAuth>
                <BriefProvider>
                  <Shell />
                </BriefProvider>
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<SpinePage />} />
            <Route path="/dashboard/:project" element={<SpinePage />} />

            {/* Legacy redirects */}
            <Route path="/spine" element={<Navigate to="/dashboard" replace />} />
            <Route path="/spine/:project" element={<LegacySpineRedirect />} />
            <Route path="/intake" element={<Navigate to="/dashboard" replace />} />
            <Route path="/files/*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
