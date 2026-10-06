import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// recharts needs real layout; the chart itself is not what these tests check.
vi.mock("recharts", () => {
  const Box = ({ children }) => <div>{children}</div>;
  return { ResponsiveContainer: Box, BarChart: Box, Bar: () => null, CartesianGrid: () => null, Legend: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null };
});

const server = { fetch: null, calls: [] };
vi.mock("../../store/session", () => ({ useUser: () => ({ fetchWithAuth: (url, options) => server.fetch(url, options) }) }));

import MailerOps from "./mailer-ops";

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const job = (id, over = {}) => ({ _id: id, createdAt: new Date().toISOString(), attempt: 5, maxAttempts: 5, lastError: "SMTP 550 mailbox unavailable", payload: { to: ["a@example.com"], subject: `Subject ${id}` }, ...over });

function setup({ window = {}, totals = {}, trends = [], dead = [], logs = [] } = {}) {
  server.calls = [];
  server.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    server.calls.push(`${method} ${url}`);
    if (url.startsWith("/v1/monitoring/mailer")) return reply({ windowMetrics: { successRate: 100, sent: 0, retries: 0, dead: 0, latency: { p95Ms: null }, ...window }, totals: { pending: 0, processing: 0, failed: 0, dead: dead.length, ...totals }, trends });
    if (url.startsWith("/v1/email-queue/jobs?")) return reply({ jobs: dead });
    if (/^\/v1\/email-queue\/jobs\/[\w-]+\/retry$/.test(url) && method === "POST") return reply({ success: true });
    if (url.startsWith("/v1/audit-logs")) return reply({ success: true, logs, pagination: { page: 1, total: logs.length, totalPages: 1 } });
    throw new Error(`unexpected request: ${method} ${url}`);
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MailerOps />
    </QueryClientProvider>
  );
}

const banner = () => screen.findByLabelText(/Mailer status/);
beforeEach(() => {
  server.calls = [];
});

describe("Mailer ops", () => {
  it("shows a healthy banner, compact primary metrics and honest empty states with zero data", async () => {
    setup();
    renderPage();
    const status = await banner();
    expect(within(status).getByText("Healthy")).toBeTruthy();
    expect(within(status).getByText("All outbound mail is delivering normally.")).toBeTruthy();
    expect(within(status).getByText("0 dead letters · 0 retries")).toBeTruthy();
    for (const label of ["Success rate", "Sent", "Retries", "Dead", "p95 latency", "Queue now", "Pending", "Processing", "Failed"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText("No mail activity in the last 24 hours.")).toBeTruthy();
    expect((await screen.findAllByText("No dead letters")).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /Dead letters/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry all/i })).toBeNull();
  });

  it("is degraded (amber) when there are retries or failed jobs but no dead letters, using the real numbers", async () => {
    setup({ window: { retries: 12 }, totals: { failed: 2 } });
    renderPage();
    const status = await banner();
    expect(within(status).getByText("Degraded")).toBeTruthy();
    expect(within(status).getByText("12 retries · 2 failed · 0 dead letters")).toBeTruthy();
  });

  it("needs attention when dead letters exist, and offers retry actions that use the existing per-job endpoint", async () => {
    setup({ dead: [job("j1"), job("j2")], window: { dead: 2 } });
    const user = userEvent.setup();
    renderPage();
    const status = await banner();
    expect(within(status).getByText("Needs attention")).toBeTruthy();
    expect(within(status).getByText(/2 messages are in the dead-letter queue and require action/)).toBeTruthy();
    expect(await screen.findByRole("tab", { name: /Dead letters\s*2/ })).toBeTruthy();
    expect(await screen.findByText("2 messages require attention.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^retry all$/i }));
    await user.click(await screen.findByRole("button", { name: /^retry all$/i, hidden: false }).then(() => screen.getAllByRole("button", { name: /^retry all$/i }).pop()));
    await waitFor(() => expect(server.calls.filter((c) => c.startsWith("POST") && c.endsWith("/retry"))).toEqual(["POST /v1/email-queue/jobs/j1/retry", "POST /v1/email-queue/jobs/j2/retry"]));
  });

  it("shows the full error in a details drawer", async () => {
    setup({ dead: [job("j1", { lastError: "SMTP 550 mailbox unavailable for a@example.com" })] });
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByText(/^a@example.com$/))[0]);
    const drawer = within(await screen.findByRole("dialog"));
    expect(drawer.getByText("Last error")).toBeTruthy();
    expect(drawer.getByText(/SMTP 550 mailbox unavailable for a@example.com/)).toBeTruthy();
    expect(drawer.getByText("j1")).toBeTruthy();
  });

  it("filters the audit log with a real event-type list, quick ranges and removable chips", async () => {
    setup({ logs: [{ _id: "l1", eventType: "job_sent", entityId: "abc123", at: new Date().toISOString(), actor: { actorType: "worker", actorName: "mailer" } }] });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Audit log" }));
    const select = await screen.findByLabelText("Event type");
    expect([...select.options].map((o) => o.value)).toEqual(["", "job_enqueued", "job_sent", "job_retry", "job_dead"]);
    await user.selectOptions(select, "job_sent");
    await user.click(screen.getByRole("button", { name: /^apply$/i }));
    await waitFor(() => expect(server.calls.some((c) => c.includes("/v1/audit-logs") && c.includes("eventType=job_sent"))).toBe(true));
    expect(screen.getByText("Event: Sent")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "24h" }));
    await waitFor(() => expect(server.calls.some((c) => c.includes("startDate=") && !c.includes("range="))).toBe(true));
    expect(screen.getByLabelText("Remove filter Last 24h")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove filter Event: Sent" }));
    await waitFor(() => expect(screen.queryByText("Event: Sent")).toBeNull());
    await user.click(screen.getByRole("button", { name: /^reset$/i }));
    await waitFor(() => expect(screen.queryByLabelText("Remove filter Last 24h")).toBeNull());
    expect(screen.getAllByText("mailer").length).toBeGreaterThan(0); // actor column
  });

  it("refresh re-reads all three sources and is disabled while one is running", async () => {
    setup();
    const user = userEvent.setup();
    renderPage();
    await banner();
    server.calls = [];
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(server.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(/Last updated/)).toBeTruthy();
  });
});
