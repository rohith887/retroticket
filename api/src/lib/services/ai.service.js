// Node -> Python intelligence client.
//
// Rules this module enforces:
//   * AI is an enhancement. Nothing here throws to callers: every function resolves to { ok, ... } and a failure (service
//     down, slow, unauthorised, rate limited, bad output) only means "no insight this time".
//   * Python only advises. Results are stored as AiInsight (status "suggested"); only a user action applies anything.
//   * Only sanitised message text and opaque ids leave this process (see sanitizeForAi). Never credentials or auth data.
//   * The browser never calls Python. Python is reached only from here, with the internal service token.
const crypto = require('crypto');
const AiInsight = require('../../models/AiInsight');
const { sanitizeForAi, MAX_TEXT_CHARS } = require('../ai/sanitize');
const { buildConversationRequest } = require('../ai/contextBuilder');
const { validateConversationResponse, ContractError } = require('../ai/conversationContract');
const { validateReplyResponse, ContractError: ReplyContractError } = require('../ai/replyContract');
const Ticket = require('../../models/Ticket');

const SENTIMENTS = new Set(['positive', 'neutral', 'negative', 'frustrated']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const LOW_CONFIDENCE = 0.5;

/** Read at call time so tests and process managers can change the environment. */
function config() {
  const token = String(process.env.INTELLIGENCE_TOKEN || '').trim();
  const flag = String(process.env.AI_ENABLED || '').trim().toLowerCase();
  return {
    // Off unless a token is configured, and off when explicitly disabled.
    enabled: Boolean(token) && flag !== 'false' && flag !== '0',
    baseUrl: String(process.env.INTELLIGENCE_URL || 'http://127.0.0.1:8100').replace(/\/+$/, ''),
    token,
    timeoutMs: Math.max(200, Number(process.env.AI_TIMEOUT_MS || 3000)),
    failureThreshold: Math.max(1, Number(process.env.AI_FAILURE_THRESHOLD || 3)),
    cooldownMs: Math.max(1000, Number(process.env.AI_CIRCUIT_COOLDOWN_MS || 30000)),
    autoAnalyze: String(process.env.AI_AUTO_ANALYZE || '').trim().toLowerCase() === 'true',
  };
}

/* ------------------------------ circuit breaker ------------------------------ */
// After several consecutive failures the service is skipped for a short cooldown, so a dead or slow Python process costs
// one fast check instead of a timeout on every call.
const breaker = { failures: 0, openUntil: 0 };

function circuitOpen() {
  return Date.now() < breaker.openUntil;
}
function recordSuccess() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}
function recordFailure(cfg) {
  breaker.failures += 1;
  if (breaker.failures >= cfg.failureThreshold) breaker.openUntil = Date.now() + cfg.cooldownMs;
}
function resetCircuit() {
  recordSuccess();
}

/* ------------------------------ response validation ------------------------------ */

class AiError extends Error {
  constructor(reason, detail) {
    super(detail || reason);
    this.name = 'AiError';
    this.reason = reason; // disabled | circuit_open | timeout | unavailable | unauthorized | rate_limited | invalid_response | provider_error | invalid_request
  }
}

const isConfidence = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const isText = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;

function validateAnalysis(body) {
  const bad = (why) => new AiError('invalid_response', `Unexpected response from the intelligence service: ${why}`);
  if (!body || typeof body !== 'object') throw bad('not an object');
  const { sentiment, intent, priority, meta } = body;
  if (!sentiment || !SENTIMENTS.has(sentiment.label) || !isConfidence(sentiment.confidence)) throw bad('sentiment');
  if (!intent || !isText(intent.label, 48) || !isConfidence(intent.confidence)) throw bad('intent');
  if (!priority || !PRIORITIES.has(priority.label) || !isConfidence(priority.confidence)) throw bad('priority');
  if (!Array.isArray(priority.reasons) || priority.reasons.length > 10 || !priority.reasons.every((r) => isText(r, 200))) throw bad('priority reasons');
  const alternatives = Array.isArray(intent.alternatives) ? intent.alternatives : [];
  if (alternatives.length > 5 || !alternatives.every((a) => a && isText(a.label, 48) && isConfidence(a.confidence))) throw bad('intent alternatives');
  if (!meta || !isText(meta.provider, 64)) throw bad('meta');
  return {
    sentiment: { label: sentiment.label, confidence: sentiment.confidence },
    intent: { label: intent.label, confidence: intent.confidence, alternatives: alternatives.map((a) => ({ label: a.label, confidence: a.confidence })) },
    priority: { label: priority.label, confidence: priority.confidence, reasons: priority.reasons },
    meta: {
      provider: meta.provider,
      model: typeof meta.model === 'string' ? meta.model.slice(0, 64) : null,
      version: typeof meta.version === 'string' ? meta.version.slice(0, 32) : null,
      latencyMs: typeof meta.latencyMs === 'number' ? meta.latencyMs : null,
      requestId: typeof meta.requestId === 'string' ? meta.requestId.slice(0, 64) : null,
      engineVersion: typeof meta.engineVersion === 'string' ? meta.engineVersion.slice(0, 32) : null,
      knowledgeVersion: typeof meta.knowledge === 'string' ? meta.knowledge.slice(0, 96) : null,
      componentVersions: meta.componentVersions && typeof meta.componentVersions === 'object' && !Array.isArray(meta.componentVersions) ? meta.componentVersions : null,
    },
  };
}

/* ------------------------------ HTTP call ------------------------------ */

async function post(path, payload, { requestId } = {}) {
  const cfg = config();
  if (!cfg.enabled) throw new AiError('disabled');
  if (circuitOpen()) throw new AiError('circuit_open');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    let response;
    try {
      response = await fetch(`${cfg.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.token}`,
          ...(requestId ? { 'X-Request-ID': requestId } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      recordFailure(cfg);
      throw new AiError(error?.name === 'AbortError' ? 'timeout' : 'unavailable');
    }

    if (response.status === 401 || response.status === 403) throw new AiError('unauthorized'); // a configuration problem, not an outage
    if (response.status === 429) {
      recordFailure(cfg);
      throw new AiError('rate_limited');
    }
    if (response.status === 422 || response.status === 413) throw new AiError('invalid_request');
    if (!response.ok) {
      recordFailure(cfg);
      if (response.status === 504) throw new AiError('timeout');
      throw new AiError(response.status >= 500 && response.status !== 503 ? 'provider_error' : 'unavailable');
    }

    let body;
    try {
      body = await response.json();
    } catch {
      recordFailure(cfg);
      throw new AiError('invalid_response', 'The intelligence service returned invalid JSON');
    }
    recordSuccess();
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ public API ------------------------------ */

/**
 * Analyse one customer message and store the insights. Never throws.
 *   -> { ok: true, insights: [AiInsight x3], analysisId }
 *   -> { ok: false, reason }        (disabled, timeout, unavailable, unauthorized, rate_limited, invalid_response, ...)
 */
async function analyzeMessage({ ticketId, conversationId = null, messageId = null, messageRef = 'comment', text, requestedBy = null, trigger = 'manual', requestId = null }) {
  try {
    const clean = sanitizeForAi(text);
    if (!clean) return { ok: false, reason: 'empty_text' };

    const body = validateAnalysis(
      await post(
        '/api/v1/analyze-message',
        {
          ticketId: ticketId ? String(ticketId) : undefined,
          conversationId: conversationId ? String(conversationId) : undefined,
          messageId: messageId ? String(messageId) : undefined,
          text: clean,
        },
        { requestId }
      )
    );

    const analysisId = crypto.randomUUID();
    const common = {
      ticketId,
      conversationId,
      messageId,
      messageRef,
      analysisId,
      provider: body.meta.provider,
      model: body.meta.model,
      providerVersion: body.meta.version,
      requestId: body.meta.requestId,
      latencyMs: body.meta.latencyMs,
      engineVersion: body.meta.engineVersion,
      knowledgeVersion: body.meta.knowledgeVersion,
      componentVersions: body.meta.componentVersions,
      requestedBy,
      trigger,
    };
    const insights = await AiInsight.insertMany(
      ['sentiment', 'intent', 'priority'].map((type) => ({
        ...common,
        type,
        result: body[type],
        confidence: body[type].confidence,
        lowConfidence: body[type].confidence < LOW_CONFIDENCE,
      }))
    );
    return { ok: true, analysisId, insights };
  } catch (error) {
    const reason = error instanceof AiError ? error.reason : 'internal_error';
    if (reason !== 'disabled') console.warn(`AI analysis skipped (${reason})`); // reason only: never message text
    return { ok: false, reason };
  }
}

/**
 * Build the conversation summary for a ticket with the internal engine and store it as an AiInsight (type "summary").
 * Node builds and sanitizes the context (internal notes excluded), the engine derives facts and a template summary from it,
 * and Node validates the response before storing. If the newest stored summary was made from the same context by the same
 * engine and knowledge version, it is returned instead of a duplicate. Never throws.
 *   -> { ok: true, insight, reused }  |  { ok: false, reason }
 */
async function summarizeConversation({ ticket, comments = [], activities = [], requestedBy = null, requestId = null }) {
  try {
    const built = buildConversationRequest({ ticket, comments, activities, includeInternalNotes: false });
    if (!built.request.messages.some((m) => m.role === 'customer' || m.role === 'agent')) return { ok: false, reason: 'empty_text' };

    let checked;
    try {
      checked = validateConversationResponse(await post('/api/v1/analyze-conversation', built.request, { requestId }));
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      recordFailure(config());
      throw new AiError('invalid_response', error.message);
    }

    const latest = await AiInsight.findOne({ ticketId: ticket._id, type: 'summary' }).sort({ createdAt: -1 });
    if (latest && latest.contextHash === built.contextHash && latest.engineVersion === checked.meta.engineVersion && latest.knowledgeVersion === checked.meta.knowledgeVersion) {
      return { ok: true, insight: latest, reused: true };
    }

    const warnings = [...checked.summary.warnings];
    if (built.omitted.count > 0) warnings.push(`${built.omitted.count} earlier message(s) were not included, so this summary is based on partial context.`);
    const insight = await AiInsight.create({
      ticketId: ticket._id,
      analysisId: crypto.randomUUID(),
      type: 'summary',
      result: { ...checked.summary, warnings },
      provider: checked.meta.provider,
      model: checked.meta.model,
      providerVersion: checked.meta.version,
      requestId: checked.meta.requestId,
      latencyMs: checked.meta.latencyMs,
      engineVersion: checked.meta.engineVersion,
      knowledgeVersion: checked.meta.knowledgeVersion,
      componentVersions: checked.meta.componentVersions,
      featureSnapshot: checked.featureSnapshot,
      contextHash: built.contextHash,
      basedOnSeq: built.basedOnSeq,
      audience: 'agent',
      inputChars: built.stats.inputChars,
      warnings,
      usedInternalNotes: built.usedInternalNotes,
      requestedBy,
      trigger: 'manual',
    });
    return { ok: true, insight, reused: false };
  } catch (error) {
    const reason = error instanceof AiError ? error.reason : 'internal_error';
    if (reason !== 'disabled') console.warn(`AI summary skipped (${reason})`); // reason only: never message text
    return { ok: false, reason };
  }
}

/**
 * Draft an editable customer reply with the internal engine and store it as an AiInsight (type "reply_draft").
 * Node builds the context (internal notes are never included and there is no override), the engine drafts from facts, and
 * Node validates the response again before storing. The draft is tied to the conversation sequence it was built from
 * (`basedOnSeq`); if the ticket moved on while generating, nothing is stored. An identical, current, undismissed draft is
 * reused. Never throws; never sends anything.
 *   -> { ok: true, status: 'ready', insight, reused } | { ok: true, status: 'insufficient_context', reason }
 *   -> { ok: false, reason }
 */
async function draftReply({ ticket, comments = [], activities = [], requestedBy = null, requestId = null }) {
  try {
    const built = buildConversationRequest({ ticket, comments, activities, includeInternalNotes: false });
    const messages = built.request.messages.filter((m) => m.role !== 'internal_note'); // defence in depth: the builder already drops them
    if (!messages.some((m) => m.role === 'customer')) return { ok: true, status: 'insufficient_context', reason: 'no_customer_message' };
    const request = { ...built.request, messages, sequence: { basedOn: built.basedOnSeq, current: built.basedOnSeq } };

    let checked;
    try {
      checked = validateReplyResponse(await post('/api/v1/reply-draft', request, { requestId }));
    } catch (error) {
      if (!(error instanceof ReplyContractError)) throw error;
      recordFailure(config());
      throw new AiError('invalid_response', error.message);
    }
    if (checked.status === 'validation_failed') return { ok: false, reason: 'validation_failed', failures: checked.failures };
    if (checked.status === 'insufficient_context') return { ok: true, status: 'insufficient_context', reason: checked.reason };

    // The conversation may have moved on while the engine was working: a draft for an old sequence is never stored.
    const current = await Ticket.findById(ticket._id).select('lastSeq').lean();
    if (!current || Number(current.lastSeq || 0) > built.basedOnSeq) return { ok: false, reason: 'stale_context' };

    const knowledgeVersion = checked.meta.knowledgeVersion;
    const latest = await AiInsight.findOne({ ticketId: ticket._id, type: 'reply_draft' }).sort({ createdAt: -1 });
    if (
      latest && latest.status === 'suggested' && latest.contextHash === built.contextHash && latest.basedOnSeq === built.basedOnSeq &&
      latest.engineVersion === checked.meta.engineVersion && latest.knowledgeVersion === knowledgeVersion &&
      latest.componentVersions && latest.componentVersions['reply-patterns'] === checked.draft.replyKnowledge
    ) {
      return { ok: true, status: 'ready', insight: latest, reused: true };
    }

    const insight = await AiInsight.create({
      ticketId: ticket._id,
      analysisId: crypto.randomUUID(),
      type: 'reply_draft',
      result: { status: 'ready', ...checked.draft },
      provider: checked.meta.provider,
      model: checked.meta.model,
      providerVersion: checked.meta.version,
      requestId: checked.meta.requestId,
      latencyMs: checked.meta.latencyMs,
      engineVersion: checked.meta.engineVersion,
      knowledgeVersion,
      componentVersions: checked.meta.componentVersions,
      featureSnapshot: checked.featureSnapshot,
      contextHash: built.contextHash,
      basedOnSeq: built.basedOnSeq,
      audience: 'customer',
      inputChars: built.stats.inputChars,
      warnings: checked.draft.warnings,
      usedInternalNotes: false,
      requestedBy,
      trigger: 'manual',
    });
    return { ok: true, status: 'ready', insight, reused: false };
  } catch (error) {
    const reason = error instanceof AiError ? error.reason : 'internal_error';
    if (reason !== 'disabled') console.warn(`AI reply draft skipped (${reason})`); // reason only: never message text
    return { ok: false, reason };
  }
}

/** Fire-and-forget wrapper for background use after a message is stored. Cannot reject. */
function analyzeInBackground(args) {
  setImmediate(() => {
    analyzeMessage({ ...args, trigger: 'auto' }).catch(() => {});
  });
}

/** Is the feature configured, and does the service answer? (For the UI to decide whether to show AI actions.) */
async function status() {
  const cfg = config();
  if (!cfg.enabled) return { enabled: false, available: false, reason: 'not_configured' };
  if (circuitOpen()) return { enabled: true, available: false, reason: 'circuit_open' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 1500));
  try {
    const response = await fetch(`${cfg.baseUrl}/ready`, { signal: controller.signal });
    return { enabled: true, available: response.ok, reason: response.ok ? null : 'not_ready' };
  } catch {
    return { enabled: true, available: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { draftReply, summarizeConversation, analyzeMessage, analyzeInBackground, status, sanitizeForAi, validateAnalysis, config, resetCircuit, AiError, LOW_CONFIDENCE };
