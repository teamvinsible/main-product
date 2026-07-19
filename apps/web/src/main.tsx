import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AntDesignProvider } from "./antdTheme";
import { App } from "./App";
import { setApiTokenGetter } from "./api";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { ThemeProvider } from "./theme";
import "./styles.css";
import "./lib/scrollIndicators";


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
  </React.StrictMode>,
);
