import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AiSummary } from "./AiSummary";

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const line = (section, text, review = "established") => ({ section, text, review, factIds: [], sources: [] });
const insight = (over = {}) => ({
  _id: "s1",
  stale: false,
  warnings: ["Based on a draft knowledge pack that has not been approved."],
  createdAt: new Date().toISOString(),
  summary: {
    text: "",
    lines: [
      line("claim", "The customer says they submitted the passport three times and it was rejected.", "needs_review"),
      line("verified", "The ticket status is open."),
      line("state", "The customer is waiting for a reply from support."),
    ],
    pending: [{ kind: "unanswered_question", messageId: "m1", sentenceIndex: 0 }],
    warnings: [],
  },
  ...over,
});

function renderSummary(handler) {
  const calls = [];
  const fetchWithAuth = async (url, options = {}) => {
    calls.push(`${options.method || "GET"} ${url}`);
    return handler(url, options.method || "GET");
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AiSummary ticketId="t1" fetchWithAuth={fetchWithAuth} />
    </QueryClientProvider>
  );
  return calls;
}

describe("Conversation summary", () => {
  it("offers to summarize when none exists, and generating shows claims as claims with review and warnings", async () => {
    const user = userEvent.setup();
    let stored = null;
    const calls = renderSummary((url, method) => {
      if (method === "POST") {
        stored = insight();
        return reply({ success: true, reused: false, insight: stored });
      }
      return reply({ success: true, insight: stored });
    });
    await user.click(await screen.findByRole("button", { name: /summarize/i }));
    expect(await screen.findByText(/The customer says they submitted the passport three times/)).toBeTruthy();
    expect(screen.getByText("The ticket status is open.")).toBeTruthy();
    expect(screen.getByText("Under review")).toBeTruthy();
    expect(screen.getByText(/draft knowledge pack/)).toBeTruthy();
    expect(screen.getByText("Unanswered question")).toBeTruthy();
    expect(screen.getByText(/not written by a language model/)).toBeTruthy();
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /v1/ai/tickets/t1/summary"]);
  });

  it("shows a stored summary immediately and flags it when the ticket has moved on", async () => {
    renderSummary(() => reply({ success: true, insight: insight({ stale: true }) }));
    expect(await screen.findByText(/Out of date/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /update summary/i })).toBeTruthy();
  });

  it("reports an unavailable engine without breaking anything", async () => {
    const user = userEvent.setup();
    renderSummary((url, method) => (method === "POST" ? reply({ success: false, available: false, reason: "unavailable" }) : reply({ success: true, insight: null })));
    await user.click(await screen.findByRole("button", { name: /summarize/i }));
    expect(await screen.findByText(/not available right now/i)).toBeTruthy();
    expect(screen.getByText(/keep working on this ticket/i)).toBeTruthy();
  });

  it("handles an HTTP failure and only ever calls Node's summary endpoint", async () => {
    const user = userEvent.setup();
    const calls = renderSummary((url, method) => (method === "POST" ? reply({}, 500) : reply({ success: true, insight: null })));
    await user.click(await screen.findByRole("button", { name: /summarize/i }));
    expect(await screen.findByText(/could not be completed/i)).toBeTruthy();
    for (const call of calls) expect(call).toMatch(/^(GET|POST) \/v1\/ai\/tickets\/t1\/summary$/);
  });
});
