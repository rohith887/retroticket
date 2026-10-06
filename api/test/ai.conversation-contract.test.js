// Node validation of the Python analyze-conversation response: pure function, no database or network.
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateConversationResponse, ContractError } = require('../src/lib/ai/conversationContract');

const good = (over = {}) => ({
  summary: {
    text: 'The customer says they submitted the passport. The ticket status is open.',
    lines: [
      { section: 'claim', text: 'The customer says they submitted the passport.', factIds: ['f1'], sources: [{ messageId: 'c1', sentenceIndex: 0 }], review: 'needs_review' },
      { section: 'verified', text: 'The ticket status is open.', factIds: ['f2'], sources: [], review: 'established' },
    ],
    pending: [{ kind: 'unanswered_question', messageId: 'c1', sentenceIndex: 0 }],
    warnings: ['Based on a draft knowledge pack that has not been approved.'],
    realiser: { name: 'rules-summary', version: '1.0' },
    knowledge: 'verification-support@0.1.0+abc',
  },
  state: { state: 'awaiting_support', ruleId: 'R3', ruleReview: 'established' },
  meta: { provider: 'local_rules', model: 'rules-lexicon', version: '1.0', latencyMs: 3, requestId: 'r1', engineVersion: '3a.1', knowledge: 'verification-support@0.1.0+abc', componentVersions: { 'rules-state': '0.1' } },
  featureSnapshot: { messages: { total: 1 } },
  ...over,
});

test('a well-formed response is accepted and normalised', () => {
  const ok = validateConversationResponse(good());
  assert.equal(ok.summary.lines.length, 2);
  assert.equal(ok.meta.knowledgeVersion, 'verification-support@0.1.0+abc');
  assert.equal(ok.summary.state.ruleReview, 'established');
});

test('malformed or inconsistent responses are rejected', () => {
  const withSummary = (patch) => good({ summary: { ...good().summary, ...patch } });
  const bad = [
    null,
    [],
    good({ summary: null }),
    withSummary({ text: '' }),
    withSummary({ lines: [] }),
    withSummary({ lines: [{ section: 'opinion', text: 'x', factIds: [], sources: [], review: 'established' }] }),
    withSummary({ lines: [{ section: 'claim', text: 'x', factIds: [], sources: [], review: 'approved-by-me' }] }),
    withSummary({ warnings: 'none' }),
    withSummary({ pending: [{ kind: 'made_up', messageId: 'c1' }] }),
    withSummary({ knowledge: 'a-different-pack@9.9.9+zzz' }),
    good({ state: { state: 'exploded', ruleId: null } }),
    good({ meta: null }),
  ];
  for (const body of bad) assert.throws(() => validateConversationResponse(body), ContractError);
});
