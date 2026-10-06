import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A scriptable stand-in for the Node API. React only ever talks to Node; there is no Python here.
const server = { fetch: null, calls: [], bodies: [] };
vi.mock("../../../store/session", () => ({
  useUser: () => ({ fetchWithAuth: (url, options) => server.fetch(url, options), user: { _id: "u1", name: "Anita", isAdmin: true } }),
}));

import { MessageComposer } from "../../conversation/MessageComposer";
import { AiReplyDraft } from "./AiReplyDraft";
import { useReplyDraft } from "./useReplyDraft";

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const TEXT = "Hi Priya,\n\nThank you for your message. You mentioned that you submitted your passport three times and that it was rejected.\n\nAnita\nSupport Team";
const draft = (over = {}) => ({
  _id: "d1",
  body: "Thank you for your message. You mentioned that you submitted your passport three times and that it was rejected.",
  text: TEXT,
  stale: false,
  warnings: ["Built from draft reply patterns that have not been approved. Read and edit before sending."],
  sentences: [
    { text: "Thank you for your message.", source: { type: "pattern", patternId: "opening", factIds: [] } },
    { text: "You mentioned that you submitted your passport three times and that it was rejected.", source: { type: "claim", patternId: "claim.action_outcome", factIds: ["f1"], messageId: "c1", sentenceIndex: 0 } },
  ],
  ...over,
});

function setup({ enabled = true, stored = null, generate } = {}) {
  const state = { stored, hang: null };
  server.calls = [];
  server.bodies = [];
  server.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    server.calls.push(`${method} ${url}`);
    if (options.body) server.bodies.push(JSON.parse(options.body));
    if (url === "/v1/ai/status") return reply({ success: true, enabled, available: true });
    if (url === "/v1/ai/tickets/t1/reply-draft" && method === "GET") return reply({ success: true, insight: state.stored });
    if (url === "/v1/ai/tickets/t1/reply-draft" && method === "POST") {
      if (state.hang) await state.hang;
      return generate ? generate(state) : reply({ success: true, status: "ready", reused: false, insight: draft() });
    }
    if (/^\/v1\/ai\/insights\/[\w-]+\/feedback$/.test(url)) return reply({ success: true });
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  return state;
}

function Harness({ version = 1 }) {
  // Mirrors the wiring in TicketWorkspace: the draft goes into the composer; the agent sends with the composer's button.
  const [composerText, setComposerText] = useState("");
  const [seed, setSeed] = useState(null);
  const insert = (text) => setSeed((prev) => ({ key: (prev?.key || 0) + 1, text }));
  const state = useReplyDraft({ ticketId: "t1", version, composerText, insertIntoComposer: insert });
  return (
    <div>
      <AiReplyDraft state={state} />
      <MessageComposer
        seed={seed}
        onTextChange={setComposerText}
        onSubmit={async ({ mode, body }) => {
          server.calls.push(`SEND ${mode}`);
          if (mode === "reply") state.onSent(body);
        }}
      />
    </div>
  );
}

function renderHarness(props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>
  );
}

const box = () => screen.getByRole("textbox", { name: "Reply" });
const feedback = () => server.bodies.filter((b) => b.event).map((b) => b.event);
const writes = () => server.calls.filter((c) => c.startsWith("POST") || c.startsWith("SEND"));

beforeEach(() => {
  server.calls = [];
  server.bodies = [];
});

describe("AI reply draft", () => {
  it("is absent when AI is not configured", async () => {
    setup({ enabled: false });
    renderHarness();
    await screen.findByRole("textbox", { name: "Reply" });
    await waitFor(() => expect(server.calls).toContain("GET /v1/ai/status"));
    expect(screen.queryByRole("button", { name: /draft reply/i })).toBeNull();
  });

  it("shows a loading state, then inserts the draft into the composer as editable text without sending anything", async () => {
    const state = setup();
    let release;
    state.hang = new Promise((resolve) => (release = resolve));
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    expect(await screen.findByRole("button", { name: /generating/i })).toBeTruthy();
    expect(box().value).toBe("");
    release();
    await waitFor(() => expect(box().value).toBe(TEXT));
    expect(screen.getByText("Draft ready")).toBeTruthy();
    expect(screen.getByText(/Read it and edit it before you send/)).toBeTruthy();
    expect(screen.getByText(/draft reply patterns/)).toBeTruthy();

    // editable like any other text
    await user.type(box(), " Extra line.");
    expect(box().value).toBe(`${TEXT} Extra line.`);
    // nothing was sent, and the only write is the draft request
    expect(writes()).toEqual(["POST /v1/ai/tickets/t1/reply-draft"]);
  });

  it("explains why every sentence exists", async () => {
    setup();
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    await waitFor(() => expect(box().value).toBe(TEXT));
    await user.click(screen.getByText("Why this draft?"));
    expect(screen.getByText("Customer said")).toBeTruthy();
    expect(screen.getAllByText("Standard wording").length).toBeGreaterThan(0);
  });

  it("does not overwrite text the agent already wrote; the agent chooses", async () => {
    setup();
    const user = userEvent.setup();
    renderHarness();
    await user.type(await screen.findByRole("textbox", { name: "Reply" }), "My own start");
    await user.click(screen.getByRole("button", { name: /draft reply/i }));
    expect(await screen.findByText("Your reply already has text")).toBeTruthy();
    expect(box().value).toBe("My own start");
    await user.click(screen.getByRole("button", { name: /replace with draft/i }));
    await waitFor(() => expect(box().value).toBe(TEXT));
  });

  it("says when no safe draft is available and leaves the composer alone", async () => {
    setup({ generate: () => reply({ success: true, status: "insufficient_context", reason: "unsupported_request" }) });
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    expect(await screen.findByText("No safe draft available")).toBeTruthy();
    expect(screen.getByText(/not covered by the available reply wording/)).toBeTruthy();
    expect(box().value).toBe("");
  });

  it("reports a generation failure and offers a retry that works", async () => {
    let calls = 0;
    setup({ generate: () => (++calls === 1 ? reply({ success: false, available: false, reason: "unavailable" }) : reply({ success: true, status: "ready", insight: draft() })) });
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    expect(await screen.findByText(/not available right now/i)).toBeTruthy();
    expect(screen.getByText(/keep writing the reply yourself/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(box().value).toBe(TEXT));
  });

  it("reports safety-check rejections and HTTP failures without breaking the composer", async () => {
    setup({ generate: () => reply({ success: false, available: false, reason: "validation_failed" }) });
    const user = userEvent.setup();
    const view = renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    expect(await screen.findByText(/did not pass the safety checks/i)).toBeTruthy();
    view.unmount();

    setup({ generate: () => reply({}, 500) });
    renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    expect(await screen.findByText(/could not be completed/i)).toBeTruthy();
    await user.type(box(), "still works");
    expect(box().value).toBe("still works");
  });

  it("shows a stored draft as out of date when the customer has written since", async () => {
    setup({ stored: draft({ stale: true }) });
    renderHarness();
    expect(await screen.findByText("Draft is out of date")).toBeTruthy();
    expect(screen.getByText(/customer has written since this draft was made/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /draft again/i })).toBeTruthy();
    expect(box().value).toBe(""); // never inserted on its own
  });

  it("re-reads the draft when the conversation changes, so a new message makes it stale", async () => {
    const state = setup({ stored: draft({ stale: false }) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <Harness version={1} />
      </QueryClientProvider>
    );
    expect(await screen.findByText("Draft ready")).toBeTruthy();
    state.stored = draft({ stale: true });
    view.rerender(
      <QueryClientProvider client={client}>
        <Harness version={2} />
      </QueryClientProvider>
    );
    expect(await screen.findByText("Draft is out of date")).toBeTruthy();
  });

  it("records feedback only when the agent sends: unchanged, or edited", async () => {
    setup();
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    await waitFor(() => expect(box().value).toBe(TEXT));
    expect(feedback()).toEqual([]);
    await user.type(box(), " Edited.");
    await user.click(screen.getByRole("button", { name: /send reply/i }));
    await waitFor(() => expect(feedback()).toEqual(["used_edited"]));
    expect(server.calls.filter((c) => c === "SEND reply")).toHaveLength(1);

    setup();
    await user.click(screen.getByRole("button", { name: /draft again|draft reply/i }));
    await waitFor(() => expect(box().value).toBe(TEXT));
    await user.click(screen.getByRole("button", { name: /send reply/i }));
    await waitFor(() => expect(feedback()).toEqual(["used_unchanged"]));
  });

  it("dismissing records it and clears the untouched draft from the composer", async () => {
    setup();
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    await waitFor(() => expect(box().value).toBe(TEXT));
    await user.click(screen.getByRole("button", { name: /^dismiss$/i }));
    await waitFor(() => expect(feedback()).toEqual(["dismissed"]));
    await waitFor(() => expect(box().value).toBe(""));
    expect(server.calls.filter((c) => c.startsWith("SEND"))).toEqual([]);
  });

  it("keeps the agent's edits when dismissing an edited draft", async () => {
    setup();
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    await waitFor(() => expect(box().value).toBe(TEXT));
    await user.type(box(), " My addition.");
    await user.click(screen.getByRole("button", { name: /^dismiss$/i }));
    await waitFor(() => expect(feedback()).toEqual(["dismissed"]));
    expect(box().value).toBe(`${TEXT} My addition.`);
  });

  it("only ever talks to Node's /v1/ai endpoints", async () => {
    setup();
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByRole("button", { name: /draft reply/i }));
    await waitFor(() => expect(box().value).toBe(TEXT));
    for (const call of server.calls.filter((c) => !c.startsWith("SEND"))) expect(call).toMatch(/^(GET|POST) \/v1\/ai\//);
    expect(server.calls.join(" ")).not.toMatch(/8100|intelligence|reply-draft-python/);
  });
});
