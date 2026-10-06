// src/index.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Theme } from "@radix-ui/themes";
import "react-toastify/dist/ReactToastify.css";
import App from "./App.jsx";
import { SessionProvider } from "./store/session";
import "./styles/globals.css";
import "./ui/tokens.css";
import { Toaster } from "./ui";
import { initTheme } from "./ui/shell/theme";

initTheme();

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().catch((error) => {
          console.warn("Failed to unregister stale service worker:", error);
        });
      });
    });

    if ("caches" in window) {
      caches.keys().then((keys) => {
        keys
          .filter((key) => key.includes("workbox") || key.includes("start-url") || key === "dev")
          .forEach((key) => {
            caches.delete(key).catch((error) => {
              console.warn("Failed to delete stale cache:", key, error);
            });
          });
      });
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Theme appearance="inherit" accentColor="pink" grayColor="mauve" radius="medium">
          <App />
          <Toaster />
        </Theme>
      </SessionProvider>
    </QueryClientProvider>
  </BrowserRouter>
);
