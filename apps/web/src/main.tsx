import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AntDesignProvider } from "./antdTheme";
import { App } from "./App";
import { ThemeProvider } from "./theme";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AntDesignProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntDesignProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
