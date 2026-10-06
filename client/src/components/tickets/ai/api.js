// Node AI endpoints (see apps/api/AI_INTEGRATION.md). React talks to Node only; Node talks to the Python service.
//   GET  /v1/ai/status                          -> { success, enabled, available, reason }
//   POST /v1/ai/tickets/:id/analyze             -> { success: true, analysisId, insights[] }
//                                                  | { success: false, available: false, reason }   (HTTP 200: AI down is not a server error)
//   GET  /v1/ai/tickets/:id/insights            -> { success, insights[] }   (latest analysis)
//   POST /v1/ai/insights/:id/accept | /dismiss  -> { success, insight }      (409 when already handled)
//
// insight = { _id, ticketId, type: sentiment|intent|priority, label, confidence, lowConfidence, reasons[], status,
//             applied, reviewedBy: { id, name } | null, reviewedAt, createdAt }

export const aiStatusKey = ["aiStatus"];
export const aiInsightsKey = (ticketId) => ["aiInsights", ticketId];

/** Thrown for accept / dismiss failures so the panel can tell "already handled" apart from a real error. */
export class AiApiError extends Error {
  constructor(message, { status, reason } = {}) {
    super(message);
    this.name = "AiApiError";
    this.status = status;
    this.reason = reason;
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchAiStatus(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/ai/status");
  if (!res.ok) throw new AiApiError("Could not read AI status", { status: res.status });
  return (await readJson(res)) || { enabled: false, available: false };
}

export async function fetchInsights(fetchWithAuth, ticketId) {
  const res = await fetchWithAuth(`/v1/ai/tickets/${ticketId}/insights`);
  if (!res.ok) throw new AiApiError("Could not load AI insights", { status: res.status });
  const data = await readJson(res);
  return Array.isArray(data?.insights) ? data.insights : [];
}

/** Resolves to { ok: true, insights } or { ok: false, reason }. Only a transport / server failure throws. */
export async function analyzeTicket(fetchWithAuth, ticketId) {
  const res = await fetchWithAuth(`/v1/ai/tickets/${ticketId}/analyze`, { method: "POST", body: JSON.stringify({}) });
  if (!res.ok) throw new AiApiError("The analysis request failed", { status: res.status });
  const data = await readJson(res);
  if (data?.success && Array.isArray(data.insights) && data.insights.length > 0) return { ok: true, insights: data.insights };
  if (data?.success) return { ok: false, reason: "empty_result" };
  return { ok: false, reason: data?.reason || "unavailable" };
}

async function review(fetchWithAuth, insightId, action) {
  const res = await fetchWithAuth(`/v1/ai/insights/${insightId}/${action}`, { method: "POST", body: JSON.stringify({}) });
  const data = await readJson(res);
  if (!res.ok || !data?.success) {
    throw new AiApiError(data?.message || `Could not ${action} this suggestion`, { status: res.status });
  }
  return data.insight;
}

export const acceptInsight = (fetchWithAuth, insightId) => review(fetchWithAuth, insightId, "accept");
export const dismissInsight = (fetchWithAuth, insightId) => review(fetchWithAuth, insightId, "dismiss");

// --- Conversation summary (deterministic, built by Node's internal engine) ---
//   GET  /v1/ai/tickets/:id/summary  -> { success, insight: summaryInsight | null }
//   POST /v1/ai/tickets/:id/summary  -> { success: true, reused, insight } | { success: false, available: false, reason }
//
// summaryInsight = { _id, summary: { text, lines[{ section, text, review, sources[] }], pending[], warnings[], state }, warnings[],
//                    knowledgeVersion, engineVersion, stale, createdAt }
export const aiSummaryKey = (ticketId) => ["aiSummary", ticketId];

export async function fetchSummary(fetchWithAuth, ticketId) {
  const res = await fetchWithAuth(`/v1/ai/tickets/${ticketId}/summary`);
  if (!res.ok) throw new AiApiError("Could not load the summary", { status: res.status });
  const data = await readJson(res);
  return data?.insight || null;
}

/** Resolves to { ok: true, insight, reused } or { ok: false, reason }. Only a transport / server failure throws. */
export async function generateSummary(fetchWithAuth, ticketId) {
  const res = await fetchWithAuth(`/v1/ai/tickets/${ticketId}/summary`, { method: "POST", body: JSON.stringify({}) });
  if (!res.ok) throw new AiApiError("The summary request failed", { status: res.status });
  const data = await readJson(res);
  if (data?.success && data.insight) return { ok: true, insight: data.insight, reused: Boolean(data.reused) };
  return { ok: false, reason: data?.reason || "unavailable" };
}

// --- Reply draft (deterministic and editable; nothing here sends a message) ---
//   GET  /v1/ai/tickets/:id/reply-draft   -> { success, insight: draft | null }   (newest open draft, `stale` when the customer wrote since)
//   POST /v1/ai/tickets/:id/reply-draft   -> { success: true, status: "ready", reused, insight }
//                                          | { success: true, status: "insufficient_context", reason }
//                                          | { success: false, available: false, reason }
//   POST /v1/ai/insights/:id/feedback     -> { success, status }   body { event: used_unchanged | used_edited | dismissed }
//
// draft = { _id, body, text (greeting + body + signature, ready for the composer), sentences[{ text, source }], warnings[], basedOnSeq, stale }
export const aiReplyDraftKey = (ticketId) => ["aiReplyDraft", ticketId];

export async function fetchReplyDraft(fetchWithAuth, ticketId) {
  const res = await fetchWithAuth(`/v1/ai/tickets/${ticketId}/reply-draft`);
  if (!res.ok) throw new AiApiError("Could not load the draft", { status: res.status });
  const data = await readJson(res);
  return data?.insight || null;
}

/** Resolves to { ok: true, status: "ready", insight } | { ok: true, status: "insufficient_context", reason } | { ok: false, reason }. */
export async function generateReplyDraft(fetchWithAuth, ticketId) {
  const res = await fetchWithAuth(`/v1/ai/tickets/${ticketId}/reply-draft`, { method: "POST", body: JSON.stringify({}) });
  if (!res.ok) throw new AiApiError("The draft request failed", { status: res.status });
  const data = await readJson(res);
  if (data?.success && data.status === "ready" && data.insight?.text) return { ok: true, status: "ready", insight: data.insight, reused: Boolean(data.reused) };
  if (data?.success && data.status === "insufficient_context") return { ok: true, status: "insufficient_context", reason: data.reason };
  return { ok: false, reason: data?.reason || "unavailable" };
}

export async function sendDraftFeedback(fetchWithAuth, insightId, event) {
  const res = await fetchWithAuth(`/v1/ai/insights/${insightId}/feedback`, { method: "POST", body: JSON.stringify({ event }) });
  if (!res.ok) throw new AiApiError("Could not record feedback", { status: res.status });
}
