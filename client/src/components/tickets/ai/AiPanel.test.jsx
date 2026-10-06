import React from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A scriptable stand-in for the Node API. React only ever talks to Node; there is no Python here.
const server = { fetch: null, calls: [] };
vi.mock("../../../store/session", () => ({
  useUser: () => ({ fetchWithAuth: (url, options) => server.fetch(url, options), user: { _id: "u1", name: "Anita", isAdmin: true } }),
}));

import { AiPanel } from "./AiPanel";
import { fetchTicket, ticketKey } from "../model";

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const insight = (type, label, confidence, extra = {}) => ({
  _id: `${type}-1`,
  ticketId: "t1",
  analysisId: "a1",
  type,
  label,
  confidence,
  lowConfidence: confidence < 0.5,
  reasons: [],
  status: "suggested",
  applied: null,
  reviewedBy: null,
  reviewedAt: null,
  ...extra,
});
const analysis = (over = {}) => [
  insight("sentiment", "frustrated", 0.92),
  insight("intent", "document_issue", 0.71),
  insight("priority", "high", 0.78, { reasons: ["Repeated failed attempts or no response so far", "Customer appears frustrated"], ...over }),
];

/** State of the fake server, plus the routes the panel is allowed to use. */
function setup({ enabled = true, available = true, stored = [], analyze, accept, dismiss, ticketPriority = "medium" } = {}) {
  const state = { stored, ticketPriority, analyzeHang: null };
  server.calls = [];
  server.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    server.calls.push(`${method} ${url}`);
    if (url === "/v1/ai/status") return reply({ success: true, enabled, available });
    if (url === "/v1/ai/tickets/t1/insights") return reply({ success: true, insights: state.stored });
    if (url === "/v1/ai/tickets/t1/analyze") {
      if (state.analyzeHang) await state.analyzeHang;
      return analyze ? analyze(state) : reply({ success: true, analysisId: "a1", insights: analysis() });
    }
    if (/^\/v1\/ai\/insights\/[\w-]+\/accept$/.test(url)) return accept ? accept(state) : reply({ success: true, insight: { ...state.stored.find((i) => i.type === "priority") } });
    if (/^\/v1\/ai\/insights\/[\w-]+\/dismiss$/.test(url)) return dismiss ? dismiss(state) : reply({ success: true, insight: {} });
    if (url === "/v1/ai/tickets/t1/summary" && method === "GET") return reply({ success: true, insight: null });
    if (url === "/v1/ticket/t1") return reply({ ticket: { _id: "t1", priority: state.ticketPriority } });
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  return state;
}

function TicketHarness() {
  // Stands in for the workspace: the ticket is read from the server and AiPanel is given whatever it currently holds.
  const { data: ticket } = useQuery({ queryKey: ticketKey("t1"), queryFn: () => fetchTicket((u, o) => server.fetch(u, o), "t1") });
  return (
    <div>
      <div data-testid="ticket-priority">Priority: {ticket?.priority || "…"}</div>
      <button type="button">Reply to customer</button>
      {ticket ? <AiPanel ticket={ticket} /> : null}
    </div>
  );
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TicketHarness />
    </QueryClientProvider>
  );
  return { client, ...view };
}

const panel = () => screen.findByLabelText("AI analysis");
const writes = () => server.calls.filter((c) => c.startsWith("POST") || c.startsWith("PUT") || c.startsWith("PATCH"));

beforeEach(() => {
  server.calls = [];
});

describe("AI analysis panel", () => {
  it("is absent when AI is not configured", async () => {
    setup({ enabled: false });
    renderPanel();
    await screen.findByTestId("ticket-priority");
    await waitFor(() => expect(server.calls).toContain("GET /v1/ai/status"));
    expect(screen.queryByLabelText("AI analysis")).not.toBeInTheDocument();
  });

  it("shows a loading state while the analysis runs, then the results", async () => {
    const state = setup();
    let release;
    state.analyzeHang = new Promise((resolve) => (release = resolve));
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /analyze/i }));

    expect(await screen.findByRole("button", { name: /analyzing/i })).toBeDisabled();
    expect(screen.getByLabelText("Analyzing")).toHaveAttribute("aria-busy", "true");

    release();
    expect(await screen.findByText("Frustrated")).toBeInTheDocument();
    expect(screen.queryByLabelText("Analyzing")).not.toBeInTheDocument();
  });

  it("renders sentiment, intent and suggested priority with confidence and reasons, and changes nothing on the ticket", async () => {
    setup();
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /analyze/i }));

    const region = await panel();
    await within(region).findByText("Frustrated");
    expect(within(region).getByText("92% confidence")).toBeInTheDocument();
    expect(within(region).getByText("Document issue")).toBeInTheDocument();
    expect(within(region).getByText("71% confidence")).toBeInTheDocument();
    expect(within(region).getByText("High")).toBeInTheDocument();
    expect(within(region).getByText("78% confidence")).toBeInTheDocument();
    expect(within(region).getByText("Repeated failed attempts or no response so far")).toBeInTheDocument();
    expect(within(region).getByText("Current priority: Medium.")).toBeInTheDocument();
    expect(within(region).getByText(/not a guaranteed probability/i)).toBeInTheDocument();

    // Only the analyze request was sent; no accept, and no ticket update of any kind.
    expect(writes()).toEqual(["POST /v1/ai/tickets/t1/analyze"]);
    expect(screen.getByTestId("ticket-priority")).toHaveTextContent("Priority: medium");
  });

  it("flags a low-confidence result", async () => {
    setup({ analyze: () => reply({ success: true, analysisId: "a1", insights: [insight("sentiment", "neutral", 0.5), insight("intent", "other", 0.3), insight("priority", "low", 0.4, { reasons: ["No urgency or issue signals detected"] })] }) });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /analyze/i }));

    const region = await panel();
    await within(region).findByText("30% confidence");
    expect(within(region).getAllByText("Low confidence").length).toBeGreaterThanOrEqual(2);
    expect(within(region).getByText(/weak signal/i)).toBeInTheDocument();
  });

  it("accepting the priority calls Node's accept endpoint and re-reads the ticket, so the UI shows the server's priority", async () => {
    const state = setup({
      stored: analysis(),
      accept: (s) => {
        s.ticketPriority = "high"; // what the server does
        s.stored = s.stored.map((i) => (i.type === "priority" ? { ...i, status: "accepted", reviewedBy: { id: "u1", name: "Anita" }, reviewedAt: new Date().toISOString(), applied: { priority: { from: "medium", to: "high" } } } : i));
        return reply({ success: true, insight: { ...s.stored.find((i) => i.type === "priority") } });
      },
    });
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("ticket-priority")).toHaveTextContent("Priority: medium"));

    const region = await panel();
    await user.click(await within(region).findByRole("button", { name: "Accept" }));

    await waitFor(() => expect(screen.getByTestId("ticket-priority")).toHaveTextContent("Priority: high"));
    expect(writes()).toEqual(["POST /v1/ai/insights/priority-1/accept"]);
    expect(await within(region).findByText(/Accepted by Anita/)).toBeInTheDocument();
    expect(within(region).getByText(/Priority changed from Medium to High/)).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    // The client never wrote the priority itself.
    expect(server.calls.some((c) => c.includes("/ticket/ticket/update") || c.startsWith("PUT"))).toBe(false);
  });

  it("dismissing calls Node's dismiss endpoint and shows who dismissed it", async () => {
    setup({
      stored: analysis(),
      dismiss: (s) => {
        s.stored = s.stored.map((i) => (i.type === "priority" ? { ...i, status: "dismissed", reviewedBy: { id: "u1", name: "Anita" }, reviewedAt: new Date().toISOString() } : i));
        return reply({ success: true, insight: {} });
      },
    });
    const user = userEvent.setup();
    renderPanel();
    const region = await panel();
    const dismissButtons = await within(region).findAllByRole("button", { name: "Dismiss" });
    await user.click(dismissButtons[dismissButtons.length - 1]); // the priority row is last

    expect(await within(region).findByText(/Dismissed by Anita/)).toBeInTheDocument();
    expect(writes()).toEqual(["POST /v1/ai/insights/priority-1/dismiss"]);
    expect(screen.getByTestId("ticket-priority")).toHaveTextContent("Priority: medium");
  });

  it("shows an already-reviewed insight as reviewed, with who and when, and offers no actions", async () => {
    const reviewedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    setup({
      stored: [
        insight("sentiment", "frustrated", 0.92, { status: "dismissed", reviewedBy: { id: "u2", name: "Ravi Menon" }, reviewedAt }),
        insight("intent", "document_issue", 0.71),
        insight("priority", "high", 0.78, { status: "accepted", reviewedBy: { id: "u1", name: "Anita" }, reviewedAt, applied: { priority: { from: "medium", to: "high" } } }),
      ],
    });
    renderPanel();
    const region = await panel();
    expect(await within(region).findByText(/Accepted by Anita/)).toBeInTheDocument();
    expect(within(region).getByText(/Dismissed by Ravi Menon/)).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    // Only the unreviewed intent row still offers Dismiss.
    expect(within(region).getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);
  });

  it("when Node reports the suggestion was already handled (409), it says so and reloads the real state", async () => {
    const state = setup({
      stored: analysis(),
      accept: (s) => {
        s.stored = s.stored.map((i) => (i.type === "priority" ? { ...i, status: "accepted", reviewedBy: { id: "u2", name: "Ravi Menon" }, reviewedAt: new Date().toISOString() } : i));
        return reply({ success: false, message: "This suggestion has already been handled." }, 409);
      },
    });
    const user = userEvent.setup();
    renderPanel();
    const region = await panel();
    await user.click(await within(region).findByRole("button", { name: "Accept" }));
    expect(await within(region).findByText(/Accepted by Ravi Menon/)).toBeInTheDocument();
    expect(state.ticketPriority).toBe("medium");
  });

  it.each([
    ["unavailable", /not available right now/i],
    ["timeout", /took too long/i],
    ["unauthorized", /rejected its credentials/i],
    ["rate_limited", /too many analysis requests/i],
    ["invalid_response", /did not return a usable result/i],
  ])("reports %s from Node without disturbing the ticket", async (reason, message) => {
    setup({ analyze: () => reply({ success: false, available: false, reason }) });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /analyze/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent(/keep working on this ticket as usual/i);
    // The rest of the ticket is intact and usable.
    expect(screen.getByTestId("ticket-priority")).toHaveTextContent("Priority: medium");
    expect(screen.getByRole("button", { name: "Reply to customer" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /analyze/i })).toBeEnabled();
  });

  it("treats an empty successful result as unusable", async () => {
    setup({ analyze: () => reply({ success: true, analysisId: "a1", insights: [] }) });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /analyze/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/did not return a usable result/i);
  });

  it("handles a failing Node API (HTTP 500) without breaking the panel", async () => {
    setup({ analyze: () => reply({ success: false, message: "boom" }, 500) });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /analyze/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be completed/i);
    expect(screen.getByTestId("ticket-priority")).toHaveTextContent("Priority: medium");
  });

  it("says when the analysis service is offline but still lets the agent try", async () => {
    setup({ available: false });
    renderPanel();
    expect(await screen.findByText(/looks offline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /analyze/i })).toBeEnabled();
  });

  it("never talks to anything except Node's /v1/ai endpoints and the ticket read", async () => {
    setup();
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /analyze/i }));
    await screen.findByText("Frustrated");
    for (const call of server.calls) expect(call).toMatch(/^(GET|POST) \/v1\/(ai\/|ticket\/t1$)/);
    expect(server.calls.join(" ")).not.toMatch(/8100|intelligence|analyze-message/);
  });
});
