import { Navigate, useLocation } from "react-router-dom";
import { BrandLoader } from "../components/BrandLoader";
import { useAuth } from "./AuthProvider";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, configured, session } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="auth-loading">
        <BrandLoader label="Signing you in…" />
      </div>
    );
  }

  if (configured && !session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
