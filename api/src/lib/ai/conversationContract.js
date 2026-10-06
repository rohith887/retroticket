// Node-side validation of the Python POST /api/v1/analyze-conversation response. Node never trusts the shape of what comes back:
// anything unexpected is rejected as invalid_response and nothing is stored.
const SECTIONS = new Set(['request', 'claim', 'verified', 'state']);
const REVIEWS = new Set(['established', 'needs_review']);
const PENDING = new Set(['unanswered_question', 'information_requested', 'support_commitment', 'unanswered_request']);
const STATES = new Set(['resolved', 'awaiting_support', 'awaiting_customer', 'unresolved', 'unknown']);

class ContractError extends Error {}

const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const fail = (why) => {
  throw new ContractError(why);
};

function validateConversationResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('not an object');
  const { summary, state, meta, knowledge, featureSnapshot } = body;
  if (!summary || typeof summary !== 'object') fail('summary');
  if (!isText(summary.text, 4000)) fail('summary text');
  if (!Array.isArray(summary.lines) || summary.lines.length < 1 || summary.lines.length > 20) fail('summary lines');
  const lines = summary.lines.map((line) => {
    if (!line || !SECTIONS.has(line.section) || !isText(line.text, 400) || !REVIEWS.has(line.review)) fail('summary line');
    const factIds = Array.isArray(line.factIds) ? line.factIds : fail('line factIds');
    const sources = Array.isArray(line.sources) ? line.sources : fail('line sources');
    if (factIds.length > 5 || !factIds.every((f) => isText(f, 40))) fail('line factIds');
    if (sources.length > 5 || !sources.every((s) => s && isText(s.messageId, 64) && (s.sentenceIndex === null || Number.isInteger(s.sentenceIndex)))) fail('line sources');
    return { section: line.section, text: line.text, factIds, sources: sources.map((s) => ({ messageId: s.messageId, sentenceIndex: s.sentenceIndex })), review: line.review };
  });
  if (!Array.isArray(summary.warnings) || summary.warnings.length > 10 || !summary.warnings.every((w) => isText(w, 300))) fail('summary warnings');
  const pending = Array.isArray(summary.pending) ? summary.pending : fail('summary pending');
  if (pending.length > 60 || !pending.every((p) => p && PENDING.has(p.kind) && isText(p.messageId, 64))) fail('summary pending');
  if (!state || !STATES.has(state.state) || (state.ruleId !== null && !isText(state.ruleId, 8))) fail('state');
  if (!meta || !isText(meta.provider, 64) || !isText(meta.knowledge, 96) || !isText(meta.engineVersion, 32)) fail('meta');
  if (!isText(summary.knowledge, 96) || summary.knowledge !== meta.knowledge) fail('knowledge');
  return {
    summary: {
      text: summary.text,
      lines,
      warnings: summary.warnings,
      pending: pending.map((p) => ({ kind: p.kind, messageId: p.messageId, sentenceIndex: Number.isInteger(p.sentenceIndex) ? p.sentenceIndex : null })),
      realiser: summary.realiser && isText(summary.realiser.name, 40) && isText(summary.realiser.version, 16) ? { name: summary.realiser.name, version: summary.realiser.version } : null,
      state: { state: state.state, ruleId: state.ruleId, ruleReview: state.ruleReview === 'needs_review' ? 'needs_review' : 'established' },
    },
    meta: {
      provider: meta.provider,
      model: typeof meta.model === 'string' ? meta.model.slice(0, 64) : null,
      version: typeof meta.version === 'string' ? meta.version.slice(0, 32) : null,
      latencyMs: typeof meta.latencyMs === 'number' ? meta.latencyMs : null,
      requestId: typeof meta.requestId === 'string' ? meta.requestId.slice(0, 64) : null,
      engineVersion: meta.engineVersion,
      knowledgeVersion: meta.knowledge,
      componentVersions: meta.componentVersions && typeof meta.componentVersions === 'object' && !Array.isArray(meta.componentVersions) ? meta.componentVersions : null,
    },
    featureSnapshot: featureSnapshot && typeof featureSnapshot === 'object' && !Array.isArray(featureSnapshot) ? featureSnapshot : null,
    knowledge,
  };
}

module.exports = { validateConversationResponse, ContractError };
