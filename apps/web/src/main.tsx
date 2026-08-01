import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { BrowserRouter } from "react-router-dom";
import { AntDesignProvider } from "./antdTheme";
import { App } from "./App";
import { setApiTokenGetter } from "./api";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { initAnalytics } from "./lib/analytics";
import { ThemeProvider } from "./theme";
import "./styles.css";
import "./lib/scrollIndicators";

initAnalytics();


function ApiTokenBridge({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  useEffect(() => {
    setApiTokenGetter(getToken);
    return () => setApiTokenGetter(null);
  }, [getToken]);
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PostHogProvider client={posthog}>
      <ThemeProvider>
        <AntDesignProvider>
          <BrowserRouter>
            <AuthProvider>
              <ApiTokenBridge>
                <App />
              </ApiTokenBridge>
            </AuthProvider>
          </BrowserRouter>
        </AntDesignProvider>
      </ThemeProvider>
    </PostHogProvider>
  </React.StrictMode>,
);
