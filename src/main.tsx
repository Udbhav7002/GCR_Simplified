import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import App from "./App";
import "./index.css";

// Forward webview console + logs to the Rust log plugin (file + stdout).
attachConsole();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
