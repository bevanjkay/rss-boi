import type { AuthSession } from "@rss-boi/shared";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { ApiError } from "./lib/api";
import "./styles/global.css";

let queryClient: QueryClient;

function handleUnauthorized(error: unknown) {
  if (error instanceof ApiError && error.status === 401)
    queryClient.setQueryData<AuthSession>(["session"], { user: null });
}

queryClient = new QueryClient({
  defaultOptions: {
    // Feed data changes on the worker's poll interval, not per interaction, so
    // treat it as fresh briefly. Without this every navigation refetches the
    // whole entry list immediately.
    queries: {
      staleTime: 30_000,
    },
  },
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
  queryCache: new QueryCache({ onError: handleUnauthorized }),
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
