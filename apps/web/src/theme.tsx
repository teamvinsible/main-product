import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "teamvinsible-theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  cycle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
}

const ORDER: ThemePreference[] = ["system", "light", "dark"];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    typeof window === "undefined" ? "system" : readStoredPreference(),
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    typeof window === "undefined" ? "light" : resolveTheme(readStoredPreference()),
  );

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    applyTheme(next);
    setResolved(resolveTheme(next));
  }, []);

  const cycle = useCallback(() => {
    const idx = ORDER.indexOf(preference);
    setPreference(ORDER[(idx + 1) % ORDER.length]);
  }, [preference, setPreference]);

  useEffect(() => {
    applyTheme(preference);
    setResolved(resolveTheme(preference));
  }, [preference]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (preference === "system") {
        applyTheme("system");
        setResolved(systemTheme());
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, cycle }),
    [preference, resolved, setPreference, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
