// Run with: npm test   (node:test, no database needed)
const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveReadSeq, unreadFor } = require('../src/lib/unread');

test('effective read position is the larger of the user read state and the thread baseline', () => {
  assert.equal(effectiveReadSeq({ readBaselineSeq: 5 }, { lastReadSeq: 3 }), 5);
  assert.equal(effectiveReadSeq({ readBaselineSeq: 2 }, { lastReadSeq: 7 }), 7);
  assert.equal(effectiveReadSeq({}, null), 0);
});

test('unread is the number of messages after the read position, never negative', () => {
  assert.equal(unreadFor({ lastSeq: 10, readBaselineSeq: 0 }, { lastReadSeq: 4 }), 6);
  assert.equal(unreadFor({ lastSeq: 10, readBaselineSeq: 8 }, null), 2);
  assert.equal(unreadFor({ lastSeq: 3, readBaselineSeq: 0 }, { lastReadSeq: 9 }), 0);
  assert.equal(unreadFor({}, null), 0);
});

test('two users have independent unread counts on the same thread', () => {
  const thread = { lastSeq: 6, readBaselineSeq: 0 };
  assert.equal(unreadFor(thread, { lastReadSeq: 6 }), 0); // opened it
  assert.equal(unreadFor(thread, null), 6); // never opened it
});
