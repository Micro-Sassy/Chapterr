import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { ApiRequestError } from "./lib/api";
import "./styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Don't retry client errors (401/403/404/409/422); retry network hiccups briefly.
      retry: (count, err) => !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

// Any 401 from the API means the session ended (expired, revoked, password reset).
queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (event.type === "updated" && err instanceof ApiRequestError && err.status === 401 && event.query.queryKey[0] !== "session") {
    void queryClient.invalidateQueries({ queryKey: ["session"] });
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
