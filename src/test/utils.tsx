import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { ToastProvider } from "@/components/ui/Toast";

export function renderRoutes(routes: RouteObject[], initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, qc };
}

export function renderWithProviders(ui: ReactElement) {
  return renderRoutes([{ path: "*", element: ui }], "/");
}

/** Minimal fetch mock keyed by "METHOD path". */
export function mockFetch(handlers: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const handler = handlers[`${method} ${url.pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: { code: "not_found", message: "Not mocked" } }), { status: 404 });
    const res = handler(body);
    return new Response(JSON.stringify(res.json), { status: res.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}
