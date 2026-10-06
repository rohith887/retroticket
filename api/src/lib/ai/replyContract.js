// Node-side validation of the Python POST /api/v1/reply-draft response. Node never trusts what comes back: the shape is checked
// strictly and, independently of Python's own validator, the text is checked again for anything a customer reply must not
// contain. Anything unexpected is rejected and nothing is stored or shown.
const STATUSES = new Set(['ready', 'insufficient_context', 'validation_failed']);
const REASONS = new Set(['no_customer_message', 'ambiguous_state', 'unknown_intent', 'unsupported_request', 'missing_entity', 'no_safe_pattern']);
const SOURCE_TYPES = new Set(['claim', 'verified_fact', 'pattern']);
const MAX_BODY = 1500;
const MAX_SENTENCE = 300;
const MAX_SENTENCES = 10;

class ContractError extends Error {}
const fail = (why) => {
  throw new ContractError(why);
};
const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

// Independent safety net. These are not wording knowledge: they describe what an automatically drafted reply must never say.
const UNSAFE = [
  ['digits_or_dates', /\d|\b(yesterday|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i],
  ['link_or_address', /https?:|www\.|@|\.(com|org|net|in|io)\b/i],
  ['placeholder_or_internal_marker', /\{\{|\}\}|\[\[|\[agent\]|internal|<[a-z/]/i],
  ['promise_or_completion', /\b(we will|we'll|will be (approved|completed|resolved|verified|processed)|has been (approved|completed|verified)|guarantee|shortly|as soon as|within|refund|reimburs)/i],
  ['receipt_claim', /\b(we|our team) (have |has )?(received|rejected|approved)\b|\b(has|have|was|were) been received\b/i],
];

function unsafeCheck(text) {
  for (const [name, pattern] of UNSAFE) if (pattern.test(text)) return name;
  return null;
}

function validateReplyResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('not an object');
  const { replyDraft: draft, meta, replyKnowledge } = body;
  if (!draft || typeof draft !== 'object' || !STATUSES.has(draft.status)) fail('status');
  if (!meta || !isText(meta.provider, 64) || !isText(meta.engineVersion, 32) || !isText(meta.knowledge, 96)) fail('meta');
  if (!replyKnowledge || !isText(replyKnowledge.id, 64) || !isText(replyKnowledge.version, 16) || !isText(replyKnowledge.contentHash, 16)) fail('replyKnowledge');
  if (!isText(draft.knowledge, 120) || draft.knowledge !== `${replyKnowledge.id}@${replyKnowledge.version}+${replyKnowledge.contentHash}`) fail('reply knowledge fingerprint');

  const normalisedMeta = {
    provider: meta.provider,
    model: typeof meta.model === 'string' ? meta.model.slice(0, 64) : null,
    version: typeof meta.version === 'string' ? meta.version.slice(0, 32) : null,
    latencyMs: typeof meta.latencyMs === 'number' ? meta.latencyMs : null,
    requestId: typeof meta.requestId === 'string' ? meta.requestId.slice(0, 64) : null,
    engineVersion: meta.engineVersion,
    knowledgeVersion: meta.knowledge,
    componentVersions: { ...(meta.componentVersions && typeof meta.componentVersions === 'object' && !Array.isArray(meta.componentVersions) ? meta.componentVersions : {}) },
  };
  for (const c of Array.isArray(body.components) ? body.components : []) if (c && isText(c.name, 40) && isText(c.version, 16)) normalisedMeta.componentVersions[c.name] = c.version;
  normalisedMeta.componentVersions['reply-patterns'] = draft.knowledge;
  const featureSnapshot = body.featureSnapshot && typeof body.featureSnapshot === 'object' && !Array.isArray(body.featureSnapshot) ? body.featureSnapshot : null;

  if (draft.status === 'validation_failed') {
    const checks = Array.isArray(draft.failures) ? draft.failures.map((f) => String(f && f.check).slice(0, 40)) : [];
    return { status: 'validation_failed', failures: checks, meta: normalisedMeta, featureSnapshot };
  }
  if (draft.status === 'insufficient_context') {
    if (!REASONS.has(draft.reason)) fail('reason');
    if (draft.body !== '' || (Array.isArray(draft.sentences) && draft.sentences.length)) fail('insufficient draft must be empty');
    return { status: 'insufficient_context', reason: draft.reason, detail: typeof draft.detail === 'string' ? draft.detail.slice(0, 40) : null, meta: normalisedMeta, featureSnapshot };
  }

  // ready
  if (!isText(draft.body, MAX_BODY)) fail('body');
  if (!Array.isArray(draft.sentences) || draft.sentences.length < 1 || draft.sentences.length > MAX_SENTENCES) fail('sentences');
  const sentences = draft.sentences.map((s) => {
    if (!s || !isText(s.text, MAX_SENTENCE) || !s.source || !SOURCE_TYPES.has(s.source.type) || !isText(s.source.patternId, 64)) fail('sentence');
    const factIds = Array.isArray(s.source.factIds) ? s.source.factIds : fail('factIds');
    if (factIds.length > 5 || !factIds.every((f) => isText(f, 40))) fail('factIds');
    if (s.source.type !== 'pattern' && factIds.length < 1) fail('sentence without supporting facts');
    if (s.source.type === 'pattern' && factIds.length) fail('pattern with facts');
    const source = { type: s.source.type, patternId: s.source.patternId, factIds };
    if (s.source.type === 'claim') {
      if (!isText(s.source.messageId, 64) || !Number.isInteger(s.source.sentenceIndex)) fail('claim provenance');
      source.messageId = s.source.messageId;
      source.sentenceIndex = s.source.sentenceIndex;
    }
    const unsafe = unsafeCheck(s.text);
    if (unsafe) fail(`unsafe sentence (${unsafe})`);
    return { text: s.text, source };
  });
  if (sentences.map((s) => s.text).join(' ') !== draft.body) fail('body does not match the sentences');
  if (!Array.isArray(draft.warnings) || draft.warnings.length > 5 || !draft.warnings.every((w) => isText(w, 300))) fail('warnings');
  if (!isText(draft.intent, 48)) fail('intent');
  return {
    status: 'ready',
    draft: {
      body: draft.body,
      sentences,
      warnings: draft.warnings,
      intent: draft.intent,
      state: typeof draft.state === 'string' ? draft.state.slice(0, 24) : null,
      generator: draft.generator && isText(draft.generator.name, 40) && isText(draft.generator.version, 16) ? { name: draft.generator.name, version: draft.generator.version } : null,
      replyKnowledge: draft.knowledge,
    },
    meta: normalisedMeta,
    featureSnapshot,
  };
}

module.exports = { validateReplyResponse, ContractError, unsafeCheck };
