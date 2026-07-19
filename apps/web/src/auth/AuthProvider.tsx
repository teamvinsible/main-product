import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  getSession,
  isSupabaseConfigured,
  mapUser,
  signInWithGoogle,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  supabase,
  type SessionUser,
} from "../lib/supabase";

type AuthContextValue = {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  user: SessionUser | null;
  /** True when signed-in OR running local demo without Supabase */
  canUseApp: boolean;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    let alive = true;
    getSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const user = useMemo(() => mapUser(session?.user ?? null), [session]);

  const getToken = useCallback(async () => session?.access_token ?? null, [session]);

  const logout = useCallback(async () => {
    await signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      configured,
      session,
      user,
      canUseApp: !configured || Boolean(session),
      signInGoogle: signInWithGoogle,
      signInEmail: signInWithPassword,
      signUpEmail: signUpWithPassword,
      logout,
      getToken,
    }),
    [ready, configured, session, user, logout, getToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
