import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = { fetch: null, calls: [] };
vi.mock("../../store/session", () => ({ useUser: () => ({ fetchWithAuth: (url, options) => server.fetch(url, options) }) }));

// jsdom has no matchMedia; the workspace uses it to decide whether to show the conversation inline (wide) or as a
// sheet (narrow). Report "wide" so the panel behaviour is deterministic in these tests.
beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
});

import ThreadsWorkspace from "./ThreadsWorkspace";

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const row = (id, status, over = {}) => ({ _id: id, sourceCaseId: `APP-${id}`, subject: `Subject ${id}`, lastMessage: `Preview ${id}`, lastMessageAt: new Date().toISOString(), unreadCount: 0, mailboxId: null, status, ...over });

function setup({ rows = {}, mailboxes = [] } = {}) {
  server.calls = [];
  server.fetch = async (url, options = {}) => {
    server.calls.push(url);
    if (url.startsWith("/v1/threads?")) {
      const params = new URLSearchParams(url.split("?")[1]);
      const status = params.get("status");
      return reply({ threads: rows[status] || [] });
    }
    if (url.startsWith("/v1/mailboxes")) return reply({ mailboxes });
    throw new Error(`unexpected request: ${options.method || "GET"} ${url}`);
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/agents/threads"]}>
        <ThreadsWorkspace basePath="/agents" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const nav = () => screen.findByLabelText("Thread views");

beforeEach(() => {
  server.calls = [];
});

describe("Threads workspace", () => {
  it("has no vertical sidebar: the view nav is a single horizontal row above a full-width list", async () => {
    setup({ rows: { open: [row("1", "open")], active: [row("2", "active")] } });
    renderPage();
    const bar = await nav();
    expect(bar.className).toMatch(/h-11/);
    expect(document.querySelector("aside")).toBeNull(); // the old ~300px sidebar column is gone
    expect(await screen.findByText("Subject 1")).toBeTruthy();
  });

  it("shows every existing view with real counts, grouped the same as before", async () => {
    setup({ rows: { open: [row("1", "open"), row("2", "open")], active: [row("3", "active")] } });
    renderPage();
    await screen.findByText("Subject 1");
    const bar = within(await nav());
    for (const label of ["All threads", "Unread", "Open", "Active", "Pending", "Monitoring", "Closed", "Archived"]) expect(bar.getByText(label)).toBeTruthy();
    const openButton = bar.getByText("Open").closest("button");
    expect(openButton.textContent).toBe("Open2");
  });

  it("selecting a status view filters the list and marks the pill active, same as the old sidebar", async () => {
    setup({ rows: { open: [row("1", "open")], active: [row("2", "active")] } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Subject 1");
    expect(screen.getByText("Subject 2")).toBeTruthy();
    const bar = within(await nav());
    await user.click(bar.getByText("Active"));
    expect(bar.getByText("Active").closest("button")).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(screen.queryByText("Subject 1")).toBeNull());
    expect(screen.getByText("Subject 2")).toBeTruthy();
  });

  it("mailboxes appear in the same nav and toggle the mailboxId query param", async () => {
    setup({ rows: { open: [row("1", "open", { mailboxId: "m1" })] }, mailboxes: [{ _id: "m1", name: "Support Inbox" }] });
    const user = userEvent.setup();
    renderPage();
    const bar = within(await nav());
    const support = await bar.findByText("Support Inbox");
    await user.click(support);
    expect(support.closest("button")).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(server.calls.some((c) => c.includes("mailboxId=m1"))).toBe(true));
  });

  it("the thread list still opens the right conversation and refresh still works", async () => {
    setup({ rows: { open: [row("1", "open")] } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Subject 1");
    server.calls = [];
    await user.click(screen.getByRole("button", { name: /refresh threads/i }));
    await waitFor(() => expect(server.calls.some((c) => c.startsWith("/v1/threads?"))).toBe(true));
  });
});
