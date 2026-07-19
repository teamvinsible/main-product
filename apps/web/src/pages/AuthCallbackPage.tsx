import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/** Completes OAuth / email magic-link redirect */
export function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) {
        navigate("/login", { replace: true });
        return;
      }
      // Session is recovered via detectSessionInUrl
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      navigate(data.session ? "/dashboard" : "/login", { replace: true });
    })();
    return () => {
      alive = false;
    };
  }, [navigate]);

  return (
    <div className="auth-loading">
      <p>Finishing sign-in…</p>
    </div>
  );
}
