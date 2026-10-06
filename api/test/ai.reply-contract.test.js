// Node validation of the Python reply-draft response: pure function, no database or network.
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateReplyResponse, ContractError, unsafeCheck } = require('../src/lib/ai/replyContract');

const KNOWLEDGE = { id: 'verification-support-replies', version: '0.1.0', contentHash: 'abc123def456' };
const FINGERPRINT = 'verification-support-replies@0.1.0+abc123def456';

const ready = (over = {}) => ({
  engineVersion: '3a.1',
  knowledge: { id: 'verification-support' },
  replyKnowledge: KNOWLEDGE,
  components: [{ name: 'rules-reply', version: '0.1' }],
  replyDraft: {
    status: 'ready',
    body: 'Thank you for your message. You mentioned that you submitted your passport.',
    sentences: [
      { text: 'Thank you for your message.', source: { type: 'pattern', patternId: 'opening', factIds: [] } },
      { text: 'You mentioned that you submitted your passport.', source: { type: 'claim', patternId: 'claim.action', factIds: ['f1'], messageId: 'c1', sentenceIndex: 0 } },
    ],
    intent: 'document_issue',
    state: 'awaiting_support',
    warnings: ['Built from draft reply patterns that have not been approved. Read and edit before sending.'],
    generator: { name: 'rules-reply', version: '0.1' },
    knowledge: FINGERPRINT,
  },
  meta: { provider: 'local_rules', model: 'rules-lexicon', version: '1.0', latencyMs: 2, requestId: 'r1', engineVersion: '3a.1', knowledge: 'verification-support@0.1.0+5d4e92e70ad1', componentVersions: { 'rules-state': '0.1' } },
  featureSnapshot: { reply: { status: 'ready' } },
  ...over,
});
const withDraft = (patch) => ready({ replyDraft: { ...ready().replyDraft, ...patch } });

test('a well-formed ready draft is accepted and versions are collected', () => {
  const ok = validateReplyResponse(ready());
  assert.equal(ok.status, 'ready');
  assert.equal(ok.draft.sentences.length, 2);
  assert.equal(ok.meta.knowledgeVersion, 'verification-support@0.1.0+5d4e92e70ad1');
  assert.deepEqual(ok.meta.componentVersions, { 'rules-state': '0.1', 'rules-reply': '0.1', 'reply-patterns': FINGERPRINT });
});

test('insufficient context and validation failures are structured and carry no draft', () => {
  const insufficient = validateReplyResponse(withDraft({ status: 'insufficient_context', reason: 'unsupported_request', body: '', sentences: [] }));
  assert.deepEqual([insufficient.status, insufficient.reason], ['insufficient_context', 'unsupported_request']);
  const failed = validateReplyResponse(withDraft({ status: 'validation_failed', body: '', sentences: [], failures: [{ check: 'stale_context' }] }));
  assert.deepEqual([failed.status, failed.failures], ['validation_failed', ['stale_context']]);
  assert.throws(() => validateReplyResponse(withDraft({ status: 'insufficient_context', reason: 'made_up', body: '', sentences: [] })), ContractError);
  assert.throws(() => validateReplyResponse(withDraft({ status: 'insufficient_context', reason: 'no_safe_pattern', body: 'sneaky', sentences: [] })), ContractError);
});

test('malformed drafts are rejected', () => {
  const s = (text, source) => ({ text, source });
  const good = ready().replyDraft.sentences;
  const bad = [
    null,
    [],
    ready({ replyDraft: null }),
    ready({ meta: null }),
    withDraft({ status: 'sent' }),
    withDraft({ body: '' }),
    withDraft({ body: 'Different from the sentences.' }),
    withDraft({ sentences: [] }),
    withDraft({ sentences: [...good, ...Array(9).fill(good[0])], body: [...good, ...Array(9).fill(good[0])].map((x) => x.text).join(' ') }),
    withDraft({ warnings: 'none' }),
    withDraft({ intent: '' }),
    withDraft({ knowledge: 'another@9.9.9+000' }),
    withDraft({ sentences: [s('Thank you for your message.', { type: 'opinion', patternId: 'x', factIds: [] })], body: 'Thank you for your message.' }),
    withDraft({ sentences: [s('You mentioned that you submitted your passport.', { type: 'claim', patternId: 'claim.action', factIds: [], messageId: 'c1', sentenceIndex: 0 })], body: 'You mentioned that you submitted your passport.' }),
    withDraft({ sentences: [s('Thank you for your message.', { type: 'pattern', patternId: 'opening', factIds: ['f1'] })], body: 'Thank you for your message.' }),
  ];
  for (const body of bad) assert.throws(() => validateReplyResponse(body), ContractError);
});

test('unsafe wording is rejected even if Python let it through', () => {
  const unsafe = [
    'We received your passport and it will be approved within 3 days.',
    'You mentioned that your passport was rejected on Monday.',
    'You mentioned your passport. See https://example.org/help',
    'Call us on 0123456789.',
    'We will refund you shortly.',
    'Write to help@example.com.',
    'Hello {{customer_name}}.',
    'This came from an internal note.',
    'We have rejected your passport.',
  ];
  for (const text of unsafe) {
    assert.ok(unsafeCheck(text), text);
    const draft = withDraft({ sentences: [{ text, source: { type: 'pattern', patternId: 'opening', factIds: [] } }], body: text });
    assert.throws(() => validateReplyResponse(draft), ContractError, text);
  }
  for (const text of ['Thank you for your message.', 'You mentioned that you submitted your passport three times and that it was rejected.', 'Our records show this ticket as in progress.']) assert.equal(unsafeCheck(text), null, text);
});
